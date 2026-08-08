import { parseCampaignTracking } from './campaign-tracking.js';
import { buildCreatorKolPortfolio, creatorIdentity } from './creator-kol-portfolio-intelligence.js';
import { buildDeliveryPartnerPortfolio } from './delivery-partner-portfolio-intelligence.js';

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const clamp = (value) => Math.max(0, Math.min(100, number(value)));
const text = (value) => String(value || '').trim();
const upper = (value) => text(value).toUpperCase();
const normalize = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
const approved = (post) => !post.status || upper(post.status) === 'APPROVED';
const dateOnly = (value) => {
  const candidate = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
};

export const TALENT_OBJECTIVES = ['BALANCED','REACH','ENGAGEMENT','RELIABILITY'];
export const TALENT_TYPES = ['ALL','CREATOR','KOL'];

function daysSince(value, today) {
  const date = dateOnly(value);
  const point = dateOnly(today);
  if (!date || !point) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${point}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}

function recencyScore(value, today) {
  const days = daysSince(value, today);
  if (days === null) return 20;
  if (days <= 30) return 100;
  if (days <= 90) return 85;
  if (days <= 180) return 70;
  if (days <= 365) return 50;
  return 30;
}

function efficiencyScores(items, field) {
  const ranked = items
    .filter((item) => number(item[field]) > 0)
    .sort((a, b) => number(a[field]) - number(b[field]) || String(a.identityKey).localeCompare(String(b.identityKey)));
  const result = new Map();
  ranked.forEach((item, index) => {
    const score = ranked.length <= 1 ? 100 : 100 - ((index / (ranked.length - 1)) * 70);
    result.set(item.identityKey, score);
  });
  return result;
}

function buildEvidence(campaigns) {
  const byIdentity = new Map();
  const platformSet = new Set();
  const contentSet = new Set();
  const regionSet = new Set();

  for (const campaign of campaigns || []) {
    const { tracking } = parseCampaignTracking(campaign.notes);
    const postsByAssignment = new Map();
    (tracking.creatorPosts || []).forEach((post) => {
      const list = postsByAssignment.get(post.assignmentId) || [];
      list.push(post);
      postsByAssignment.set(post.assignmentId, list);
    });

    for (const assignment of tracking.creatorAssignments || []) {
      const identity = creatorIdentity(assignment);
      const current = byIdentity.get(identity.key) || {
        platforms:new Map(), contentTypes:new Map(), regions:new Set(), campaignIds:new Set(), activeCampaignIds:new Set(),
      };
      const region = text(assignment.region);
      if (region) { current.regions.add(region); regionSet.add(region); }
      current.campaignIds.add(campaign.id);
      if (!['COMPLETED','CANCELLED'].includes(upper(campaign.status)) && assignment.active !== false) current.activeCampaignIds.add(campaign.id);

      const assignmentPlatform = upper(assignment.platform || 'OTHER');
      platformSet.add(assignmentPlatform);
      const posts = (postsByAssignment.get(assignment.id) || []).filter(approved);
      posts.forEach((post) => {
        const platform = upper(post.platform || assignmentPlatform);
        const platformItem = current.platforms.get(platform) || { posts:0, reach:0, engagements:0 };
        platformItem.posts += 1;
        platformItem.reach += number(post.reach);
        platformItem.engagements += number(post.totalEngagements);
        current.platforms.set(platform, platformItem);
        platformSet.add(platform);

        const contentType = text(post.postType) || 'Unspecified';
        const contentItem = current.contentTypes.get(contentType) || { posts:0, reach:0, engagements:0 };
        contentItem.posts += 1;
        contentItem.reach += number(post.reach);
        contentItem.engagements += number(post.totalEngagements);
        current.contentTypes.set(contentType, contentItem);
        contentSet.add(contentType);
      });
      byIdentity.set(identity.key, current);
    }
  }

  return {
    byIdentity,
    platforms:[...platformSet].filter(Boolean).sort(),
    contentTypes:[...contentSet].sort((a, b) => a.localeCompare(b)),
    regions:[...regionSet].sort((a, b) => a.localeCompare(b)),
  };
}

function matchesType(item, type) {
  if (!type || type === 'ALL') return true;
  return item.creatorType === type || item.creatorType === 'MIXED';
}

