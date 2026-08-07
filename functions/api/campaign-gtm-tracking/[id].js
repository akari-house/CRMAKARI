import { json,error,readJson } from '../../lib/response.js';
import { first,run,makeId,nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignGtmTracking,serializeCampaignGtmTracking,sanitizeGtmActivity,gtmTrackingSummary } from '../../lib/campaign-gtm-tracking.js';

const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER']);

function requireWrite(auth){if(!WRITE_ROLES.has(auth?.role)){const cause=new Error('Campaign GTM tracking write permission is required');cause.status=403;throw cause;}}

async function loadCampaign(db,tenantId,id){
  return first(db,`SELECT c.*,p.name AS project_name,u.full_name AS campaign_owner_name FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id LEFT JOIN users u ON u.id=c.campaign_owner_id WHERE c.tenant_id=? AND c.id=? LIMIT 1`,[tenantId,id]);
}

function publicItem(row,tracking){return {id:row.id,name:row.name,projectName:row.project_name,startDate:row.start_date,status:row.status,activities:[...tracking.activities].sort((a,b)=>String(b.dataDate).localeCompare(String(a.dataDate))),summary:gtmTrackingSummary(tracking),updatedAt:tracking.updatedAt||row.updated_at};}

async function persist(db,auth,tenantId,row,root,tracking,action,before){
  const now=nowIso(); tracking.createdAt||=now; tracking.createdBy||=auth.userId; tracking.updatedAt=now; tracking.updatedBy=auth.userId;
  await run(db,'UPDATE campaigns SET notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[serializeCampaignGtmTracking(root,tracking),now,auth.userId,tenantId,row.id]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,?, 'CAMPAIGN_GTM_TRACKING',?,?,?,?)`,[makeId('aud'),tenantId,auth.userId,action,row.id,JSON.stringify(before||{}),JSON.stringify(gtmTrackingSummary(tracking)),now]);
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth; const tenantId=requireTenant(auth); if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const row=await loadCampaign(context.env.DB,tenantId,context.params.id); if(!row)return error('Campaign engagement not found',404);
    const {tracking}=parseCampaignGtmTracking(row.notes); return json({item:publicItem(row,tracking),permissions:{canWrite:WRITE_ROLES.has(auth?.role),canManage:MANAGER_ROLES.has(auth?.role)}});
  }catch(cause){return error(cause.message||'Campaign GTM tracking workspace could not be loaded',Number(cause.status||500));}
}

export async function onRequestPatch(context){
  try{
    const auth=context.data.auth; requireWrite(auth); const tenantId=requireTenant(auth); const body=await readJson(context.request); const action=String(body.action||'').toLowerCase();
    if(!context.env.DB)return json({updated:true,action,demo:true});
    const row=await loadCampaign(context.env.DB,tenantId,context.params.id); if(!row)return error('Campaign engagement not found',404);
    const {root,tracking}=parseCampaignGtmTracking(row.notes); const before=gtmTrackingSummary(tracking);
    if(action==='upsert-activity'){
      const input=body.activity||{}; const index=input.id?tracking.activities.findIndex((item)=>item.id===input.id):-1;
      const activity=sanitizeGtmActivity(input,row.start_date,index>=0?tracking.activities[index]:{}); activity.enteredBy||=auth.userId;
      if(index>=0)tracking.activities[index]=activity; else tracking.activities.push(activity);
    }else if(action==='delete-activity'){
      if(!MANAGER_ROLES.has(auth?.role))return error('Owner, Admin or BD Manager permission is required',403);
      const index=tracking.activities.findIndex((item)=>item.id===String(body.id||'')); if(index<0)return error('Tracked GTM activity was not found',404); tracking.activities.splice(index,1);
    }else{return error('Campaign GTM tracking action is invalid',422);}
    await persist(context.env.DB,auth,tenantId,row,root,tracking,`CAMPAIGN_GTM_${action.toUpperCase().replaceAll('-','_')}`,before);
    return json({updated:true,item:publicItem(row,tracking)});
  }catch(cause){return error(cause.message||'Campaign GTM tracking could not be updated',Number(cause.status||500));}
}
