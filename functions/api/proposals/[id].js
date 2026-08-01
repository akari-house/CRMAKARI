import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { PROPOSAL_MARKER, parseJson, qualificationComplete, probabilityForStage, text } from '../../lib/revenue-lifecycle.js';
import { PROPOSAL_STATUSES, parseProposal } from '../../lib/commercial-hardening.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const APPROVER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const TRANSITIONS = {
  DRAFT: new Set(['INTERNAL_REVIEW', 'APPROVED', 'SUPERSEDED']),
  INTERNAL_REVIEW: new Set(['DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED']),
  APPROVED: new Set(['SENT', 'SUPERSEDED']),
  SENT: new Set(['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']),
  ACCEPTED: new Set([]),
  REJECTED: new Set([]),
  EXPIRED: new Set([]),
  SUPERSEDED: new Set([]),
};

async function loadProposal(db, tenantId, id) {
  return first(db, `
    SELECT a.*, o.stage AS opportunity_stage, o.need_confirmed, o.decision_maker_confirmed,
      o.timeline_confirmed, o.budget_status, o.probability_percentage, o.project_id AS opportunity_project_id,
      p.name AS project_name, c.full_name AS primary_contact_name
    FROM activities a
    JOIN opportunities o ON o.id = a.opportunity_id AND o.tenant_id = a.tenant_id
    JOIN projects p ON p.id = a.project_id AND p.tenant_id = a.tenant_id
    LEFT JOIN contacts c ON c.id = o.primary_contact_id AND c.tenant_id = o.tenant_id
    WHERE a.tenant_id = ? AND a.id = ? AND a.activity_type = 'PROPOSAL'
      AND a.description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
    LIMIT 1
  `, [tenantId, id]);
}

async function supersedeOthers(db, tenantId, opportunityId, exceptId, now) {
  const rows = await all(db, `
    SELECT id, description, outcome FROM activities
    WHERE tenant_id = ? AND opportunity_id = ? AND activity_type = 'PROPOSAL' AND id != ?
      AND description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
  `, [tenantId, opportunityId, exceptId]);
  for (const row of rows) {
    const metadata = parseJson(row.description, {});
    const status = String(metadata.status || row.outcome || '').toUpperCase();
    if (['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'].includes(status)) continue;
    metadata.status = 'SUPERSEDED';
    metadata.supersededAt = now;
    metadata.supersededBy = exceptId;
    await run(db, `UPDATE activities SET outcome = 'SUPERSEDED', description = ? WHERE tenant_id = ? AND id = ?`, [JSON.stringify(metadata), tenantId, row.id]);
  }
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadProposal(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Proposal not found', 404);
    return json({ item: { ...parseProposal(row), projectName: row.project_name, primaryContactName: row.primary_contact_name } });
  } catch (cause) {
    return error(cause.message || 'Proposal could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Opportunity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const target = String(body.status || '').toUpperCase();
    if (!PROPOSAL_STATUSES.has(target)) return error('Proposal status is invalid', 422);
    if (!context.env.DB) return json({ updated: true, status: target, demo: true });

    const row = await loadProposal(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Proposal not found', 404);
    const item = parseProposal(row);
    const current = item.status;
    if (target === current) return json({ updated: true, item });
    if (!TRANSITIONS[current]?.has(target)) return error(`Proposal cannot move from ${current} to ${target}`, 409);
    if (['APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'].includes(target) && !APPROVER_ROLES.has(auth?.role)) {
      return error('Manager approval is required for this proposal status', 403);
    }
    if (target === 'SENT' && !qualificationComplete(row)) {
      return error('Complete the qualification checklist before sending a proposal', 422);
    }
    if (target === 'ACCEPTED' && !text(body.acceptedBy, 300) && !row.primary_contact_name) {
      return error('Record who accepted the proposal', 422);
    }
    if (target === 'REJECTED' && !text(body.reason, 2000)) return error('Record why the proposal was rejected', 422);

    const now = nowIso();
    const metadata = { ...item.metadata, status: target, updatedBy: auth.userId, updatedAt: now };
    if (target === 'APPROVED') Object.assign(metadata, { approvedBy: auth.userId, approvedAt: now });
    if (target === 'SENT') Object.assign(metadata, { approvedBy: metadata.approvedBy || auth.userId, approvedAt: metadata.approvedAt || now, sentAt: now });
    if (target === 'ACCEPTED') Object.assign(metadata, { acceptedBy: text(body.acceptedBy, 300) || row.primary_contact_name, acceptedAt: now });
    if (target === 'REJECTED') Object.assign(metadata, { rejectedReason: text(body.reason, 2000), rejectedAt: now });
    if (target === 'EXPIRED') Object.assign(metadata, { expiredAt: now });
    if (target === 'SUPERSEDED') Object.assign(metadata, { supersededAt: now });

    let nextAction = text(body.nextAction, 2000) || row.next_action;
    let stage = row.opportunity_stage;
    if (target === 'INTERNAL_REVIEW') nextAction = nextAction || 'Review proposal internally';
    if (target === 'APPROVED') nextAction = nextAction || 'Send approved proposal';
    if (target === 'SENT') { nextAction = nextAction || 'Follow up on proposal'; stage = 'PROPOSAL'; }
    if (target === 'ACCEPTED') { nextAction = nextAction || 'Confirm contract and close as won'; stage = 'VERBAL_CONFIRMATION'; }
    if (['REJECTED', 'EXPIRED'].includes(target)) { nextAction = nextAction || 'Revise commercial approach'; stage = 'QUALIFIED'; }

    await run(context.env.DB, `
      UPDATE activities SET outcome = ?, description = ?, next_action = ?, follow_up_at = COALESCE(?, follow_up_at)
      WHERE tenant_id = ? AND id = ?
    `, [target, JSON.stringify(metadata), nextAction, text(body.followUpAt, 100), tenantId, row.id]);

    if (['APPROVED', 'SENT', 'ACCEPTED'].includes(target)) await supersedeOthers(context.env.DB, tenantId, row.opportunity_id, row.id, now);

    if (stage !== row.opportunity_stage || nextAction !== row.next_action) {
      const probability = probabilityForStage(stage, row.probability_percentage);
      await run(context.env.DB, `
        UPDATE opportunities SET stage = ?, probability_percentage = ?, next_action = ?,
          proposal_sent_at = CASE WHEN ? = 'SENT' THEN ? ELSE proposal_sent_at END,
          updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [stage, probability, nextAction, target, now, now, auth.userId, tenantId, row.opportunity_id]);
      if (stage !== row.opportunity_stage) {
        await run(context.env.DB, `
          INSERT INTO opportunity_stage_history
            (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [makeId('osh'), tenantId, row.opportunity_id, row.opportunity_stage, stage, auth.userId, now, `Proposal v${item.version} moved to ${target}`]);
      }
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'PROPOSAL_STATUS_UPDATED', 'PROPOSAL', ?, ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, row.id, JSON.stringify({ status: current }), JSON.stringify({ status: target, reason: metadata.rejectedReason || null }), now]);

    return json({ updated: true, item: { ...parseProposal({ ...row, description: JSON.stringify(metadata), outcome: target, next_action: nextAction }), status: target }, opportunityStage: stage });
  } catch (cause) {
    console.error('Proposal status update error', cause);
    return error(cause.message || 'Proposal status could not be updated', Number(cause.status || 500));
  }
}
