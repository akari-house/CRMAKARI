import { nowIso } from './db.js';
import {
  parseCampaignCompensation,
  campaignCompensationFingerprint,
} from './campaign-compensation.js';

export const CAMPAIGN_PLAN_STATUSES = ['DRAFT','READY_FOR_APPROVAL','APPROVED','REJECTED'];
export const CAMPAIGN_PLAN_OBJECTIVES = ['BALANCED','REACH','ENGAGEMENT','RELIABILITY'];
export const CAMPAIGN_PLAN_TALENT_TYPES = ['ALL','CREATOR','KOL'];

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const text = (value, max = 3000) => String(value || '').trim().slice(0, max);
const upper = (value) => text(value, 100).toUpperCase();
const clamp = (value) => Math.max(0, Math.min(100, number(value)));

function normalizeStatus(value) {
  const status = upper(value);
  return CAMPAIGN_PLAN_STATUSES.includes(status) ? status : 'DRAFT';
}

export function parseCampaignPlanning(root = {}) {
  const existing = root?.campaignPlanning && typeof root.campaignPlanning === 'object' && !Array.isArray(root.campaignPlanning)
    ? root.campaignPlanning
    : {};
  return {
    version:1,
    status:normalizeStatus(existing.status),
    objective:CAMPAIGN_PLAN_OBJECTIVES.includes(upper(existing.objective)) ? upper(existing.objective) : 'BALANCED',
    platform:upper(existing.platform) || 'ALL',
    creatorType:CAMPAIGN_PLAN_TALENT_TYPES.includes(upper(existing.creatorType)) ? upper(existing.creatorType) : 'ALL',
    contentType:text(existing.contentType, 120) || 'ALL',
    region:text(existing.region, 120) || 'ALL',
    budgetUsd:number(existing.budgetUsd),
    notes:text(existing.notes, 5000),
    selections:Array.isArray(existing.selections) ? existing.selections.map((item) => ({
      assignmentId:text(item?.assignmentId, 120),
      identityKey:text(item?.identityKey, 500),
      recommendationScore:clamp(item?.recommendationScore),
      recommendationVersion:text(item?.recommendationVersion, 80),
      addedAt:text(item?.addedAt, 80) || null,
      addedBy:text(item?.addedBy, 120) || null,
    })).filter((item) => item.assignmentId) : [],
    compensation:parseCampaignCompensation(existing.compensation),
    submittedAt:text(existing.submittedAt, 80) || null,
    submittedBy:text(existing.submittedBy, 120) || null,
    approvedAt:text(existing.approvedAt, 80) || null,
    approvedBy:text(existing.approvedBy, 120) || null,
    approvedFingerprint:text(existing.approvedFingerprint, 200) || null,
    rejectedAt:text(existing.rejectedAt, 80) || null,
    rejectedBy:text(existing.rejectedBy, 120) || null,
    rejectionReason:text(existing.rejectionReason, 1000),
    lastModifiedAt:text(existing.lastModifiedAt, 80) || null,
    lastModifiedBy:text(existing.lastModifiedBy, 120) || null,
  };
}

export function sanitizeCampaignPlanning(input = {}, previous = {}) {
  const objective = upper(input.objective ?? previous.objective ?? 'BALANCED');
  if (!CAMPAIGN_PLAN_OBJECTIVES.includes(objective)) {
    const cause = new Error('Campaign plan objective is invalid');
    cause.status = 422;
    throw cause;
  }
  const creatorType = upper(input.creatorType ?? previous.creatorType ?? 'ALL');
  if (!CAMPAIGN_PLAN_TALENT_TYPES.includes(creatorType)) {
    const cause = new Error('Campaign plan talent type is invalid');
    cause.status = 422;
    throw cause;
  }
  return {
    ...previous,
    objective,
    platform:upper(input.platform ?? previous.platform ?? 'ALL') || 'ALL',
    creatorType,
    contentType:text(input.contentType ?? previous.contentType, 120) || 'ALL',
    region:text(input.region ?? previous.region, 120) || 'ALL',
    budgetUsd:number(input.budgetUsd ?? previous.budgetUsd),
    notes:text(input.notes ?? previous.notes, 5000),
  };
}

