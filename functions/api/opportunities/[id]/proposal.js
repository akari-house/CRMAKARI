import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import {
  PROPOSAL_MARKER,
  lifecyclePayload,
  moneyNumber,
  text,
  qualificationComplete,
  probabilityForStage,
} from '../../../lib/revenue-lifecycle.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const STATUSES = new Set(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']);

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
    if (['WON', 'LOST'].includes(opportunity.stage)) return error('Closed opportunities cannot receive a new proposal', 409);

    const status = String(body.status || 'SENT').toUpperCase();
    if (!STATUSES.has(status)) return error('Proposal status is invalid', 422);
    if (status === 'SENT' && !qualificationComplete(opportunity)) {
      return error('Complete the qualification checklist before sending a proposal', 422);
    }

    const amount = moneyNumber(body.amount ?? opportunity.estimated_value ?? 0, 'Proposal amount');
    const currency = String(body.currency || opportunity.currency || 'USD').toUpperCase().slice(0, 10);
    const title = text(body.title, 500) || `${opportunity.name} proposal`;
    const scope = text(body.scope, 12000);
    const deliverables = text(body.deliverables, 12000);
    if (!scope || !deliverables) return error('Proposal scope and deliverables are required', 422);

    const versionRow = await first(context.env.DB, `
      SELECT COUNT(*) AS value
      FROM activities
      WHERE tenant_id = ? AND opportunity_id = ? AND activity_type = 'PROPOSAL'
        AND description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
    `, [tenantId, opportunityId]);
    const version = Number(versionRow?.value || 0) + 1;
    const now = nowIso();
    const activityId = makeId('act');
    const nextAction = text(body.nextAction, 2000) || (status === 'SENT' ? 'Follow up on proposal' : 'Review and send proposal');
    const followUpAt = text(body.followUpAt, 100);
    const metadata = {
      title,
      version,
      status,
      serviceType: text(body.serviceType, 300) || opportunity.service_type,
      commercialModel: text(body.commercialModel, 100) || 'FIXED_FEE',
      amount,
      currency,
      scope,
      deliverables,
      timeline: text(body.timeline, 5000),
      paymentTerms: text(body.paymentTerms, 5000),
      validityDate: text(body.validityDate, 30),
      assumptions: text(body.assumptions, 8000),
      documentUrl: text(body.documentUrl, 1500),
      createdBy: auth.userId,
      createdAt: now,
    };

    await run(context.env.DB, `
      INSERT INTO activities
        (id, tenant_id, project_id, contact_id, opportunity_id, user_id, activity_type,
         subject, description, outcome, occurred_at, next_action, follow_up_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PROPOSAL', ?, ?, ?, ?, ?, ?, ?)
    `, [
      activityId, tenantId, opportunity.project_id, opportunity.primary_contact_id, opportunityId, auth.userId,
      `${title} · v${version}`, lifecyclePayload(PROPOSAL_MARKER, metadata), status,
      now, nextAction, followUpAt, now,
    ]);

    const stage = status === 'SENT' ? 'PROPOSAL' : opportunity.stage;
    const probability = status === 'SENT' ? probabilityForStage(stage, opportunity.probability_percentage) : opportunity.probability_percentage;
    await run(context.env.DB, `
      UPDATE opportunities SET
        stage = ?, service_type = COALESCE(?, service_type), estimated_value = ?,
        estimated_value_base_currency = ?, currency = ?, probability_percentage = ?,
        proposal_sent_at = CASE WHEN ? = 'SENT' THEN ? ELSE proposal_sent_at END,
        next_action = ?, next_follow_up_at = ?, updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      stage, metadata.serviceType, amount, amount, currency, probability,
      status, now, nextAction, followUpAt, now, auth.userId, tenantId, opportunityId,
    ]);

    if (stage !== opportunity.stage) {
      await run(context.env.DB, `
        INSERT INTO opportunity_stage_history
          (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [makeId('osh'), tenantId, opportunityId, opportunity.stage, stage, auth.userId, now, `Proposal v${version} ${status.toLowerCase()}`]);
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'PROPOSAL_RECORDED', 'OPPORTUNITY', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, opportunityId, JSON.stringify({ activityId, version, status, amount, currency }), now]);

    return json({ id: activityId, version, status, stage, amount, currency, created: true }, 201);
  } catch (cause) {
    console.error('Proposal workflow error', cause);
    return error(cause.message || 'Proposal could not be recorded', Number(cause.status || 500));
  }
}