function candidateReasons(candidate, criteria, cpvEfficiency, cpeEfficiency) {
  const reasons = [];
  if (criteria.platform !== 'ALL') reasons.push(`Proven Approved performance on ${criteria.platform}`);
  if (criteria.contentType !== 'ALL') reasons.push(`Approved ${criteria.contentType} delivery history`);
  if (candidate.portfolioScore >= 80) reasons.push('Strong cross-campaign portfolio score');
  if (candidate.averageDeliveryCompletion >= 90) reasons.push('High delivery completion');
  if (candidate.averageReachTargetAchievement >= 90) reasons.push('Strong reach-target achievement');
  if (candidate.campaignReliability >= 90) reasons.push('Reliable across tracked campaigns');
  if (cpvEfficiency >= 80 && candidate.approvedReach > 0) reasons.push('Efficient historical CPV');
  if (cpeEfficiency >= 80 && candidate.approvedEngagements > 0) reasons.push('Efficient historical CPE');
  if (candidate.campaignCount >= 3) reasons.push('Multi-campaign AKARI history');
  return [...new Set(reasons)].slice(0, 4);
}

function riskSignals(candidate, today) {
  const signals = [];
  const staleDays = daysSince(candidate.lastActiveDate, today);
  if (candidate.rejectionRate > 15) signals.push(`Rejected-post rate ${candidate.rejectionRate.toFixed(1)}%`);
  if (candidate.holdingRate > 20) signals.push(`Holding-post rate ${candidate.holdingRate.toFixed(1)}%`);
  if (candidate.averageDeliveryCompletion < 60 && candidate.expectedPosts > 0) signals.push('Delivery completion below 60%');
  if (candidate.identityConfidence === 'LOW') signals.push('Low-confidence cross-campaign identity');
  if (staleDays !== null && staleDays > 180) signals.push(`No tracked activity for ${staleDays} days`);
  if (candidate.activeCampaigns >= 3) signals.push(`${candidate.activeCampaigns} active campaigns — verify capacity`);
  return signals;
}

function recommendationScore(candidate, objective, cpvEfficiency, cpeEfficiency, today) {
  const quality = clamp(100 - candidate.rejectionRate - (candidate.holdingRate * 0.5));
  const recent = recencyScore(candidate.lastActiveDate, today);
  const experience = clamp(40 + (candidate.campaignCount * 15));
  const identity = candidate.identityConfidence === 'HIGH' ? 100 : candidate.identityConfidence === 'MEDIUM' ? 85 : 60;
  const portfolio = clamp(candidate.portfolioScore);
  const delivery = clamp(candidate.averageDeliveryCompletion);
  const reach = clamp(candidate.averageReachTargetAchievement);
  const reliability = clamp(candidate.campaignReliability);

  if (objective === 'REACH') {
    return clamp(portfolio * 0.25 + reach * 0.20 + cpvEfficiency * 0.20 + delivery * 0.10 + quality * 0.10 + recent * 0.05 + experience * 0.05 + identity * 0.05);
  }
  if (objective === 'ENGAGEMENT') {
    return clamp(portfolio * 0.25 + cpeEfficiency * 0.25 + quality * 0.15 + delivery * 0.10 + reach * 0.05 + recent * 0.05 + experience * 0.05 + identity * 0.05 + reliability * 0.05);
  }
  if (objective === 'RELIABILITY') {
    return clamp(delivery * 0.25 + reliability * 0.25 + quality * 0.20 + portfolio * 0.15 + recent * 0.05 + experience * 0.05 + identity * 0.05);
  }
  return clamp(portfolio * 0.35 + delivery * 0.15 + reach * 0.10 + ((cpvEfficiency + cpeEfficiency) / 2) * 0.15 + quality * 0.10 + recent * 0.05 + experience * 0.05 + identity * 0.05);
}

function normalizeCriteria(input = {}) {
  const objective = TALENT_OBJECTIVES.includes(upper(input.objective)) ? upper(input.objective) : 'BALANCED';
  const creatorType = TALENT_TYPES.includes(upper(input.creatorType)) ? upper(input.creatorType) : 'ALL';
  return {
    objective,
    platform:upper(input.platform) || 'ALL',
    creatorType,
    contentType:text(input.contentType) || 'ALL',
    region:text(input.region) || 'ALL',
    budgetUsd:number(input.budgetUsd),
    limit:Math.max(1, Math.min(25, Math.floor(number(input.limit) || 10))),
  };
}

