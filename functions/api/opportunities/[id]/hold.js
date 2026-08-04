import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import { lifecyclePayload, probabilityForStage, text } from '../../../lib/revenue-lifecycle.js';

export const HOLD_MARKER = 'AKARI_OPPORTUNITY_HOLD_V1';
const MANAGER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const ACTIONS = new Set(['HOLD', 'RESUME']);
const HOLD_CATEGORIES = new Set(['CLIENT_TIMING', 'BUDGET', 'INTERNAL_DEPENDENCY', 'LEGAL_COMPLIANCE', 'NO_RESPONSE', 'DELIVERY_CAPACITY', 'OTHER']);
const RESUME_STAGES = new Set(['NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION']);

function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const permissionError = new Error('Manager permission is required to place or resume an opportunity');
    permissionError.status = 403;
    throw permissionError;
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireManager(auth);
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '').trim();
    const body = await readJson(context.request);
    const action = String(body.action || 'HOLD').trim().toUpperCase();
    if (!ACTIONS.has(action)) return error('Hold action must be HOLD or RESUME', 422);
    if (!context.env.DB) return json({ id: opportunityId, action, updated: true, demo: true });

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.name AS project_name
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND o.id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (!opportunity) return error('Opportunity not found', 404);
    if (['WON', 'LOST'].includes(String(opportunity.stage || '').toUpperCase())) {
      return error('Closed opportunities cannot be placed on hold or resumed', 409);
    }

    const now = nowIso();
    let nextStage;
    let nextAction;
    let nextFollowUpAt;
    let metadata;

    if (action === 'HOLD') {
      if (String(opportunity.stage || '').toUpperCase() === 'ON_HOLD') return error('This opportunity is already on hold', 409);
      const category = String(body.category || '').trim().toUpperCase();
      const reason = text(body.reason, 5000);
      nextAction = text(body.nextAction, 2000);
      nextFollowUpAt = text(body.reviewAt || body.nextFollowUpAt, 100);
      if (!HOLD_CATEGORIES.has(category)) return error('Select a valid hold category', 422);
      if (!reason) return error('Record why this opportunity is being placed on hold', 422);
      if (!nextAction) return error('Record the next relationship action while the opportunity is on hold', 422);
      if (!nextFollowUpAt) return error('A hold review date is required', 422);
      nextStage = 'ON_HOLD';
      metadata = {
        action,
        category,
        reason,
        reviewAt: nextFollowUpAt,
        nextAction,
        previousStage: opportunity.stage,
        ownerUserId: opportunity.owner_user_id || null,
        recordedBy: auth.userId,
        recordedAt: now,
      };
    } else {
      if (String(opportunity.stage || '').toUpperCase() !== 'ON_HOLD') return error('Only an opportunity on hold can be resumed', 409);
      nextStage = String(body.resumeStage || 'QUALIFIED').trim().toUpperCase();
      const reason = text(body.reason, 5000);
      nextAction = text(body.nextAction, 2000);
      nextFollowUpAt = text(body.nextFollowUpAt, 100);
      if (!RESUME_STAGES.has(nextStage)) return error('Select a valid working stage to resume the opportunity', 422);
      if (!reason) return error('Record why the opportunity is ready to resume', 422);
      if (!nextAction) return error('Record the next action for the resumed opportunity', 422);
      if (!nextFollowUpAt) return error('A follow-up date is required when resuming an opportunity', 422);
      metadata = {
        action,
        reason,
        resumeStage: nextStage,
        nextAction,
        nextFollowUpAt,
        previousStage: opportunity.stage,
        ownerUserId: opportunity.owner_user_id || null,
        recordedBy: auth.userId,
        recordedAt: now,
      };
    }

    const probability = nextStage === 'ON_HOLD'
      ? Number(opportunity.probability_percentage || 0)
      : probabilityForStage(nextStage, opportunity.probability_percentage);
    const activityId = makeId('act');
    await run(context.env.DB, `
      INSERT INTO activities (
        id, tenant_id, project_id, contact_id, opportunity_id, user_id,
        activity_type, subject, description, outcome, occurred_at,
        next_action, follow_up_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPPORTUNITY_HOLD', ?, ?, ?, ?, ?, ?, ?)
    `, [
      activityId,
      tenantId,
      opportunity.project_id,
      opportunity.primary_contact_id,
      opportunityId,
      auth.userId,
      action === 'HOLD' ? `Opportunity placed on hold · ${opportunity.name}` : `Opportunity resumed · ${opportunity.name}`,
      lifecyclePayload(HOLD_MARKER, metadata),
      action,
      now,
      nextAction,
      nextFollowUpAt,
      now,
    ]);

    await run(context.env.DB, `
      UPDATE opportunities SET
        stage = ?, probability_percentage = ?, next_action = ?, next_follow_up_at = ?,
        updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [nextStage, probability, nextAction, nextFollowUpAt, now, auth.userId, tenantId, opportunityId]);

    await run(context.env.DB, `
      INSERT INTO opportunity_stage_history (
        id, tenant_id, opportunity_id, previous_stage, new_stage,
        changed_by, changed_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      makeId('osh'), tenantId, opportunityId, opportunity.stage, nextStage,
      auth.userId, now,
      action === 'HOLD' ? `Hold category: ${metadata.category}` : `Resumed: ${metadata.reason}`,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs (
        id, tenant_id, user_id, action, entity_type, entity_id,
        before_data, after_data, created_at
      ) VALUES (?, ?, ?, ?, 'OPPORTUNITY', ?, ?, ?, ?)
    `, [
      makeId('aud'),
      tenantId,
      auth.userId,
      action === 'HOLD' ? 'OPPORTUNITY_PLACED_ON_HOLD' : 'OPPORTUNITY_RESUMED',
      opportunityId,
      JSON.stringify({ stage: opportunity.stage, nextAction: opportunity.next_action, nextFollowUpAt: opportunity.next_follow_up_at }),
      JSON.stringify({ stage: nextStage, nextAction, nextFollowUpAt, activityId, metadata }),
      now,
    ]);

    return json({ id: opportunityId, activityId, action, stage: nextStage, nextAction, nextFollowUpAt, updated: true });
  } catch (cause) {
    console.error('Opportunity hold workflow error', cause);
    return error(cause.message || 'Opportunity hold status could not be updated', Number(cause.status || 500));
  }
}
