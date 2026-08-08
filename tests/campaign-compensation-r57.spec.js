import { test, expect } from '@playwright/test';

let compensation;
let planItems;

function recommendation(){return {identityKey:'social:X:alice',identityConfidence:'HIGH',name:'Alice Creator',handle:'@alice',creatorType:'CREATOR',platforms:['X'],agencies:['Direct / Unassigned'],regions:['EMEA'],approvedPosts:6,approvedReach:25000,averageDeliveryCompletion:100,campaignReliability:100,historicalAverageAllocation:250,recommendationScore:94,recommendationReasons:['Proven Approved performance on X'],riskSignals:[]};}
function planning(){return {status:'DRAFT',objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,notes:'Launch plan',selections:[],compensation};}
function planningSummary(){const cash=planItems.reduce((sum,item)=>sum+Number(item.allocatedUsd||0),0);const bonus=compensation.enabled?Number(compensation.bonusPoolUsdt||0):0;const total=cash+bonus;return {status:'DRAFT',effectiveStatus:'DRAFT',approvalDrift:false,currentFingerprint:'r8.5f-test',approvedFingerprint:null,talentCount:planItems.length,creatorCount:1,kolCount:0,partnerCount:0,plannedPosts:2,plannedReach:10000,cashAllocation:cash,tokenAllocation:0,tokenPrice:0.5,estimatedTokenValue:0,reservedBonusPoolUsd:bonus,estimatedPlanCost:total,budgetUsd:1000,remainingBudget:1000-total,budgetUtilization:total/10,budgetReconciled:total<=1000,compensationEnabled:compensation.enabled,compensationCalculationCurrent:compensation.lastAppliedFingerprint==='r8.5g-test'};}
function planningPayload(){return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-01',endDate:'2026-08-31',overview:{currentTokenPrice:0.5},planning:planning(),summary:planningSummary(),planItems:[...planItems]},recommendations:{criteria:{objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000},eligibleCount:0,recommendations:[],partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED','REACH'],creatorTypes:['ALL','CREATOR','KOL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}},deliveryPartners:[],permissions:{canWrite:true,canManage:true},methodology:{approvedSnapshot:true,driftDetection:true,recommendationVersion:'R8.5E-1'}};}
function compPayload(){
  const input=compensation.talentInputs[0];
  const verified=Boolean(input.metricsVerified);
  const calculation=verified?{assignmentId:'cca_1',rank:1,selectionScore:1,platformScore:1,postingCommitmentScore:1,engagementCommitmentScore:1,payoutUsdt:100,payoutPercent:40}:null;
  const current=compensation.lastAppliedFingerprint==='r8.5g-test';
  return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-01',endDate:'2026-08-31',planningStatus:'DRAFT',planningBudgetUsd:1000,compensation:{...compensation},summary:{enabled:true,currency:'USDT',engineVersion:'R8.5G-1',activeTalentCount:1,includedTalentCount:1,verifiedTalentCount:verified?1:0,unsupportedTalentCount:0,budgetUsdt:300,baseBudgetUsdt:250,bonusPoolUsdt:50,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:25,calculatedBaseAllocationUsdt:verified?100:0,unallocatedBaseUsdt:verified?150:250,calculationCurrent:current,currentFingerprint:'r8.5g-current',lastAppliedFingerprint:compensation.lastAppliedFingerprint||null,lastAppliedAt:compensation.lastAppliedAt||null,lastAppliedBy:compensation.lastAppliedBy||null,calculationError:verified?null:'Alice Creator has unverified compensation metrics',calculation:verified?{version:'R8.5G-1',currency:'USDT',baseBudgetUsdt:250,bonusPoolUsdt:50,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:25,budgetFactor:1,totalAllocatedUsdt:100,unallocatedBaseUsdt:150,items:[calculation]}:null},planSummary:planningSummary(),talent:planItems.map((item)=>({...item,compensationInput:{...input},calculation,lastApplied:current?calculation:null,supportedByEngine:true}))},permissions:{canWrite:true,canManage:true},methodology:{engineVersion:'R8.5G-1',currency:'USDT',usdtPlanningRate:1,supportedPlatforms:['X','YOUTUBE','TIKTOK','INSTAGRAM'],postingCadences:['ONE_TIME','WEEKLY_3','DAILY'],engagementActions:['COMMENT','LIKE','REPOST','BOOKMARK'],xPlatformFormula:{followers:40,xScore:30,sorsaScore:30},finalSelectionFormula:{platformScore:70,postingCommitment:20,engagementCommitment:10},percentileRelativeToCampaignRoster:true,baseBudgetExcludesReservedBonusPool:true,strongestVerifiedTalentCanReachConfiguredCeiling:true,proportionalBudgetScaling:true,allocationIsPaymentEvidence:false}};
}

function responseFor(url,request){
  const parsed=new URL(url);
  if(parsed.pathname==='/api/me')return {user:{userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(parsed.pathname==='/api/dashboard')return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(parsed.pathname==='/api/tasks')return {items:[],total:0};
  if(parsed.pathname==='/api/opportunities')return {items:[],total:0};
  if(parsed.pathname==='/api/akari-leads')return {items:[],total:0,categories:[],canWrite:true};
  if(parsed.pathname==='/api/campaigns')return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-31',currency:'USD'}],total:1};
  if(parsed.pathname==='/api/campaign-talent-recommendations')return {intelligence:{criteria:{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},eligibleCount:1,recommendations:[recommendation()],basket:{budgetUsd:0,items:[]},partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED','REACH','ENGAGEMENT','RELIABILITY'],creatorTypes:['ALL','CREATOR','KOL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}}};
  if(parsed.pathname==='/api/creator-kol-intelligence')return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if(parsed.pathname==='/api/delivery-partner-intelligence')return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if(parsed.pathname==='/api/campaign-planning/cam_1')return planningPayload();
  if(parsed.pathname==='/api/campaign-compensation/cam_1'){
    if(request.method()==='PATCH'){
      const body=request.postDataJSON();
      if(body.action==='upsert-talent-input'){
        compensation={...compensation,talentInputs:[{...compensation.talentInputs[0],...body.input,assignmentId:'cca_1',metricsVerified:false,verificationNote:'',verifiedAt:null,verifiedBy:null}]};
      }
      if(body.action==='verify-talent-metrics'){
        compensation={...compensation,talentInputs:[{...compensation.talentInputs[0],metricsVerified:true,verificationNote:body.note,verifiedAt:'2026-08-08T20:01:00Z',verifiedBy:'usr_owner'}]};
      }
      if(body.action==='apply-calculation'){
        planItems=planItems.map((item)=>({...item,allocatedUsd:100}));
        compensation={...compensation,lastAppliedFingerprint:'r8.5g-test',lastAppliedAt:'2026-08-08T20:02:00Z',lastAppliedBy:'usr_owner',lastResult:{version:'R8.5G-1',appliedAt:'2026-08-08T20:02:00Z',appliedBy:'usr_owner',baseBudgetUsdt:250,bonusPoolUsdt:50,totalAllocatedUsdt:100,unallocatedBaseUsdt:150,budgetFactor:1,items:[{assignmentId:'cca_1',rank:1,selectionScore:1,platformScore:1,postingCommitmentScore:1,engagementCommitmentScore:1,payoutUsdt:100,payoutPercent:40}]}};
      }
      if(body.action==='update-compensation')compensation={...compensation,...body.compensation};
    }
    return compPayload();
  }
  if(parsed.pathname==='/api/service-delivery')return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async({page})=>{
  planItems=[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',profileUrl:'https://x.com/alice',agencyPartnerId:null,agencyName:'',category:'Thread',region:'EMEA',sorsaScore:720,xScore:780,expectedPosts:2,expectedReach:10000,allocatedUsd:0,allocatedTokens:0,tgeUnlockPercent:0,cliffMonths:0,vestingMonths:0,notes:'',active:true}];
  compensation={enabled:true,currency:'USDT',budgetUsdt:300,bonusPoolUsdt:50,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:25,platformWeights:{X:100,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},postingCadence:'WEEKLY_3',dailyEngagementRequired:true,engagementActions:['COMMENT','LIKE'],talentInputs:[{assignmentId:'cca_1',included:true,selectedPlatforms:['X'],followers:{X:10000,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},postingDays:[1,3,5],engagementAccepted:true,metricsVerified:false,verificationNote:'',verifiedAt:null,verifiedBy:null}],lastAppliedFingerprint:null,lastAppliedAt:null,lastAppliedBy:null,lastResult:{items:[]}};
  await page.clock.setFixedTime(new Date('2026-08-08T20:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{const request=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request))});});
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('AKARI USDT compensation verifies metrics and applies a budget-safe allocation',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.campaign-compensation-r57');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('AKARI USDT Allocation Intelligence')).toBeVisible();
  await expect(panel.getByText('Alice Creator has unverified compensation metrics')).toBeVisible();

  await panel.locator('[data-comp-talent="cca_1"] [data-metrics]').click();
  const metricsModal=page.locator('.campaign-comp-modal-r57');
  await metricsModal.getByLabel('X followers').fill('100000');
  await metricsModal.locator('input[name="postingDay"][value="1"]').check();
  await metricsModal.locator('input[name="postingDay"][value="3"]').check();
  await metricsModal.locator('input[name="postingDay"][value="5"]').check();
  await metricsModal.getByRole('button',{name:'Save metrics'}).click();

  await panel.locator('[data-comp-talent="cca_1"] [data-verify]').click();
  const verifyModal=page.locator('.campaign-comp-modal-r57');
  await verifyModal.getByLabel('Verification note').fill('Checked X followers, XScore and Sorsa against current profile metrics.');
  await verifyModal.getByRole('button',{name:'Verify metrics'}).click();
  await expect(panel.locator('[data-comp-talent="cca_1"]').getByText('Verified',{exact:true})).toBeVisible();
  await expect(panel.locator('[data-comp-talent="cca_1"]').getByText('100 USDT')).toBeVisible();

  await panel.getByRole('button',{name:'Calculate & apply USDT allocations'}).click();
  await expect(panel.locator('.campaign-comp-status-r57').getByText('Calculation Current')).toBeVisible();
  await expect(panel.locator('[data-comp-talent="cca_1"]').getByText('$100')).toBeVisible();
  await expect(panel.getByText('Reserved bonus')).toBeVisible();
  await expect(panel.getByText('50 USDT')).toBeVisible();
  await expect(panel.getByText('40% follower percentile + 30% XScore percentile + 30% Sorsa percentile.')).toBeVisible();
  await expect(panel.getByText(/not proof that a Creator\/KOL was paid/i)).toBeVisible();
});
