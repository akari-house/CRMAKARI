import { makeId, nowIso } from './db.js';

export const CAMPAIGN_PLATFORMS = ['X','FACEBOOK','INSTAGRAM','TIKTOK','TELEGRAM_CHANNEL','TELEGRAM_GROUP','DISCORD','YOUTUBE','LINKEDIN','REDDIT'];

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const text = (value, max = 2000) => String(value || '').trim().slice(0, max);
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;

export function parseCampaignTracking(notes) {
  let root = {};
  try { root = notes ? JSON.parse(notes) : {}; } catch { root = {}; }
  if (!root || Array.isArray(root) || typeof root !== 'object') root = {};
  const existing = root.campaignTracking && typeof root.campaignTracking === 'object' ? root.campaignTracking : {};
  const tracking = {
    version: 1,
    overview: existing.overview && typeof existing.overview === 'object' ? existing.overview : {},
    targets: Array.isArray(existing.targets) ? existing.targets : [],
    socialUpdates: Array.isArray(existing.socialUpdates) ? existing.socialUpdates : [],
    createdAt: existing.createdAt || null,
    createdBy: existing.createdBy || null,
    updatedAt: existing.updatedAt || null,
    updatedBy: existing.updatedBy || null,
  };
  return { root, tracking };
}

export function serializeCampaignTracking(root, tracking) {
  return JSON.stringify({ ...root, campaignTracking: tracking });
}

export function sanitizeOverview(input = {}, previous = {}) {
  return {
    reportingCurrency: text(input.reportingCurrency || previous.reportingCurrency || 'USD', 10).toUpperCase(),
    projectWebsite: text(input.projectWebsite ?? previous.projectWebsite, 500),
    mainXProfile: text(input.mainXProfile ?? previous.mainXProfile, 500),
    tokenListingPrice: number(input.tokenListingPrice ?? previous.tokenListingPrice),
    currentTokenPrice: number(input.currentTokenPrice ?? previous.currentTokenPrice),
    defaultTgeUnlock: Math.min(100, number(input.defaultTgeUnlock ?? previous.defaultTgeUnlock)),
    defaultCliffMonths: number(input.defaultCliffMonths ?? previous.defaultCliffMonths),
    defaultVestingMonths: number(input.defaultVestingMonths ?? previous.defaultVestingMonths),
    notes: text(input.notes ?? previous.notes, 5000),
    baselineSorsaScore: number(input.baselineSorsaScore ?? previous.baselineSorsaScore),
    targetSorsaScore: number(input.targetSorsaScore ?? previous.targetSorsaScore),
    baselineXScore: number(input.baselineXScore ?? previous.baselineXScore),
    targetXScore: number(input.targetXScore ?? previous.targetXScore),
  };
}

export function sanitizeTarget(input = {}, previous = {}) {
  const platform = text(input.platform || previous.platform, 40).toUpperCase();
  if (!CAMPAIGN_PLATFORMS.includes(platform)) {
    const cause = new Error('Owned-social platform is invalid');
    cause.status = 422;
    throw cause;
  }
  return {
    id: previous.id || makeId('cst'),
    platform,
    profileUrl: text(input.profileUrl ?? previous.profileUrl, 500),
    baselineAudience: number(input.baselineAudience ?? previous.baselineAudience),
    targetAudience: number(input.targetAudience ?? previous.targetAudience),
  };
}

export function campaignPeriod(startDate, dataDate) {
  const start = dateOnly(startDate) ? new Date(`${startDate}T00:00:00.000Z`) : null;
  const point = dateOnly(dataDate) ? new Date(`${dataDate}T00:00:00.000Z`) : null;
  if (!start || !point || point < start) return { week: 1, month: 1, daysRunning: 0 };
  const daysRunning = Math.floor((point - start) / 86400000);
  const week = Math.floor(daysRunning / 7) + 1;
  return { week, month: Math.floor((week - 1) / 4) + 1, daysRunning };
}

