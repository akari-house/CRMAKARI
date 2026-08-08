import { parseCampaignTracking } from './campaign-tracking.js';

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const clamp = (value) => Math.max(0, Math.min(100, number(value)));
const text = (value) => String(value || '').trim();
const dateOnly = (value) => {
  const candidate = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
};
const laterDate = (current, candidate) => {
  const next = dateOnly(candidate);
  if (!next) return current;
  return !current || next > current ? next : current;
};
const normalizeHandle = (value) => text(value).toLowerCase().replace(/^@+/, '').replace(/\/$/, '');
const normalizeName = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
const normalizeUrl = (value) => text(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, '');

function socialIdentityFromUrl(value, fallbackPlatform) {
  const url = normalizeUrl(value);
  if (!url) return null;
  const rules = [
    [/^(?:x\.com|twitter\.com)\/([^/]+)/, 'X'],
    [/^instagram\.com\/([^/]+)/, 'INSTAGRAM'],
    [/^tiktok\.com\/@?([^/]+)/, 'TIKTOK'],
    [/^youtube\.com\/@([^/]+)/, 'YOUTUBE'],
    [/^linkedin\.com\/(?:in|company)\/([^/]+)/, 'LINKEDIN'],
    [/^reddit\.com\/(?:user|u)\/([^/]+)/, 'REDDIT'],
    [/^facebook\.com\/([^/]+)/, 'FACEBOOK'],
  ];
  for (const [pattern, platform] of rules) {
    const match = url.match(pattern);
    if (match?.[1]) return { key:`social:${platform}:${normalizeHandle(match[1])}`, method:'PROFILE_URL', confidence:'HIGH' };
  }
  return { key:`url:${String(fallbackPlatform || 'OTHER').toUpperCase()}:${url}`, method:'PROFILE_URL', confidence:'HIGH' };
}

export function creatorIdentity(assignment = {}) {
  const platform = String(assignment.platform || 'OTHER').toUpperCase();
  const fromUrl = socialIdentityFromUrl(assignment.profileUrl, platform);
  if (fromUrl) return fromUrl;
  const handle = normalizeHandle(assignment.handle);
  if (handle) return { key:`social:${platform}:${handle}`, method:'HANDLE', confidence:'MEDIUM' };
  const name = normalizeName(assignment.name);
  if (name) return { key:`name:${platform}:${name}`, method:'NAME_ONLY', confidence:'LOW' };
  return { key:`assignment:${assignment.id || Math.random()}`, method:'ASSIGNMENT_ONLY', confidence:'LOW' };
}

function classification(item, today) {
  if (item.campaignCount === 0) return 'INACTIVE';
  const last = item.lastActiveDate ? new Date(`${item.lastActiveDate}T00:00:00.000Z`) : null;
  const point = new Date(`${today}T00:00:00.000Z`);
  const inactiveByAge = last && Number.isFinite(last.getTime()) && Number.isFinite(point.getTime())
    ? (point.getTime() - last.getTime()) / 86400000 > 180
    : false;
  if (item.activeCampaigns === 0 && inactiveByAge) return 'INACTIVE';
  if (item.portfolioScore >= 85 && item.campaignCount >= 2) return 'TOP_PERFORMING';
  if (item.portfolioScore >= 70) return 'RELIABLE';
  if (item.portfolioScore >= 50) return 'NEEDS_ATTENTION';
  return 'UNDERPERFORMING';
}

function mapBest(map) {
  return [...map.entries()].sort((a, b) => b[1].reach - a[1].reach || b[1].posts - a[1].posts)[0] || null;
}

