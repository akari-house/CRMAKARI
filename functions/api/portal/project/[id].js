import { json,error,readJson } from '../../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import { requirePortalProject } from '../../../lib/portal-access.js';
import { parseFundraisingFlags,sanitizeInvestorQuestion } from '../../../lib/fundraising-os.js';

const TASK_STATUSES=new Set(['TODO','IN_PROGRESS','WAITING','DONE']);
const text=(value,max=8000)=>String(value??'').trim().slice(0,max);

async function settings(db,tenantId){return first(db,'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id=? LIMIT 1',[tenantId]);}
function safeRoom(flags,projectId,grant){
  if(!grant?.permissions?.viewFundraising)return null;
  const room=parseFundraisingFlags(flags).rooms.find(item=>item.projectId===projectId);if(!room)return null;
  const investors=new Map((room.investorPipeline||[]).map(item=>[item.id,item.investorName]));
  return {
    id:room.id,roundName:room.roundName,stage:room.stage,roundType:room.roundType,fundingStage:room.fundingStage,currency:room.currency,targetAmount:Number(room.targetAmount||0),committedAmount:Number(room.committedAmount||0),valuation:Number(room.valuation||0),minimumTicket:Number(room.minimumTicket||0),launchDate:room.launchDate||null,targetCloseDate:room.targetCloseDate||null,readinessScore:Number(room.readinessScore||0),thesis:room.thesis||'',nextAction:room.nextAction||'',
    dataRoomDocuments:grant.permissions.viewDocuments?(room.dataRoomDocuments||[]).filter(item=>item.status!=='ARCHIVED').map(item=>({id:item.id,title:item.title,category:item.category,url:item.url,version:item.version,confidentiality:item.confidentiality,status:item.status})):[],
    diligenceRequests:(room.diligenceRequests||[]).map(item=>({id:item.id,investorName:investors.get(item.investorPipelineId)||'Investor',title:item.title,category:item.category,status:item.status,dueDate:item.dueDate||null,response:item.response||'',evidenceUrl:item.evidenceUrl||''})),
    investorQuestions:(room.investorQuestions||[]).map(item=>({id:item.id,investorName:investors.get(item.investorPipelineId)||'Investor',question:item.question,answer:item.answer||'',status:item.status,askedAt:item.askedAt||null,answeredAt:item.answeredAt||null})),
  };
}
async function build(db,auth,projectId){
  const access=await requirePortalProject(db,auth,projectId);const grant=access.grant;
  const [tasks,campaigns,settingRow]=await Promise.all([
    all(db,`SELECT id,title,description,status,priority,due_at,completed_at FROM tasks WHERE tenant_id=? AND project_id=? AND owner_user_id=? AND status NOT IN ('CANCELLED','ARCHIVED') ORDER BY CASE status WHEN 'TODO' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'WAITING' THEN 3 ELSE 4 END,COALESCE(due_at,'9999-12-31')`,[auth.tenantId,projectId,auth.userId]),
    grant?.permissions?.viewCampaigns?all(db,`SELECT id,name,status,start_date,end_date,region,tracking_enabled FROM campaigns WHERE tenant_id=? AND project_id=? ORDER BY COALESCE(start_date,created_at) DESC LIMIT 100`,[auth.tenantId,projectId]):Promise.resolve([]),
    settings(db,auth.tenantId),
  ]);
  return {
    project:{id:access.project.id,name:access.project.name,category:access.project.category,region:access.project.region,country:access.project.country,website:access.project.website,lifecycleStatus:access.project.lifecycle_status},
    grant,
    tasks:tasks.map(item=>({id:item.id,title:item.title,description:item.description,status:item.status,priority:item.priority,dueAt:item.due_at,completedAt:item.completed_at})),
    campaigns:campaigns.map(item=>({id:item.id,name:item.name,status:item.status,startDate:item.start_date,endDate:item.end_date,region:item.region,trackingEnabled:Boolean(item.tracking_enabled)})),
    fundraising:safeRoom(settingRow?.feature_flags_json,projectId,grant),
    disclosures:{internalNotesExcluded:true,privateInvestorContactsExcluded:true,commercialNegotiationsExcluded:true,financeExcluded:true,creatorPaymentsExcluded:true},
  };
}

