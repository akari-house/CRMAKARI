import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const STAGES = new Set(['NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION','WON','LOST','ON_HOLD']);
const text = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const items = await all(context.env.DB, `
      SELECT o.*, p.name AS project_name, u.full_name AS owner_name
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.tenant_id = ?
      ORDER BY CASE o.stage WHEN 'NEGOTIATION' THEN 1 WHEN 'PROPOSAL' THEN 2 WHEN 'QUALIFIED' THEN 3 ELSE 4 END,
               COALESCE(o.expected_close_date, '9999-12-31') ASC, o.updated_at DESC
    `, [tenantId]);
    return json({ items, total: items.length });
  } catch (cause) {
    console.error('Opportunities GET error', cause);
    return error(cause.message || 'Opportunities could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Opportunity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const projectId = text(body.projectId, 120);
    const name = text(body.name, 500);
    if (!projectId || !name) return error('Project and opportunity name are required', 422);
    const stage = String(body.stage || 'NEW').toUpperCase();
    if (!STAGES.has(stage)) return error('Invalid opportunity stage', 422);
    const probability = Math.min(Math.max(Number(body.probabilityPercentage || 10), 0), 100);
    if (!context.env.DB) return json({ id: makeId('opp'), created: true, demo: true }, 201);
    const project = await first(context.env.DB, 'SELECT id FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, projectId]);
    if (!project) return error('Project not found in this workspace', 404);
    const id = makeId('opp');
    const now = nowIso();
    await run(context.env.DB, `
      INSERT INTO opportunities (
        id, tenant_id, project_id, name, service_type, description, owner_user_id,
        stage, estimated_value, currency, estimated_value_base_currency,
        probability_percentage, expected_close_date, next_action, next_follow_up_at,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, tenantId, projectId, name, text(body.serviceType, 300), text(body.description, 10000),
      auth.userId, stage, Number(body.estimatedValue || 0), text(body.currency, 10) || 'USD',
      Number(body.estimatedValue || 0), probability, text(body.expectedCloseDate, 30),
      text(body.nextAction, 2000), text(body.nextFollowUpAt, 100), now, now, auth.userId, auth.userId,
    ]);
    await run(context.env.DB, `INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Opportunity created')`, [makeId('osh'), tenantId, id, stage, auth.userId, now]);
    if (!['WON','LOST','ON_HOLD'].includes(stage)) {
      await run(context.env.DB, `UPDATE projects SET lifecycle_status = CASE WHEN lifecycle_status = 'LEAD' THEN 'ACTIVE_OPPORTUNITY' ELSE lifecycle_status END, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [now, auth.userId, tenantId, projectId]);
    }
    await run(context.env.DB, `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at) VALUES (?, ?, ?, 'OPPORTUNITY_CREATED', 'OPPORTUNITY', ?, ?, ?)`, [makeId('aud'), tenantId, auth.userId, id, JSON.stringify({ projectId, name, stage }), now]);
    return json({ id, created: true }, 201);
  } catch (cause) {
    console.error('Opportunities POST error', cause);
    return error(cause.message || 'Opportunity could not be created', Number(cause.status || 500));
  }
}