function budgetBasket(items, budgetUsd) {
  if (!(budgetUsd > 0)) return { budgetUsd:0, estimatedHistoricalAllocation:0, remainingBudget:0, items:[], note:'Enter a planning budget to generate a historical allocation-fit basket.' };
  let remaining = budgetUsd;
  const selected = [];
  for (const item of items) {
    if (selected.length >= 8) break;
    const historicalAverageAllocation = item.campaignCount > 0 ? item.trackedAllocationValue / item.campaignCount : 0;
    if (!(historicalAverageAllocation > 0) || historicalAverageAllocation > remaining) continue;
    selected.push({
      identityKey:item.identityKey,
      name:item.name,
      handle:item.handle,
      creatorType:item.creatorType,
      recommendationScore:item.recommendationScore,
      historicalAverageAllocation,
      agencies:item.agencies,
    });
    remaining -= historicalAverageAllocation;
  }
  return {
    budgetUsd,
    estimatedHistoricalAllocation:budgetUsd - remaining,
    remainingBudget:remaining,
    items:selected,
    note:'Historical tracked allocations are planning signals only — not current quotes, commitments or proof of payment.',
  };
}

function partnerRecommendations(partnerPortfolio, talentItems) {
  const topTalent = talentItems.slice(0, 12);
  return (partnerPortfolio.items || []).map((partner) => {
    const matchedTalent = topTalent.filter((talent) => (talent.agencies || []).some((agency) => normalize(agency) === normalize(partner.partnerName)));
    const matchScore = clamp(matchedTalent.length * 20);
    const recommendationScore = clamp(partner.portfolioScore * 0.60 + matchScore * 0.25 + partner.campaignReliability * 0.15);
    return {
      partnerId:partner.partnerId,
      partnerName:partner.partnerName,
      partnerType:partner.partnerType,
      partnerStatus:partner.partnerStatus,
      recommendationScore,
      matchedTalent:matchedTalent.length,
      campaignCount:partner.campaignCount,
      portfolioScore:partner.portfolioScore,
      campaignReliability:partner.campaignReliability,
      averageDeliveryCompletion:partner.averageDeliveryCompletion,
      approvedReach:partner.approvedReach,
      lifetimeCpv:partner.lifetimeCpv,
      lifetimeCpe:partner.lifetimeCpe,
    };
  }).filter((item) => item.matchedTalent > 0 || item.portfolioScore >= 70)
    .sort((a, b) => b.recommendationScore - a.recommendationScore || b.matchedTalent - a.matchedTalent || String(a.partnerName).localeCompare(String(b.partnerName)))
    .slice(0, 5);
}

