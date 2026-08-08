import { json, error } from '../../lib/response.js';
import { first } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignReportingHistory } from '../../lib/campaign-reporting-history.js';
import { buildCampaignPeriodSummary } from '../../lib/campaign-summary-intelligence.js';

const ALLOWED_TYPES = new Set(['WEEKLY','MONTHLY']);

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const url = new URL(context.request.url);
    const requestedType = String(url.searchParams.get('type') || 'WEEKLY').toUpperCase();
    if (!ALLOWED_TYPES.has(requestedType)) return error('Summary type must be weekly or monthly', 422);
    const row = await first(context.env.DB, `
      SELECT c.id, c.name, c.status, c.start_date, c.end_date, c.notes,
        p.name AS project_name, u.full_name AS campaign_owner_name
      FROM campaigns c
      JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
      LEFT JOIN users u ON u.id = c.campaign_owner_id
      WHERE c.tenant_id = ? AND c.id = ?
      LIMIT 1
    `, [tenantId, context.params.id]);
    if (!row) return error('Campaign engagement not found', 404);
    const { history } = parseCampaignReportingHistory(row.notes);
    return json({
      item: {
        id: row.id,
        name: row.name,
        projectName: row.project_name,
        status: row.status,
        startDate: row.start_date,
        targetCompletionDate: row.end_date,
        campaignOwnerName: row.campaign_owner_name,
        summary: buildCampaignPeriodSummary(history, requestedType),
      },
    });
  } catch (cause) {
    return error(cause.message || 'Campaign summary intelligence could not be generated', Number(cause.status || 500));
  }
}