export function buildCreatorKolPortfolio(campaigns = [], partners = [], today = new Date().toISOString().slice(0, 10)) {
  const partnerById = new Map((partners || []).map((partner) => [partner.id, partner]));
  const grouped = new Map();

  for (const campaign of campaigns || []) {
    const { tracking } = parseCampaignTracking(campaign.notes);
    const assignments = tracking.creatorAssignments || [];
    const postsByAssignment = new Map();
    (tracking.creatorPosts || []).forEach((post) => {
      const list = postsByAssignment.get(post.assignmentId) || [];
      list.push(post);
      postsByAssignment.set(post.assignmentId, list);
    });
    const tokenPrice = number(tracking.overview?.currentTokenPrice || tracking.overview?.tokenListingPrice);

    for (const assignment of assignments) {
      const identity = creatorIdentity(assignment);
      const current = grouped.get(identity.key) || {
        identityKey:identity.key,
        identityMethod:identity.method,
        identityConfidence:identity.confidence,
        name:'', handle:'', profileUrl:'', primaryType:'CREATOR', typeSet:new Set(), platforms:new Set(), agencyNames:new Set(),
        campaignIds:new Set(), activeCampaignIds:new Set(), completedCampaignIds:new Set(),
        approvedPosts:0, submittedPosts:0, holdingPosts:0, rejectedPosts:0,
        approvedReach:0, approvedEngagements:0, expectedPosts:0, expectedReach:0,
        cashAllocation:0, tokenAllocation:0, estimatedTokenValue:0, trackedAllocationValue:0,
        deliveryTotal:0, deliveryCount:0, reachTotal:0, reachCount:0, reliableCampaigns:0, reliabilityCampaigns:0,
        sorsaTotal:0, sorsaCount:0, xScoreTotal:0, xScoreCount:0, latestSorsaScore:0, latestXScore:0, latestScoreDate:null,
        firstActiveDate:null, lastActiveDate:null, platformPerformance:new Map(), contentPerformance:new Map(), history:[],
      };

      current.name = text(assignment.name) || current.name;
      current.handle = text(assignment.handle) || current.handle;
      current.profileUrl = text(assignment.profileUrl) || current.profileUrl;
      current.typeSet.add(String(assignment.creatorType || 'CREATOR').toUpperCase());
      current.platforms.add(String(assignment.platform || 'OTHER').toUpperCase());
      current.campaignIds.add(campaign.id);
      const campaignStatus = String(campaign.status || '').toUpperCase();
      if (!['COMPLETED','CANCELLED'].includes(campaignStatus) && assignment.active !== false) current.activeCampaignIds.add(campaign.id);
      if (campaignStatus === 'COMPLETED') current.completedCampaignIds.add(campaign.id);

      const partner = assignment.agencyPartnerId ? partnerById.get(assignment.agencyPartnerId) : null;
      const agencyName = partner?.name || text(assignment.agencyName) || 'Direct / Unassigned';
      current.agencyNames.add(agencyName);

      const posts = postsByAssignment.get(assignment.id) || [];
      const approved = posts.filter((post) => !post.status || String(post.status).toUpperCase() === 'APPROVED');
      const holding = posts.filter((post) => String(post.status).toUpperCase() === 'HOLDING');
      const rejected = posts.filter((post) => String(post.status).toUpperCase() === 'REJECTED');
      const approvedReach = approved.reduce((sum, post) => sum + number(post.reach), 0);
      const approvedEngagements = approved.reduce((sum, post) => sum + number(post.totalEngagements), 0);
      const expectedPosts = number(assignment.expectedPosts);
      const expectedReach = number(assignment.expectedReach);
      const cashAllocation = number(assignment.allocatedUsd);
      const tokenAllocation = number(assignment.allocatedTokens);
      const estimatedTokenValue = tokenAllocation * tokenPrice;
      const trackedAllocationValue = cashAllocation + estimatedTokenValue;
      const deliveryCompletion = expectedPosts > 0 ? clamp((approved.length / expectedPosts) * 100) : 0;
      const reachCompletion = expectedReach > 0 ? clamp((approvedReach / expectedReach) * 100) : 0;
      const rejectionRate = posts.length ? (rejected.length / posts.length) * 100 : 0;

      current.approvedPosts += approved.length;
      current.submittedPosts += posts.length;
      current.holdingPosts += holding.length;
      current.rejectedPosts += rejected.length;
      current.approvedReach += approvedReach;
      current.approvedEngagements += approvedEngagements;
      current.expectedPosts += expectedPosts;
      current.expectedReach += expectedReach;
      current.cashAllocation += cashAllocation;
      current.tokenAllocation += tokenAllocation;
      current.estimatedTokenValue += estimatedTokenValue;
      current.trackedAllocationValue += trackedAllocationValue;

      if (expectedPosts > 0) {
        current.deliveryTotal += deliveryCompletion;
        current.deliveryCount += 1;
        current.reliabilityCampaigns += 1;
        if (deliveryCompletion >= 80 && rejectionRate <= 10) current.reliableCampaigns += 1;
      }
      if (expectedReach > 0) {
        current.reachTotal += reachCompletion;
        current.reachCount += 1;
      }

      const scoreDate = laterDate(dateOnly(assignment.updatedAt), campaign.start_date) || dateOnly(campaign.start_date) || today;
      const sorsa = number(assignment.sorsaScore);
      const xScore = number(assignment.xScore);
      if (sorsa > 0) { current.sorsaTotal += sorsa; current.sorsaCount += 1; }
      if (xScore > 0) { current.xScoreTotal += xScore; current.xScoreCount += 1; }
      if (!current.latestScoreDate || scoreDate >= current.latestScoreDate) {
        current.latestScoreDate = scoreDate;
        if (sorsa > 0) current.latestSorsaScore = sorsa;
        if (xScore > 0) current.latestXScore = xScore;
      }

      const assignmentPlatform = String(assignment.platform || 'OTHER').toUpperCase();
      approved.forEach((post) => {
        const platform = String(post.platform || assignmentPlatform).toUpperCase();
        const platformItem = current.platformPerformance.get(platform) || { posts:0, reach:0, engagements:0 };
        platformItem.posts += 1;
        platformItem.reach += number(post.reach);
        platformItem.engagements += number(post.totalEngagements);
        current.platformPerformance.set(platform, platformItem);

        const contentType = text(post.postType) || 'Unspecified';
        const contentItem = current.contentPerformance.get(contentType) || { posts:0, reach:0, engagements:0 };
        contentItem.posts += 1;
        contentItem.reach += number(post.reach);
        contentItem.engagements += number(post.totalEngagements);
        current.contentPerformance.set(contentType, contentItem);
        current.lastActiveDate = laterDate(current.lastActiveDate, post.dataDate);
        current.firstActiveDate = !current.firstActiveDate || (dateOnly(post.dataDate) && post.dataDate < current.firstActiveDate) ? dateOnly(post.dataDate) : current.firstActiveDate;
      });
      current.lastActiveDate = laterDate(current.lastActiveDate, campaign.start_date);
      if (!current.firstActiveDate) current.firstActiveDate = dateOnly(campaign.start_date);

      current.history.push({
        campaignId:campaign.id,
        campaignName:campaign.name,
        projectName:campaign.project_name || null,
        campaignStatus:campaign.status || null,
        startDate:dateOnly(campaign.start_date),
        endDate:dateOnly(campaign.end_date),
        assignmentActive:assignment.active !== false,
        creatorType:String(assignment.creatorType || 'CREATOR').toUpperCase(),
        platform:assignmentPlatform,
        agencyName,
        expectedPosts,
        submittedPosts:posts.length,
        approvedPosts:approved.length,
        holdingPosts:holding.length,
        rejectedPosts:rejected.length,
        expectedReach,
        approvedReach,
        approvedEngagements,
        deliveryCompletion,
        reachCompletion,
        sorsaScore:sorsa,
        xScore,
        cashAllocation,
        tokenAllocation,
        tokenPrice,
        estimatedTokenValue,
        trackedAllocationValue,
        lastPostDate:posts.reduce((latest, post) => laterDate(latest, post.dataDate), null),
      });

      grouped.set(identity.key, current);
    }
  }

  const rankOrder = { TOP_PERFORMING:0, RELIABLE:1, NEEDS_ATTENTION:2, UNDERPERFORMING:3, INACTIVE:4 };
  const items = [...grouped.values()].map((item) => {
    const averageDeliveryCompletion = item.deliveryCount ? item.deliveryTotal / item.deliveryCount : 0;
    const averageReachTargetAchievement = item.reachCount ? item.reachTotal / item.reachCount : 0;
    const holdingRate = item.submittedPosts ? (item.holdingPosts / item.submittedPosts) * 100 : 0;
    const rejectionRate = item.submittedPosts ? (item.rejectedPosts / item.submittedPosts) * 100 : 0;
    const campaignReliability = item.reliabilityCampaigns ? (item.reliableCampaigns / item.reliabilityCampaigns) * 100 : 0;
    const approvalQuality = clamp(100 - rejectionRate - (holdingRate * 0.5));
    const portfolioScore = clamp(
      averageDeliveryCompletion * 0.40 +
      averageReachTargetAchievement * 0.25 +
      approvalQuality * 0.20 +
      campaignReliability * 0.15
    );
    const bestPlatform = mapBest(item.platformPerformance);
    const bestContentType = mapBest(item.contentPerformance);
    const publicItem = {
      identityKey:item.identityKey,
      identityMethod:item.identityMethod,
      identityConfidence:item.identityConfidence,
      name:item.name || item.handle || 'Contributor',
      handle:item.handle,
      profileUrl:item.profileUrl,
      creatorType:item.typeSet.size > 1 ? 'MIXED' : ([...item.typeSet][0] || 'CREATOR'),
      platforms:[...item.platforms].sort(),
      agencies:[...item.agencyNames].sort((a, b) => a.localeCompare(b)),
      campaignCount:item.campaignIds.size,
      activeCampaigns:item.activeCampaignIds.size,
      completedCampaigns:item.completedCampaignIds.size,
      contributorState:item.activeCampaignIds.size > 0 ? 'ACTIVE' : 'INACTIVE',
      approvedPosts:item.approvedPosts,
      submittedPosts:item.submittedPosts,
      holdingPosts:item.holdingPosts,
      rejectedPosts:item.rejectedPosts,
      approvedReach:item.approvedReach,
      approvedEngagements:item.approvedEngagements,
      expectedPosts:item.expectedPosts,
      expectedReach:item.expectedReach,
      averageDeliveryCompletion,
      averageReachTargetAchievement,
      holdingRate,
      rejectionRate,
      campaignReliability,
      averageSorsaScore:item.sorsaCount ? item.sorsaTotal / item.sorsaCount : 0,
      averageXScore:item.xScoreCount ? item.xScoreTotal / item.xScoreCount : 0,
      latestSorsaScore:item.latestSorsaScore,
      latestXScore:item.latestXScore,
      latestScoreDate:item.latestScoreDate,
      cashAllocation:item.cashAllocation,
      tokenAllocation:item.tokenAllocation,
      estimatedTokenValue:item.estimatedTokenValue,
      trackedAllocationValue:item.trackedAllocationValue,
      lifetimeCpv:item.approvedReach ? item.trackedAllocationValue / item.approvedReach : 0,
      lifetimeCpe:item.approvedEngagements ? item.trackedAllocationValue / item.approvedEngagements : 0,
      bestPlatform:bestPlatform ? { name:bestPlatform[0], ...bestPlatform[1] } : null,
      bestContentType:bestContentType ? { name:bestContentType[0], ...bestContentType[1] } : null,
      firstActiveDate:item.firstActiveDate,
      lastActiveDate:item.lastActiveDate,
      portfolioScore,
      history:item.history.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || ''))),
    };
    return { ...publicItem, classification:classification(publicItem, today) };
  }).sort((a, b) =>
    (rankOrder[a.classification] - rankOrder[b.classification]) ||
    (b.portfolioScore - a.portfolioScore) ||
    (b.approvedReach - a.approvedReach) ||
    String(a.name).localeCompare(String(b.name))
  );

  return {
    contributorCount:items.length,
    activeContributors:items.filter((item) => item.contributorState === 'ACTIVE').length,
    creators:items.filter((item) => item.creatorType === 'CREATOR').length,
    kols:items.filter((item) => item.creatorType === 'KOL').length,
    mixedTypeContributors:items.filter((item) => item.creatorType === 'MIXED').length,
    topPerforming:items.filter((item) => item.classification === 'TOP_PERFORMING').length,
    reliable:items.filter((item) => item.classification === 'RELIABLE').length,
    needsAttention:items.filter((item) => ['NEEDS_ATTENTION','UNDERPERFORMING'].includes(item.classification)).length,
    lowConfidenceIdentities:items.filter((item) => item.identityConfidence === 'LOW').length,
    totalApprovedPosts:items.reduce((sum, item) => sum + item.approvedPosts, 0),
    totalApprovedReach:items.reduce((sum, item) => sum + item.approvedReach, 0),
    totalApprovedEngagements:items.reduce((sum, item) => sum + item.approvedEngagements, 0),
    totalTrackedAllocationValue:items.reduce((sum, item) => sum + item.trackedAllocationValue, 0),
    items,
  };
}
