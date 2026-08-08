export const CAMPAIGN_COMPENSATION_VERSION = 'R8.5G-1';
export const CAMPAIGN_COMPENSATION_PLATFORMS = ['X','YOUTUBE','TIKTOK','INSTAGRAM'];
export const CAMPAIGN_COMPENSATION_POSTING_CADENCES = ['ONE_TIME','WEEKLY_1','WEEKLY_2','WEEKLY_3','WEEKLY_4','WEEKLY_5','WEEKLY_6','WEEKLY_7','DAILY'];
export const CAMPAIGN_COMPENSATION_ENGAGEMENT_ACTIONS = ['COMMENT','LIKE','REPOST','BOOKMARK'];

const DEFAULT_PLATFORM_WEIGHTS = { X:100, YOUTUBE:0, TIKTOK:0, INSTAGRAM:0 };

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const text = (value, max = 2000) => String(value || '').trim().slice(0, max);
const upper = (value) => text(value, 120).toUpperCase();
const cents = (value) => Math.round(number(value) * 100);
const fromCents = (value) => Number((Number(value || 0) / 100).toFixed(2));
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePlatforms(value, fallback = []) {
  const list = Array.isArray(value) ? value : fallback;
  return CAMPAIGN_COMPENSATION_PLATFORMS.filter((platform) =>
    list.map((item) => upper(item)).includes(platform),
  );
}

function normalizeFollowers(value = {}) {
  const source = object(value);
  return Object.fromEntries(CAMPAIGN_COMPENSATION_PLATFORMS.map((platform) => [platform, number(source[platform])]));
}

