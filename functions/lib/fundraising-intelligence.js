const MAX_TEXT = 8000;

export const NORMALIZED_TARGET_STAGES = [
  'RESEARCHING',
  'READY',
  'INTRO_REQUESTED',
  'CONTACTED',
  'MEETING',
  'DILIGENCE',
  'PARTNER_MEETING',
  'SOFT_CIRCLE',
  'COMMITTED',
  'PASSED',
  'NOT_NOW',
];

export const ROUND_STAGES = ['PREPARING','OPEN','OUTREACH','DILIGENCE','COMMITMENTS','CLOSING','CLOSED','PAUSED'];

export function cleanText(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeName(value) {
  return cleanText(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function nonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function percentage(value, fallback = 0) {
  return Math.min(100, Math.max(0, nonNegativeNumber(value, fallback)));
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function textList(value, max = 50) {
  const source = Array.isArray(value)
    ? value
    : cleanText(value).split(/[,\n|]/g);
  return source.map((item) => cleanText(item, 200)).filter(Boolean).slice(0, max);
}

function normalizedSet(value) {
  return new Set(textList(value).map((item) => item.toLowerCase()));
}

function overlap(left, right) {
  const leftValues = [...normalizedSet(left)];
  const rightValues = [...normalizedSet(right)];
  return leftValues.filter((leftValue) => rightValues.some((rightValue) => (
    leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue)
  )));
}

function addComponent(components, reasons, warnings, key, points, maximum, reason, warning) {
  components[key] = { points, maximum };
  if (points > 0 && reason) reasons.push(reason);
  if (warning) warnings.push(warning);
}

export function assessInvestorFit(round = {}, investor = {}, context = {}) {
  const components = {};
  const reasons = [];
  const warnings = [];

  const desiredStage = cleanText(round.funding_stage ?? round.fundingStage, 100).toLowerCase();
  const investorStages = textList(investor.stages ?? investor.investment_stages ?? investor.investmentStages);
  const stageMatches = desiredStage ? overlap([desiredStage], investorStages) : [];
  if (!desiredStage) addComponent(components, reasons, warnings, 'stage', 0, 20, '', 'Round funding stage is missing.');
  else if (!investorStages.length) addComponent(components, reasons, warnings, 'stage', 0, 20, '', 'Investor stage evidence is missing.');
  else addComponent(components, reasons, warnings, 'stage', stageMatches.length ? 20 : 0, 20, `Invests at ${cleanText(round.funding_stage ?? round.fundingStage, 100)} stage.`, stageMatches.length ? '' : 'Published stage evidence does not match this round.');

  const desiredTicket = nonNegativeNumber(round.minimum_ticket ?? round.minimumTicket ?? context.desiredTicket);
  const minimumCheck = nonNegativeNumber(investor.minimum_check ?? investor.minimumCheck, 0);
  const maximumCheck = nonNegativeNumber(investor.maximum_check ?? investor.maximumCheck, 0);
  let chequePoints = 0;
  let chequeReason = '';
  let chequeWarning = '';
  if (!desiredTicket) chequeWarning = 'Round minimum ticket is missing.';
  else if (!minimumCheck && !maximumCheck) chequeWarning = 'Investor cheque-size evidence is missing.';
  else if ((!minimumCheck || desiredTicket >= minimumCheck) && (!maximumCheck || desiredTicket <= maximumCheck)) {
    chequePoints = 20;
    chequeReason = 'Published cheque range covers the target ticket.';
  } else {
    const typical = nonNegativeNumber(investor.typical_check ?? investor.typicalCheck, 0);
    if (typical && Math.abs(typical - desiredTicket) / Math.max(desiredTicket, 1) <= 0.5) {
      chequePoints = 10;
      chequeReason = 'Typical cheque is close to the target ticket.';
    } else chequeWarning = 'Published cheque evidence does not cover the target ticket.';
  }
  addComponent(components, reasons, warnings, 'cheque', chequePoints, 20, chequeReason, chequeWarning);

  const roundSectors = textList(round.sectors ?? round.project_sectors ?? round.projectCategory ?? round.category);
  const investorSectors = textList(investor.sectors ?? investor.investment_focus ?? investor.investmentFocus);
  const sectorMatches = overlap(roundSectors, investorSectors);
  addComponent(
    components,
    reasons,
    warnings,
    'sector',
    sectorMatches.length ? 15 : 0,
    15,
    sectorMatches.length ? `Sector match: ${sectorMatches.slice(0, 3).join(', ')}.` : '',
    !roundSectors.length ? 'Company sector context is missing.' : !investorSectors.length ? 'Investor sector evidence is missing.' : sectorMatches.length ? '' : 'No sector match is currently evidenced.',
  );

  const roundGeographies = textList(round.geographies ?? round.project_geographies ?? round.projectRegion ?? round.region);
  const investorGeographies = textList(investor.geographies ?? investor.regions ?? investor.geography);
  const geographyMatches = overlap(roundGeographies, investorGeographies);
  addComponent(
    components,
    reasons,
    warnings,
    'geography',
    geographyMatches.length ? 10 : 0,
    10,
    geographyMatches.length ? `Geography match: ${geographyMatches.slice(0, 3).join(', ')}.` : '',
    !roundGeographies.length ? 'Company geography context is missing.' : !investorGeographies.length ? 'Investor geography evidence is missing.' : geographyMatches.length ? '' : 'No geography match is currently evidenced.',
  );

  const portfolioMatches = nonNegativeNumber(context.portfolioMatchCount ?? investor.portfolio_match_count ?? investor.portfolioMatchCount);
  addComponent(
    components,
    reasons,
    warnings,
    'portfolio',
    portfolioMatches > 0 ? 10 : 0,
    10,
    portfolioMatches > 0 ? `${portfolioMatches} relevant portfolio example${portfolioMatches === 1 ? '' : 's'} evidenced.` : '',
    portfolioMatches > 0 ? '' : 'No relevant portfolio evidence has been reviewed.',
  );

  const currentYear = new Date().getUTCFullYear();
  const vintageYear = Number(context.fundVintageYear ?? investor.fund_vintage_year ?? investor.fundVintageYear);
  let fundPoints = 0;
  let fundReason = '';
  let fundWarning = '';
  if (Number.isInteger(vintageYear) && vintageYear > 1900 && vintageYear <= currentYear + 1) {
    const age = Math.max(0, currentYear - vintageYear);
    fundPoints = age <= 4 ? 10 : age <= 7 ? 5 : 0;
    fundReason = fundPoints ? `Current fund vintage is ${vintageYear}.` : '';
    fundWarning = fundPoints ? '' : 'Available fund evidence may be stale.';
  } else fundWarning = 'Current fund freshness is not verified.';
  addComponent(components, reasons, warnings, 'fundFreshness', fundPoints, 10, fundReason, fundWarning);

  const leadBehavior = cleanText(investor.lead_behavior ?? investor.leadBehavior, 300).toLowerCase();
  const leadPoints = /lead|co-lead|anchor/.test(leadBehavior) ? 5 : 0;
  addComponent(components, reasons, warnings, 'leadBehavior', leadPoints, 5, leadPoints ? 'Published evidence indicates lead or anchor behaviour.' : '', leadBehavior ? '' : 'Lead-investor behaviour is not verified.');

  const warmPath = cleanText(context.warmPathStatus ?? investor.warm_path_status ?? investor.warmPathStatus, 100).toUpperCase();
  const warmPathPoints = ['VERIFIED','STRONG','GRANTED'].includes(warmPath) ? 5 : 0;
  addComponent(components, reasons, warnings, 'warmPath', warmPathPoints, 5, warmPathPoints ? 'A verified warm path is available.' : '', warmPath && warmPath !== 'UNKNOWN' ? '' : 'No verified warm path is recorded.');

  const evidenceConfidence = percentage(context.evidenceConfidence ?? investor.evidence_confidence ?? investor.evidenceConfidence);
  const evidencePoints = evidenceConfidence >= 80 ? 5 : evidenceConfidence >= 50 ? 3 : evidenceConfidence > 0 ? 1 : 0;
  addComponent(components, reasons, warnings, 'evidence', evidencePoints, 5, evidencePoints ? `Evidence confidence is ${Math.round(evidenceConfidence)}%.` : '', evidencePoints ? '' : 'Material investor claims need evidence review.');

  const conflict = cleanText(context.conflictStatus ?? investor.conflict_status ?? investor.conflictStatus, 100).toUpperCase();
  const conflictAdjustment = conflict === 'CONFIRMED' ? -20 : conflict === 'POSSIBLE' ? -10 : 0;
  components.conflict = { points: conflictAdjustment, maximum: 0, minimum: -20 };
  if (conflict === 'CONFIRMED') warnings.push('Confirmed portfolio conflict requires an explicit decision before outreach.');
  else if (conflict === 'POSSIBLE') warnings.push('Possible portfolio conflict requires evidence review.');
  else if (!conflict || conflict === 'UNKNOWN') warnings.push('Portfolio conflict review is incomplete.');
  else reasons.push('No portfolio conflict is currently evidenced.');

  const score = Math.min(100, Math.max(0, Object.values(components).reduce((sum, item) => sum + Number(item.points || 0), 0)));
  return { score, components, reasons, warnings };
}

export function normalizeLegacyTargetStage(value) {
  const stage = cleanText(value, 80).toUpperCase();
  const mapping = {
    TARGET:'RESEARCHING', INTRO_REQUESTED:'INTRO_REQUESTED', INTRO_MADE:'INTRO_REQUESTED',
    CONTACTED:'CONTACTED', REPLIED:'CONTACTED', FOLLOW_UP:'CONTACTED', MEETING:'MEETING',
    DILIGENCE:'DILIGENCE', SOFT_COMMITMENT:'SOFT_CIRCLE', CONFIRMED:'COMMITTED',
    PASSED:'PASSED', DECLINED:'NOT_NOW',
  };
  return mapping[stage] || (NORMALIZED_TARGET_STAGES.includes(stage) ? stage : 'RESEARCHING');
}

export function calculateRoundEconomics(round = {}, targets = [], commitments = []) {
  const targetAmount = nonNegativeNumber(round.target_amount ?? round.targetAmount);
  const activeTargets = targets.filter((target) => !['PASSED','NOT_NOW'].includes(cleanText(target.stage, 80).toUpperCase()));
  const qualifiedPipeline = activeTargets.reduce((sum, target) => sum + nonNegativeNumber(target.expected_check ?? target.expectedCheck ?? target.estimatedTicket), 0);
  const weightedPipeline = activeTargets.reduce((sum, target) => {
    const expected = nonNegativeNumber(target.expected_check ?? target.expectedCheck ?? target.estimatedTicket);
    const probabilityValue = percentage(target.probability_percentage ?? target.probabilityPercentage ?? target.probability);
    return sum + (expected * probabilityValue / 100);
  }, 0);
  const softCircled = activeTargets
    .filter((target) => ['SOFT_CIRCLE','COMMITTED'].includes(cleanText(target.stage, 80).toUpperCase()))
    .reduce((sum, target) => sum + nonNegativeNumber(target.expected_check ?? target.expectedCheck ?? target.estimatedTicket), 0);
  const includedCommitments = commitments.filter((item) => !['CANCELLED','SOFT'].includes(cleanText(item.status, 80).toUpperCase()));
  const confirmedCommitments = includedCommitments.reduce((sum, item) => sum + nonNegativeNumber(item.committed_amount ?? item.committedAmount ?? item.amount), 0);
  const allocatedCapital = includedCommitments.reduce((sum, item) => sum + nonNegativeNumber(item.allocated_amount ?? item.allocatedAmount), 0);
  const fundsReceived = includedCommitments.reduce((sum, item) => sum + nonNegativeNumber(item.received_amount ?? item.receivedAmount ?? item.fundsReceived), 0);
  return {
    targetAmount,
    qualifiedPipeline:Math.round(qualifiedPipeline * 100) / 100,
    weightedPipeline:Math.round(weightedPipeline * 100) / 100,
    softCircled:Math.round(softCircled * 100) / 100,
    confirmedCommitments:Math.round(confirmedCommitments * 100) / 100,
    allocatedCapital:Math.round(allocatedCapital * 100) / 100,
    fundsReceived:Math.round(fundsReceived * 100) / 100,
    remaining:Math.max(0, Math.round((targetAmount - confirmedCommitments) * 100) / 100),
    coverageRatio:targetAmount > 0 ? Math.round((qualifiedPipeline / targetAmount) * 100) / 100 : 0,
  };
}

export function legacyCompatibilitySnapshot(rooms = []) {
  const rounds = rooms.map((room) => {
    const targets = (Array.isArray(room.investorPipeline) ? room.investorPipeline : []).map((item) => ({
      id:item.id,
      round_id:room.id,
      organisation_id:item.investorProjectId,
      organisation_name:item.investorName,
      primary_person_name:item.decisionMaker || '',
      stage:normalizeLegacyTargetStage(item.stage),
      fit_score:percentage(item.fitScore),
      fit_components_json:'{}',
      fit_reasons_json:'[]',
      fit_warnings_json:'["Legacy score has not yet been converted to an evidence-backed assessment."]',
      conflict_signal:'UNKNOWN',
      expected_check:nonNegativeNumber(item.estimatedTicket),
      probability_percentage:percentage(item.probability),
      warm_intro_source:item.warmIntroSource || '',
      introduction_status:item.introductionStatus || 'NOT_REQUESTED',
      next_follow_up_at:item.nextFollowUpAt || '',
      next_action:item.nextAction || '',
      notes:item.notes || '',
      storage_mode:'LEGACY_COMPATIBILITY',
    }));
    const commitments = Array.isArray(room.commitments) ? room.commitments : [];
    const normalizedRound = {
      id:room.id,
      legacy_room_id:room.id,
      project_id:room.projectId,
      project_name:room.projectName,
      round_name:room.roundName || 'Current round',
      stage:cleanText(room.stage || 'PREPARING', 80).toUpperCase(),
      instrument:room.roundType || '',
      funding_stage:room.fundingStage || '',
      currency:cleanText(room.currency || 'USD', 12).toUpperCase(),
      target_amount:nonNegativeNumber(room.targetAmount),
      valuation:nonNegativeNumber(room.valuation),
      minimum_ticket:nonNegativeNumber(room.minimumTicket),
      maximum_ticket:0,
      readiness_score:percentage(room.readinessScore),
      target_close_date:room.targetCloseDate || '',
      thesis:room.thesis || '',
      next_action:room.nextAction || '',
      storage_mode:'LEGACY_COMPATIBILITY',
      targets,
    };
    return { ...normalizedRound, economics:calculateRoundEconomics(normalizedRound, targets, commitments) };
  });
  return {
    storageMode:'LEGACY_COMPATIBILITY',
    migrationRequired:true,
    readOnly:true,
    rounds,
    summary:{
      rounds:rounds.length,
      activeRounds:rounds.filter((round) => !['CLOSED','PAUSED'].includes(round.stage)).length,
      targets:rounds.reduce((sum, round) => sum + round.targets.length, 0),
      targetAmount:rounds.reduce((sum, round) => sum + round.economics.targetAmount, 0),
      confirmedCommitments:rounds.reduce((sum, round) => sum + round.economics.confirmedCommitments, 0),
      weightedPipeline:rounds.reduce((sum, round) => sum + round.economics.weightedPipeline, 0),
    },
  };
}
