import { makeId, nowIso } from './db.js';

export const CAMPAIGN_PLATFORMS = ['X','FACEBOOK','INSTAGRAM','TIKTOK','TELEGRAM_CHANNEL','TELEGRAM_GROUP','DISCORD','YOUTUBE','LINKEDIN','REDDIT'];
export const CREATOR_TYPES = ['CREATOR','KOL'];

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
    version: 2,
    overview: existing.overview && typeof existing.overview === 'object' ? existing.overview : {},
    targets: Array.isArray(existing.targets) ? existing.targets : [],
    socialUpdates: Array.isArray(existing.socialUpdates) ? existing.socialUpdates : [],
    creatorAssignments: Array.isArray(existing.creatorAssignments) ? existing.creatorAssignments : [],
    creatorPosts: Array.isArray(existing.creatorPosts) ? existing.creatorPosts : [],
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
    id: previous.id || makeId('csu'), platform, dataDate,
    campaignWeek: period.week, campaignMonth: period.month,
    profileUrl: text(input.profileUrl ?? previous.profileUrl, 500),
    audience: number(input.audience ?? previous.audience), reach, impressions,
    likes, comments, shares,
    videoViews: number(input.videoViews ?? previous.videoViews),
    linkClicks: number(input.linkClicks ?? previous.linkClicks),
    profileVisits: number(input.profileVisits ?? previous.profileVisits),
    totalEngagements,
    engagementRate: (impressions || reach) > 0 ? (totalEngagements / (impressions || reach)) * 100 : 0,
    sorsaScore: platform === 'X' ? number(input.sorsaScore ?? previous.sorsaScore) : 0,
    xScore: platform === 'X' ? number(input.xScore ?? previous.xScore) : 0,
    notes: text(input.notes ?? previous.notes, 3000),
    enteredBy: previous.enteredBy || null,
    createdAt: previous.createdAt || nowIso(), updatedAt: nowIso(),
  };
}

