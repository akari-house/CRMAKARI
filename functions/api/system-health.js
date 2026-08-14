import { json,error } from '../lib/response.js';
import { first,all,nowIso } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';

const REQUIRED_TABLES=['agreements','founder_onboarding_items','fundraising_data_room_requirements','relationship_profiles','operational_attention','operating_report_snapshots','platform_admins','workspace_usage_snapshots','workspace_integrations','workspace_api_keys','webhook_endpoints'];

export async function onRequestGet(context){
  const startedAt=Date.now();
  try{
    const tenantId=requireTenant(context.data.auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500,{requestId:context.data.requestId||null});
    const tenant=await first(context.env.DB,`SELECT id,slug,status FROM tenants WHERE id=? LIMIT 1`,[tenantId]);
    if(!tenant)return error('Workspace was not found',404,{requestId:context.data.requestId||null});
    const placeholders=REQUIRED_TABLES.map(()=>'?').join(',');
    const rows=await all(context.env.DB,`SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${placeholders}) ORDER BY name`,REQUIRED_TABLES);
    const present=new Set(rows.map(row=>row.name)),missing=REQUIRED_TABLES.filter(name=>!present.has(name));
    const status=missing.length?'DEGRADED':'OK';
    return json({service:'crm-by-akari',status,generatedAt:nowIso(),requestId:context.data.requestId||null,workspace:{slug:tenant.slug,status:tenant.status},database:{reachable:true,latencyMs:Date.now()-startedAt},schema:{expected:REQUIRED_TABLES.length,present:REQUIRED_TABLES.length-missing.length,missing}},status==='OK'?200:503);
  }catch(cause){
    console.error('AKARI system health failed',cause);
    return error('System health check failed',Number(cause.status||500),{requestId:context.data.requestId||null});
  }
}
