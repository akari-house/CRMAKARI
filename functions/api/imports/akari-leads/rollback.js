import { json, error, readJson } from '../../../lib/response.js';
import { first, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';

const IMPORT_ROLES = new Set(['OWNER', 'ADMIN']);

function text(input, max = 500) {
  if (input === null || input === undefined) return null;
  const normalized = String(input).trim();
  return normalized ? normalized.slice(0, max) : null;
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!IMPORT_ROLES.has(auth?.role)) return error('Owner or Admin permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const body = await readJson(context.request);
    const batchId = text(body.batchId, 120);
    const fileName = text(body.fileName, 300) || 'AKARI Leads workbook';
    if (!batchId) return error('Import batch ID is required', 422);

    const sourceToken = `${fileName}#${batchId}`;
    const downstream = await first(context.env.DB, `
      SELECT
        COUNT(DISTINCT o.id) AS opportunity_count,
        COUNT(DISTINCT c.id) AS campaign_count,
        COUNT(DISTINCT a.id) AS activity_count
      FROM projects p
      LEFT JOIN opportunities o ON o.project_id = p.id AND o.tenant_id = p.tenant_id
      LEFT JOIN campaigns c ON c.project_id = p.id AND c.tenant_id = p.tenant_id
      LEFT JOIN activities a ON a.project_id = p.id AND a.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.source_type = 'AKARI_LEADS' AND p.original_import_source = ?
    `, [tenantId, sourceToken]);

    if (Number(downstream?.opportunity_count || 0) > 0 || Number(downstream?.campaign_count || 0) > 0 || Number(downstream?.activity_count || 0) > 0) {
      return error('Rollback blocked because imported records already have opportunities, campaigns or activities', 409, downstream);
    }

    const taskMarker = `%[AKARI_IMPORT:${batchId}]%`;
    const now = nowIso();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`DELETE FROM tasks WHERE tenant_id = ? AND description LIKE ?`).bind(tenantId, taskMarker),
      context.env.DB.prepare(`DELETE FROM projects WHERE tenant_id = ? AND source_type = 'AKARI_LEADS' AND original_import_source = ?`).bind(tenantId, sourceToken),
      context.env.DB.prepare(`
        INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, 'AKARI_LEADS_IMPORT_ROLLBACK', 'IMPORT_BATCH', ?, ?, ?, ?, ?)
      `).bind(
        makeId('aud'), tenantId, auth.userId, batchId,
        JSON.stringify({ batchId, fileName, sourceToken }),
        context.request.headers.get('cf-connecting-ip'),
        context.request.headers.get('user-agent'),
        now,
      ),
    ]);

    return json({
      batchId,
      rolledBack: true,
      tasksDeleted: Number(results[0]?.meta?.changes || 0),
      projectsDeleted: Number(results[1]?.meta?.changes || 0),
    });
  } catch (cause) {
    console.error('AKARI Leads rollback error', cause);
    return error(cause.message || 'AKARI Leads rollback failed', Number(cause.status || 500));
  }
}