export function sanitizeCreatorAssignment(input = {}, previous = {}, overview = {}) {
  const creatorType = text(input.creatorType || previous.creatorType || 'CREATOR', 20).toUpperCase();
  if (!CREATOR_TYPES.includes(creatorType)) {
    const cause = new Error('Creator type must be Creator or KOL');
    cause.status = 422;
    throw cause;
  }
  const platform = text(input.platform || previous.platform || 'X', 40).toUpperCase();
  if (!CAMPAIGN_PLATFORMS.includes(platform)) {
    const cause = new Error('Creator platform is invalid');
    cause.status = 422;
    throw cause;
  }
  const name = text(input.name ?? previous.name, 300);
  const handle = text(input.handle ?? previous.handle, 200);
  if (!name && !handle) {
    const cause = new Error('Creator name or handle is required');
    cause.status = 422;
    throw cause;
  }
  return {
    id: previous.id || makeId('cca'),
    creatorType, name, handle, platform,
    profileUrl: text(input.profileUrl ?? previous.profileUrl, 500),
    agencyName: text(input.agencyName ?? previous.agencyName, 300),
    category: text(input.category ?? previous.category, 200),
    region: text(input.region ?? previous.region, 120),
    sorsaScore: number(input.sorsaScore ?? previous.sorsaScore),
    xScore: number(input.xScore ?? previous.xScore),
    expectedPosts: number(input.expectedPosts ?? previous.expectedPosts),
    expectedReach: number(input.expectedReach ?? previous.expectedReach),
    allocatedUsd: number(input.allocatedUsd ?? previous.allocatedUsd),
    allocatedTokens: number(input.allocatedTokens ?? previous.allocatedTokens),
    tgeUnlockPercent: Math.min(100, number(input.tgeUnlockPercent ?? previous.tgeUnlockPercent ?? overview.defaultTgeUnlock)),
    cliffMonths: number(input.cliffMonths ?? previous.cliffMonths ?? overview.defaultCliffMonths),
    vestingMonths: number(input.vestingMonths ?? previous.vestingMonths ?? overview.defaultVestingMonths),
    notes: text(input.notes ?? previous.notes, 3000),
    active: input.active === undefined ? previous.active !== false : Boolean(input.active),
    createdAt: previous.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

export function sanitizeCreatorPost(input = {}, assignment, campaignStartDate, previous = {}) {
  if (!assignment) {
    const cause = new Error('Tracked creator assignment was not found');
    cause.status = 422;
    throw cause;
  }
  const dataDate = dateOnly(input.dataDate || previous.dataDate);
  if (!dataDate) {
    const cause = new Error('A valid post date is required');
    cause.status = 422;
    throw cause;
  }
  const platform = text(input.platform || previous.platform || assignment.platform, 40).toUpperCase();
  if (!CAMPAIGN_PLATFORMS.includes(platform)) {
    const cause = new Error('Creator post platform is invalid');
    cause.status = 422;
    throw cause;
  }
  const url = text(input.url ?? previous.url, 800);
  if (!url) {
    const cause = new Error('Published post URL is required');
    cause.status = 422;
    throw cause;
  }
  const likes = number(input.likes ?? previous.likes);
  const comments = number(input.comments ?? previous.comments);
  const shares = number(input.shares ?? previous.shares);
  const totalEngagements = likes + comments + shares;
  const reach = number(input.reach ?? previous.reach);
  const impressions = number(input.impressions ?? previous.impressions);
  const period = campaignPeriod(campaignStartDate, dataDate);
  return {
    id: previous.id || makeId('ccp'),
    assignmentId: assignment.id,
    platform,
    dataDate,
    campaignWeek: period.week,
    campaignMonth: period.month,
    postType: text(input.postType ?? previous.postType, 120),
    url,
    reach,
    impressions,
    likes,
    comments,
    shares,
    videoViews: number(input.videoViews ?? previous.videoViews),
    linkClicks: number(input.linkClicks ?? previous.linkClicks),
    totalEngagements,
    engagementRate: (impressions || reach) > 0 ? (totalEngagements / (impressions || reach)) * 100 : 0,
    notes: text(input.notes ?? previous.notes, 3000),
    enteredBy: previous.enteredBy || null,
    createdAt: previous.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

export function creatorTrackingSummary(tracking) {
  const assignments = tracking.creatorAssignments.filter((item) => item.active !== false);
  const posts = tracking.creatorPosts || [];
  const postByAssignment = new Map();
  posts.forEach((post) => {
    const list = postByAssignment.get(post.assignmentId) || [];
    list.push(post);
    postByAssignment.set(post.assignmentId, list);
  });
  const creators = assignments.map((assignment) => {
    const creatorPosts = postByAssignment.get(assignment.id) || [];
    const reach = creatorPosts.reduce((sum, post) => sum + number(post.reach), 0);
    const engagements = creatorPosts.reduce((sum, post) => sum + number(post.totalEngagements), 0);
    return {
      ...assignment,
      publishedPosts: creatorPosts.length,
      remainingPosts: Math.max(0, number(assignment.expectedPosts) - creatorPosts.length),
      totalReach: reach,
      totalEngagements: engagements,
      deliveryProgress: assignment.expectedPosts > 0 ? Math.min(100, (creatorPosts.length / assignment.expectedPosts) * 100) : 0,
      reachProgress: assignment.expectedReach > 0 ? Math.min(100, (reach / assignment.expectedReach) * 100) : 0,
    };
  });
  const agencyMap = new Map();
  creators.forEach((creator) => {
    const agency = creator.agencyName || 'Direct / Unassigned';
    const current = agencyMap.get(agency) || { agencyName:agency, creators:0, expectedPosts:0, publishedPosts:0, reach:0, engagements:0, allocatedUsd:0, allocatedTokens:0 };
    current.creators += 1;
    current.expectedPosts += number(creator.expectedPosts);
    current.publishedPosts += number(creator.publishedPosts);
    current.reach += number(creator.totalReach);
    current.engagements += number(creator.totalEngagements);
    current.allocatedUsd += number(creator.allocatedUsd);
    current.allocatedTokens += number(creator.allocatedTokens);
    agencyMap.set(agency, current);
  });
  const plannedPosts = creators.reduce((sum, item) => sum + number(item.expectedPosts), 0);
  const publishedPosts = posts.length;
  return {
    creators,
    agencies:[...agencyMap.values()].sort((a,b)=>b.reach-a.reach),
    creatorCount:creators.length,
    kolCount:creators.filter((item)=>item.creatorType === 'KOL').length,
    agencyCount:[...agencyMap.keys()].filter((name)=>name !== 'Direct / Unassigned').length,
    plannedPosts,
    publishedPosts,
    postCompletionPercent:plannedPosts > 0 ? Math.min(100,(publishedPosts/plannedPosts)*100) : 0,
    creatorReach:posts.reduce((sum, item)=>sum+number(item.reach),0),
    creatorEngagements:posts.reduce((sum, item)=>sum+number(item.totalEngagements),0),
    allocatedUsd:creators.reduce((sum,item)=>sum+number(item.allocatedUsd),0),
    allocatedTokens:creators.reduce((sum,item)=>sum+number(item.allocatedTokens),0),
    averageReachPerPost:publishedPosts > 0 ? posts.reduce((sum,item)=>sum+number(item.reach),0)/publishedPosts : 0,
  };
}

export function campaignTrackingSummary(tracking, startDate, today = nowIso().slice(0, 10)) {
  const latestByPlatform = new Map();
  [...tracking.socialUpdates].sort((a, b) => String(a.dataDate).localeCompare(String(b.dataDate))).forEach((item) => latestByPlatform.set(item.platform, item));
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
      baselineAudience:number(target.baselineAudience), targetAudience:number(target.targetAudience), currentAudience,
      netGrowth, growthPercent, targetProgress,
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
    creatorTracking:creatorTrackingSummary(tracking),
  };
}
