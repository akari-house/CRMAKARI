import { json,error,readJson } from '../../lib/response.js';
import { first } from '../../lib/db.js';
import { canViewFinance,requireRole,requireTenant } from '../../lib/permissions.js';
import { buildReport,listAttention,listReportSnapshots,refreshAttention,saveReportSnapshot,updateAttention } from '../../lib/reporting-attention.js';

const WRITE_ROLES=['OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE'];
const TEAM_ROLES=['OWNER','ADMIN','BD_MANAGER'];
const FINANCE_REPORTS=['MANAGEMENT','REVENUE'];
const MISSING_SCHEMA=/(no such table.*operational_attention|no such table.*operating_report_snapshots|D1_ERROR.*operational_attention|SQLITE_ERROR.*operational_attention)/i;

async function ensureSchema(db){
  try{await first(db,'SELECT id FROM operational_attention LIMIT 1');}
  catch(cause){
    if(MISSING_SCHEMA.test(String(cause?.message||''))){const e=new Error('Reporting + Attention migration 0007 must be applied before R74 is available');e.status=503;throw e;}
    throw cause;
  }
}
function stripFinance(value){
  if(Array.isArray(value))return value.map(stripFinance);
  if(!value||typeof value!=='object')return value;
  const hidden=new Set(['amount','amount_base_currency','estimated_value','estimated_value_base_currency','weighted_value','won_value','collected','overdue','net_revenue','outstanding','gross_revenue','akari_net_revenue','outstanding_amount','target_amount','committed','received','committed_amount','received_amount','expected','expected_check']);
  return Object.fromEntries(Object.entries(value).filter(([key])=>!hidden.has(key)).map(([key,item])=>[key,stripFinance(item)]));
}
function attentionForAuth(rows,auth){
  if(canViewFinance(auth))return rows;
  return rows.filter(row=>!['PAYMENT','REFERRAL'].includes(row.source_type)).map(row=>{
    if(row.reason_key==='SETTLEMENT_PENDING')return {...row,summary:'Campaign settlement requires attention.',metadata:{}};
    return row;
  });
}
function reportForAuth(report,auth){return canViewFinance(auth)?report:stripFinance(report);}

export async function onRequestGet(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth),url=new URL(context.request.url),action=url.searchParams.get('action')||'attention';
    await ensureSchema(context.env.DB);
    if(action==='report'){
      const reportType=String(url.searchParams.get('reportType')||'').toUpperCase();
      if(FINANCE_REPORTS.includes(reportType)&&!canViewFinance(auth))return error('Finance permission is required for this report',403);
      const report=await buildReport(context.env.DB,tenantId,{reportType,entityId:url.searchParams.get('entityId')||'',periodStart:url.searchParams.get('periodStart')||'',periodEnd:url.searchParams.get('periodEnd')||''});
      return json({report:reportForAuth(report,auth)});
    }
    if(action==='snapshots'){
      const rows=await listReportSnapshots(context.env.DB,tenantId,{reportType:url.searchParams.get('reportType')||'',limit:url.searchParams.get('limit')||20});
      return json({snapshots:rows});
    }
    const scope=url.searchParams.get('scope')==='team'?'team':'mine';
    if(scope==='team'&&!TEAM_ROLES.includes(auth.role))return error('Team attention requires manager permission',403);
    if(url.searchParams.get('refresh')!=='0')await refreshAttention(context.env.DB,tenantId);
    const rows=await listAttention(context.env.DB,tenantId,{ownerUserId:scope==='mine'?auth.userId:'',includeResolved:url.searchParams.get('includeResolved')==='1',limit:url.searchParams.get('limit')||100});
    const visible=attentionForAuth(rows,auth);
    const summary={total:visible.length,urgent:visible.filter(row=>row.priority==='URGENT').length,high:visible.filter(row=>row.priority==='HIGH').length,overdue:visible.filter(row=>row.due_at&&Date.parse(row.due_at)<Date.now()).length};
    return json({scope,summary,attention:visible,generatedAt:new Date().toISOString()});
  }catch(cause){
    console.error('R74 operating rhythm read failed',cause);
    return error(cause.message||'Operating Rhythm could not be loaded',Number(cause.status||500));
  }
}

export async function onRequestPost(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);
    await ensureSchema(context.env.DB);
    requireRole(auth,WRITE_ROLES);
    const body=await readJson(context.request),action=String(body.action||'');
    if(action==='refresh-attention'){
      const rows=await refreshAttention(context.env.DB,tenantId);
      return json({refreshed:true,attention:attentionForAuth(rows,auth)});
    }
    if(action==='update-attention'){
      const id=String(body.id||'').trim();
      if(!id)return error('Attention item id is required',422);
      const current=await first(context.env.DB,'SELECT id,owner_user_id FROM operational_attention WHERE tenant_id = ? AND id = ?',[tenantId,id]);
      if(!current)return error('Attention item not found',404);
      if(!TEAM_ROLES.includes(auth.role)&&current.owner_user_id&&current.owner_user_id!==auth.userId)return error('You can only update attention assigned to you',403);
      const updated=await updateAttention(context.env.DB,tenantId,id,{status:body.status,snoozedUntil:body.snoozedUntil},auth.userId);
      return json({updated:true,item:attentionForAuth([updated],auth)[0]||null});
    }
    if(action==='snapshot-report'){
      const reportType=String(body.reportType||'').toUpperCase();
      if(FINANCE_REPORTS.includes(reportType)&&!canViewFinance(auth))return error('Finance permission is required for this report',403);
      const saved=await saveReportSnapshot(context.env.DB,tenantId,auth.userId,{reportType,entityType:body.entityType||'',entityId:body.entityId||'',periodStart:body.periodStart||'',periodEnd:body.periodEnd||''});
      return json({saved:true,report:reportForAuth(saved,auth)});
    }
    return error('Operating Rhythm action is not supported',404);
  }catch(cause){
    console.error('R74 operating rhythm write failed',cause);
    return error(cause.message||'Operating Rhythm update failed',Number(cause.status||500));
  }
}
