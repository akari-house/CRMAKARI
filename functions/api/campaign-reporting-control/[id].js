import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseReportingControl, serializeReportingControl, sanitizeReportingControl, buildReportingControlSummary } from '../../lib/campaign-reporting-control.js';

const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);

async function loadCampaign(db, tenantId, id) {
  return first(db, `SELECT c.id,c.name,c.status,c.start_date,c.end_date,c.notes,p.name AS project_name FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.id=? LIMIT 1`, [tenantId,id]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);
    const row = await loadCampaign(context.env.DB,tenantId,context.params.id);
    if (!row) return error('Campaign engagement not found',404);
    return json({ item:{ id:row.id,name:row.name,projectName:row.project_name,status:row.status,startDate:row.start_date,targetCompletionDate:row.end_date,...buildReportingControlSummary(row.notes,row.start_date) }, permissions:{ canManage:MANAGER_ROLES.has(auth?.role) } });
  } catch (cause) { return error(cause.message || 'Reporting control could not be loaded', Number(cause.status || 500)); }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!MANAGER_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required',403);
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ updated:true,demo:true });
    const row = await loadCampaign(context.env.DB,tenantId,context.params.id);
    if (!row) return error('Campaign engagement not found',404);
    const { root,control } = parseReportingControl(row.notes);
    const before = buildReportingControlSummary(row.notes,row.start_date);
    const next = sanitizeReportingControl(body.control || {}, control);
    next.updatedBy = auth.userId;
    const now = nowIso();
    const notes = serializeReportingControl(root,next);
    await run(context.env.DB,`UPDATE campaigns SET notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`,[notes,now,auth.userId,tenantId,row.id]);
    const after = buildReportingControlSummary(notes,row.start_date);
    await run(context.env.DB,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[makeId('aud'),tenantId,auth.userId,'CAMPAIGN_REPORTING_CONTROL_UPDATED','CAMPAIGN_REPORTING_CONTROL',row.id,JSON.stringify(before),JSON.stringify(after),now]);
    return json({ updated:true,item:{ id:row.id,name:row.name,projectName:row.project_name,...after } });
  } catch (cause) { return error(cause.message || 'Reporting control could not be updated', Number(cause.status || 500)); }
}
