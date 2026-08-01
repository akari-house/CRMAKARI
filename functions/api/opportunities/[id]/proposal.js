import { json, error, readJson } from '../../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import {
  PROPOSAL_MARKER,
  lifecyclePayload,
  moneyNumber,
  text,
  qualificationComplete,
  probabilityForStage,
  parseJson,
} from '../../../lib/revenue-lifecycle.js';
import { PROPOSAL_STATUSES, parseFeatureFlags } from '../../../lib/commercial-hardening.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const APPROVER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);

async function loadTemplate(db, tenantId, templateId) {
  if (!templateId) return null;
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ?', [tenantId]);
  const flags = parseFeatureFlags(row?.feature_flags_json);
  const templates = Array.isArray(flags.proposalTemplates) ? flags.proposalTemplates : [];
  return templates.find((item) => item.id === templateId && item.active !== false) || null;
}

async function supersedePrevious(db, tenantId, opportunityId, exceptId, now) {
  const rows = await all(db, `
    SELECT id, description, outcome FROM activities
    WHERE tenant_id = ? AND opportunity_id = ? AND activity_type = 'PROPOSAL' AND id != ?
      AND description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
  `, [tenantId, opportunityId, exceptId]);
  for (const row of rows) {
    const metadata = parseJson(row.description, {});
    const current = String(metadata.status || row.outcome || '').toUpperCase();
    if (['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'].includes(current)) continue;
    metadata.status = 'SUPERSEDED';
    metadata.supersededAt = now;
    metadata.supersededBy = exceptId;
    await run(db, `UPDATE activities SET outcome = 'SUPERSEDED', description = ? WHERE tenant_id = ? AND id = ?`, [JSON.stringify(metadata), tenantId, row.id]);
  }
}

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

    const status = String(body.status || 'DRAFT').toUpperCase();
    if (!PROPOSAL_STATUSES.has(status)) return error('Proposal status is invalid', 422);
    if (['APPROVED', 'SENT', 'ACCEPTED', 'REJECTED'].includes(status) && !APPROVER_ROLES.has(auth?.role)) {
      return error('Manager approval is required for this proposal status', 403);
    }
    if (status === 'SENT' && !qualificationComplete(opportunity)) {
      return error('Complete the qualification checklist before sending a proposal', 422);
    }

    const templateId = text(body.templateId, 120);
    const template = await loadTemplate(context.env.DB, tenantId, templateId);
    if (templateId && !template) return error('Selected proposal template was not found in this workspace', 422);

    const amount = moneyNumber(body.amount ?? opportunity.estimated_value ?? 0, 'Proposal amount');
    const currency = String(body.currency || opportunity.currency || 'USD').toUpperCase().slice(0, 10);
    const title = text(body.title, 500) || `${opportunity.name} proposal`;
    const scope = text(body.scope, 12000) || template?.scope;
    const deliverables = text(body.deliverables, 12000) || template?.deliverables;
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
    const nextAction = text(body.nextAction, 2000) || (status === 'SENT' ? 'Follow up on proposal' : status === 'INTERNAL_REVIEW' ? 'Review proposal internally' : 'Review and submit for approval');
    const followUpAt = text(body.followUpAt, 100);
    const autoApproved = ['APPROVED', 'SENT', 'ACCEPTED'].includes(status);
    const metadata = {
      title,
      version,
      status,
      serviceType: text(body.serviceType, 300) || template?.serviceType || opportunity.service_type,
      commercialModel: text(body.commercialModel, 100) || template?.commercialModel || 'FIXED_FEE',
      amount,
      currency,
      scope,
      deliverables,
      timeline: text(body.timeline, 5000) || template?.timeline,
      paymentTerms: text(body.paymentTerms, 5000) || template?.paymentTerms,
      validityDate: text(body.validityDate, 30),
      assumptions: text(body.assumptions, 8000) || template?.assumptions,
      documentUrl: text(body.documentUrl, 1500),
      templateId: template?.id || null,
      approvedBy: autoApproved ? auth.userId : null,
      approvedAt: autoApproved ? now : null,
      sentAt: ['SENT', 'ACCEPTED'].includes(status) ? now : null,
      acceptedBy: status === 'ACCEPTED' ? text(body.acceptedBy, 300) || opportunity.primary_contact_id : null,
      acceptedAt: status === 'ACCEPTED' ? now : null,
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

    if (['APPROVED', 'SENT', 'ACCEPTED'].includes(status)) {
      await supersedePrevious(context.env.DB, tenantId, opportunityId, activityId, now);
    }

    const stage = ['SENT', 'ACCEPTED'].includes(status) ? 'PROPOSAL' : opportunity.stage;
    const probability = stage === 'PROPOSAL' ? probabilityForStage(stage, opportunity.probability_percentage) : opportunity.probability_percentage;
    await run(context.env.DB, `
      UPDATE opportunities SET
        stage = ?, service_type = COALESCE(?, service_type), estimated_value = ?,
        estimated_value_base_currency = ?, currency = ?, probability_percentage = ?,
        proposal_sent_at = CASE WHEN ? IN ('SENT','ACCEPTED') THEN ? ELSE proposal_sent_at END,
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
    `, [makeId('aud'), tenantId, auth.userId, opportunityId, JSON.stringify({ activityId, version, status, amount, currency, templateId: metadata.templateId }), now]);

    return json({ id: activityId, version, status, stage, amount, currency, approved: Boolean(metadata.approvedAt), created: true }, 201);
  } catch (cause) {
    console.error('Proposal workflow error', cause);
    return error(cause.message || 'Proposal could not be recorded', Number(cause.status || 500));
  }
}
