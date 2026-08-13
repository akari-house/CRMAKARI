import { all, first, run, makeId, nowIso } from './db.js';

export const ATTENTION_STATUSES=Object.freeze(['OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED','DISMISSED']);
export const REPORT_TYPES=Object.freeze(['FOUNDER_WEEKLY','CLIENT','CAMPAIGN','FUNDRAISING','INVESTOR_UPDATE','REVENUE','MANAGEMENT']);
const ACTIVE_ATTENTION_STATUSES=['OPEN','ACKNOWLEDGED','SNOOZED'];
const PRIORITY_WEIGHT={URGENT:4,HIGH:3,MEDIUM:2,LOW:1};
const TERMINAL_OPPORTUNITY=['WON','LOST'];
const TERMINAL_TARGET=['COMMITTED','PASSED','NOT_NOW'];

const text=(value,max=4000)=>String(value??'').trim().slice(0,max);
const upper=(value)=>text(value,100).toUpperCase();
const isoDate=(value)=>{const ts=Date.parse(String(value||''));return Number.isFinite(ts)?new Date(ts).toISOString():'';};
const day=(value)=>String(value||'').slice(0,10);
const plusDays=(base,days)=>new Date(Date.parse(base)+days*86400000).toISOString();
const n=(value)=>Number(value||0);
const safeJson=(value,fallback={})=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed&&typeof parsed==='object'?parsed:fallback;}catch{return fallback;}};

export function normalizeAttentionStatus(value='OPEN'){
  const status=upper(value)||'OPEN';
  if(!ATTENTION_STATUSES.includes(status))throw Object.assign(new Error('Attention status is invalid'),{status:422});
  return status;
}
export function normalizeReportType(value){
  const type=upper(value);
  if(!REPORT_TYPES.includes(type))throw Object.assign(new Error('Report type is invalid'),{status:422});
  return type;
}
export function priorityFor({overdueDays=0,base='MEDIUM'}={}){
  if(overdueDays>=14)return 'URGENT';
  if(overdueDays>=3)return 'HIGH';
  return base;
}
export function overdueDays(dueAt,now=new Date()){
  const due=Date.parse(String(dueAt||''));
  if(!Number.isFinite(due))return 0;
  return Math.max(0,Math.floor((now.getTime()-due)/86400000));
}

function item({sourceType,sourceId,reasonKey,title,summary='',ownerUserId='',priority='MEDIUM',dueAt='',sourceUrl='',metadata={}}){
  return {sourceType,sourceId,reasonKey,title,summary,ownerUserId:ownerUserId||null,priority,dueAt:isoDate(dueAt)||text(dueAt,100)||null,sourceUrl,metadata};
}

async function safeAll(db,sql,bindings=[]){try{return await all(db,sql,bindings);}catch(error){if(/no such table|no such column/i.test(String(error?.message||'')))return [];throw error;}}
async function safeFirst(db,sql,bindings=[]){try{return await first(db,sql,bindings);}catch(error){if(/no such table|no such column/i.test(String(error?.message||'')))return null;throw error;}}