function normalizePostingDays(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

function normalizeWeights(value = {}) {
  const source = object(value);
  const weights = Object.fromEntries(CAMPAIGN_COMPENSATION_PLATFORMS.map((platform) => [
    platform,
    Number.isInteger(Number(source[platform])) && Number(source[platform]) >= 0
      ? Math.min(100, Number(source[platform]))
      : DEFAULT_PLATFORM_WEIGHTS[platform],
  ]));
  const total = CAMPAIGN_COMPENSATION_PLATFORMS.reduce((sum, platform) => sum + weights[platform], 0);
  return total > 0 ? weights : { ...DEFAULT_PLATFORM_WEIGHTS };
}

function normalizeCadence(value) {
  const cadence = upper(value);
  return CAMPAIGN_COMPENSATION_POSTING_CADENCES.includes(cadence) ? cadence : 'WEEKLY_3';
}

function normalizeEngagementActions(value) {
  const list = Array.isArray(value) ? value.map((item) => upper(item)) : [];
  return CAMPAIGN_COMPENSATION_ENGAGEMENT_ACTIONS.filter((action) => list.includes(action));
}

function parseLastResult(value) {
  const source = object(value);
  return {
    version:text(source.version, 80) || null,
    appliedAt:text(source.appliedAt, 80) || null,
    appliedBy:text(source.appliedBy, 120) || null,
    baseBudgetUsdt:number(source.baseBudgetUsdt),
    bonusPoolUsdt:number(source.bonusPoolUsdt),
    totalAllocatedUsdt:number(source.totalAllocatedUsdt),
    unallocatedBaseUsdt:number(source.unallocatedBaseUsdt),
    budgetFactor:number(source.budgetFactor),
    items:Array.isArray(source.items) ? source.items.map((item) => ({
      assignmentId:text(item?.assignmentId, 120),
      rank:number(item?.rank),
      selectionScore:number(item?.selectionScore),
      platformScore:number(item?.platformScore),
      postingCommitmentScore:number(item?.postingCommitmentScore),
      engagementCommitmentScore:number(item?.engagementCommitmentScore),
      payoutUsdt:number(item?.payoutUsdt),
      payoutPercent:number(item?.payoutPercent),
    })).filter((item) => item.assignmentId) : [],
  };
}

export function defaultCompensationTalentInput(assignment = {}) {
  const assignmentPlatform = upper(assignment.platform);
  const supported = CAMPAIGN_COMPENSATION_PLATFORMS.includes(assignmentPlatform);
  return {
    assignmentId:text(assignment.id, 120),
    included:supported,
    selectedPlatforms:supported ? [assignmentPlatform] : [],
    followers:normalizeFollowers({}),
    postingDays:[],
    engagementAccepted:false,
    metricsVerified:false,
    verificationNote:'',
    verifiedAt:null,
    verifiedBy:null,
    updatedAt:null,
    updatedBy:null,
  };
}

export function parseCompensationTalentInput(value = {}, assignment = {}) {
  const fallback = defaultCompensationTalentInput(assignment);
  const source = object(value);
  const selectedPlatforms = normalizePlatforms(source.selectedPlatforms, fallback.selectedPlatforms);
  return {
    assignmentId:text(source.assignmentId || assignment.id, 120),
    included:hasOwn(source, 'included') ? Boolean(source.included) : fallback.included,
    selectedPlatforms,
    followers:normalizeFollowers(source.followers),
    postingDays:normalizePostingDays(source.postingDays),
    engagementAccepted:Boolean(source.engagementAccepted),
    metricsVerified:Boolean(source.metricsVerified),
    verificationNote:text(source.verificationNote, 1000),
    verifiedAt:text(source.verifiedAt, 80) || null,
    verifiedBy:text(source.verifiedBy, 120) || null,
    updatedAt:text(source.updatedAt, 80) || null,
    updatedBy:text(source.updatedBy, 120) || null,
  };
}

export function parseCampaignCompensation(value = {}) {
  const source = object(value);
  const cadence = normalizeCadence(source.postingCadence);
  const inputs = Array.isArray(source.talentInputs) ? source.talentInputs : [];
  return {
    version:1,
    engineVersion:CAMPAIGN_COMPENSATION_VERSION,
    enabled:Boolean(source.enabled),
    currency:'USDT',
    budgetUsdt:number(source.budgetUsdt),
    bonusPoolUsdt:number(source.bonusPoolUsdt),
    maximumBaseAllocationUsdt:number(source.maximumBaseAllocationUsdt),
    maximumBonusPerTalentUsdt:number(source.maximumBonusPerTalentUsdt),
    platformWeights:normalizeWeights(source.platformWeights),
    postingCadence:cadence,
    dailyEngagementRequired:Boolean(source.dailyEngagementRequired),
    engagementActions:normalizeEngagementActions(source.engagementActions),
    talentInputs:inputs.map((item) => parseCompensationTalentInput(item)).filter((item) => item.assignmentId),
    lastAppliedFingerprint:text(source.lastAppliedFingerprint, 200) || null,
    lastAppliedAt:text(source.lastAppliedAt, 80) || null,
    lastAppliedBy:text(source.lastAppliedBy, 120) || null,
    lastResult:parseLastResult(source.lastResult),
  };
}

export function sanitizeCampaignCompensation(input = {}, previous = {}) {
  const base = parseCampaignCompensation(previous);
  const source = object(input);
  const next = {
    ...base,
    enabled:hasOwn(source, 'enabled') ? Boolean(source.enabled) : base.enabled,
    budgetUsdt:hasOwn(source, 'budgetUsdt') ? number(source.budgetUsdt) : base.budgetUsdt,
    bonusPoolUsdt:hasOwn(source, 'bonusPoolUsdt') ? number(source.bonusPoolUsdt) : base.bonusPoolUsdt,
    maximumBaseAllocationUsdt:hasOwn(source, 'maximumBaseAllocationUsdt') ? number(source.maximumBaseAllocationUsdt) : base.maximumBaseAllocationUsdt,
    maximumBonusPerTalentUsdt:hasOwn(source, 'maximumBonusPerTalentUsdt') ? number(source.maximumBonusPerTalentUsdt) : base.maximumBonusPerTalentUsdt,
    platformWeights:hasOwn(source, 'platformWeights') ? normalizeWeights(source.platformWeights) : base.platformWeights,
    postingCadence:hasOwn(source, 'postingCadence') ? normalizeCadence(source.postingCadence) : base.postingCadence,
    dailyEngagementRequired:hasOwn(source, 'dailyEngagementRequired') ? Boolean(source.dailyEngagementRequired) : base.dailyEngagementRequired,
    engagementActions:hasOwn(source, 'engagementActions') ? normalizeEngagementActions(source.engagementActions) : base.engagementActions,
  };
  validateCampaignCompensation(next);
  return next;
}

export function sanitizeCompensationTalentInput(input = {}, previous = {}, assignment = {}) {
  const base = parseCompensationTalentInput(previous, assignment);
  const source = object(input);
  return {
    ...base,
    assignmentId:text(assignment.id || source.assignmentId || base.assignmentId, 120),
    included:hasOwn(source, 'included') ? Boolean(source.included) : base.included,
    selectedPlatforms:hasOwn(source, 'selectedPlatforms') ? normalizePlatforms(source.selectedPlatforms) : base.selectedPlatforms,
    followers:hasOwn(source, 'followers') ? normalizeFollowers(source.followers) : base.followers,
    postingDays:hasOwn(source, 'postingDays') ? normalizePostingDays(source.postingDays) : base.postingDays,
    engagementAccepted:hasOwn(source, 'engagementAccepted') ? Boolean(source.engagementAccepted) : base.engagementAccepted,
    verificationNote:hasOwn(source, 'verificationNote') ? text(source.verificationNote, 1000) : base.verificationNote,
  };
}

export function validateCampaignCompensation(value = {}) {
  const compensation = parseCampaignCompensation(value);
  if (!compensation.enabled) return true;
  const budgetCents = cents(compensation.budgetUsdt);
  const bonusPoolCents = cents(compensation.bonusPoolUsdt);
  const maximumAllocationCents = cents(compensation.maximumBaseAllocationUsdt);
  const maximumBonusCents = cents(compensation.maximumBonusPerTalentUsdt);
  const baseBudgetCents = budgetCents - bonusPoolCents;
  const weightTotal = CAMPAIGN_COMPENSATION_PLATFORMS.reduce((sum, platform) => sum + Number(compensation.platformWeights[platform] || 0), 0);
  if (
    budgetCents <= 0 ||
    bonusPoolCents < 0 ||
    bonusPoolCents > budgetCents ||
    maximumAllocationCents <= 0 ||
    maximumAllocationCents > baseBudgetCents ||
    maximumBonusCents < 0 ||
    maximumBonusCents > bonusPoolCents ||
    weightTotal !== 100 ||
    CAMPAIGN_COMPENSATION_PLATFORMS.some((platform) => !Number.isInteger(Number(compensation.platformWeights[platform])) || Number(compensation.platformWeights[platform]) < 0 || Number(compensation.platformWeights[platform]) > 100) ||
    !CAMPAIGN_COMPENSATION_POSTING_CADENCES.includes(compensation.postingCadence) ||
    (compensation.dailyEngagementRequired && compensation.engagementActions.length === 0)
  ) {
    const cause = new Error('Check the USDT budget, reserved bonus pool, individual ceilings, posting cadence and platform weights. Platform weights must total 100.');
    cause.status = 422;
    throw cause;
  }
  return true;
}

export function requiredPostingDays(postingCadence) {
  const cadence = normalizeCadence(postingCadence);
  if (cadence === 'DAILY') return 7;
  if (cadence.startsWith('WEEKLY_')) {
    const count = Number(cadence.slice('WEEKLY_'.length));
    return Number.isInteger(count) && count > 0 ? Math.min(7, count) : 1;
  }
  return 1;
}

export function percentile(values, value) {
  if (values.length <= 1) return 1;
  const below = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return (below + (equal - 1) / 2) / (values.length - 1);
}

export function resolveCompensationTalentInputs(tracking = {}, compensationValue = {}) {
  const compensation = parseCampaignCompensation(compensationValue);
  const byId = new Map(compensation.talentInputs.map((input) => [input.assignmentId, input]));
  return (tracking.creatorAssignments || [])
    .filter((assignment) => assignment.active !== false)
    .map((assignment) => parseCompensationTalentInput(byId.get(String(assignment.id || '')) || {}, assignment));
}

function candidateSet(tracking = {}, compensationValue = {}, { requireVerified = true } = {}) {
  const compensation = parseCampaignCompensation(compensationValue);
  validateCampaignCompensation(compensation);
  const assignments = (tracking.creatorAssignments || []).filter((assignment) => assignment.active !== false);
  const byAssignment = new Map(assignments.map((assignment) => [String(assignment.id || ''), assignment]));
  const inputs = resolveCompensationTalentInputs(tracking, compensation);
  const included = inputs.filter((input) => input.included);
  if (!included.length) {
    const cause = new Error('Include at least one Creator or KOL in AKARI USDT compensation before calculating allocations');
    cause.status = 422;
    throw cause;
  }
  const candidates = included.map((input) => {
    const assignment = byAssignment.get(input.assignmentId);
    if (!assignment) {
      const cause = new Error('A compensation talent item is no longer in the campaign plan');
      cause.status = 409;
      throw cause;
    }
    if (!input.selectedPlatforms.length) {
      const cause = new Error(`${assignment.name || assignment.handle || 'Talent'} needs at least one supported compensation platform`);
      cause.status = 422;
      throw cause;
    }
    if (requireVerified && !input.metricsVerified) {
      const cause = new Error(`${assignment.name || assignment.handle || 'Talent'} has unverified compensation metrics`);
      cause.status = 422;
      throw cause;
    }
    return {
      id:input.assignmentId,
      assignment,
      input,
      selectedPlatforms:input.selectedPlatforms,
      followers:input.followers,
      xScore:number(assignment.xScore),
      sorsaScore:number(assignment.sorsaScore),
      postingDays:input.postingDays,
      engagementAccepted:Boolean(input.engagementAccepted),
    };
  });
  return { compensation, candidates };
}

export function allocateCampaignCompensation(tracking = {}, compensationValue = {}) {
  const { compensation, candidates } = candidateSet(tracking, compensationValue, { requireVerified:true });
  const platformFollowerValues = Object.fromEntries(CAMPAIGN_COMPENSATION_PLATFORMS.map((platform) => [
    platform,
    candidates.filter((candidate) => candidate.selectedPlatforms.includes(platform)).map((candidate) => number(candidate.followers[platform])),
  ]));
  const xCandidates = candidates.filter((candidate) => candidate.selectedPlatforms.includes('X'));
  const xScoreValues = xCandidates.map((candidate) => number(candidate.xScore));
  const sorsaValues = xCandidates.map((candidate) => number(candidate.sorsaScore));
  const minimumDays = requiredPostingDays(compensation.postingCadence);

  const scored = candidates.map((candidate) => {
    const platformScores = candidate.selectedPlatforms.map((platform) => {
      const followerScore = percentile(platformFollowerValues[platform], number(candidate.followers[platform]));
      const score = platform === 'X'
        ? followerScore * 0.4 + percentile(xScoreValues, number(candidate.xScore)) * 0.3 + percentile(sorsaValues, number(candidate.sorsaScore)) * 0.3
        : followerScore;
      return { platform, score, weight:Number(compensation.platformWeights[platform] || 0) };
    });
    const selectedWeight = platformScores.reduce((sum, item) => sum + item.weight, 0);
    const platformScore = selectedWeight
      ? platformScores.reduce((sum, item) => sum + item.score * item.weight, 0) / selectedWeight
      : platformScores.reduce((sum, item) => sum + item.score, 0) / Math.max(1, platformScores.length);
    const postingCommitmentScore = Math.min(1, new Set(candidate.postingDays).size / minimumDays);
    const engagementCommitmentScore = compensation.dailyEngagementRequired ? (candidate.engagementAccepted ? 1 : 0) : 1;
    const selectionScore = platformScore * 0.7 + postingCommitmentScore * 0.2 + engagementCommitmentScore * 0.1;
    return { ...candidate, platformScore, postingCommitmentScore, engagementCommitmentScore, selectionScore };
  });

  const highestScore = Math.max(...scored.map((candidate) => candidate.selectionScore));
  const budgetCents = cents(compensation.budgetUsdt);
  const bonusPoolCents = cents(compensation.bonusPoolUsdt);
  const baseBudgetCents = Math.max(0, budgetCents - bonusPoolCents);
  const maximumAllocationCents = cents(compensation.maximumBaseAllocationUsdt);
  const provisional = scored.map((candidate) => {
    const exact = highestScore ? (maximumAllocationCents * candidate.selectionScore) / highestScore : 0;
    return { ...candidate, exact:Math.min(maximumAllocationCents, exact) };
  });
  const provisionalTotal = provisional.reduce((sum, item) => sum + item.exact, 0);
  const budgetFactor = provisionalTotal ? Math.min(1, baseBudgetCents / provisionalTotal) : 0;
  const items = provisional.map(({ exact, assignment, input, ...candidate }) => {
    const payoutCents = Math.min(maximumAllocationCents, Math.floor(exact * budgetFactor));
    return {
      assignmentId:candidate.id,
      creatorType:upper(assignment.creatorType || 'CREATOR'),
      name:text(assignment.name, 300),
      handle:text(assignment.handle, 200),
      selectedPlatforms:[...candidate.selectedPlatforms],
      selectionScore:candidate.selectionScore,
      selectionScorePercent:candidate.selectionScore * 100,
      platformScore:candidate.platformScore,
      platformScorePercent:candidate.platformScore * 100,
      postingCommitmentScore:candidate.postingCommitmentScore,
      engagementCommitmentScore:candidate.engagementCommitmentScore,
      payoutUsdt:fromCents(payoutCents),
      payoutPercent:baseBudgetCents === 0 ? 0 : (payoutCents / baseBudgetCents) * 100,
    };
  }).sort((a, b) => b.selectionScore - a.selectionScore || a.assignmentId.localeCompare(b.assignmentId));
  items.forEach((item, index) => { item.rank = index + 1; });
  const totalAllocatedCents = items.reduce((sum, item) => sum + cents(item.payoutUsdt), 0);
  return {
    version:CAMPAIGN_COMPENSATION_VERSION,
    currency:'USDT',
    baseBudgetUsdt:fromCents(baseBudgetCents),
    bonusPoolUsdt:fromCents(bonusPoolCents),
    maximumBaseAllocationUsdt:fromCents(maximumAllocationCents),
    maximumBonusPerTalentUsdt:Number(compensation.maximumBonusPerTalentUsdt || 0),
    budgetFactor,
    totalAllocatedUsdt:fromCents(totalAllocatedCents),
    unallocatedBaseUsdt:fromCents(Math.max(0, baseBudgetCents - totalAllocatedCents)),
    items,
  };
}

function fnv1a(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function campaignCompensationFingerprint(tracking = {}, compensationValue = {}) {
  const compensation = parseCampaignCompensation(compensationValue);
  const inputs = resolveCompensationTalentInputs(tracking, compensation);
  const inputById = new Map(inputs.map((input) => [input.assignmentId, input]));
  const assignments = (tracking.creatorAssignments || [])
    .filter((assignment) => assignment.active !== false)
    .map((assignment) => {
      const input = inputById.get(String(assignment.id || '')) || defaultCompensationTalentInput(assignment);
      return {
        id:String(assignment.id || ''),
        creatorType:upper(assignment.creatorType || 'CREATOR'),
        platform:upper(assignment.platform || ''),
        xScore:number(assignment.xScore),
        sorsaScore:number(assignment.sorsaScore),
        included:input.included,
        selectedPlatforms:[...input.selectedPlatforms].sort(),
        followers:Object.fromEntries(CAMPAIGN_COMPENSATION_PLATFORMS.map((platform) => [platform, number(input.followers[platform])])),
        postingDays:[...input.postingDays],
        engagementAccepted:Boolean(input.engagementAccepted),
        metricsVerified:Boolean(input.metricsVerified),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const payload = JSON.stringify({
    enabled:compensation.enabled,
    budgetUsdt:number(compensation.budgetUsdt),
    bonusPoolUsdt:number(compensation.bonusPoolUsdt),
    maximumBaseAllocationUsdt:number(compensation.maximumBaseAllocationUsdt),
    maximumBonusPerTalentUsdt:number(compensation.maximumBonusPerTalentUsdt),
    platformWeights:compensation.platformWeights,
    postingCadence:compensation.postingCadence,
    dailyEngagementRequired:compensation.dailyEngagementRequired,
    engagementActions:[...compensation.engagementActions].sort(),
    assignments,
  });
  return `r8.5g-${fnv1a(payload)}`;
}

export function buildCampaignCompensationSummary(tracking = {}, compensationValue = {}) {
  const compensation = parseCampaignCompensation(compensationValue);
  const inputs = resolveCompensationTalentInputs(tracking, compensation);
  const currentFingerprint = campaignCompensationFingerprint(tracking, compensation);
  const included = inputs.filter((input) => input.included);
  const verified = included.filter((input) => input.metricsVerified);
  const unsupported = inputs.filter((input) => !input.selectedPlatforms.length);
  let calculation = null;
  let calculationError = null;
  if (compensation.enabled) {
    try { calculation = allocateCampaignCompensation(tracking, compensation); }
    catch (cause) { calculationError = cause.message || 'Compensation cannot be calculated yet'; }
  }
  const baseBudgetUsdt = Math.max(0, number(compensation.budgetUsdt) - number(compensation.bonusPoolUsdt));
  return {
    enabled:compensation.enabled,
    currency:'USDT',
    engineVersion:CAMPAIGN_COMPENSATION_VERSION,
    activeTalentCount:inputs.length,
    includedTalentCount:included.length,
    verifiedTalentCount:verified.length,
    unsupportedTalentCount:unsupported.length,
    budgetUsdt:number(compensation.budgetUsdt),
    baseBudgetUsdt,
    bonusPoolUsdt:number(compensation.bonusPoolUsdt),
    maximumBaseAllocationUsdt:number(compensation.maximumBaseAllocationUsdt),
    maximumBonusPerTalentUsdt:number(compensation.maximumBonusPerTalentUsdt),
    calculatedBaseAllocationUsdt:number(calculation?.totalAllocatedUsdt),
    unallocatedBaseUsdt:calculation ? number(calculation.unallocatedBaseUsdt) : baseBudgetUsdt,
    calculationCurrent:!compensation.enabled || Boolean(compensation.lastAppliedFingerprint) && compensation.lastAppliedFingerprint === currentFingerprint,
    currentFingerprint,
    lastAppliedFingerprint:compensation.lastAppliedFingerprint || null,
    lastAppliedAt:compensation.lastAppliedAt || null,
    lastAppliedBy:compensation.lastAppliedBy || null,
    calculationError,
    calculation,
  };
}