export function sanitizeSocialUpdate(input = {}, campaignStartDate, previous = {}) {
  const platform = text(input.platform || previous.platform, 40).toUpperCase();
  if (!CAMPAIGN_PLATFORMS.includes(platform)) {
    const cause = new Error('Owned-social platform is invalid');
    cause.status = 422;
    throw cause;
  }
  const dataDate = dateOnly(input.dataDate || previous.dataDate);
  if (!dataDate) {
    const cause = new Error('A valid social-update date is required');
    cause.status = 422;
    throw cause;
  }
  const period = campaignPeriod(campaignStartDate, dataDate);
  const likes = number(input.likes ?? previous.likes);
  const comments = number(input.comments ?? previous.comments);
  const shares = number(input.shares ?? previous.shares);
  const totalEngagements = likes + comments + shares;
  const impressions = number(input.impressions ?? previous.impressions);
  const reach = number(input.reach ?? previous.reach);
  const denominator = impressions || reach;
  return {
    id: previous.id || makeId('csu'),
    platform,
    dataDate,
    campaignWeek: period.week,
    campaignMonth: period.month,
    profileUrl: text(input.profileUrl ?? previous.profileUrl, 500),
    audience: number(input.audience ?? previous.audience),
    reach,
    impressions,
    likes,
    comments,
    shares,
    videoViews: number(input.videoViews ?? previous.videoViews),
    linkClicks: number(input.linkClicks ?? previous.linkClicks),
    profileVisits: number(input.profileVisits ?? previous.profileVisits),
    totalEngagements,
    engagementRate: denominator > 0 ? (totalEngagements / denominator) * 100 : 0,
    sorsaScore: platform === 'X' ? number(input.sorsaScore ?? previous.sorsaScore) : 0,
    xScore: platform === 'X' ? number(input.xScore ?? previous.xScore) : 0,
    notes: text(input.notes ?? previous.notes, 3000),
    enteredBy: previous.enteredBy || null,
    createdAt: previous.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

export function campaignTrackingSummary(tracking, startDate, today = nowIso().slice(0, 10)) {
  const latestByPlatform = new Map();
  [...tracking.socialUpdates]
    .sort((a, b) => String(a.dataDate).localeCompare(String(b.dataDate)))
    .forEach((item) => latestByPlatform.set(item.platform, item));
  const targetByPlatform = new Map(tracking.targets.map((item) => [item.platform, item]));
  const scorecard = CAMPAIGN_PLATFORMS.map((platform) => {
    const target = targetByPlatform.get(platform) || { platform, profileUrl:'', baselineAudience:0, targetAudience:0 };
    const current = latestByPlatform.get(platform);
    const currentAudience = number(current?.audience);
    const netGrowth = currentAudience - number(target.baselineAudience);
    const growthPercent = target.baselineAudience > 0 ? (netGrowth / target.baselineAudience) * 100 : 0;
    const targetDelta = number(target.targetAudience) - number(target.baselineAudience);
    const targetProgress = targetDelta > 0 ? Math.max(0, Math.min(100, (netGrowth / targetDelta) * 100)) : 0;
    const updates = tracking.socialUpdates.filter((item) => item.platform === platform);
    return {
      platform,
      profileUrl: current?.profileUrl || target.profileUrl || '',
      baselineAudience:number(target.baselineAudience),
      targetAudience:number(target.targetAudience),
      currentAudience,
      netGrowth,
      growthPercent,
      targetProgress,
      totalReach:updates.reduce((sum, item) => sum + number(item.reach), 0),
      totalEngagements:updates.reduce((sum, item) => sum + number(item.totalEngagements), 0),
      engagementRate:current?.engagementRate || 0,
      latestUpdateDate:current?.dataDate || null,
    };
  });
  const xCurrent = latestByPlatform.get('X');
  const period = campaignPeriod(startDate, today);
  const latestUpdateDate = tracking.socialUpdates.reduce((latest, item) => !latest || item.dataDate > latest ? item.dataDate : latest, null);
  return {
    scorecard,
    currentWeek:period.week,
    currentMonth:period.month,
    daysRunning:period.daysRunning,
    lastDataUpdate:latestUpdateDate,
    nextReportingDate:startDate ? new Date(new Date(`${startDate}T00:00:00.000Z`).getTime() + period.week * 7 * 86400000).toISOString().slice(0,10) : null,
    totalOwnedAudience:scorecard.reduce((sum, item) => sum + item.currentAudience, 0),
    totalOwnedReach:tracking.socialUpdates.reduce((sum, item) => sum + number(item.reach), 0),
    totalOwnedEngagements:tracking.socialUpdates.reduce((sum, item) => sum + number(item.totalEngagements), 0),
    currentSorsaScore:number(xCurrent?.sorsaScore),
    currentXScore:number(xCurrent?.xScore),
  };
}
