import { test, expect } from '@playwright/test';

function intelligenceFor(url) {
  const parsed=new URL(url);
  const objective=parsed.searchParams.get('objective')||'BALANCED';
  const platform=parsed.searchParams.get('platform')||'ALL';
  const creatorType=parsed.searchParams.get('creatorType')||'ALL';
  const contentType=parsed.searchParams.get('contentType')||'ALL';
  const region=parsed.searchParams.get('region')||'ALL';
  const budgetUsd=Number(parsed.searchParams.get('budgetUsd')||0);
  const recommendationReasons=['Strong cross-campaign portfolio score','High delivery completion','Reliable across tracked campaigns'];
  if (platform!=='ALL') recommendationReasons.unshift(`Proven Approved performance on ${platform}`);
  if (contentType!=='ALL') recommendationReasons.unshift(`Approved ${contentType} delivery history`);
  return {
    criteria:{ objective,platform,creatorType,contentType,region,budgetUsd,limit:10 },
    eligibleCount:1,
    recommendations:[{
      identityKey:'social:X:alice',identityConfidence:'HIGH',name:'Alice Creator',handle:'@alice',creatorType:'CREATOR',platforms:['X'],agencies:['Agency One'],
      campaignCount:3,activeCampaigns:1,approvedPosts:6,approvedReach:25000,approvedEngagements:1800,expectedPosts:6,
      averageDeliveryCompletion:100,averageReachTargetAchievement:110,campaignReliability:100,rejectionRate:0,holdingRate:0,
      portfolioScore:96,recommendationScore:94,lifetimeCpv:0.03,lifetimeCpe:0.42,trackedAllocationValue:750,historicalAverageAllocation:250,
      recommendationReasons,riskSignals:[],
      platformEvidence:platform==='X'?{posts:6,reach:25000,engagements:1800}:null,
      contentEvidence:contentType==='Thread'?{posts:4,reach:20000,engagements:1500}:null,
    }],
    basket:{ budgetUsd,estimatedHistoricalAllocation:budgetUsd?250:0,remainingBudget:budgetUsd?Math.max(0,budgetUsd-250):0,items:budgetUsd?[{identityKey:'social:X:alice',name:'Alice Creator',handle:'@alice',creatorType:'CREATOR',recommendationScore:94,historicalAverageAllocation:250,agencies:['Agency One']}]:[],note:'Historical tracked allocations are planning signals only.' },
    partnerRecommendations:[{partnerId:'p1',partnerName:'Agency One',partnerType:'CREATOR_AGENCY',partnerStatus:'ACTIVE',recommendationScore:91,matchedTalent:1,campaignCount:4,portfolioScore:90,campaignReliability:100,averageDeliveryCompletion:96,approvedReach:50000,lifetimeCpv:0.04,lifetimeCpe:0.5}],
    insights:{
      underusedReliable:[{identityKey:'social:X:alice',name:'Alice Creator',handle:'@alice',creatorType:'CREATOR',campaignCount:2,portfolioScore:90,campaignReliability:100,approvedReach:25000}],
      spendWithoutDelivery:[{identityKey:'social:X:risk',name:'Risk Creator',handle:'@risk',trackedAllocationValue:900,approvedPosts:0,averageDeliveryCompletion:0,rejectionRate:20}],
      mostUsed:[{identityKey:'social:X:alice',name:'Alice Creator',handle:'@alice',creatorType:'CREATOR',campaignCount:3,approvedReach:25000,portfolioScore:96}],
    },
    facets:{objectives:['BALANCED','REACH','ENGAGEMENT','RELIABILITY'],creatorTypes:['ALL','CREATOR','KOL'],platforms:['ALL','X','INSTAGRAM'],contentTypes:['ALL','Thread','Video'],regions:['ALL','EMEA','APAC']},
    methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1',notes:[]},
  };
}

function responseFor(url) {
  const parsed=new URL(url);
  if (parsed.pathname==='/api/me') return { user:{ userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true } };
  if (parsed.pathname==='/api/dashboard') return { currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:1,outstandingPayments:0,referralRewardsDue:0} };
  if (parsed.pathname==='/api/tasks') return {items:[],total:0};
  if (parsed.pathname==='/api/opportunities') return {items:[],total:0};
  if (parsed.pathname==='/api/akari-leads') return {items:[],total:0,categories:[],canWrite:true};
  if (parsed.pathname==='/api/campaigns') return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-31',currency:'USD'}],total:1};
  if (parsed.pathname==='/api/creator-kol-intelligence') return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if (parsed.pathname==='/api/delivery-partner-intelligence') return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if (parsed.pathname==='/api/campaign-talent-recommendations') return {intelligence:intelligenceFor(url)};
  if (parsed.pathname==='/api/service-delivery') return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async ({page})=>{
  await page.clock.setFixedTime(new Date('2026-08-08T10:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{
    const request=route.request();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url()))});
  });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('Campaigns renders and refreshes Campaign Talent Recommendation Intelligence',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.campaign-talent-r55');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Recommendation intelligence')).toBeVisible();
  await expect(panel.getByText('Alice Creator')).toBeVisible();
  await expect(panel.getByText('Agency One')).toBeVisible();
  await expect(panel.getByText('Spend without delivery')).toBeVisible();
  await expect(panel.getByText('Risk Creator')).toBeVisible();

  await panel.locator('[data-r55-field="objective"]').selectOption('REACH');
  await panel.locator('[data-r55-field="platform"]').selectOption('X');
  await panel.locator('[data-r55-field="contentType"]').selectOption('Thread');
  await panel.locator('[data-r55-field="region"]').selectOption('EMEA');
  await panel.locator('[data-r55-field="budgetUsd"]').fill('1000');
  await panel.getByRole('button',{name:'Generate shortlist'}).click();

  const method=panel.locator('.talent-method-r55');
  await expect(method.getByText('Reach')).toBeVisible();
  await expect(method.getByText('X')).toBeVisible();
  await expect(panel.getByText('$1,000 planning budget')).toBeVisible();
  await expect(panel.getByText('$250').first()).toBeVisible();
  await panel.getByText('Why this rank').click();
  await expect(panel.getByText('Approved Thread delivery history')).toBeVisible();
});
