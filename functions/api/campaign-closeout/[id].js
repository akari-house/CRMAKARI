import { json,error,readJson } from '../../lib/response.js';
import { first,run,makeId,nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking } from '../../lib/campaign-tracking.js';
import { parseCampaignGtmTracking } from '../../lib/campaign-gtm-tracking.js';
import { parseCampaignPlanning } from '../../lib/campaign-planning.js';
import { parseCampaignActivation } from '../../lib/campaign-activation.js';
import { parseCampaignSettlement } from '../../lib/campaign-settlement.js';
import {
  RENEWAL_RECOMMENDATIONS,RENEWAL_OPPORTUNITY_RECOMMENDATIONS,
  parseCampaignCloseout,buildCampaignCloseoutSummary,campaignCloseoutFingerprint,
  assertReportCanPrepare,assertCloseoutCanComplete,clearCloseoutApproval,
} from '../../lib/campaign-closeout-renewal.js';

const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER']);
const text=(value,max=5000)=>String(value??'').trim().slice(0,max);
const upper=(value)=>text(value,100).toUpperCase();
function requireWrite(auth){if(!WRITE_ROLES.has(auth?.role)){const cause=new Error('Campaign closeout write permission is required');cause.status=403;throw cause;}}
function requireManager(auth){if(!MANAGER_ROLES.has(auth?.role)){const cause=new Error('Owner, Admin or BD Manager permission is required');cause.status=403;throw cause;}}
function validateDate(value){const raw=text(value,40);if(!raw)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)){const cause=new Error('Renewal target date must use YYYY-MM-DD');cause.status=422;throw cause;}return raw;}

async function loadCampaign(db,tenantId,id){return first(db,`
 SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.project_id,c.campaign_owner_id,p.name AS project_name
 FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id
 WHERE c.tenant_id=? AND c.id=? LIMIT 1`,[tenantId,id]);}
function stateFromRow(row){
 const {root,tracking}=parseCampaignTracking(row.notes);
 const {tracking:gtmTracking}=parseCampaignGtmTracking(row.notes);
 const planning=parseCampaignPlanning(root),activation=parseCampaignActivation(root),settlement=parseCampaignSettlement(root),closeout=parseCampaignCloseout(root);
 const summary=buildCampaignCloseoutSummary(tracking,gtmTracking,planning,activation,settlement,closeout);
 return{root,tracking,gtmTracking,planning,activation,settlement,closeout,summary};
}
function item(row,state){return{id:row.id,name:row.name,projectId:row.project_id,projectName:row.project_name,campaignStatus:row.status,startDate:row.start_date,endDate:row.end_date,reportUrl:`/api/campaign-tracking/${encodeURIComponent(row.id)}/report`,closeout:state.closeout,summary:state.summary};}
async function audit(db,tenantId,userId,action,campaignId,beforeData,afterData){await run(db,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[makeId('aud'),tenantId,userId,action,'CAMPAIGN_CLOSEOUT',campaignId,JSON.stringify(beforeData||{}),JSON.stringify(afterData||{}),nowIso()]);}

