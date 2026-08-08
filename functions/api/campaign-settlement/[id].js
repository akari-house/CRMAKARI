import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseCampaignTracking } from '../../lib/campaign-tracking.js';
import { parseCampaignPlanning } from '../../lib/campaign-planning.js';
import {
  CAMPAIGN_SETTLEMENT_VERSION,
  CAMPAIGN_PAYMENT_METHODS,
  parseCampaignSettlement,
  buildCampaignSettlementSummary,
  upsertSettlementRecord,
  addSettlementPayment,
} from '../../lib/campaign-settlement.js';

const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const VOID_ROLES = new Set(['OWNER','ADMIN']);
const text = (value, max = 3000) => String(value || '').trim().slice(0, max);
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const cents = (value) => Math.round(num(value) * 100);
const fromCents = (value) => Number((Number(value || 0) / 100).toFixed(2));
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const cause = new Error('Owner, Admin or BD Manager permission is required for settlement approval');
    cause.status = 403;
    throw cause;
  }
}

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const cause = new Error('Finance permission is required for Creator/KOL settlement');
    cause.status = 403;
    throw cause;
  }
}

function requireVoid(auth) {
  if (!VOID_ROLES.has(auth?.role)) {
    const cause = new Error('Owner or Admin permission is required to void a payment record');
    cause.status = 403;
    throw cause;
  }
}

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,c.project_id,
      p.name AS project_name,p.website AS project_website
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

function publicPayload(row, tracking, planning, settlement, auth) {
  const summary = buildCampaignSettlementSummary(tracking, planning, settlement);
  const financeVisible = canViewFinance(auth);
  const talent = summary.talent.map((item) => ({
    ...item,
    paidUsdt:financeVisible ? item.paidUsdt : null,
    outstandingUsdt:financeVisible ? item.outstandingUsdt : null,
    payments:financeVisible ? item.payments : [],
  }));
  return {
    item:{
      id:row.id,
      name:row.name,
      projectId:row.project_id,
      projectName:row.project_name,
      status:row.status,
      region:row.region,
      startDate:row.start_date,
      endDate:row.end_date,
      planningStatus:planning.status,
      summary:{ ...summary, talent:undefined, paidUsdt:financeVisible ? summary.paidUsdt : null, outstandingUsdt:financeVisible ? summary.outstandingUsdt : null },
      talent,
    },
    permissions:{
      canManage:MANAGER_ROLES.has(auth?.role),
      canFinance:financeVisible,
      canApprove:MANAGER_ROLES.has(auth?.role) && financeVisible,
      canVoid:VOID_ROLES.has(auth?.role) && financeVisible,
    },
    methodology:{
      engineVersion:CAMPAIGN_SETTLEMENT_VERSION,
      currency:'USDT',
      approvedPostsOnlyForPerformance:true,
      baseReadyAfterApprovedPostCommitment:true,
      bonusRequiresBaseReadyAndReachTarget:true,
      bonusFormula:{ reachAchievement:55, engagementPercentile:30, approvalQuality:15 },
      reachOverperformanceCapPercent:150,
      holdingAndRejectedOnlyAffectQuality:true,
      bonusPoolCapped:true,
      perTalentBonusCapped:true,
      approvalIsNotPayment:true,
      paymentRequiresManualEvidence:true,
      paymentMethods:CAMPAIGN_PAYMENT_METHODS,
    },
  };
}

