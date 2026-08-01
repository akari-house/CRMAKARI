import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import { buildBdProfile } from '../../../lib/bd-profile.js';
import { booleanValue, text, probabilityForStage } from '../../../lib/revenue-lifecycle.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const BUDGET_STATUSES = new Set(['UNKNOWN', 'NOT_DISCLOSED', 'ESTIMATED', 'CONFIRMED', 'NOT_QUALIFIED']);

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Opportunity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id: opportunityId, updated: true, demo: true });

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.legacy_import_data, p.funding_status, p.funding_amount, p.valuation
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND o.id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (!opportunity) return error('Opportunity not found', 404);

    const budgetStatus = String(body.budgetStatus || opportunity.budget_status || 'UNKNOWN').toUpperCase();
    if (!BUDGET_STATUSES.has(budgetStatus)) return error('Budget status is invalid', 422);
    const needConfirmed = body.needConfirmed === undefined ? Boolean(opportunity.need_confirmed) : booleanValue(body.needConfirmed);
    const decisionMakerConfirmed = body.decisionMakerConfirmed === undefined ? Boolean(opportunity.decision_maker_confirmed) : booleanValue(body.decisionMakerConfirmed);
    const timelineConfirmed = body.timelineConfirmed === undefined ? Boolean(opportunity.timeline_confirmed) : booleanValue(body.timelineConfirmed);
    const markQualified = booleanValue(body.markQualified);
    const complete = needConfirmed && decisionMakerConfirmed && timelineConfirmed && !['UNKNOWN', 'NOT_QUALIFIED'].includes(budgetStatus);
    if (markQualified && !complete) {
      return error('Confirm need, decision-maker, timeline and budget before qualifying this opportunity', 422);
    }

    const stage = markQualified ? 'QUALIFIED' : opportunity.stage;
    const probability = markQualified ? probabilityForStage(stage, opportunity.probability_percentage) : opportunity.probability_percentage;
    const nextAction = text(body.nextAction, 2000) || opportunity.next_action;
    const nextFollowUpAt = text(body.nextFollowUpAt, 100) || opportunity.next_follow_up_at;
    const now = nowIso();

    await run(context.env.DB, `
      UPDATE opportunities SET
        budget_status = ?, need_confirmed = ?, decision_maker_confirmed = ?, timeline_confirmed = ?,
        stage = ?, probability_percentage = ?, next_action = ?, next_follow_up_at = ?,
        updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      budgetStatus, needConfirmed ? 1 : 0, decisionMakerConfirmed ? 1 : 0, timelineConfirmed ? 1 : 0,
      stage, probability, nextAction, nextFollowUpAt, now, auth.userId, tenantId, opportunityId,
    ]);

    if (stage !== opportunity.stage) {
      await run(context.env.DB, `
        INSERT INTO opportunity_stage_history
          (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [makeId('osh'), tenantId, opportunityId, opportunity.stage, stage, auth.userId, now, 'Qualification checklist completed']);
    }

    const profile = buildBdProfile(opportunity.legacy_import_data, {
      bdStage: markQualified ? 'QUALIFIED' : undefined,
      nextAction,
    }, opportunity);
    await run(context.env.DB, `
      UPDATE projects SET lifecycle_status = 'ACTIVE_OPPORTUNITY', legacy_import_data = ?,
        next_follow_up_at = ?, updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [profile.serialized, nextFollowUpAt, now, auth.userId, tenantId, opportunity.project_id]);

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'OPPORTUNITY_QUALIFICATION_UPDATED', 'OPPORTUNITY', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, opportunityId,
      JSON.stringify({
        budgetStatus: opportunity.budget_status,
        needConfirmed: Boolean(opportunity.need_confirmed),
        decisionMakerConfirmed: Boolean(opportunity.decision_maker_confirmed),
        timelineConfirmed: Boolean(opportunity.timeline_confirmed),
        stage: opportunity.stage,
      }),
      JSON.stringify({ budgetStatus, needConfirmed, decisionMakerConfirmed, timelineConfirmed, stage }),
      now,
    ]);

    return json({
      id: opportunityId,
      updated: true,
      stage,
      qualificationComplete: complete,
      probabilityPercentage: probability,
    });
  } catch (cause) {
    console.error('Opportunity qualification error', cause);
    return error(cause.message || 'Opportunity qualification could not be updated', Number(cause.status || 500));
  }
}
