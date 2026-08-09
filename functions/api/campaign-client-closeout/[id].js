import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking } from '../../lib/campaign-tracking.js';
import { parseCampaignPlanning } from '../../lib/campaign-planning.js';
import { parseCampaignActivation } from '../../lib/campaign-activation.js';
import { parseCampaignSettlement } from '../../lib/campaign-settlement.js';
import {
  CAMPAIGN_RENEWAL_RECOMMENDATIONS,
  parseCampaignClientCloseout,
  buildCampaignClientCloseoutSummary,
  campaignClientCloseoutFingerprint,
  assertCloseoutReportReady,
  assertCloseoutCompletionReady,
  clearCloseoutApproval,
} from '../../lib/campaign-client-closeout.js';

const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER']);
const text=(value,max=4000)=>String(value??'').trim().slice(0,max);
const upper=(value)=>text(value,100).toUpperCase();

function requireWrite(auth){if(!WRITE_ROLES.has(auth?.role)){const cause=new Error('Campaign closeout write permission is required');cause.status=403;throw cause;}}
function requireManager(auth){if(!MANAGER_ROLES.has(auth?.role)){const cause=new Error('Owner, Admin or BD Manager permission is required');cause.status=403;throw cause;}}
function validateDate(value){const raw=text(value,40);if(!raw)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)){const cause=new Error('Renewal target date must use YYYY-MM-DD');cause.status=422;throw cause;}return raw;}

async function loadCampaign(db,tenantId,id){return first(db,`
  SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,c.project_id,c.campaign_owner_id,
    p.name AS project_name
  FROM campaigns c
  JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id
  WHERE c.tenant_id=? AND c.id=?
  LIMIT 1
`,[tenantId,id]);}

