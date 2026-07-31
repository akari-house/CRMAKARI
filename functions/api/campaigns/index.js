import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const STATUSES = new Set(['CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','COMPLETED','PAUSED','CANCELLED']);
const text = (value, max = 5000) => value === null || value === undefined ? null : (String(value).trim().slice(0,max) || null);

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({items:[],total:0,demo:true});
    const items = await all(context.env.DB, `SELECT c.*, p.name AS project_name, u.full_name AS owner_name FROM campaigns c JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id LEFT JOIN users u ON u.id = c.campaign_owner_id WHERE c.tenant_id = ? ORDER BY CASE c.status WHEN 'LIVE' THEN 1 WHEN 'REPORTING' THEN 2 WHEN 'PLANNING' THEN 3 ELSE 4 END, c.updated_at DESC`, [tenantId]);
    return json({items,total:items.length});
  } catch(cause) { console.error('Campaigns GET error',cause); return error(cause.message || 'Campaigns could not be loaded',Number(cause.status || 500)); }
}

export async function onRequestPost(context) {
  try {
    const auth=context.data.auth;
    if(!WRITE_ROLES.has(auth?.role)) return error('Campaign write permission is required',403);
    const tenantId=requireTenant(auth); const body=await readJson(context.request);
    const projectId=text(body.projectId,120); const name=text(body.name,500); if(!projectId||!name)return error('Project and campaign name are required',422);
    const status=String(body.status||'CONFIRMED').toUpperCase(); if(!STATUSES.has(status))return error('Invalid campaign status',422);
    if(!context.env.DB)return json({id:makeId('cam'),created:true,demo:true},201);
    const project=await first(context.env.DB,'SELECT id FROM projects WHERE tenant_id = ? AND id = ?',[tenantId,projectId]); if(!project)return error('Project not found',404);
    const id=makeId('cam'); const now=nowIso();
    await run(context.env.DB,`INSERT INTO campaigns (id,tenant_id,project_id,name,campaign_owner_id,status,region,start_date,end_date,reporting_due_date,deliverables_summary,gross_revenue,currency,gross_revenue_base_currency,campaign_cost,creator_cost,other_cost,referral_percentage,amount_invoiced,amount_received,payment_status,next_action,notes,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      id,tenantId,projectId,name,auth.userId,status,text(body.region,500),text(body.startDate,30),text(body.endDate,30),text(body.reportingDueDate,30),text(body.deliverablesSummary,10000),Number(body.grossRevenue||0),text(body.currency,10)||'USD',Number(body.grossRevenue||0),Number(body.campaignCost||0),Number(body.creatorCost||0),Number(body.otherCost||0),Number(body.referralPercentage||0),Number(body.amountInvoiced||0),Number(body.amountReceived||0),text(body.paymentStatus,100),text(body.nextAction,2000),text(body.notes,10000),now,now,auth.userId,auth.userId
    ]);
    await run(context.env.DB,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,'CAMPAIGN_CREATED','CAMPAIGN',?,?,?)`,[makeId('aud'),tenantId,auth.userId,id,JSON.stringify({projectId,name,status}),now]);
    return json({id,created:true},201);
  } catch(cause) { console.error('Campaigns POST error',cause); return error(cause.message || 'Campaign could not be created',Number(cause.status || 500)); }
}