export async function onRequestGet(context){
  try{const auth=context.data.auth;requireTenant(auth);if(auth.role!=='EXTERNAL_COLLABORATOR')return error('External portal access is required',403);if(!context.env.DB)return error('D1 binding DB is not configured',500);return json(await build(context.env.DB,auth,String(context.params.id||'')));}
  catch(cause){return error(cause.message||'Portal project could not be loaded',Number(cause.status||500));}
}

export async function onRequestPatch(context){
  try{
    const auth=context.data.auth;requireTenant(auth);if(auth.role!=='EXTERNAL_COLLABORATOR')return error('External portal access is required',403);if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const projectId=String(context.params.id||''),body=await readJson(context.request),action=String(body.action||'').toUpperCase();
    const access=await requirePortalProject(context.env.DB,auth,projectId);
    if(action==='UPDATE_TASK'){
      if(!access.grant.permissions.updateOwnTasks)return error('Task updates are not enabled for this portal access',403);
      const taskId=text(body.taskId,120),status=String(body.status||'').toUpperCase();if(!TASK_STATUSES.has(status))return error('Task status is invalid',422);
      const task=await first(context.env.DB,'SELECT id,status FROM tasks WHERE tenant_id=? AND project_id=? AND id=? AND owner_user_id=? LIMIT 1',[auth.tenantId,projectId,taskId,auth.userId]);if(!task)return error('Assigned portal task was not found',404);
      const now=nowIso();await run(context.env.DB,'UPDATE tasks SET status=?,completed_at=?,updated_at=? WHERE tenant_id=? AND project_id=? AND id=? AND owner_user_id=?',[status,status==='DONE'?now:null,now,auth.tenantId,projectId,taskId,auth.userId]);
      await run(context.env.DB,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[makeId('aud'),auth.tenantId,auth.userId,'PORTAL_TASK_STATUS_UPDATED','TASK',taskId,JSON.stringify({status:task.status}),JSON.stringify({status,projectId}),now]);
    }else if(action==='ANSWER_INVESTOR_QUESTION'){
      if(!access.grant.permissions.answerDiligence||!access.grant.permissions.viewFundraising)return error('Founder diligence responses are not enabled for this portal access',403);
      const questionId=text(body.questionId,120),answer=text(body.answer,8000);if(answer.length<2)return error('A diligence answer is required',422);
      const row=await settings(context.env.DB,auth.tenantId);const parsed=parseFundraisingFlags(row?.feature_flags_json);const roomIndex=parsed.rooms.findIndex(item=>item.projectId===projectId);if(roomIndex<0)return error('Founder Capital Room was not found',404);
      const room=parsed.rooms[roomIndex],questions=Array.isArray(room.investorQuestions)?room.investorQuestions:[],index=questions.findIndex(item=>item.id===questionId);if(index<0)return error('Investor question was not found',404);
      const before=questions[index];const updated=sanitizeInvestorQuestion({...before,answer,status:'ANSWERED',answeredAt:nowIso()},before);questions[index]=updated;room.investorQuestions=questions;room.updatedAt=nowIso();parsed.rooms[roomIndex]=room;parsed.flags.fundraisingCapitalRooms=parsed.rooms;
      const payload=JSON.stringify(parsed.flags),now=nowIso();if(row)await run(context.env.DB,'UPDATE tenant_settings SET feature_flags_json=?,updated_at=? WHERE tenant_id=?',[payload,now,auth.tenantId]);else return error('Fundraising settings are unavailable',409);
      await run(context.env.DB,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[makeId('aud'),auth.tenantId,auth.userId,'PORTAL_DILIGENCE_ANSWERED','INVESTOR_QUESTION',questionId,JSON.stringify({status:before.status}),JSON.stringify({status:'ANSWERED',projectId}),now]);
    }else return error('Portal action is not supported',422);
    return json({updated:true,item:await build(context.env.DB,auth,projectId)});
  }catch(cause){return error(cause.message||'Portal update failed',Number(cause.status||500));}
}