function stateFromRow(row){
  const {root,tracking}=parseCampaignTracking(row.notes);
  const planning=parseCampaignPlanning(root);
  const activation=parseCampaignActivation(root);
  const settlement=parseCampaignSettlement(root);
  const closeout=parseCampaignClientCloseout(root);
  const summary=buildCampaignClientCloseoutSummary(tracking,planning,activation,settlement,closeout);
  return {root,tracking,planning,activation,settlement,closeout,summary};
}
function responseItem(row,state){return{
  id:row.id,name:row.name,projectId:row.project_id,projectName:row.project_name,campaignStatus:row.status,region:row.region,startDate:row.start_date,endDate:row.end_date,
  closeout:state.closeout,summary:state.summary,
};}
async function audit(db,tenantId,userId,action,campaignId,beforeData,afterData){
  await run(db,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[
    makeId('aud'),tenantId,userId,action,'CAMPAIGN_CLIENT_CLOSEOUT',campaignId,JSON.stringify(beforeData||{}),JSON.stringify(afterData||{}),nowIso(),
  ]);
}
async function save(db,tenantId,auth,row,state,nextCloseout,action){
  const nextRoot={...state.root,campaignClientCloseout:nextCloseout};
  const nextSummary=buildCampaignClientCloseoutSummary(state.tracking,state.planning,state.activation,state.settlement,nextCloseout);
  await run(db,'UPDATE campaigns SET notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[JSON.stringify(nextRoot),nowIso(),auth.userId,tenantId,row.id]);
  await audit(db,tenantId,auth.userId,action,row.id,{closeout:state.closeout,summary:state.summary},{closeout:nextCloseout,summary:nextSummary});
  return {root:nextRoot,tracking:state.tracking,planning:state.planning,activation:state.activation,settlement:state.settlement,closeout:nextCloseout,summary:nextSummary};
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;const tenantId=requireTenant(auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const row=await loadCampaign(context.env.DB,tenantId,context.params.id);
    if(!row)return error('Campaign engagement not found',404);
    const state=stateFromRow(row);
    return json({item:responseItem(row,state),permissions:{canWrite:WRITE_ROLES.has(auth.role),canManage:MANAGER_ROLES.has(auth.role),canReopenCompleted:['OWNER','ADMIN'].includes(auth.role)},methodology:{version:'R8.5M-1',canonicalTrackingEvidence:true,approvedOnlyPerformance:true,clientSendEvidenceRequired:true,settlementMustBeClear:true,renewalHandoffRequired:true}});
  }catch(cause){return error(cause.message||'Campaign client closeout could not be loaded',Number(cause.status||500));}
}

export async function onRequestPatch(context){
  try{
    const auth=context.data.auth;requireWrite(auth);const tenantId=requireTenant(auth);
    if(!context.env.DB)return json({updated:true,demo:true});
    const row=await loadCampaign(context.env.DB,tenantId,context.params.id);
    if(!row)return error('Campaign engagement not found',404);
    const body=await readJson(context.request);const action=upper(body.action);
    const state=stateFromRow(row);const now=nowIso();let next={...state.closeout,lastModifiedAt:now,lastModifiedBy:auth.userId};let auditAction='CAMPAIGN_CLIENT_CLOSEOUT_UPDATED';

    if(action==='PREPARE-REPORT'||action==='PREPARE_REPORT'){
      if(['READY_FOR_APPROVAL','APPROVED','SENT_TO_CLIENT','COMPLETED'].includes(state.closeout.status))return error('Reopen the current closeout before refreshing the final report evidence',409);
      assertCloseoutReportReady(state.summary);
      next={...clearCloseoutApproval(next),status:'REPORT_READY',reportFingerprint:campaignClientCloseoutFingerprint(state.tracking,state.planning,state.activation,state.settlement),reportPreparedAt:now,reportPreparedBy:auth.userId,lastModifiedAt:now,lastModifiedBy:auth.userId};
      auditAction='CAMPAIGN_CLIENT_CLOSEOUT_REPORT_PREPARED';
    }else if(action==='UPDATE-CLOSEOUT'||action==='UPDATE_CLOSEOUT'){
      if(!['REPORT_READY','REJECTED'].includes(state.closeout.status))return error('Prepare or reopen the final report before editing closeout notes and renewal handoff',409);
      const recommendation=upper(body.renewalRecommendation||next.renewalRecommendation||'UNSET');
      if(!CAMPAIGN_RENEWAL_RECOMMENDATIONS.includes(recommendation))return error('Renewal recommendation is invalid',422);
      next={...next,status:'REPORT_READY',lessonsLearned:text(body.lessonsLearned??next.lessonsLearned,5000),renewalRecommendation:recommendation,renewalReason:text(body.renewalReason??next.renewalReason,3000),renewalTargetDate:validateDate(body.renewalTargetDate??next.renewalTargetDate)};
      auditAction='CAMPAIGN_CLIENT_CLOSEOUT_DETAILS_UPDATED';
    }else if(action==='SUBMIT-REPORT'||action==='SUBMIT_REPORT'){
      if(!['REPORT_READY','REJECTED'].includes(state.closeout.status))return error('Only a prepared or rejected final report can be submitted',409);
      assertCloseoutReportReady(state.summary);
      if(!state.closeout.reportFingerprint||state.closeout.reportFingerprint!==state.summary.currentFingerprint)return error('Final report evidence changed. Prepare the report again before submission',409);
      next={...next,status:'READY_FOR_APPROVAL',submittedAt:now,submittedBy:auth.userId,rejectedAt:null,rejectedBy:null,rejectionReason:''};auditAction='CAMPAIGN_CLIENT_CLOSEOUT_REPORT_SUBMITTED';
    }else if(action==='APPROVE-REPORT'||action==='APPROVE_REPORT'){
      requireManager(auth);
      if(state.closeout.status!=='READY_FOR_APPROVAL')return error('Only a submitted final report can be approved',409);
      if(state.summary.reportDrift||!state.closeout.reportFingerprint)return error('Final report evidence changed and must be refreshed before approval',409);
      next={...next,status:'APPROVED',approvedAt:now,approvedBy:auth.userId,rejectedAt:null,rejectedBy:null,rejectionReason:''};auditAction='CAMPAIGN_CLIENT_CLOSEOUT_REPORT_APPROVED';
    }else if(action==='REJECT-REPORT'||action==='REJECT_REPORT'){
      requireManager(auth);if(state.closeout.status!=='READY_FOR_APPROVAL')return error('Only a submitted final report can be rejected',409);
      const reason=text(body.reason,1000);if(reason.length<5)return error('A rejection reason is required',422);
      next={...next,status:'REJECTED',rejectedAt:now,rejectedBy:auth.userId,rejectionReason:reason,approvedAt:null,approvedBy:null};auditAction='CAMPAIGN_CLIENT_CLOSEOUT_REPORT_REJECTED';
    }else if(action==='MARK-CLIENT-SENT'||action==='MARK_CLIENT_SENT'){
      requireManager(auth);if(state.closeout.status!=='APPROVED')return error('Approve the final report before recording client delivery',409);
      if(state.summary.reportDrift)return error('Final report evidence changed and must be reapproved before client delivery',409);
      const channel=text(body.channel,80);const reference=text(body.reference,1000);if(!channel||reference.length<3)return error('Client delivery channel and evidence reference are required',422);
      next={...next,status:'SENT_TO_CLIENT',clientSentAt:now,clientSentBy:auth.userId,clientSentChannel:channel,clientSentReference:reference};auditAction='CAMPAIGN_CLIENT_CLOSEOUT_REPORT_SENT';
    }else if(action==='COMPLETE-CLOSEOUT'||action==='COMPLETE_CLOSEOUT'){
      requireManager(auth);if(state.closeout.status!=='SENT_TO_CLIENT')return error('Record client delivery before completing campaign closeout',409);
      assertCloseoutCompletionReady(state.summary);
      const completionNote=text(body.note,3000);if(completionNote.length<5)return error('A completion sign-off note is required',422);
      next={...next,status:'COMPLETED',completedAt:now,completedBy:auth.userId,completionNote};auditAction='CAMPAIGN_CLIENT_CLOSEOUT_COMPLETED';
    }else if(action==='REOPEN-CLOSEOUT'||action==='REOPEN_CLOSEOUT'){
      requireManager(auth);if(state.closeout.status==='NOT_STARTED')return error('This campaign closeout has not started',409);
      if(state.closeout.status==='COMPLETED'&&!['OWNER','ADMIN'].includes(auth.role))return error('Owner or Admin permission is required to reopen a completed campaign closeout',403);
      next={...clearCloseoutApproval(next),lastModifiedAt:now,lastModifiedBy:auth.userId};auditAction='CAMPAIGN_CLIENT_CLOSEOUT_REOPENED';
    }else return error('Unsupported campaign closeout action',422);

    const saved=await save(context.env.DB,tenantId,auth,row,state,next,auditAction);
    return json({updated:true,item:responseItem(row,saved),permissions:{canWrite:true,canManage:MANAGER_ROLES.has(auth.role),canReopenCompleted:['OWNER','ADMIN'].includes(auth.role)}});
  }catch(cause){return error(cause.message||'Campaign client closeout could not be updated',Number(cause.status||500));}
}
