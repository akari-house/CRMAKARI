import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const STAGES = new Set(['NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION','WON','LOST','ON_HOLD']);

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Opportunity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const id = context.params.id;
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id, updated: true, demo: true });
    const existing = await first(context.env.DB, 'SELECT * FROM opportunities WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    if (!existing) return error('Opportunity not found', 404);
    const stage = body.stage ? String(body.stage).toUpperCase() : existing.stage;
    if (!STAGES.has(stage)) return error('Invalid opportunity stage', 422);
    const now = nowIso();
    await run(context.env.DB, `
      UPDATE opportunities SET
        stage = ?,
        name = COALESCE(?, name),
        service_type = COALESCE(?, service_type),
        estimated_value = COALESCE(?, estimated_value),
        estimated_value_base_currency = COALESCE(?, estimated_value_base_currency),
        probability_percentage = COALESCE(?, probability_percentage),
        expected_close_date = COALESCE(?, expected_close_date),
        next_action = COALESCE(?, next_action),
        next_follow_up_at = COALESCE(?, next_follow_up_at),
        won_at = CASE WHEN ? = 'WON' THEN COALESCE(won_at, ?) ELSE won_at END,
        lost_at = CASE WHEN ? = 'LOST' THEN COALESCE(lost_at, ?) ELSE lost_at END,
        updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      stage, body.name || null, body.serviceType || null,
      body.estimatedValue === undefined ? null : Number(body.estimatedValue),
      body.estimatedValue === undefined ? null : Number(body.estimatedValue),
      body.probabilityPercentage === undefined ? null : Math.min(Math.max(Number(body.probabilityPercentage),0),100),
      body.expectedCloseDate || null, body.nextAction || null, body.nextFollowUpAt || null,
      stage, now, stage, now, now, auth.userId, tenantId, id,
    ]);
    if (stage !== existing.stage) {
      await run(context.env.DB, `INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [makeId('osh'), tenantId, id, existing.stage, stage, auth.userId, now]);
    }
    if (stage === 'WON') await run(context.env.DB, `UPDATE projects SET lifecycle_status = 'CLIENT', customer_since = COALESCE(customer_since, ?), updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [now.slice(0,10), now, auth.userId, tenantId, existing.project_id]);
    await run(context.env.DB, `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at) VALUES (?, ?, ?, 'OPPORTUNITY_UPDATED', 'OPPORTUNITY', ?, ?, ?, ?)`, [makeId('aud'), tenantId, auth.userId, id, JSON.stringify({ stage: existing.stage }), JSON.stringify({ stage }), now]);
    return json({ id, updated: true, stage });
  } catch (cause) {
    console.error('Opportunity PATCH error', cause);
    return error(cause.message || 'Opportunity could not be updated', Number(cause.status || 500));
  }
}
