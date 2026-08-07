import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking, campaignTrackingSummary } from '../../lib/campaign-tracking.js';
import { parseCampaignGtmTracking, gtmTrackingSummary } from '../../lib/campaign-gtm-tracking.js';
import {
  parseCampaignReportingHistory,
  serializeCampaignReportingHistory,
  buildCampaignSnapshot,
  reportingHistorySummary,
} from '../../lib/campaign-reporting-history.js';

const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.*, p.name AS project_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

function publicItem(row, history) {
  return {
    id: row.id,
    name: row.name,
    projectName: row.project_name,
    startDate: row.start_date,
    targetCompletionDate: row.end_date,
    status: row.status,
    ...reportingHistorySummary(history),
  };
}

async function persist(db, auth, tenantId, row, root, history, action, before) {
  const now = nowIso();
  history.createdAt ||= now;
  history.createdBy ||= auth.userId;
  history.updatedAt = now;
  history.updatedBy = auth.userId;
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [serializeCampaignReportingHistory(root, history), now, auth.userId, tenantId, row.id]);
  await run(db, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'CAMPAIGN_REPORTING_HISTORY', ?, ?, ?, ?)
  `, [makeId('aud'), tenantId, auth.userId, action, row.id, JSON.stringify(before || {}), JSON.stringify(reportingHistorySummary(history)), now]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { history } = parseCampaignReportingHistory(row.notes);
    return json({ item:publicItem(row, history), permissions:{ canManage:MANAGER_ROLES.has(auth?.role) } });
  } catch (cause) {
    return error(cause.message || 'Campaign reporting history could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!MANAGER_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
    const body = await readJson(context.request);
    const action = String(body.action || '').toLowerCase();
    if (!context.env.DB) return json({ updated:true, action, demo:true });
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, history } = parseCampaignReportingHistory(row.notes);
    const before = reportingHistorySummary(history);

    if (action === 'capture-snapshot') {
      const type = String(body.snapshot?.type || 'WEEKLY').toUpperCase();
      const periodDate = String(body.snapshot?.periodDate || nowIso().slice(0,10));
      const duplicate = history.snapshots.find((item) => item.type === type && item.periodDate === periodDate);
      if (duplicate) return error('A snapshot already exists for this reporting type and date', 409);
      const { tracking } = parseCampaignTracking(row.notes);
      const { tracking:gtmTracking } = parseCampaignGtmTracking(row.notes);
      const trackingSummary = campaignTrackingSummary(tracking, row.start_date, periodDate);
      const gtmSummary = gtmTrackingSummary(gtmTracking, periodDate);
      history.snapshots.push(buildCampaignSnapshot({
        type,
        label: body.snapshot?.label,
        periodDate,
        campaignStartDate: row.start_date,
        tracking,
        trackingSummary,
        gtmTracking,
        gtmSummary,
        capturedBy: auth.userId,
      }));
    } else if (action === 'delete-snapshot') {
      const index = history.snapshots.findIndex((item) => item.id === String(body.id || ''));
      if (index < 0) return error('Campaign reporting snapshot was not found', 404);
      history.snapshots.splice(index, 1);
    } else {
      return error('Campaign reporting-history action is invalid', 422);
    }

    await persist(context.env.DB, auth, tenantId, row, root, history, `CAMPAIGN_REPORTING_${action.toUpperCase().replaceAll('-', '_')}`, before);
    return json({ updated:true, item:publicItem(row, history) });
  } catch (cause) {
    return error(cause.message || 'Campaign reporting history could not be updated', Number(cause.status || 500));
  }
}