function renewalName(projectName,recommendation){const suffix={RENEW:'Renewal',RETAINER:'Retainer',UPSELL:'Upsell',NEW_CAMPAIGN:'Next Campaign'}[recommendation]||'Renewal';return `${projectName} — ${suffix}`;}
async function ensureRenewalOpportunity(db,tenantId,auth,row,closeout){
 if(!RENEWAL_OPPORTUNITY_RECOMMENDATIONS.has(closeout.renewalRecommendation))return null;
 const marker=`[AKARI_CAMPAIGN_RENEWAL:${row.id}]`;
 const existing=await first(db,`SELECT id,name FROM opportunities WHERE tenant_id=? AND project_id=? AND description LIKE ? ORDER BY created_at DESC LIMIT 1`,[tenantId,row.project_id,`${marker}%`]);
 if(existing)return existing;
 const id=makeId('opp'),now=nowIso(),name=renewalName(row.project_name,closeout.renewalRecommendation);
 const serviceType=closeout.renewalRecommendation==='NEW_CAMPAIGN'?'CAMPAIGN':closeout.renewalRecommendation;
 const description=`${marker} Created from completed campaign closeout: ${row.name}. ${text(closeout.renewalReason,2500)}`.trim();
 await run(db,`INSERT INTO opportunities(id,tenant_id,project_id,name,service_type,description,owner_user_id,stage,estimated_value,currency,estimated_value_base_currency,probability_percentage,expected_close_date,next_action,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,0,'USD',0,10,?,?,?,?,?,?)`,[id,tenantId,row.project_id,name,serviceType,description,row.campaign_owner_id||auth.userId,'NEW',closeout.renewalTargetDate,text(closeout.renewalReason,2000)||'Prepare the next commercial proposal',now,now,auth.userId,auth.userId]);
 await run(db,`INSERT INTO opportunity_stage_history(id,tenant_id,opportunity_id,previous_stage,new_stage,changed_by,changed_at,notes) VALUES(?,?,?,NULL,'NEW',?,?,'Created from completed campaign closeout')`,[makeId('osh'),tenantId,id,auth.userId,now]);
 await run(db,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES(?,?,?,'CAMPAIGN_RENEWAL_OPPORTUNITY_CREATED','OPPORTUNITY',?,?,?)`,[makeId('aud'),tenantId,auth.userId,id,JSON.stringify({campaignId:row.id,projectId:row.project_id,recommendation:closeout.renewalRecommendation}),now]);
 return{id,name};
}
async function save(db,tenantId,auth,row,state,next,action,campaignStatus=null){
 const nextRoot={...state.root,campaignCloseout:next};const summary=buildCampaignCloseoutSummary(state.tracking,state.gtmTracking,state.planning,state.activation,state.settlement,next);const now=nowIso();
 await run(db,`UPDATE campaigns SET notes=?,status=COALESCE(?,status),next_action=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`,[JSON.stringify(nextRoot),campaignStatus,next.status==='COMPLETED'?(next.renewalRecommendation==='NO_RENEWAL'?'Closed — no renewal':next.renewalRecommendation==='HOLD'?'Renewal on hold':next.renewalOpportunityId?'Continue renewal opportunity':'Closeout complete'):row.status==='REPORTING'?'Complete final client report':'Finalize campaign closeout',now,auth.userId,tenantId,row.id]);
 await audit(db,tenantId,auth.userId,action,row.id,{closeout:state.closeout,summary:state.summary},{closeout:next,summary});
 return{...state,root:nextRoot,closeout:next,summary};
}

export async function onRequestGet(context){try{const auth=context.data.auth,tenantId=requireTenant(auth);if(!context.env.DB)return error('D1 binding DB is not configured',500);const row=await loadCampaign(context.env.DB,tenantId,context.params.id);if(!row)return error('Campaign engagement not found',404);const state=stateFromRow(row);return json({item:item(row,state),permissions:{canWrite:WRITE_ROLES.has(auth.role),canManage:MANAGER_ROLES.has(auth.role),canReopenCompleted:['OWNER','ADMIN'].includes(auth.role)},methodology:{version:'R69-1',canonicalReport:true,approvedOnlyCreatorPerformance:true,reportFingerprint:true,clientSendEvidenceRequired:true,settlementCoverageRequired:true,renewalHandoffRequired:true,automaticOpportunityHandoff:true}});}catch(cause){return error(cause.message||'Campaign closeout could not be loaded',Number(cause.status||500));}}

export async function onRequestPatch(context){try{
 const auth=context.data.auth;requireWrite(auth);const tenantId=requireTenant(auth);if(!context.env.DB)return json({updated:true,demo:true});const row=await loadCampaign(context.env.DB,tenantId,context.params.id);if(!row)return error('Campaign engagement not found',404);
 const body=await readJson(context.request),action=upper(body.action),state=stateFromRow(row),now=nowIso();let next={...state.closeout,lastModifiedAt:now,lastModifiedBy:auth.userId},auditAction='CAMPAIGN_CLOSEOUT_UPDATED',campaignStatus=null;
 if(action==='PREPARE_REPORT'){
   if(['READY_FOR_APPROVAL','APPROVED','SENT_TO_CLIENT','COMPLETED'].includes(state.closeout.status))return error('Reopen the closeout before refreshing final report evidence',409);assertReportCanPrepare(state.summary);
   next={...clearCloseoutApproval(next),status:'REPORT_READY',reportFingerprint:campaignCloseoutFingerprint(state.tracking,state.gtmTracking,state.planning,state.activation,state.settlement),reportPreparedAt:now,reportPreparedBy:auth.userId,lastModifiedAt:now,lastModifiedBy:auth.userId};auditAction='CAMPAIGN_CLOSEOUT_REPORT_PREPARED';campaignStatus='REPORTING';
 }else if(action==='UPDATE_CLOSEOUT'){
   if(!['REPORT_READY','REJECTED'].includes(state.closeout.status))return error('Prepare or reopen the final report before editing closeout details',409);const recommendation=upper(body.renewalRecommendation||next.renewalRecommendation||'UNSET');if(!RENEWAL_RECOMMENDATIONS.includes(recommendation))return error('Renewal recommendation is invalid',422);
   next={...next,status:'REPORT_READY',lessonsLearned:text(body.lessonsLearned??next.lessonsLearned,5000),renewalRecommendation:recommendation,renewalReason:text(body.renewalReason??next.renewalReason,3000),renewalTargetDate:validateDate(body.renewalTargetDate??next.renewalTargetDate),renewalOpportunityId:null,renewalOpportunityName:null,renewalOpportunityLinkedAt:null,renewalOpportunityLinkedBy:null};auditAction='CAMPAIGN_CLOSEOUT_DETAILS_UPDATED';
 }else if(action==='SUBMIT_REPORT'){
   if(!['REPORT_READY','REJECTED'].includes(state.closeout.status))return error('Only a prepared or rejected final report can be submitted',409);assertReportCanPrepare(state.summary);if(!state.closeout.reportFingerprint||state.summary.reportDrift)return error('Final report evidence changed. Prepare the report again before submission',409);
   next={...next,status:'READY_FOR_APPROVAL',submittedAt:now,submittedBy:auth.userId,rejectedAt:null,rejectedBy:null,rejectionReason:''};auditAction='CAMPAIGN_CLOSEOUT_REPORT_SUBMITTED';
 }else if(action==='APPROVE_REPORT'){
   requireManager(auth);if(state.closeout.status!=='READY_FOR_APPROVAL')return error('Only a submitted final report can be approved',409);if(state.summary.reportDrift||!state.closeout.reportFingerprint)return error('Final report evidence changed and must be refreshed before approval',409);
   next={...next,status:'APPROVED',approvedAt:now,approvedBy:auth.userId,rejectedAt:null,rejectedBy:null,rejectionReason:''};auditAction='CAMPAIGN_CLOSEOUT_REPORT_APPROVED';
 }else if(action==='REJECT_REPORT'){
   requireManager(auth);if(state.closeout.status!=='READY_FOR_APPROVAL')return error('Only a submitted final report can be rejected',409);const reason=text(body.reason,1500);if(reason.length<5)return error('A rejection reason is required',422);next={...next,status:'REJECTED',rejectedAt:now,rejectedBy:auth.userId,rejectionReason:reason,approvedAt:null,approvedBy:null};auditAction='CAMPAIGN_CLOSEOUT_REPORT_REJECTED';
 }else if(action==='MARK_CLIENT_SENT'){
   requireManager(auth);if(state.closeout.status!=='APPROVED')return error('Approve the final report before recording client delivery',409);if(state.summary.reportDrift)return error('Final report evidence changed and must be reapproved before client delivery',409);const channel=text(body.channel,100),reference=text(body.reference,1200);if(!channel||reference.length<3)return error('Client delivery channel and evidence reference are required',422);next={...next,status:'SENT_TO_CLIENT',clientSentAt:now,clientSentBy:auth.userId,clientSentChannel:channel,clientSentReference:reference};auditAction='CAMPAIGN_CLOSEOUT_REPORT_SENT';
 }else if(action==='COMPLETE_CLOSEOUT'){
   requireManager(auth);if(state.closeout.status!=='SENT_TO_CLIENT')return error('Record client delivery before completing campaign closeout',409);assertCloseoutCanComplete(state.summary);const note=text(body.note,3000);if(note.length<5)return error('A completion sign-off note is required',422);
   const opportunity=await ensureRenewalOpportunity(context.env.DB,tenantId,auth,row,state.closeout);next={...next,status:'COMPLETED',completedAt:now,completedBy:auth.userId,completionNote:note,renewalOpportunityId:opportunity?.id||null,renewalOpportunityName:opportunity?.name||null,renewalOpportunityLinkedAt:opportunity?now:null,renewalOpportunityLinkedBy:opportunity?auth.userId:null};auditAction='CAMPAIGN_CLOSEOUT_COMPLETED';campaignStatus='COMPLETED';
 }else if(action==='REOPEN_CLOSEOUT'){
   requireManager(auth);if(state.closeout.status==='NOT_STARTED')return error('This campaign closeout has not started',409);if(state.closeout.status==='COMPLETED'&&!['OWNER','ADMIN'].includes(auth.role))return error('Owner or Admin permission is required to reopen a completed campaign closeout',403);next={...clearCloseoutApproval(next),lastModifiedAt:now,lastModifiedBy:auth.userId};auditAction='CAMPAIGN_CLOSEOUT_REOPENED';campaignStatus='REPORTING';
 }else return error('Unsupported campaign closeout action',422);
 const saved=await save(context.env.DB,tenantId,auth,row,state,next,auditAction,campaignStatus);return json({updated:true,item:item({...row,status:campaignStatus||row.status},saved),permissions:{canWrite:true,canManage:MANAGER_ROLES.has(auth.role),canReopenCompleted:['OWNER','ADMIN'].includes(auth.role)}});
}catch(cause){return error(cause.message||'Campaign closeout could not be updated',Number(cause.status||500));}}