export function buildCampaignTalentRecommendations(campaigns = [], partners = [], input = {}, today = new Date().toISOString().slice(0, 10)) {
  const criteria = normalizeCriteria(input);
  const creatorPortfolio = buildCreatorKolPortfolio(campaigns, partners, today);
  const partnerPortfolio = buildDeliveryPartnerPortfolio(campaigns, partners, today);
  const evidence = buildEvidence(campaigns);

  let eligible = (creatorPortfolio.items || []).filter((item) => {
    const proof = evidence.byIdentity.get(item.identityKey);
    if (!matchesType(item, criteria.creatorType)) return false;
    if (criteria.platform !== 'ALL' && !proof?.platforms?.has(criteria.platform)) return false;
    if (criteria.contentType !== 'ALL' && !proof?.contentTypes?.has(criteria.contentType)) return false;
    if (criteria.region !== 'ALL') {
      const target = normalize(criteria.region);
      if (![...(proof?.regions || [])].some((region) => normalize(region) === target)) return false;
    }
    return item.approvedPosts > 0 || item.campaignCount > 0;
  });

  const cpvMap = efficiencyScores(eligible, 'lifetimeCpv');
  const cpeMap = efficiencyScores(eligible, 'lifetimeCpe');

  eligible = eligible.map((item) => {
    const proof = evidence.byIdentity.get(item.identityKey);
    const cpvEfficiency = cpvMap.get(item.identityKey) || 40;
    const cpeEfficiency = cpeMap.get(item.identityKey) || 40;
    const score = recommendationScore(item, criteria.objective, cpvEfficiency, cpeEfficiency, today);
    const platformEvidence = criteria.platform !== 'ALL' ? proof?.platforms?.get(criteria.platform) || null : null;
    const contentEvidence = criteria.contentType !== 'ALL' ? proof?.contentTypes?.get(criteria.contentType) || null : null;
    return {
      ...item,
      recommendationScore:score,
      cpvEfficiencyScore:cpvEfficiency,
      cpeEfficiencyScore:cpeEfficiency,
      recommendationReasons:candidateReasons(item, criteria, cpvEfficiency, cpeEfficiency),
      riskSignals:riskSignals(item, today),
      platformEvidence,
      contentEvidence,
      regions:[...(proof?.regions || [])].sort((a, b) => a.localeCompare(b)),
      historicalAverageAllocation:item.campaignCount > 0 ? item.trackedAllocationValue / item.campaignCount : 0,
    };
  }).sort((a, b) => b.recommendationScore - a.recommendationScore || b.portfolioScore - a.portfolioScore || b.approvedReach - a.approvedReach || String(a.name).localeCompare(String(b.name)));

  const recommendations = eligible.slice(0, criteria.limit);
  const underusedReliable = (creatorPortfolio.items || [])
    .filter((item) => item.approvedPosts > 0 && item.campaignCount <= 2 && item.portfolioScore >= 70 && item.campaignReliability >= 80)
    .sort((a, b) => b.portfolioScore - a.portfolioScore || b.approvedReach - a.approvedReach)
    .slice(0, 6)
    .map((item) => ({ identityKey:item.identityKey, name:item.name, handle:item.handle, creatorType:item.creatorType, campaignCount:item.campaignCount, portfolioScore:item.portfolioScore, campaignReliability:item.campaignReliability, approvedReach:item.approvedReach }));

  const spendWithoutDelivery = (creatorPortfolio.items || [])
    .filter((item) => item.trackedAllocationValue > 0 && (item.approvedPosts === 0 || (item.expectedPosts > 0 && item.averageDeliveryCompletion < 50)))
    .sort((a, b) => b.trackedAllocationValue - a.trackedAllocationValue)
    .slice(0, 6)
    .map((item) => ({ identityKey:item.identityKey, name:item.name, handle:item.handle, trackedAllocationValue:item.trackedAllocationValue, approvedPosts:item.approvedPosts, averageDeliveryCompletion:item.averageDeliveryCompletion, rejectionRate:item.rejectionRate }));

  const mostUsed = [...(creatorPortfolio.items || [])]
    .sort((a, b) => b.campaignCount - a.campaignCount || b.approvedReach - a.approvedReach)
    .slice(0, 6)
    .map((item) => ({ identityKey:item.identityKey, name:item.name, handle:item.handle, creatorType:item.creatorType, campaignCount:item.campaignCount, approvedReach:item.approvedReach, portfolioScore:item.portfolioScore }));

  return {
    criteria,
    eligibleCount:eligible.length,
    recommendations,
    basket:budgetBasket(eligible, criteria.budgetUsd),
    partnerRecommendations:partnerRecommendations(partnerPortfolio, recommendations),
    insights:{ underusedReliable, spendWithoutDelivery, mostUsed },
    facets:{
      objectives:TALENT_OBJECTIVES,
      creatorTypes:TALENT_TYPES,
      platforms:['ALL', ...evidence.platforms],
      contentTypes:['ALL', ...evidence.contentTypes],
      regions:['ALL', ...evidence.regions],
    },
    methodology:{
      approvedOnly:true,
      deterministic:true,
      rankingVersion:'R8.5E-1',
      notes:[
        'Only Approved creator/KOL posts contribute to measured reach and engagement performance.',
        'Recommendation scores combine historical portfolio performance, delivery, quality, efficiency, recency, experience and identity confidence.',
        'Active-campaign counts are workload signals only and do not prove availability.',
        'Budget baskets use historical tracked allocation averages and are not quotes or payment records.',
      ],
    },
  };
}
