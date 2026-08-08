import { parseCampaignTracking } from './campaign-tracking.js';
import { buildDeliveryPartnerPerformance } from './campaign-delivery-partner-performance.js';

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const clamp = (value) => Math.max(0, Math.min(100, number(value)));
const dateOnly = (value) => {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const laterDate = (current, candidate) => {
  const next = dateOnly(candidate);
  if (!next) return current;
  return !current || next > current ? next : current;
};
const contributorKey = (assignment) => {
  const raw = assignment.profileUrl || assignment.handle || assignment.name || assignment.id || '';
  return String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
};

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

export function buildDeliveryPartnerPortfolio(campaigns = [], partners = [], today = new Date().toISOString().slice(0, 10)) {
  const resultByPartner = new Map((partners || []).map((partner) => [partner.id, {
    partnerId:partner.id,
    partnerName:partner.name,
    partnerType:partner.partner_type || null,
    partnerStatus:partner.status || null,
    website:partner.website || null,
    xUrl:partner.x_url || null,
    contactName:partner.contact_name || null,
    activeCampaigns:0,
    completedCampaigns:0,
    campaignCount:0,
    approvedPosts:0,
    approvedReach:0,
    approvedEngagements:0,
    totalCashSpend:0,
    totalTokenAllocation:0,
    totalEstimatedTokenCost:0,
    totalCampaignCost:0,
    holdingPosts:0,
    rejectedPosts:0,
    submittedPosts:0,
    sorsaTotal:0,
    sorsaCount:0,
    xScoreTotal:0,
    xScoreCount:0,
    deliveryTotal:0,
    deliveryCount:0,
    reachTotal:0,
    reachCount:0,
    reliableCampaigns:0,
    reliabilityCampaigns:0,
    lastActiveDate:null,
    contributorKeys:new Set(),
    creatorKeys:new Set(),
    kolKeys:new Set(),
  }]));

  let legacyUnmappedAssignments = 0;
  const legacyUnmappedCampaigns = new Set();

  for (const campaign of campaigns || []) {
    const { tracking } = parseCampaignTracking(campaign.notes);
    const performance = buildDeliveryPartnerPerformance(campaign.notes, partners);
    const assignments = (tracking.creatorAssignments || []).filter((item) => item.active !== false);
    const assignmentByPartner = new Map();

    assignments.forEach((assignment) => {
      if (!assignment.agencyPartnerId) {
        if (assignment.agencyName) {
          legacyUnmappedAssignments += 1;
          legacyUnmappedCampaigns.add(campaign.id);
        }
        return;
      }
      const list = assignmentByPartner.get(assignment.agencyPartnerId) || [];
      list.push(assignment);
      assignmentByPartner.set(assignment.agencyPartnerId, list);
    });

    for (const campaignPartner of (performance.items || []).filter((item) => item.partnerId)) {
      const current = resultByPartner.get(campaignPartner.partnerId);
      if (!current) continue;

      current.campaignCount += 1;
      if (String(campaign.status || '').toUpperCase() === 'COMPLETED') current.completedCampaigns += 1;
      else if (String(campaign.status || '').toUpperCase() !== 'CANCELLED') current.activeCampaigns += 1;

      current.approvedPosts += number(campaignPartner.approvedPosts);
      current.approvedReach += number(campaignPartner.approvedReach);
      current.approvedEngagements += number(campaignPartner.approvedEngagements);
      current.totalCashSpend += number(campaignPartner.allocatedUsd);
      current.totalTokenAllocation += number(campaignPartner.allocatedTokens);
      current.totalEstimatedTokenCost += number(campaignPartner.tokenCost);
      current.totalCampaignCost += number(campaignPartner.totalCost);
      current.holdingPosts += number(campaignPartner.holdingPosts);
      current.rejectedPosts += number(campaignPartner.rejectedPosts);
      current.submittedPosts += number(campaignPartner.submittedPosts);
      current.sorsaTotal += number(campaignPartner.sorsaTotal);
      current.sorsaCount += number(campaignPartner.sorsaCount);
      current.xScoreTotal += number(campaignPartner.xScoreTotal);
      current.xScoreCount += number(campaignPartner.xScoreCount);

      if (number(campaignPartner.expectedPosts) > 0) {
        current.deliveryTotal += clamp(campaignPartner.deliveryCompletion);
        current.deliveryCount += 1;
        const campaignRejectionRate = number(campaignPartner.submittedPosts) > 0
          ? number(campaignPartner.rejectedPosts) / number(campaignPartner.submittedPosts)
          : 0;
        current.reliabilityCampaigns += 1;
        if (clamp(campaignPartner.deliveryCompletion) >= 80 && campaignRejectionRate <= 0.10) current.reliableCampaigns += 1;
      }
      if (number(campaignPartner.expectedReach) > 0) {
        current.reachTotal += clamp(campaignPartner.reachCompletion);
        current.reachCount += 1;
      }

      const linkedAssignments = assignmentByPartner.get(campaignPartner.partnerId) || [];
      const linkedIds = new Set(linkedAssignments.map((assignment) => assignment.id));
      linkedAssignments.forEach((assignment) => {
        const key = contributorKey(assignment);
        if (!key) return;
        current.contributorKeys.add(key);
        if (String(assignment.creatorType || 'CREATOR').toUpperCase() === 'KOL') current.kolKeys.add(key);
        else current.creatorKeys.add(key);
      });

      (tracking.creatorPosts || []).filter((post) => linkedIds.has(post.assignmentId)).forEach((post) => {
        current.lastActiveDate = laterDate(current.lastActiveDate, post.dataDate);
      });
      current.lastActiveDate = laterDate(current.lastActiveDate,
        String(campaign.status || '').toUpperCase() === 'COMPLETED'
          ? campaign.end_date || campaign.start_date
          : campaign.start_date);
    }
  }

  const rankOrder = { TOP_PERFORMING:0, RELIABLE:1, NEEDS_ATTENTION:2, UNDERPERFORMING:3, INACTIVE:4 };
  const items = [...resultByPartner.values()].map((item) => {
    const averageDeliveryCompletion = item.deliveryCount ? item.deliveryTotal / item.deliveryCount : 0;
    const averageReachTargetAchievement = item.reachCount ? item.reachTotal / item.reachCount : 0;
    const holdingRate = item.submittedPosts ? item.holdingPosts / item.submittedPosts : 0;
    const rejectionRate = item.submittedPosts ? item.rejectedPosts / item.submittedPosts : 0;
    const campaignReliability = item.reliabilityCampaigns ? (item.reliableCampaigns / item.reliabilityCampaigns) * 100 : 0;
    const approvalQuality = clamp(100 - (rejectionRate * 100) - (holdingRate * 50));
    const portfolioScore = clamp(
      averageDeliveryCompletion * 0.35 +
      averageReachTargetAchievement * 0.25 +
      approvalQuality * 0.20 +
      campaignReliability * 0.20
    );
    const publicItem = {
      partnerId:item.partnerId,
      partnerName:item.partnerName,
      partnerType:item.partnerType,
      partnerStatus:item.partnerStatus,
      website:item.website,
      xUrl:item.xUrl,
      contactName:item.contactName,
      activeCampaigns:item.activeCampaigns,
      completedCampaigns:item.completedCampaigns,
      campaignCount:item.campaignCount,
      lifetimeContributors:item.contributorKeys.size,
      creatorCount:item.creatorKeys.size,
      kolCount:item.kolKeys.size,
      approvedPosts:item.approvedPosts,
      approvedReach:item.approvedReach,
      approvedEngagements:item.approvedEngagements,
      totalCashSpend:item.totalCashSpend,
      totalTokenAllocation:item.totalTokenAllocation,
      totalEstimatedTokenCost:item.totalEstimatedTokenCost,
      totalCampaignCost:item.totalCampaignCost,
      averageDeliveryCompletion,
      averageReachTargetAchievement,
      averageSorsaScore:item.sorsaCount ? item.sorsaTotal / item.sorsaCount : 0,
      averageXScore:item.xScoreCount ? item.xScoreTotal / item.xScoreCount : 0,
      lifetimeCpv:item.approvedReach ? item.totalCampaignCost / item.approvedReach : 0,
      lifetimeCpe:item.approvedEngagements ? item.totalCampaignCost / item.approvedEngagements : 0,
      holdingRate:holdingRate * 100,
      rejectionRate:rejectionRate * 100,
      campaignReliability,
      lastActiveDate:item.lastActiveDate,
      portfolioScore,
    };
    return { ...publicItem, classification:classification(publicItem, today) };
  }).sort((a, b) =>
    (rankOrder[a.classification] - rankOrder[b.classification]) ||
    (b.portfolioScore - a.portfolioScore) ||
    (b.approvedReach - a.approvedReach) ||
    String(a.partnerName).localeCompare(String(b.partnerName))
  );

  return {
    partnerCount:items.length,
    partnersWithCampaignHistory:items.filter((item) => item.campaignCount > 0).length,
    activePartners:items.filter((item) => item.activeCampaigns > 0).length,
    topPerforming:items.filter((item) => item.classification === 'TOP_PERFORMING').length,
    reliable:items.filter((item) => item.classification === 'RELIABLE').length,
    needsAttention:items.filter((item) => ['NEEDS_ATTENTION','UNDERPERFORMING'].includes(item.classification)).length,
    inactive:items.filter((item) => item.classification === 'INACTIVE').length,
    totalApprovedPosts:items.reduce((sum, item) => sum + item.approvedPosts, 0),
    totalApprovedReach:items.reduce((sum, item) => sum + item.approvedReach, 0),
    totalApprovedEngagements:items.reduce((sum, item) => sum + item.approvedEngagements, 0),
    totalCampaignCost:items.reduce((sum, item) => sum + item.totalCampaignCost, 0),
    legacyUnmappedAssignments,
    legacyUnmappedCampaigns:legacyUnmappedCampaigns.size,
    items,
  };
}
