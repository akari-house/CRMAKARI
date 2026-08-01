import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import {
  NEGOTIATION_MARKER,
  lifecyclePayload,
  moneyNumber,
  text,
  probabilityForStage,
} from '../../../lib/revenue-lifecycle.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const OUTCOMES = new Set(['OPEN', 'COUNTERED', 'AGREED_IN_PRINCIPLE', 'STALLED', 'REJECTED']);

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Opportunity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id: makeId('act'), created: true, demo: true }, 201);

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.name AS project_name
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND o.id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (!opportunity) return error('Opportunity not found', 404);
    if (['WON', 'LOST'].includes(opportunity.stage)) return error('Closed opportunities cannot be negotiated', 409);

    const proposal = await first(context.env.DB, `
      SELECT id FROM activities
      WHERE tenant_id = ? AND opportunity_id = ? AND activity_type = 'PROPOSAL'
        AND description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
      ORDER BY occurred_at DESC LIMIT 1
    `, [tenantId, opportunityId]);
    if (!proposal) return error('Record a proposal before opening negotiation', 422);

    const outcome = String(body.outcome || 'OPEN').toUpperCase();
    if (!OUTCOMES.has(outcome)) return error('Negotiation outcome is invalid', 422);
    const summary = text(body.summary, 10000);
    if (!summary) return error('Negotiation summary is required', 422);

    const roundRow = await first(context.env.DB, `
      SELECT COUNT(*) AS value
      FROM activities
      WHERE tenant_id = ? AND opportunity_id = ? AND activity_type = 'NEGOTIATION'
        AND description LIKE '%\"recordType\":\"AKARI_NEGOTIATION_V1\"%'
    `, [tenantId, opportunityId]);
    const round = Number(roundRow?.value || 0) + 1;
    const amount = moneyNumber(body.currentOffer ?? opportunity.estimated_value ?? 0, 'Current offer');
    const currency = String(body.currency || opportunity.currency || 'USD').toUpperCase().slice(0, 10);
    const now = nowIso();
    const nextAction = text(body.nextAction, 2000) || 'Progress negotiation';
    const followUpAt = text(body.followUpAt, 100);
    const activityId = makeId('act');
    const metadata = {
      round,
      outcome,
      currentOffer: amount,
      currency,
      summary,
      requestedChanges: text(body.requestedChanges, 10000),
      agreedTerms: text(body.agreedTerms, 10000),
      commercialRisk: text(body.commercialRisk, 5000),
      decisionDate: text(body.decisionDate, 30),
      createdBy: auth.userId,
      createdAt: now,
    };

    await run(context.env.DB, `
      INSERT INTO activities
        (id, tenant_id, project_id, contact_id, opportunity_id, user_id, activity_type,
         subject, description, outcome, occurred_at, next_action, follow_up_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'NEGOTIATION', ?, ?, ?, ?, ?, ?, ?)
    `, [
      activityId, tenantId, opportunity.project_id, opportunity.primary_contact_id, opportunityId, auth.userId,
      `Negotiation round ${round}`, lifecyclePayload(NEGOTIATION_MARKER, metadata), outcome,
      now, nextAction, followUpAt, now,
    ]);

    const stage = outcome === 'AGREED_IN_PRINCIPLE' ? 'VERBAL_CONFIRMATION' : 'NEGOTIATION';
    const probability = probabilityForStage(stage, opportunity.probability_percentage);
    await run(context.env.DB, `
      UPDATE opportunities SET stage = ?, estimated_value = ?, estimated_value_base_currency = ?,
        currency = ?, probability_percentage = ?, next_action = ?, next_follow_up_at = ?,
        updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [stage, amount, amount, currency, probability, nextAction, followUpAt, now, auth.userId, tenantId, opportunityId]);

    if (stage !== opportunity.stage) {
      await run(context.env.DB, `
        INSERT INTO opportunity_stage_history
          (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [makeId('osh'), tenantId, opportunityId, opportunity.stage, stage, auth.userId, now, `Negotiation round ${round}: ${outcome}`]);
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'NEGOTIATION_RECORDED', 'OPPORTUNITY', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, opportunityId, JSON.stringify({ activityId, round, outcome, amount, currency, stage }), now]);

    return json({ id: activityId, round, outcome, amount, currency, stage, created: true }, 201);
  } catch (cause) {
    console.error('Negotiation workflow error', cause);
    return error(cause.message || 'Negotiation round could not be recorded', Number(cause.status || 500));
  }
}
