import { json, error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';
import { buildReportingControlSummary } from '../lib/campaign-reporting-control.js';

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);
    const rows = await all(context.env.DB,`SELECT c.id,c.name,c.status,c.start_date,c.end_date,c.notes,p.name AS project_name FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.status NOT IN ('CANCELLED','ARCHIVED') ORDER BY c.updated_at DESC LIMIT 250`,[tenantId]);
    const items = rows.map((row) => ({ id:row.id,name:row.name,projectName:row.project_name,status:row.status,...buildReportingControlSummary(row.notes,row.start_date) }));
    const priorityRank = { CRITICAL:0, WARNING:1, HEALTHY:2 };
    items.sort((a,b) => (priorityRank[a.health] - priorityRank[b.health]) || Math.min(a.weekly.daysUntilDue ?? 999,a.monthly.daysUntilDue ?? 999) - Math.min(b.weekly.daysUntilDue ?? 999,b.monthly.daysUntilDue ?? 999));
    const summary = {
      campaigns:items.length,
      healthy:items.filter((item)=>item.health==='HEALTHY').length,
      warning:items.filter((item)=>item.health==='WARNING').length,
      critical:items.filter((item)=>item.health==='CRITICAL').length,
      overdueReports:items.reduce((sum,item)=>sum+(item.weekly.status==='OVERDUE'?1:0)+(item.monthly.status==='OVERDUE'?1:0),0),
      dueSoon:items.reduce((sum,item)=>sum+(['DUE_TODAY','DUE_SOON'].includes(item.weekly.status)?1:0)+(['DUE_TODAY','DUE_SOON'].includes(item.monthly.status)?1:0),0),
    };
    return json({ summary,items });
  } catch (cause) { return error(cause.message || 'Reporting queue could not be loaded',Number(cause.status || 500)); }
}
