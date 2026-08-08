import { percentile, parseCampaignCompensation, buildCampaignCompensationSummary } from './campaign-compensation.js';
import { buildCampaignPlanSummary } from './campaign-planning.js';

export const CAMPAIGN_SETTLEMENT_VERSION = 'R8.5H-1';
export const CAMPAIGN_SETTLEMENT_STATUSES = ['PENDING_REVIEW','APPROVED','DISPUTED','CANCELLED'];
export const CAMPAIGN_PAYMENT_METHODS = ['USDT_ONCHAIN','BANK','OTHER'];

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const text = (value, max = 3000) => String(value || '').trim().slice(0, max);
const cents = (value) => Math.round(num(value) * 100);
const fromCents = (value) => Number((Number(value || 0) / 100).toFixed(2));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const postStatus = (value) => String(value || 'APPROVED').toUpperCase();

function fnv1a(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseRecord(value = {}) {
  const source = object(value);
  const status = CAMPAIGN_SETTLEMENT_STATUSES.includes(String(source.status || '').toUpperCase())
    ? String(source.status).toUpperCase()
    : 'PENDING_REVIEW';
  return {
    assignmentId:text(source.assignmentId, 120),
    status,
    baseApprovedUsdt:num(source.baseApprovedUsdt),
    bonusApprovedUsdt:num(source.bonusApprovedUsdt),
    approvalNote:text(source.approvalNote, 3000),
    evidenceFingerprint:text(source.evidenceFingerprint, 200) || null,
    approvedAt:text(source.approvedAt, 80) || null,
    approvedBy:text(source.approvedBy, 120) || null,
    disputedAt:text(source.disputedAt, 80) || null,
    disputedBy:text(source.disputedBy, 120) || null,
    disputeReason:text(source.disputeReason, 3000),
    updatedAt:text(source.updatedAt, 80) || null,
    updatedBy:text(source.updatedBy, 120) || null,
  };
}

function parsePayment(value = {}) {
  const source = object(value);
  const method = CAMPAIGN_PAYMENT_METHODS.includes(String(source.method || '').toUpperCase())
    ? String(source.method).toUpperCase()
    : 'OTHER';
  return {
    id:text(source.id, 120),
    assignmentId:text(source.assignmentId, 120),
    amountUsdt:num(source.amountUsdt),
    paidAt:text(source.paidAt, 30) || null,
    method,
    reference:text(source.reference, 500),
    note:text(source.note, 3000),
    recordedAt:text(source.recordedAt, 80) || null,
    recordedBy:text(source.recordedBy, 120) || null,
    voidedAt:text(source.voidedAt, 80) || null,
    voidedBy:text(source.voidedBy, 120) || null,
    voidReason:text(source.voidReason, 3000),
  };
}

export function parseCampaignSettlement(value = {}) {
  const sourceRoot = object(value);
  const source = object(sourceRoot.campaignSettlement || sourceRoot);
  return {
    version:1,
    engineVersion:CAMPAIGN_SETTLEMENT_VERSION,
    records:Array.isArray(source.records) ? source.records.map(parseRecord).filter((item) => item.assignmentId) : [],
    payments:Array.isArray(source.payments) ? source.payments.map(parsePayment).filter((item) => item.id && item.assignmentId) : [],
    updatedAt:text(source.updatedAt, 80) || null,
    updatedBy:text(source.updatedBy, 120) || null,
  };
}

function approvedPerformance(tracking = {}, compensationValue = {}) {
  const compensation = parseCampaignCompensation(compensationValue);
  const baseById = new Map((compensation.lastResult?.items || []).map((item) => [String(item.assignmentId || ''), num(item.payoutUsdt)]));
  const postsById = new Map();
  for (const post of tracking.creatorPosts || []) {
    const id = String(post.assignmentId || '');
    const list = postsById.get(id) || [];
    list.push(post);
    postsById.set(id, list);
  }
  const rows = (tracking.creatorAssignments || []).filter((item) => item.active !== false).map((assignment) => {
    const posts = postsById.get(String(assignment.id || '')) || [];
    const approved = posts.filter((post) => postStatus(post.status) === 'APPROVED');
    const holding = posts.filter((post) => postStatus(post.status) === 'HOLDING');
    const rejected = posts.filter((post) => postStatus(post.status) === 'REJECTED');
    const approvedReach = approved.reduce((sum, post) => sum + num(post.reach ?? post.reportedReach), 0);
    const approvedEngagements = approved.reduce((sum, post) => sum + num(post.totalEngagements ?? post.reportedEngagements), 0);
    const expectedPosts = num(assignment.expectedPosts);
    const expectedReach = num(assignment.expectedReach);
    const basePlannedUsdt = baseById.get(String(assignment.id || '')) || 0;
    const baseReady = basePlannedUsdt > 0 && expectedPosts > 0 && approved.length >= expectedPosts;
    const reachAchievement = expectedReach > 0 ? approvedReach / expectedReach : (approvedReach > 0 ? 1 : 0);
    const bonusEligible = baseReady && num(compensation.bonusPoolUsdt) > 0 && num(compensation.maximumBonusPerTalentUsdt) > 0 && (expectedReach > 0 ? approvedReach >= expectedReach : approvedReach > 0);
    const submitted = approved.length + holding.length + rejected.length;
    return {
      assignment,
      approvedPosts:approved.length,
      holdingPosts:holding.length,
      rejectedPosts:rejected.length,
      submittedPosts:submitted,
      expectedPosts,
      approvedReach,
      expectedReach,
      approvedEngagements,
      deliveryCompletion:expectedPosts > 0 ? Math.min(1, approved.length / expectedPosts) : 0,
      reachAchievement,
      approvalQuality:submitted > 0 ? approved.length / submitted : 0,
      basePlannedUsdt,
      baseReady,
      bonusEligible,
      posts,
    };
  });
  const eligible = rows.filter((item) => item.bonusEligible);
  const engagementValues = eligible.map((item) => item.approvedEngagements);
  for (const row of rows) {
    if (!row.bonusEligible) {
      row.engagementScore = 0;
      row.bonusScore = 0;
      continue;
    }
    const reachScore = row.expectedReach > 0 ? Math.min(1, row.reachAchievement / 1.5) : 1;
    const engagementScore = percentile(engagementValues, row.approvedEngagements);
    row.engagementScore = engagementScore;
    row.bonusScore = reachScore * 0.55 + engagementScore * 0.30 + row.approvalQuality * 0.15;
  }
  return { compensation, rows };
}

function allocateBonus(rows, poolUsdt, maximumUsdt) {
  const pool = cents(poolUsdt);
  const cap = cents(maximumUsdt);
  const result = new Map(rows.map((row) => [String(row.assignment.id || ''), 0]));
  if (pool <= 0 || cap <= 0) return result;
  let remaining = pool;
  let active = rows.filter((row) => row.bonusEligible && row.bonusScore > 0)
    .sort((a,b) => b.bonusScore - a.bonusScore || String(a.assignment.id).localeCompare(String(b.assignment.id)));
  let guard = 0;
  while (remaining > 0 && active.length && guard++ < 1000) {
    const totalWeight = active.reduce((sum, row) => sum + row.bonusScore, 0);
    if (totalWeight <= 0) break;
    let allocatedThisPass = 0;
    for (const row of active) {
      const id = String(row.assignment.id || '');
      const current = result.get(id) || 0;
      const room = Math.max(0, cap - current);
      if (!room) continue;
      const share = Math.min(room, Math.floor(remaining * row.bonusScore / totalWeight));
      if (share > 0) {
        result.set(id, current + share);
        allocatedThisPass += share;
      }
    }
    remaining -= allocatedThisPass;
    active = active.filter((row) => (result.get(String(row.assignment.id || '')) || 0) < cap);
    if (allocatedThisPass === 0 && remaining > 0 && active.length) {
      for (const row of active) {
        if (!remaining) break;
        const id = String(row.assignment.id || '');
        const current = result.get(id) || 0;
        if (current < cap) {
          result.set(id, current + 1);
          remaining -= 1;
        }
      }
    }
  }
  return result;
}

export function settlementEvidenceFingerprint(tracking = {}, planning = {}, assignmentId = '') {
  const compensation = parseCampaignCompensation(planning.compensation);
  const assignment = (tracking.creatorAssignments || []).find((item) => String(item.id || '') === String(assignmentId || '')) || {};
  const applied = (compensation.lastResult?.items || []).find((item) => String(item.assignmentId || '') === String(assignmentId || '')) || {};
  const posts = (tracking.creatorPosts || [])
    .filter((post) => String(post.assignmentId || '') === String(assignmentId || ''))
    .map((post) => ({
      id:post.id,
      status:postStatus(post.status),
      date:post.dataDate,
      url:post.url,
      reach:num(post.reportedReach ?? post.reach),
      engagements:num(post.reportedEngagements ?? post.totalEngagements),
      impressions:num(post.impressions),
      likes:num(post.likes), comments:num(post.comments), shares:num(post.shares),
    }))
    .sort((a,b) => String(a.id).localeCompare(String(b.id)));
  return fnv1a(JSON.stringify({
    planningFingerprint:planning.approvedFingerprint || null,
    compensationFingerprint:compensation.lastAppliedFingerprint || null,
    assignment:{ id:assignment.id, expectedPosts:num(assignment.expectedPosts), expectedReach:num(assignment.expectedReach), allocatedUsd:num(assignment.allocatedUsd) },
    appliedBase:num(applied.payoutUsdt),
    posts,
  }));
}

export function buildCampaignSettlementSummary(tracking = {}, planning = {}, settlementValue = {}) {
  const settlement = parseCampaignSettlement(settlementValue);
  const planSummary = buildCampaignPlanSummary(tracking, planning);
  const compensationSummary = buildCampaignCompensationSummary(tracking, planning.compensation);
  const { compensation, rows } = approvedPerformance(tracking, planning.compensation);
  const bonusById = allocateBonus(rows, compensation.bonusPoolUsdt, compensation.maximumBonusPerTalentUsdt);
  const recordById = new Map(settlement.records.map((item) => [item.assignmentId, item]));
  const paymentsById = new Map();
  for (const payment of settlement.payments.filter((item) => !item.voidedAt)) {
    const list = paymentsById.get(payment.assignmentId) || [];
    list.push(payment);
    paymentsById.set(payment.assignmentId, list);
  }
  const governanceReady = planning.status === 'APPROVED' && !planSummary.approvalDrift && compensation.enabled && compensationSummary.calculationCurrent;
  const talent = rows.map((row) => {
    const assignmentId = String(row.assignment.id || '');
    const record = recordById.get(assignmentId) || parseRecord({ assignmentId });
    const currentEvidenceFingerprint = settlementEvidenceFingerprint(tracking, planning, assignmentId);
    const approvalDrift = Boolean(record.approvedAt && record.evidenceFingerprint && record.evidenceFingerprint !== currentEvidenceFingerprint);
    const payments = paymentsById.get(assignmentId) || [];
    const paidUsdt = fromCents(payments.reduce((sum, payment) => sum + cents(payment.amountUsdt), 0));
    const totalApprovedUsdt = fromCents(cents(record.baseApprovedUsdt) + cents(record.bonusApprovedUsdt));
    const outstandingUsdt = fromCents(Math.max(0, cents(totalApprovedUsdt) - cents(paidUsdt)));
    let paymentStatus = 'NOT_APPROVED';
    if (record.status === 'CANCELLED') paymentStatus = 'CANCELLED';
    else if (record.status === 'DISPUTED') paymentStatus = 'DISPUTED';
    else if (record.approvedAt && approvalDrift) paymentStatus = 'EVIDENCE_CHANGED';
    else if (record.approvedAt && totalApprovedUsdt > 0 && outstandingUsdt <= 0) paymentStatus = 'PAID';
    else if (record.approvedAt && paidUsdt > 0) paymentStatus = 'PARTIALLY_PAID';
    else if (record.approvedAt && totalApprovedUsdt > 0) paymentStatus = 'DUE';
    return {
      ...row.assignment,
      approvedPosts:row.approvedPosts,
      holdingPosts:row.holdingPosts,
      rejectedPosts:row.rejectedPosts,
      expectedPosts:row.expectedPosts,
      approvedReach:row.approvedReach,
      expectedReach:row.expectedReach,
      approvedEngagements:row.approvedEngagements,
      deliveryCompletion:Number((row.deliveryCompletion * 100).toFixed(2)),
      reachAchievement:Number((row.reachAchievement * 100).toFixed(2)),
      approvalQuality:Number((row.approvalQuality * 100).toFixed(2)),
      performanceScore:Number((row.bonusScore * 100).toFixed(2)),
      basePlannedUsdt:row.basePlannedUsdt,
      baseReady:row.baseReady,
      bonusEligible:row.bonusEligible,
      bonusRecommendedUsdt:fromCents(bonusById.get(assignmentId) || 0),
      settlement:record,
      currentEvidenceFingerprint,
      approvalDrift,
      paidUsdt,
      outstandingUsdt,
      totalApprovedUsdt,
      paymentStatus,
      payments,
    };
  });
  return {
    version:CAMPAIGN_SETTLEMENT_VERSION,
    governanceReady,
    planningStatus:planning.status,
    planningApprovalDrift:Boolean(planSummary.approvalDrift),
    compensationCalculationCurrent:Boolean(compensationSummary.calculationCurrent),
    bonusPoolUsdt:num(compensation.bonusPoolUsdt),
    maximumBonusPerTalentUsdt:num(compensation.maximumBonusPerTalentUsdt),
    talent,
    talentCount:talent.length,
    baseReadyCount:talent.filter((item) => item.baseReady).length,
    bonusEligibleCount:talent.filter((item) => item.bonusEligible).length,
    plannedBaseUsdt:fromCents(talent.reduce((sum,item)=>sum+cents(item.basePlannedUsdt),0)),
    recommendedBonusUsdt:fromCents(talent.reduce((sum,item)=>sum+cents(item.bonusRecommendedUsdt),0)),
    approvedBaseUsdt:fromCents(talent.reduce((sum,item)=>sum+cents(item.settlement.baseApprovedUsdt),0)),
    approvedBonusUsdt:fromCents(talent.reduce((sum,item)=>sum+cents(item.settlement.bonusApprovedUsdt),0)),
    paidUsdt:fromCents(talent.reduce((sum,item)=>sum+cents(item.paidUsdt),0)),
    outstandingUsdt:fromCents(talent.reduce((sum,item)=>sum+cents(item.outstandingUsdt),0)),
    disputedCount:talent.filter((item)=>item.settlement.status==='DISPUTED').length,
    driftCount:talent.filter((item)=>item.approvalDrift).length,
    paidCount:talent.filter((item)=>item.paymentStatus==='PAID').length,
  };
}

export function upsertSettlementRecord(settlementValue = {}, recordValue = {}) {
  const settlement = parseCampaignSettlement(settlementValue);
  const record = parseRecord(recordValue);
  const records = [...settlement.records];
  const index = records.findIndex((item) => item.assignmentId === record.assignmentId);
  if (index >= 0) records[index] = record;
  else records.push(record);
  return { ...settlement, records };
}

export function addSettlementPayment(settlementValue = {}, paymentValue = {}) {
  const settlement = parseCampaignSettlement(settlementValue);
  return { ...settlement, payments:[...settlement.payments, parsePayment(paymentValue)] };
}
