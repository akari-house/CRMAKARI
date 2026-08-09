import { json, error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';
import { buildCampaignExecutionCommandCenter } from '../lib/campaign-execution-command-center.js';

async function campaigns(db,tenantId){
  return all(db,`
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.project_id,c.campaign_owner_id,c.updated_at,
      p.name AS project_name,u.full_name AS owner_name
    FROM campaigns c
    JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id
    LEFT JOIN users u ON u.id=c.campaign_owner_id
    WHERE c.tenant_id=?
    ORDER BY c.updated_at DESC
  `,[tenantId]);
}
async function tasks(db,tenantId){
  return all(db,`
    SELECT t.id,t.campaign_id,t.title,t.description,t.status,t.priority,t.due_at,t.owner_user_id,t.activity_type,t.updated_at,
      u.full_name AS owner_name
    FROM tasks t
    LEFT JOIN users u ON u.id=t.owner_user_id
    WHERE t.tenant_id=? AND t.campaign_id IS NOT NULL
    ORDER BY COALESCE(t.due_at,'9999-12-31'),t.updated_at DESC
  `,[tenantId]);
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;
    const tenantId=requireTenant(auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const url=new URL(context.request.url);
    const scope=String(url.searchParams.get('scope')||'team').toLowerCase()==='mine'?'mine':'team';
    const [campaignRows,taskRows]=await Promise.all([campaigns(context.env.DB,tenantId),tasks(context.env.DB,tenantId)]);
    const command=buildCampaignExecutionCommandCenter(campaignRows,taskRows,new Date().toISOString().slice(0,10),scope==='mine'?auth.userId:null);
    return json({
      command,
      permissions:{canManage:['OWNER','ADMIN','BD_MANAGER'].includes(auth.role),canOperate:['OWNER','ADMIN','BD_MANAGER','BD_MEMBER'].includes(auth.role)},
      methodology:{version:'R8.5L-1',tenantScoped:true,approvedOnlyPerformance:true,canonicalWorkOsTasks:true,singleRankedNextAction:true,financialAllocationIsNotPayment:true},
    });
  }catch(cause){
    return error(cause.message||'Campaign Execution Command Centre could not be loaded',Number(cause.status||500));
  }
}
