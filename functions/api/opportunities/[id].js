import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const STAGES = new Set(['NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION','WON','LOST','ON_HOLD']);
const GOVERNED_STAGES = new Set(['WON', 'LOST', 'ON_HOLD']);

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

    if (stage !== existing.stage) {
      if (['WON', 'LOST'].includes(existing.stage)) {
        return error('Closed opportunities cannot be reopened through the stage selector', 409);
      }
      if (['WON', 'LOST'].includes(stage)) {
        return error('Use the controlled close workflow to record the decision, evidence and commercial handoff', 409);
      }
      if (stage === 'ON_HOLD' || existing.stage === 'ON_HOLD') {
        return error('Use the controlled hold workflow to record the reason, review date and next action', 409);
      }
    }

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
        updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      stage, body.name || null, body.serviceType || null,
      body.estimatedValue === undefined ? null : Number(body.estimatedValue),
      body.estimatedValue === undefined ? null : Number(body.estimatedValue),
      body.probabilityPercentage === undefined ? null : Math.min(Math.max(Number(body.probabilityPercentage),0),100),
      body.expectedCloseDate || null, body.nextAction || null, body.nextFollowUpAt || null,
      now, auth.userId, tenantId, id,
    ]);
    if (stage !== existing.stage) {
      await run(context.env.DB, `INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [makeId('osh'), tenantId, id, existing.stage, stage, auth.userId, now]);
    }
    await run(context.env.DB, `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at) VALUES (?, ?, ?, 'OPPORTUNITY_UPDATED', 'OPPORTUNITY', ?, ?, ?, ?)`, [makeId('aud'), tenantId, auth.userId, id, JSON.stringify({ stage: existing.stage }), JSON.stringify({ stage }), now]);
    return json({ id, updated: true, stage });
  } catch (cause) {
    console.error('Opportunity PATCH error', cause);
    return error(cause.message || 'Opportunity could not be updated', Number(cause.status || 500));
  }
}