async function persist(db, auth, tenantId, row, root, settlement, action, before) {
  const now = nowIso();
  settlement.updatedAt = now;
  settlement.updatedBy = auth.userId;
  const notes = JSON.stringify({ ...root, campaignSettlement:settlement });
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [notes, now, auth.userId, tenantId, row.id]);
  const parsed = parseCampaignTracking(notes);
  const planning = parseCampaignPlanning(parsed.root);
  const after = buildCampaignSettlementSummary(parsed.tracking, planning, settlement);
  await run(db, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'CAMPAIGN_SETTLEMENT', ?, ?, ?, ?)
  `, [
    makeId('aud'), tenantId, auth.userId, action, row.id,
    JSON.stringify(before || {}),
    JSON.stringify({ approvedBaseUsdt:after.approvedBaseUsdt, approvedBonusUsdt:after.approvedBonusUsdt, paidUsdt:after.paidUsdt, outstandingUsdt:after.outstandingUsdt, disputedCount:after.disputedCount, driftCount:after.driftCount }),
    now,
  ]);
}

function governed(summary) {
  if (!summary.governanceReady) {
    const cause = new Error('Settlement requires an Approved campaign plan with no approval drift and a current AKARI USDT compensation calculation');
    cause.status = 409;
    throw cause;
  }
}

function aggregateBefore(summary) {
  return {
    approvedBaseUsdt:summary.approvedBaseUsdt,
    approvedBonusUsdt:summary.approvedBonusUsdt,
    paidUsdt:summary.paidUsdt,
    outstandingUsdt:summary.outstandingUsdt,
    disputedCount:summary.disputedCount,
    driftCount:summary.driftCount,
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const parsed = parseCampaignTracking(row.notes);
    const planning = parseCampaignPlanning(parsed.root);
    const settlement = parseCampaignSettlement(parsed.root);
    return json(publicPayload(row, parsed.tracking, planning, settlement, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign settlement workspace could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = text(body.action, 80).toLowerCase();
    if (!context.env.DB) return json({ updated:true, action, demo:true });

    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const parsed = parseCampaignTracking(row.notes);
    const root = parsed.root;
    const tracking = parsed.tracking;
    const planning = parseCampaignPlanning(root);
    let settlement = parseCampaignSettlement(root);
    let summary = buildCampaignSettlementSummary(tracking, planning, settlement);
    const before = aggregateBefore(summary);
    let auditAction = 'campaign.settlement_updated';

    if (action === 'approve-settlement') {
      requireManager(auth);
      requireFinance(auth);
      governed(summary);
      const assignmentId = text(body.assignmentId, 120);
      const talent = summary.talent.find((item) => String(item.id || '') === assignmentId);
      if (!talent) return error('Creator/KOL settlement item was not found', 404);
      if (!talent.baseReady) return error('Base settlement is not ready until the planned Approved post commitment is delivered', 409);
      const baseApprovedUsdt = body.baseApprovedUsdt === undefined ? talent.basePlannedUsdt : num(body.baseApprovedUsdt);
      const bonusApprovedUsdt = body.bonusApprovedUsdt === undefined ? talent.bonusRecommendedUsdt : num(body.bonusApprovedUsdt);
      if (cents(baseApprovedUsdt) > cents(talent.basePlannedUsdt)) return error('Approved base settlement cannot exceed the applied AKARI USDT base allocation', 422);
      if (!talent.bonusEligible && cents(bonusApprovedUsdt) > 0) return error('Performance bonus is not eligible until Approved delivery and reach requirements are met', 422);
      if (cents(bonusApprovedUsdt) > cents(summary.maximumBonusPerTalentUsdt)) return error('Approved bonus exceeds the campaign maximum bonus per Creator/KOL', 422);
      const otherApprovedBonus = summary.talent
        .filter((item) => String(item.id || '') !== assignmentId && item.settlement.status !== 'CANCELLED')
        .reduce((sum, item) => sum + cents(item.settlement.bonusApprovedUsdt), 0);
      if (otherApprovedBonus + cents(bonusApprovedUsdt) > cents(summary.bonusPoolUsdt)) return error('Approved Creator/KOL bonuses cannot exceed the reserved campaign bonus pool', 422);
      const alreadyPaid = cents(talent.paidUsdt);
      if (alreadyPaid > cents(baseApprovedUsdt) + cents(bonusApprovedUsdt)) return error('Approved settlement cannot be reduced below payments already recorded', 422);
      const note = text(body.note, 3000);
      if (note.length < 5) return error('Add an approval note describing the settlement decision', 422);
      settlement = upsertSettlementRecord(settlement, {
        ...talent.settlement,
        assignmentId,
        status:'APPROVED',
        baseApprovedUsdt,
        bonusApprovedUsdt,
        approvalNote:note,
        evidenceFingerprint:talent.currentEvidenceFingerprint,
        approvedAt:nowIso(),
        approvedBy:auth.userId,
        disputedAt:null,
        disputedBy:null,
        disputeReason:'',
        updatedAt:nowIso(),
        updatedBy:auth.userId,
      });
      auditAction = 'campaign.creator_settlement_approved';
    } else if (action === 'mark-disputed') {
      requireManager(auth);
      requireFinance(auth);
      const assignmentId = text(body.assignmentId, 120);
      const talent = summary.talent.find((item) => String(item.id || '') === assignmentId);
      if (!talent) return error('Creator/KOL settlement item was not found', 404);
      const reason = text(body.reason, 3000);
      if (reason.length < 5) return error('Add a dispute reason', 422);
      settlement = upsertSettlementRecord(settlement, {
        ...talent.settlement,
        assignmentId,
        status:'DISPUTED',
        disputedAt:nowIso(),
        disputedBy:auth.userId,
        disputeReason:reason,
        updatedAt:nowIso(),
        updatedBy:auth.userId,
      });
      auditAction = 'campaign.creator_settlement_disputed';
    } else if (action === 'record-payment') {
      requireFinance(auth);
      governed(summary);
      const assignmentId = text(body.assignmentId, 120);
      const talent = summary.talent.find((item) => String(item.id || '') === assignmentId);
      if (!talent) return error('Creator/KOL settlement item was not found', 404);
      if (talent.settlement.status !== 'APPROVED' || !talent.settlement.approvedAt) return error('Approve the Creator/KOL settlement before recording payment', 409);
      if (talent.approvalDrift) return error('Settlement evidence changed after approval. Reapprove the settlement before recording another payment.', 409);
      const amountUsdt = num(body.amountUsdt);
      if (cents(amountUsdt) <= 0) return error('Payment amount must be greater than zero', 422);
      if (cents(amountUsdt) > cents(talent.outstandingUsdt)) return error('Payment amount cannot exceed the approved outstanding settlement', 422);
      const paidAt = text(body.paidAt, 30);
      if (!validDate(paidAt)) return error('A valid payment date is required', 422);
      const method = text(body.method, 40).toUpperCase();
      if (!CAMPAIGN_PAYMENT_METHODS.includes(method)) return error('Payment method is invalid', 422);
      const reference = text(body.reference, 500);
      if (reference.length < 4) return error('A payment or transaction reference is required', 422);
      const duplicate = settlement.payments.some((payment) => !payment.voidedAt && payment.reference.toLowerCase() === reference.toLowerCase());
      if (duplicate) return error('This payment reference is already recorded for the campaign', 409);
      settlement = addSettlementPayment(settlement, {
        id:makeId('csp'),
        assignmentId,
        amountUsdt,
        paidAt,
        method,
        reference,
        note:text(body.note, 3000),
        recordedAt:nowIso(),
        recordedBy:auth.userId,
      });
      auditAction = 'campaign.creator_settlement_payment_recorded';
    } else if (action === 'void-payment') {
      requireFinance(auth);
      requireVoid(auth);
      const paymentId = text(body.paymentId, 120);
      const reason = text(body.reason, 3000);
      if (reason.length < 5) return error('Add a reason for voiding the payment record', 422);
      const payment = settlement.payments.find((item) => item.id === paymentId);
      if (!payment) return error('Settlement payment record was not found', 404);
      if (payment.voidedAt) return error('Settlement payment is already voided', 409);
      settlement.payments = settlement.payments.map((item) => item.id === paymentId ? { ...item, voidedAt:nowIso(), voidedBy:auth.userId, voidReason:reason } : item);
      auditAction = 'campaign.creator_settlement_payment_voided';
    } else {
      return error('Unsupported campaign settlement action', 400);
    }

    summary = buildCampaignSettlementSummary(tracking, planning, settlement);
    settlement.updatedAt = nowIso();
    settlement.updatedBy = auth.userId;
    await persist(context.env.DB, auth, tenantId, row, root, settlement, auditAction, before);
    return json(publicPayload(row, tracking, planning, settlement, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign settlement could not be updated', Number(cause.status || 500));
  }
}
