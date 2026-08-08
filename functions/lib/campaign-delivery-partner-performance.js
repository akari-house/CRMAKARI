import { parseCampaignTracking } from './campaign-tracking.js';

const number = (value) => { const parsed=Number(value); return Number.isFinite(parsed)&&parsed>=0?parsed:0; };
const approved = (post) => !post.status || post.status === 'APPROVED';

export function buildDeliveryPartnerPerformance(notes, partners = []) {
  const { tracking } = parseCampaignTracking(notes);
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const postsByAssignment = new Map();
  (tracking.creatorPosts || []).forEach((post) => {
    const list=postsByAssignment.get(post.assignmentId)||[]; list.push(post); postsByAssignment.set(post.assignmentId,list);
  });
  const tokenPrice = number(tracking.overview?.currentTokenPrice || tracking.overview?.tokenListingPrice);
  const map = new Map();
  (tracking.creatorAssignments || []).filter((item)=>item.active!==false).forEach((assignment) => {
    const partner = assignment.agencyPartnerId ? partnerById.get(assignment.agencyPartnerId) : null;
    const key = assignment.agencyPartnerId || (assignment.agencyName ? `legacy:${assignment.agencyName}` : 'direct');
    const name = partner?.name || assignment.agencyName || 'Direct / Unassigned';
    const current = map.get(key) || {
      partnerId:partner?.id||null, partnerName:name, partnerType:partner?.partner_type||null, partnerStatus:partner?.status||null,
      legacy:!partner?.id && Boolean(assignment.agencyName), direct:!partner?.id && !assignment.agencyName,
      contributorCount:0, creatorCount:0, kolCount:0, contributorNames:[], expectedPosts:0, submittedPosts:0, approvedPosts:0,
      holdingPosts:0, rejectedPosts:0, expectedReach:0, approvedReach:0, approvedEngagements:0, allocatedUsd:0, allocatedTokens:0,
      sorsaTotal:0, sorsaCount:0, xScoreTotal:0, xScoreCount:0,
    };
    current.contributorCount += 1;
    if (assignment.creatorType === 'KOL') current.kolCount += 1; else current.creatorCount += 1;
    current.contributorNames.push(assignment.name || assignment.handle || 'Contributor');
    current.expectedPosts += number(assignment.expectedPosts);
    current.expectedReach += number(assignment.expectedReach);
    current.allocatedUsd += number(assignment.allocatedUsd);
    current.allocatedTokens += number(assignment.allocatedTokens);
    if (number(assignment.sorsaScore)>0) { current.sorsaTotal+=number(assignment.sorsaScore); current.sorsaCount+=1; }
    if (number(assignment.xScore)>0) { current.xScoreTotal+=number(assignment.xScore); current.xScoreCount+=1; }
    const posts=postsByAssignment.get(assignment.id)||[];
    current.submittedPosts += posts.length;
    current.approvedPosts += posts.filter(approved).length;
    current.holdingPosts += posts.filter((post)=>post.status==='HOLDING').length;
    current.rejectedPosts += posts.filter((post)=>post.status==='REJECTED').length;
    current.approvedReach += posts.filter(approved).reduce((sum,post)=>sum+number(post.reach),0);
    current.approvedEngagements += posts.filter(approved).reduce((sum,post)=>sum+number(post.totalEngagements),0);
    map.set(key,current);
  });
  const items=[...map.values()].map((item)=>{
    const tokenCost=item.allocatedTokens*tokenPrice;
    const totalCost=item.allocatedUsd+tokenCost;
    return {
      ...item,
      tokenPrice,
      tokenCost,
      totalCost,
      averageSorsaScore:item.sorsaCount?item.sorsaTotal/item.sorsaCount:0,
      averageXScore:item.xScoreCount?item.xScoreTotal/item.xScoreCount:0,
      deliveryCompletion:item.expectedPosts>0?Math.min(100,(item.approvedPosts/item.expectedPosts)*100):0,
      reachCompletion:item.expectedReach>0?Math.min(100,(item.approvedReach/item.expectedReach)*100):0,
      costPerView:item.approvedReach>0?totalCost/item.approvedReach:0,
      costPerEngagement:item.approvedEngagements>0?totalCost/item.approvedEngagements:0,
    };
  }).sort((a,b)=>b.approvedReach-a.approvedReach);
  const partnerItems=items.filter((item)=>!item.direct);
  return {
    tokenPrice,
    partnerCount:partnerItems.filter((item)=>item.partnerId).length,
    legacyUnmappedCount:partnerItems.filter((item)=>item.legacy).length,
    totalContributors:partnerItems.reduce((sum,item)=>sum+item.contributorCount,0),
    totalApprovedPosts:partnerItems.reduce((sum,item)=>sum+item.approvedPosts,0),
    totalApprovedReach:partnerItems.reduce((sum,item)=>sum+item.approvedReach,0),
    totalApprovedEngagements:partnerItems.reduce((sum,item)=>sum+item.approvedEngagements,0),
    totalCashCost:partnerItems.reduce((sum,item)=>sum+item.allocatedUsd,0),
    totalTokenCost:partnerItems.reduce((sum,item)=>sum+item.tokenCost,0),
    totalCost:partnerItems.reduce((sum,item)=>sum+item.totalCost,0),
    items,
  };
}
