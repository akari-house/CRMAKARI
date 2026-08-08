import { json, error } from '../../lib/response.js';
import { first } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { buildCampaignPeriodView } from '../../lib/campaign-period-view.js';

export async function onRequestGet(context) {
  try {
    const tenantId=requireTenant(context.data.auth);
    if(!context.env.DB) return error('D1 binding DB is not configured',500);
    const row=await first(context.env.DB,`SELECT c.id,c.name,c.status,c.start_date,c.end_date,c.notes,p.name AS project_name FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.id=? LIMIT 1`,[tenantId,context.params.id]);
    if(!row) return error('Campaign engagement not found',404);
    const url=new URL(context.request.url);
    const view=String(url.searchParams.get('view')||'THIS_WEEK').toUpperCase();
    const customStart=url.searchParams.get('start');
    const customEnd=url.searchParams.get('end');
    return json({ item:{ id:row.id,name:row.name,projectName:row.project_name,status:row.status,startDate:row.start_date,targetCompletionDate:row.end_date,period:buildCampaignPeriodView(row.notes,row.start_date,view,undefined,customStart,customEnd) } });
  } catch(cause){ return error(cause.message||'Campaign period view could not be generated',Number(cause.status||500)); }
}