function stableSelection(tracking = {}) {
  return (tracking.creatorAssignments || [])
    .filter((item) => item.active !== false)
    .map((item) => ({
      id:String(item.id || ''),
      creatorType:upper(item.creatorType || 'CREATOR'),
      name:text(item.name, 300),
      handle:text(item.handle, 200),
      platform:upper(item.platform || 'X'),
      agencyPartnerId:text(item.agencyPartnerId, 120) || null,
      agencyName:text(item.agencyName, 300),
      category:text(item.category, 200),
      region:text(item.region, 120),
      expectedPosts:number(item.expectedPosts),
      expectedReach:number(item.expectedReach),
      allocatedUsd:number(item.allocatedUsd),
      allocatedTokens:number(item.allocatedTokens),
      tgeUnlockPercent:clamp(item.tgeUnlockPercent),
      cliffMonths:number(item.cliffMonths),
      vestingMonths:number(item.vestingMonths),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function fnv1a(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function campaignPlanFingerprint(tracking = {}, planning = {}) {
  const compensation = parseCampaignCompensation(planning.compensation);
  const payload = {
    objective:planning.objective || 'BALANCED',
    platform:planning.platform || 'ALL',
    creatorType:planning.creatorType || 'ALL',
    contentType:planning.contentType || 'ALL',
    region:planning.region || 'ALL',
    budgetUsd:number(planning.budgetUsd),
    selections:stableSelection(tracking),
  };
  if (compensation.enabled) payload.compensationFingerprint = campaignCompensationFingerprint(tracking, compensation);
  return `r8.5f-${fnv1a(JSON.stringify(payload))}`;
}

export function buildCampaignPlanSummary(tracking = {}, planning = {}) {
  const selections = stableSelection(tracking);
  const tokenPrice = number(tracking.overview?.currentTokenPrice || tracking.overview?.tokenListingPrice);
  const cashAllocation = selections.reduce((sum, item) => sum + number(item.allocatedUsd), 0);
  const tokenAllocation = selections.reduce((sum, item) => sum + number(item.allocatedTokens), 0);
  const estimatedTokenValue = tokenAllocation * tokenPrice;
  const compensation = parseCampaignCompensation(planning.compensation);
  const compensationFingerprint = campaignCompensationFingerprint(tracking, compensation);
  const compensationEnabled = Boolean(compensation.enabled);
  const compensationCalculationCurrent = !compensationEnabled || Boolean(compensation.lastAppliedFingerprint) && compensation.lastAppliedFingerprint === compensationFingerprint;
  const reservedBonusPoolUsd = compensationEnabled ? number(compensation.bonusPoolUsdt) : 0;
  const estimatedPlanCost = cashAllocation + estimatedTokenValue + reservedBonusPoolUsd;
  const budgetUsd = number(planning.budgetUsd);
  const partnerIds = new Set(selections.map((item) => item.agencyPartnerId).filter(Boolean));
  const currentFingerprint = campaignPlanFingerprint(tracking, planning);
  const approvalDrift = planning.status === 'APPROVED' && Boolean(planning.approvedFingerprint) && planning.approvedFingerprint !== currentFingerprint;
  return {
    status:planning.status || 'DRAFT',
    effectiveStatus:approvalDrift ? 'CHANGES_AFTER_APPROVAL' : (planning.status || 'DRAFT'),
    approvalDrift,
    currentFingerprint,
    approvedFingerprint:planning.approvedFingerprint || null,
    talentCount:selections.length,
    creatorCount:selections.filter((item) => item.creatorType === 'CREATOR').length,
    kolCount:selections.filter((item) => item.creatorType === 'KOL').length,
    partnerCount:partnerIds.size,
    plannedPosts:selections.reduce((sum, item) => sum + number(item.expectedPosts), 0),
    plannedReach:selections.reduce((sum, item) => sum + number(item.expectedReach), 0),
    cashAllocation,
    tokenAllocation,
    tokenPrice,
    estimatedTokenValue,
    reservedBonusPoolUsd,
    estimatedPlanCost,
    budgetUsd,
    remainingBudget:budgetUsd - estimatedPlanCost,
    budgetUtilization:budgetUsd > 0 ? (estimatedPlanCost / budgetUsd) * 100 : 0,
    budgetReconciled:budgetUsd > 0 && estimatedPlanCost <= budgetUsd,
    compensationEnabled,
    compensationCurrency:compensation.currency || 'USDT',
    compensationBudgetUsdt:number(compensation.budgetUsdt),
    compensationBaseBudgetUsdt:Math.max(0, number(compensation.budgetUsdt) - number(compensation.bonusPoolUsdt)),
    compensationBonusPoolUsdt:number(compensation.bonusPoolUsdt),
    compensationMaximumBaseAllocationUsdt:number(compensation.maximumBaseAllocationUsdt),
    compensationMaximumBonusPerTalentUsdt:number(compensation.maximumBonusPerTalentUsdt),
    compensationCalculationCurrent,
    compensationFingerprint,
    compensationLastAppliedFingerprint:compensation.lastAppliedFingerprint || null,
  };
}

export function assertCampaignPlanReady(summary = {}) {
  if (!(summary.budgetUsd > 0)) {
    const cause = new Error('A positive campaign planning budget is required before approval');
    cause.status = 422;
    throw cause;
  }
  if (!(summary.talentCount > 0)) {
    const cause = new Error('Add at least one Creator or KOL before submitting the campaign plan');
    cause.status = 422;
    throw cause;
  }
  if (!(summary.plannedPosts > 0)) {
    const cause = new Error('Plan at least one Creator or KOL deliverable before approval');
    cause.status = 422;
    throw cause;
  }
  if (summary.compensationEnabled && !summary.compensationCalculationCurrent) {
    const cause = new Error('AKARI USDT compensation changed and must be recalculated before approval');
    cause.status = 422;
    throw cause;
  }
  if (!summary.budgetReconciled) {
    const cause = new Error('Campaign plan allocations exceed the planning budget');
    cause.status = 422;
    throw cause;
  }
  return true;
}

export function touchPlanning(planning, auth, status = null) {
  const next = { ...planning };
  if (status) next.status = status;
  next.lastModifiedAt = nowIso();
  next.lastModifiedBy = auth?.userId || null;
  return next;
}

export function clearApproval(planning) {
  return {
    ...planning,
    status:'DRAFT',
    submittedAt:null,
    submittedBy:null,
    approvedAt:null,
    approvedBy:null,
    approvedFingerprint:null,
    rejectedAt:null,
    rejectedBy:null,
    rejectionReason:'',
  };
}