export async function deriveAttention(db,tenantId,{now=new Date()}={}){
  const nowIsoValue=now.toISOString();
  const today=day(nowIsoValue);
  const in30=day(plusDays(nowIsoValue,30));
  const rows=[];

  for(const project of await safeAll(db,`SELECT id,name,owner_user_id,next_follow_up_at,lifecycle_status FROM projects WHERE tenant_id = ? AND next_follow_up_at IS NOT NULL AND next_follow_up_at < ? AND lifecycle_status NOT IN ('ARCHIVED','FORMER_CLIENT')`,[tenantId,nowIsoValue])){
    const days=overdueDays(project.next_follow_up_at,now);
    rows.push(item({sourceType:'PROJECT',sourceId:project.id,reasonKey:'FOLLOW_UP_OVERDUE',title:`Follow up with ${project.name}`,summary:`Project follow-up is ${days||1} day(s) overdue.`,ownerUserId:project.owner_user_id,priority:priorityFor({overdueDays:days}),dueAt:project.next_follow_up_at,sourceUrl:`/app/${tenantId}/projects/${project.id}`}));
  }

  for(const opportunity of await safeAll(db,`SELECT id,name,owner_user_id,next_follow_up_at,stage,expected_close_date,estimated_value,currency FROM opportunities WHERE tenant_id = ? AND stage NOT IN ('WON','LOST')`,[tenantId])){
    if(opportunity.next_follow_up_at&&Date.parse(opportunity.next_follow_up_at)<now.getTime()){
      const days=overdueDays(opportunity.next_follow_up_at,now);
      rows.push(item({sourceType:'OPPORTUNITY',sourceId:opportunity.id,reasonKey:'FOLLOW_UP_OVERDUE',title:`Opportunity follow-up: ${opportunity.name}`,summary:`${opportunity.stage} opportunity needs its next action.`,ownerUserId:opportunity.owner_user_id,priority:priorityFor({overdueDays:days,base:'HIGH'}),dueAt:opportunity.next_follow_up_at,sourceUrl:`/app/${tenantId}/opportunities`,metadata:{stage:opportunity.stage,value:n(opportunity.estimated_value),currency:opportunity.currency}}));
    }
    if(opportunity.expected_close_date&&day(opportunity.expected_close_date)<=in30&&day(opportunity.expected_close_date)>=today){
      rows.push(item({sourceType:'OPPORTUNITY',sourceId:opportunity.id,reasonKey:'CLOSE_APPROACHING',title:`Close date approaching: ${opportunity.name}`,summary:`Expected close is ${day(opportunity.expected_close_date)}.`,ownerUserId:opportunity.owner_user_id,priority:'MEDIUM',dueAt:opportunity.expected_close_date,sourceUrl:`/app/${tenantId}/opportunities`,metadata:{stage:opportunity.stage}}));
    }
  }

  for(const payment of await safeAll(db,`SELECT id,project_id,invoice_reference,status,due_date,amount,currency FROM payments WHERE tenant_id = ? AND status NOT IN ('PAID','CANCELLED') AND due_date IS NOT NULL AND due_date < ?`,[tenantId,today])){
    const days=overdueDays(payment.due_date,now);
    rows.push(item({sourceType:'PAYMENT',sourceId:payment.id,reasonKey:'PAYMENT_OVERDUE',title:`Payment overdue${payment.invoice_reference?`: ${payment.invoice_reference}`:''}`,summary:`${payment.currency||'USD'} ${n(payment.amount).toFixed(2)} remains due.`,priority:priorityFor({overdueDays:days,base:'HIGH'}),dueAt:payment.due_date,sourceUrl:`/app/${tenantId}/revenue`,metadata:{projectId:payment.project_id,status:payment.status,amount:n(payment.amount),currency:payment.currency}}));
  }

  for(const referral of await safeAll(db,`SELECT id,partner_id,payment_status,due_date,referral_amount,currency FROM referrals WHERE tenant_id = ? AND payment_status IN ('CONFIRMED','DUE') AND due_date IS NOT NULL AND due_date <= ?`,[tenantId,today])){
    rows.push(item({sourceType:'REFERRAL',sourceId:referral.id,reasonKey:'REFERRAL_DUE',title:'Referral reward due',summary:`${referral.currency||'USD'} ${n(referral.referral_amount).toFixed(2)} requires settlement.`,priority:'MEDIUM',dueAt:referral.due_date,sourceUrl:`/app/${tenantId}/revenue`,metadata:{partnerId:referral.partner_id}}));
  }

  for(const campaign of await safeAll(db,`SELECT id,name,campaign_owner_id,status,reporting_due_date,end_date,outstanding_amount,payment_status FROM campaigns WHERE tenant_id = ? AND status NOT IN ('COMPLETED','CANCELLED')`,[tenantId])){
    if(campaign.reporting_due_date&&day(campaign.reporting_due_date)<today){
      const days=overdueDays(campaign.reporting_due_date,now);
      rows.push(item({sourceType:'CAMPAIGN',sourceId:campaign.id,reasonKey:'REPORT_OVERDUE',title:`Campaign report overdue: ${campaign.name}`,summary:`Reporting was due ${day(campaign.reporting_due_date)}.`,ownerUserId:campaign.campaign_owner_id,priority:priorityFor({overdueDays:days,base:'HIGH'}),dueAt:campaign.reporting_due_date,sourceUrl:`/app/${tenantId}/campaigns`}));
    }
    if(n(campaign.outstanding_amount)>0&&['LIVE','REPORTING'].includes(campaign.status)){
      rows.push(item({sourceType:'CAMPAIGN',sourceId:campaign.id,reasonKey:'SETTLEMENT_PENDING',title:`Campaign settlement pending: ${campaign.name}`,summary:`Outstanding amount: ${n(campaign.outstanding_amount).toFixed(2)}.`,ownerUserId:campaign.campaign_owner_id,priority:'MEDIUM',dueAt:campaign.end_date,sourceUrl:`/app/${tenantId}/campaigns`,metadata:{outstanding:n(campaign.outstanding_amount),paymentStatus:campaign.payment_status}}));
    }
  }

  for(const deliverable of await safeAll(db,`SELECT d.id,d.title,d.owner_user_id,d.due_date,d.status,d.campaign_id,c.name campaign_name FROM campaign_deliverables d JOIN campaigns c ON c.id=d.campaign_id AND c.tenant_id=d.tenant_id WHERE d.tenant_id = ? AND d.due_date IS NOT NULL AND d.due_date < ? AND UPPER(COALESCE(d.status,'')) NOT IN ('DONE','COMPLETED','APPROVED','CANCELLED')`,[tenantId,today])){
    const days=overdueDays(deliverable.due_date,now);
    rows.push(item({sourceType:'CAMPAIGN_DELIVERABLE',sourceId:deliverable.id,reasonKey:'DELIVERABLE_OVERDUE',title:`Deliverable overdue: ${deliverable.title}`,summary:`${deliverable.campaign_name||'Campaign'} delivery needs action.`,ownerUserId:deliverable.owner_user_id,priority:priorityFor({overdueDays:days,base:'HIGH'}),dueAt:deliverable.due_date,sourceUrl:`/app/${tenantId}/campaigns`,metadata:{campaignId:deliverable.campaign_id}}));
  }

  for(const agreement of await safeAll(db,`SELECT id,title,owner_user_id,status,end_date,renewal_date,project_id FROM agreements WHERE tenant_id = ? AND status IN ('SIGNED','ACTIVE')`,[tenantId])){
    const due=agreement.renewal_date||agreement.end_date;
    if(due&&day(due)>=today&&day(due)<=in30){
      rows.push(item({sourceType:'AGREEMENT',sourceId:agreement.id,reasonKey:agreement.renewal_date?'RENEWAL_APPROACHING':'EXPIRY_APPROACHING',title:`Agreement ${agreement.renewal_date?'renewal':'expiry'} approaching: ${agreement.title}`,summary:`Action date: ${day(due)}.`,ownerUserId:agreement.owner_user_id,priority:day(due)<=day(plusDays(nowIsoValue,7))?'HIGH':'MEDIUM',dueAt:due,sourceUrl:`/app/${tenantId}/agreements`,metadata:{projectId:agreement.project_id,status:agreement.status}}));
    }
  }

  for(const target of await safeAll(db,`SELECT t.id,t.stage,t.next_follow_up_at,t.next_action,r.owner_user_id,o.name organisation_name,r.id round_id FROM fundraising_targets t JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id JOIN investor_organisations o ON o.id=t.organisation_id AND o.tenant_id=t.tenant_id WHERE t.tenant_id = ? AND t.stage NOT IN ('COMMITTED','PASSED','NOT_NOW') AND t.next_follow_up_at IS NOT NULL AND t.next_follow_up_at < ?`,[tenantId,nowIsoValue])){
    const days=overdueDays(target.next_follow_up_at,now);
    rows.push(item({sourceType:'FUNDRAISING_TARGET',sourceId:target.id,reasonKey:'INVESTOR_FOLLOW_UP_DUE',title:`Investor follow-up: ${target.organisation_name}`,summary:target.next_action||`${target.stage} investor target needs follow-up.`,ownerUserId:target.owner_user_id,priority:priorityFor({overdueDays:days,base:'HIGH'}),dueAt:target.next_follow_up_at,sourceUrl:`/app/${tenantId}/fundraising`,metadata:{stage:target.stage,roundId:target.round_id}}));
  }

  for(const request of await safeAll(db,`SELECT id,title,owner_user_id,due_date,status,project_id,round_id FROM fundraising_diligence_requests WHERE tenant_id = ? AND status NOT IN ('RESOLVED','CLOSED') AND due_date IS NOT NULL AND due_date < ?`,[tenantId,today])){
    const days=overdueDays(request.due_date,now);
    rows.push(item({sourceType:'DILIGENCE',sourceId:request.id,reasonKey:'DILIGENCE_DUE',title:`Diligence overdue: ${request.title}`,summary:`${request.status.replaceAll('_',' ')} request needs resolution.`,ownerUserId:request.owner_user_id,priority:priorityFor({overdueDays:days,base:request.status==='WAITING_FOUNDER'?'HIGH':'MEDIUM'}),dueAt:request.due_date,sourceUrl:`/app/${tenantId}/fundraising`,metadata:{projectId:request.project_id,roundId:request.round_id,status:request.status}}));
  }

  for(const req of await safeAll(db,`SELECT q.id,q.title,q.project_id,q.round_id,q.status,r.owner_user_id,r.stage FROM fundraising_data_room_requirements q JOIN fundraising_rounds r ON r.id=q.round_id AND r.tenant_id=q.tenant_id WHERE q.tenant_id = ? AND q.required = 1 AND q.status IN ('MISSING','REQUESTED') AND r.stage IN ('OPEN','OUTREACH','DILIGENCE','COMMITMENTS','CLOSING')`,[tenantId])){
    rows.push(item({sourceType:'DATA_ROOM_REQUIREMENT',sourceId:req.id,reasonKey:'FOUNDER_DOCUMENT_MISSING',title:`Missing data-room item: ${req.title}`,summary:`Required for ${req.stage.toLowerCase()} fundraising workflow.`,ownerUserId:req.owner_user_id,priority:req.stage==='DILIGENCE'?'HIGH':'MEDIUM',sourceUrl:`/app/${tenantId}/fundraising`,metadata:{projectId:req.project_id,roundId:req.round_id,status:req.status}}));
  }

  return rows.sort((a,b)=>(PRIORITY_WEIGHT[b.priority]-PRIORITY_WEIGHT[a.priority])||String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999')));
}

export async function refreshAttention(db,tenantId,{now=new Date()}={}){
  const derived=await deriveAttention(db,tenantId,{now});
  const stamp=now.toISOString();
  const activeKeys=new Set();
  for(const row of derived){
    const key=`${row.sourceType}:${row.sourceId}:${row.reasonKey}`;
    activeKeys.add(key);
    const existing=await safeFirst(db,`SELECT id,status,snoozed_until FROM operational_attention WHERE tenant_id = ? AND source_type = ? AND source_id = ? AND reason_key = ?`,[tenantId,row.sourceType,row.sourceId,row.reasonKey]);
    if(existing){
      const status=existing.status==='RESOLVED'?'OPEN':existing.status;
      await run(db,`UPDATE operational_attention SET title=?,summary=?,owner_user_id=?,priority=?,due_at=?,source_url=?,metadata_json=?,last_seen_at=?,status=?,resolved_at=NULL,updated_at=? WHERE tenant_id=? AND id=?`,[row.title,row.summary,row.ownerUserId,row.priority,row.dueAt,row.sourceUrl,JSON.stringify(row.metadata||{}),stamp,status,stamp,tenantId,existing.id]);
    }else{
      await run(db,`INSERT INTO operational_attention (id,tenant_id,source_type,source_id,reason_key,title,summary,owner_user_id,priority,due_at,status,source_url,metadata_json,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[makeId('attn'),tenantId,row.sourceType,row.sourceId,row.reasonKey,row.title,row.summary,row.ownerUserId,row.priority,row.dueAt,'OPEN',row.sourceUrl,JSON.stringify(row.metadata||{}),stamp,stamp,stamp,stamp]);
    }
  }
  const existingRows=await safeAll(db,`SELECT id,source_type,source_id,reason_key,status FROM operational_attention WHERE tenant_id = ? AND status IN ('OPEN','ACKNOWLEDGED','SNOOZED')`,[tenantId]);
  for(const current of existingRows){
    const key=`${current.source_type}:${current.source_id}:${current.reason_key}`;
    if(!activeKeys.has(key))await run(db,`UPDATE operational_attention SET status='RESOLVED',resolved_at=?,updated_at=? WHERE tenant_id=? AND id=?`,[stamp,stamp,tenantId,current.id]);
  }
  return listAttention(db,tenantId,{});
}

export async function listAttention(db,tenantId,{ownerUserId='',includeResolved=false,limit=100,now=new Date()}={}){
  const bindings=[tenantId];
  let where=`tenant_id = ?`;
  if(!includeResolved)where+=` AND status IN ('OPEN','ACKNOWLEDGED','SNOOZED')`;
  if(ownerUserId){where+=` AND (owner_user_id = ? OR owner_user_id IS NULL)`;bindings.push(ownerUserId);}
  bindings.push(Math.min(250,Math.max(1,Number(limit||100))));
  const rows=await safeAll(db,`SELECT * FROM operational_attention WHERE ${where} ORDER BY CASE priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC, COALESCE(due_at,'9999-12-31') ASC, updated_at DESC LIMIT ?`,bindings);
  return rows.filter(row=>row.status!=='SNOOZED'||!row.snoozed_until||Date.parse(row.snoozed_until)<=now.getTime()).map(row=>({...row,metadata:safeJson(row.metadata_json,{})}));
}

export async function updateAttention(db,tenantId,id,input,userId){
  const existing=await safeFirst(db,`SELECT * FROM operational_attention WHERE tenant_id = ? AND id = ?`,[tenantId,id]);
  if(!existing)throw Object.assign(new Error('Attention item not found'),{status:404});
  const status=normalizeAttentionStatus(input.status||existing.status);
  const stamp=nowIso();
  const snoozedUntil=status==='SNOOZED'?isoDate(input.snoozedUntil):null;
  if(status==='SNOOZED'&&!snoozedUntil)throw Object.assign(new Error('A valid snooze time is required'),{status:422});
  const resolvedAt=['RESOLVED','DISMISSED'].includes(status)?stamp:null;
  await run(db,`UPDATE operational_attention SET status=?,snoozed_until=?,resolved_at=?,updated_at=? WHERE tenant_id=? AND id=?`,[status,snoozedUntil,resolvedAt,stamp,tenantId,id]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId||null,'ATTENTION_STATUS_UPDATED','OPERATIONAL_ATTENTION',id,JSON.stringify({status:existing.status}),JSON.stringify({status,snoozedUntil}),stamp]);
  return await safeFirst(db,`SELECT * FROM operational_attention WHERE tenant_id = ? AND id = ?`,[tenantId,id]);
}

async function baseManagement(db,tenantId){
  const [opp,payments,campaigns,rounds,commitments,attention,agreements]=await Promise.all([
    safeFirst(db,`SELECT COUNT(*) active_opportunities,COALESCE(SUM(weighted_value),0) weighted_pipeline,COALESCE(SUM(CASE WHEN stage='WON' THEN COALESCE(estimated_value_base_currency,estimated_value,0) ELSE 0 END),0) won_value FROM opportunities WHERE tenant_id = ? AND stage != 'LOST'`,[tenantId]),
    safeFirst(db,`SELECT COALESCE(SUM(CASE WHEN status='PAID' THEN COALESCE(amount_base_currency,amount,0) ELSE 0 END),0) collected,COALESCE(SUM(CASE WHEN status='OVERDUE' OR (due_date < date('now') AND status NOT IN ('PAID','CANCELLED')) THEN amount ELSE 0 END),0) overdue,COUNT(CASE WHEN status='OVERDUE' OR (due_date < date('now') AND status NOT IN ('PAID','CANCELLED')) THEN 1 END) overdue_count FROM payments WHERE tenant_id = ?`,[tenantId]),
    safeFirst(db,`SELECT COUNT(CASE WHEN status NOT IN ('COMPLETED','CANCELLED') THEN 1 END) active_campaigns,COALESCE(SUM(akari_net_revenue),0) net_revenue,COALESCE(SUM(outstanding_amount),0) outstanding FROM campaigns WHERE tenant_id = ?`,[tenantId]),
    safeFirst(db,`SELECT COUNT(CASE WHEN stage NOT IN ('CLOSED','PAUSED') THEN 1 END) active_rounds,COALESCE(SUM(target_amount),0) target_amount,COALESCE(AVG(readiness_score),0) avg_readiness FROM fundraising_rounds WHERE tenant_id = ?`,[tenantId]),
    safeFirst(db,`SELECT COALESCE(SUM(committed_amount),0) committed,COALESCE(SUM(received_amount),0) received FROM fundraising_commitments WHERE tenant_id = ? AND status != 'CANCELLED'`,[tenantId]),
    safeFirst(db,`SELECT COUNT(*) open_attention,COUNT(CASE WHEN priority IN ('URGENT','HIGH') THEN 1 END) critical_attention FROM operational_attention WHERE tenant_id = ? AND status IN ('OPEN','ACKNOWLEDGED','SNOOZED')`,[tenantId]),
    safeFirst(db,`SELECT COUNT(*) renewals_30d FROM agreements WHERE tenant_id = ? AND status IN ('SIGNED','ACTIVE') AND COALESCE(renewal_date,end_date) BETWEEN date('now') AND date('now','+30 days')`,[tenantId]),
  ]);
  return {commercial:opp||{},revenue:payments||{},campaigns:campaigns||{},fundraising:{...(rounds||{}),...(commitments||{})},attention:attention||{},agreements:agreements||{}};
}

export async function buildReport(db,tenantId,{reportType,entityId='',periodStart='',periodEnd=''}={}){
  const type=normalizeReportType(reportType);
  const generatedAt=nowIso();
  const management=await baseManagement(db,tenantId);
  if(type==='MANAGEMENT')return {reportType:type,generatedAt,periodStart,periodEnd,...management};
  if(type==='REVENUE')return {reportType:type,generatedAt,periodStart,periodEnd,revenue:management.revenue,campaigns:{net_revenue:management.campaigns.net_revenue,outstanding:management.campaigns.outstanding},commercial:{won_value:management.commercial.won_value}};
  if(type==='FUNDRAISING'){
    const stages=await safeAll(db,`SELECT stage,COUNT(*) count FROM fundraising_targets WHERE tenant_id = ? GROUP BY stage ORDER BY count DESC`,[tenantId]);
    const diligence=await safeFirst(db,`SELECT COUNT(*) open_diligence,COUNT(CASE WHEN status='WAITING_FOUNDER' THEN 1 END) waiting_founder FROM fundraising_diligence_requests WHERE tenant_id = ? AND status NOT IN ('RESOLVED','CLOSED')`,[tenantId]);
    return {reportType:type,generatedAt,periodStart,periodEnd,summary:management.fundraising,targetStages:stages,diligence:diligence||{}};
  }
  if(type==='INVESTOR_UPDATE'){
    if(!entityId)throw Object.assign(new Error('Investor update requires a fundraising round id'),{status:422});
    const round=await safeFirst(db,`SELECT * FROM fundraising_rounds WHERE tenant_id = ? AND id = ?`,[tenantId,entityId]);
    if(!round)throw Object.assign(new Error('Fundraising round not found'),{status:404});
    const pipeline=await safeAll(db,`SELECT stage,COUNT(*) count,COALESCE(SUM(expected_check),0) expected FROM fundraising_targets WHERE tenant_id = ? AND round_id = ? GROUP BY stage`,[tenantId,entityId]);
    const capital=await safeFirst(db,`SELECT COALESCE(SUM(committed_amount),0) committed,COALESCE(SUM(received_amount),0) received FROM fundraising_commitments WHERE tenant_id = ? AND round_id = ? AND status!='CANCELLED'`,[tenantId,entityId]);
    return {reportType:type,generatedAt,round,pipeline,capital:capital||{}};
  }
  if(type==='CLIENT'||type==='FOUNDER_WEEKLY'){
    if(!entityId)throw Object.assign(new Error(`${type} report requires a project id`),{status:422});
    const project=await safeFirst(db,`SELECT id,name,lifecycle_status,relationship_health,owner_user_id,last_activity_at,next_follow_up_at FROM projects WHERE tenant_id = ? AND id = ?`,[tenantId,entityId]);
    if(!project)throw Object.assign(new Error('Project not found'),{status:404});
    const [opps,campaigns,payments,rounds]=await Promise.all([
      safeAll(db,`SELECT id,name,stage,estimated_value,currency,expected_close_date,next_action FROM opportunities WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20`,[tenantId,entityId]),
      safeAll(db,`SELECT id,name,status,start_date,end_date,akari_net_revenue,outstanding_amount,next_action FROM campaigns WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20`,[tenantId,entityId]),
      safeAll(db,`SELECT id,invoice_reference,status,amount,currency,due_date,received_date FROM payments WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20`,[tenantId,entityId]),
      safeAll(db,`SELECT id,round_name,stage,target_amount,currency,readiness_score,target_close_date,next_action FROM fundraising_rounds WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 10`,[tenantId,entityId]),
    ]);
    return {reportType:type,generatedAt,periodStart,periodEnd,project,opportunities:opps,campaigns,payments,fundraisingRounds:rounds};
  }
  if(type==='CAMPAIGN'){
    if(!entityId)throw Object.assign(new Error('Campaign report requires a campaign id'),{status:422});
    const campaign=await safeFirst(db,`SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?`,[tenantId,entityId]);
    if(!campaign)throw Object.assign(new Error('Campaign not found'),{status:404});
    const deliverables=await safeAll(db,`SELECT id,title,owner_user_id,due_date,status,completed_at,evidence_url FROM campaign_deliverables WHERE tenant_id = ? AND campaign_id = ? ORDER BY due_date`,[tenantId,entityId]);
    return {reportType:type,generatedAt,campaign,deliverables};
  }
  throw Object.assign(new Error('Unsupported report type'),{status:422});
}

export async function saveReportSnapshot(db,tenantId,userId,input){
  const report=await buildReport(db,tenantId,input);
  const id=makeId('report');
  const stamp=nowIso();
  await run(db,`INSERT INTO operating_report_snapshots (id,tenant_id,report_type,entity_type,entity_id,period_start,period_end,payload_json,generated_by,generated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[id,tenantId,report.reportType,text(input.entityType,100)||null,text(input.entityId,120)||null,text(input.periodStart,40)||null,text(input.periodEnd,40)||null,JSON.stringify(report),userId||null,stamp,stamp]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId||null,'REPORT_SNAPSHOT_CREATED','OPERATING_REPORT',id,JSON.stringify({reportType:report.reportType,entityId:input.entityId||null}),stamp]);
  return {id,...report};
}

export async function listReportSnapshots(db,tenantId,{reportType='',limit=20}={}){
  const bindings=[tenantId];
  let where='tenant_id = ?';
  if(reportType){where+=' AND report_type = ?';bindings.push(normalizeReportType(reportType));}
  bindings.push(Math.min(100,Math.max(1,Number(limit||20))));
  const rows=await safeAll(db,`SELECT id,report_type,entity_type,entity_id,period_start,period_end,generated_by,generated_at FROM operating_report_snapshots WHERE ${where} ORDER BY generated_at DESC LIMIT ?`,bindings);
  return rows;
}
