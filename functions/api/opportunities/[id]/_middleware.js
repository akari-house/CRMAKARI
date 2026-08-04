import { json, error } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import { parseJson, lifecyclePayload, text } from '../../../lib/revenue-lifecycle.js';

export const COMMERCIAL_CLOSE_MARKER = 'AKARI_COMMERCIAL_CLOSE_GOVERNANCE_V1';
const INITIAL_PROPOSAL_STATUSES = new Set(['DRAFT', 'INTERNAL_REVIEW']);
const ACCEPTANCE_METHODS = new Set(['EMAIL', 'SIGNED_DOCUMENT', 'MEETING', 'TELEGRAM', 'OTHER']);
const LOST_CATEGORIES = new Set(['BUDGET', 'TIMING', 'NO_RESPONSE', 'COMPETITOR', 'PRODUCT_FIT', 'LEGAL_COMPLIANCE', 'INTERNAL_DECISION', 'OTHER']);

function routeKind(request) {
  const pathname = new URL(request.url).pathname;
  if (/\/api\/opportunities\/[^/]+\/proposal$/.test(pathname)) return 'PROPOSAL_CREATE';
  if (/\/api\/opportunities\/[^/]+\/close$/.test(pathname)) return 'CLOSE';
  return null;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function acceptedEvidence(metadata = {}) {
  return Boolean(
    text(metadata.acceptedBy, 300) &&
    text(metadata.acceptedAt, 100) &&
    ACCEPTANCE_METHODS.has(String(metadata.acceptanceMethod || '').toUpperCase()) &&
    text(metadata.acceptanceReference, 1500) &&
    metadata.termsConfirmed === true
  );
}

function manualEvidence(body = {}) {
  const method = String(body.acceptanceMethod || '').trim().toUpperCase();
  return {
    complete: Boolean(
      text(body.acceptedBy, 300) &&
      text(body.acceptedAt, 100) &&
      ACCEPTANCE_METHODS.has(method) &&
      text(body.acceptanceReference, 1500) &&
      body.termsConfirmed === true &&
      text(body.manualCloseReason, 3000)
    ),
    acceptedBy: text(body.acceptedBy, 300),
    acceptedAt: text(body.acceptedAt, 100),
    acceptanceMethod: method,
    acceptanceReference: text(body.acceptanceReference, 1500),
    termsConfirmed: body.termsConfirmed === true,
    manualCloseReason: text(body.manualCloseReason, 3000),
  };
}

async function latestAcceptedProposal(db, tenantId, opportunityId, requestedId) {
  if (requestedId) {
    return first(db, `
      SELECT id, subject, description, outcome, occurred_at, created_at
      FROM activities
      WHERE tenant_id = ? AND opportunity_id = ? AND id = ?
        AND activity_type = 'PROPOSAL'
        AND description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
      LIMIT 1
    `, [tenantId, opportunityId, requestedId]);
  }
  return first(db, `
    SELECT id, subject, description, outcome, occurred_at, created_at
    FROM activities
    WHERE tenant_id = ? AND opportunity_id = ?
      AND activity_type = 'PROPOSAL'
      AND outcome = 'ACCEPTED'
      AND description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT 1
  `, [tenantId, opportunityId]);
}

function compareAcceptedTerms(body, proposal) {
  const metadata = parseJson(proposal?.description, {});
  const differences = [];
  if (body.finalValue !== undefined && cents(body.finalValue) !== cents(metadata.amount)) differences.push('contract value');
  if (body.currency && String(body.currency).toUpperCase() !== String(metadata.currency || 'USD').toUpperCase()) differences.push('currency');
  if (body.serviceType && metadata.serviceType && String(body.serviceType).toUpperCase() !== String(metadata.serviceType).toUpperCase()) differences.push('service type');
  if (body.commercialModel && metadata.commercialModel && String(body.commercialModel).toUpperCase() !== String(metadata.commercialModel).toUpperCase()) differences.push('commercial model');
  return { metadata, differences };
}

async function validateClose(context, body) {
  const auth = context.data.auth;
  const tenantId = requireTenant(auth);
  const opportunityId = String(context.params.id || '').trim();
  const outcome = String(body.outcome || '').trim().toUpperCase();
  if (!context.env.DB) return { tenantId, opportunityId, outcome, demo: true };

  if (outcome === 'LOST') {
    const category = String(body.lostCategory || '').trim().toUpperCase();
    if (!LOST_CATEGORIES.has(category)) throw Object.assign(new Error('Select a controlled lost category'), { status: 422 });
    if (!text(body.lostReason, 5000)) throw Object.assign(new Error('Record why the opportunity was lost'), { status: 422 });
    if (!text(body.nextAction, 2000)) throw Object.assign(new Error('Record the future relationship action for this lost opportunity'), { status: 422 });
    if (!text(body.followUpAt, 100) && !/^closed lost$/i.test(String(body.nextAction || '').trim())) {
      throw Object.assign(new Error('Add a future follow-up date or explicitly close the relationship action'), { status: 422 });
    }
    return {
      tenantId,
      opportunityId,
      outcome,
      evidence: {
        lostCategory: category,
        lostReason: text(body.lostReason, 5000),
        competitor: text(body.competitor, 1000),
        nextAction: text(body.nextAction, 2000),
        followUpAt: text(body.followUpAt, 100),
      },
    };
  }

  if (outcome !== 'WON') return { tenantId, opportunityId, outcome };
  const proposal = await latestAcceptedProposal(context.env.DB, tenantId, opportunityId, text(body.sourceProposalId, 120));
  let evidence;
  let acceptedTerms = null;
  if (proposal) {
    const compared = compareAcceptedTerms(body, proposal);
    acceptedTerms = compared.metadata;
    if (String(acceptedTerms.status || proposal.outcome || '').toUpperCase() !== 'ACCEPTED') {
      throw Object.assign(new Error('The selected proposal has not been accepted'), { status: 422 });
    }
    if (!acceptedEvidence(acceptedTerms)) {
      throw Object.assign(new Error('Complete the proposal acceptance evidence before closing this opportunity as won'), { status: 422 });
    }
    if (compared.differences.length && !text(body.commercialOverrideReason, 3000)) {
      throw Object.assign(new Error(`Accepted proposal differs from the closing terms: ${compared.differences.join(', ')}. Record an override reason or restore the accepted terms.`), { status: 422 });
    }
    evidence = {
      source: 'ACCEPTED_PROPOSAL',
      proposalId: proposal.id,
      proposalVersion: Number(acceptedTerms.version || 1),
      acceptedBy: acceptedTerms.acceptedBy,
      acceptedAt: acceptedTerms.acceptedAt,
      acceptanceMethod: acceptedTerms.acceptanceMethod,
      acceptanceReference: acceptedTerms.acceptanceReference,
      termsConfirmed: acceptedTerms.termsConfirmed === true,
      commercialDifferences: compared.differences,
      commercialOverrideReason: text(body.commercialOverrideReason, 3000),
    };
  } else {
    const manual = manualEvidence(body);
    if (!manual.complete) {
      throw Object.assign(new Error('Record complete manual acceptance evidence or accept a proposal before closing this opportunity as won'), { status: 422 });
    }
    evidence = { source: 'MANUAL_CONFIRMATION', ...manual };
  }

  if (!text(body.nextAction, 2000)) {
    throw Object.assign(new Error('Record the first onboarding or partnership activation action'), { status: 422 });
  }
  return { tenantId, opportunityId, outcome, evidence, acceptedTerms };
}

async function recordGovernance(context, validation, response) {
  if (!context.env.DB || !response.ok || !validation?.outcome) return;
  const auth = context.data.auth;
  const now = nowIso();
  const metadata = {
    outcome: validation.outcome,
    evidence: validation.evidence || null,
    acceptedTerms: validation.acceptedTerms ? {
      proposalId: validation.evidence?.proposalId || null,
      version: Number(validation.acceptedTerms.version || 1),
      amount: Number(validation.acceptedTerms.amount || 0),
      currency: validation.acceptedTerms.currency || 'USD',
      serviceType: validation.acceptedTerms.serviceType || null,
      commercialModel: validation.acceptedTerms.commercialModel || null,
      paymentTerms: validation.acceptedTerms.paymentTerms || null,
      deliverables: validation.acceptedTerms.deliverables || null,
    } : null,
    recordedBy: auth.userId,
    recordedAt: now,
  };
  await run(context.env.DB, `
    INSERT INTO activities (
      id, tenant_id, opportunity_id, user_id, activity_type,
      subject, description, outcome, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, 'COMMERCIAL_CLOSE_GOVERNANCE', ?, ?, ?, ?, ?)
  `, [
    makeId('act'), validation.tenantId, validation.opportunityId, auth.userId,
    `Commercial close evidence · ${validation.outcome}`,
    lifecyclePayload(COMMERCIAL_CLOSE_MARKER, metadata),
    validation.outcome,
    now,
    now,
  ]);
  await run(context.env.DB, `
    INSERT INTO audit_logs (
      id, tenant_id, user_id, action, entity_type, entity_id,
      after_data, created_at
    ) VALUES (?, ?, ?, 'COMMERCIAL_CLOSE_EVIDENCE_RECORDED', 'OPPORTUNITY', ?, ?, ?)
  `, [makeId('aud'), validation.tenantId, auth.userId, validation.opportunityId, JSON.stringify(metadata), now]);
}

export async function onRequest(context) {
  try {
    const kind = routeKind(context.request);
    if (!kind || context.request.method !== 'POST') return context.next();
    const body = await context.request.clone().json().catch(() => ({}));

    if (kind === 'PROPOSAL_CREATE') {
      const status = String(body.status || 'DRAFT').trim().toUpperCase();
      if (!INITIAL_PROPOSAL_STATUSES.has(status)) {
        return error('Create proposals as Draft or Internal review, then use the controlled approval and client-decision workflow', 422);
      }
      return context.next();
    }

    const validation = await validateClose(context, body);
    const response = await context.next();
    await recordGovernance(context, validation, response);
    return response;
  } catch (cause) {
    console.error('Commercial governance middleware error', cause);
    return error(cause.message || 'Commercial governance validation failed', Number(cause.status || 500));
  }
}
