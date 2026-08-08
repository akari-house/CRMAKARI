import { test, expect } from '@playwright/test';

let approved=false;
let paid=0;

function settlementPayload(){
  const paymentStatus=!approved?'NOT_APPROVED':paid>=150?'PAID':paid>0?'PARTIALLY_PAID':'DUE';
  const payments=paid>0?[{id:'csp_1',assignmentId:'cca_1',amountUsdt:paid,paidAt:'2026-08-08',method:'USDT_ONCHAIN',reference:'0xsettlement123',note:'Test payment',recordedAt:'2026-08-08T20:10:00Z',recordedBy:'usr_owner',voidedAt:null}]:[];
  return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-01',endDate:'2026-08-31',planningStatus:'APPROVED',summary:{version:'R8.5H-1',governanceReady:true,planningStatus:'APPROVED',planningApprovalDrift:false,compensationCalculationCurrent:true,bonusPoolUsdt:100,maximumBonusPerTalentUsdt:50,talentCount:1,baseReadyCount:1,bonusEligibleCount:1,plannedBaseUsdt:100,recommendedBonusUsdt:50,approvedBaseUsdt:approved?100:0,approvedBonusUsdt:approved?50:0,paidUsdt:paid,outstandingUsdt:approved?150-paid:0,disputedCount:0,driftCount:0,paidCount:paymentStatus==='PAID'?1:0},talent:[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',approvedPosts:2,holdingPosts:0,rejectedPosts:0,expectedPosts:2,approvedReach:12000,expectedReach:10000,approvedEngagements:900,deliveryCompletion:100,reachAchievement:120,approvalQuality:100,performanceScore:88,basePlannedUsdt:100,baseReady:true,bonusEligible:true,bonusRecommendedUsdt:50,settlement:{assignmentId:'cca_1',status:approved?'APPROVED':'PENDING_REVIEW',baseApprovedUsdt:approved?100:0,bonusApprovedUsdt:approved?50:0,approvalNote:approved?'Reviewed Approved delivery evidence':'',evidenceFingerprint:approved?'ev_1':null,approvedAt:approved?'2026-08-08T20:05:00Z':null,approvedBy:approved?'usr_owner':null},currentEvidenceFingerprint:'ev_1',approvalDrift:false,paidUsdt:paid,outstandingUsdt:approved?150-paid:0,totalApprovedUsdt:approved?150:0,paymentStatus,payments}]},permissions:{canManage:true,canFinance:true,canApprove:true,canVoid:true},methodology:{engineVersion:'R8.5H-1',currency:'USDT',approvedPostsOnlyForPerformance:true}};
}

function responseFor(url,request){
  const parsed=new URL(url);
  if(parsed.pathname==='/api/me')return {user:{userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(parsed.pathname==='/api/dashboard')return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(parsed.pathname==='/api/tasks')return {items:[],total:0};
  if(parsed.pathname==='/api/opportunities')return {items:[],total:0};
  if(parsed.pathname==='/api/akari-leads')return {items:[],total:0,categories:[],canWrite:true};
  if(parsed.pathname==='/api/campaigns')return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-31',currency:'USD'}],total:1};
  if(parsed.pathname==='/api/campaign-settlement/cam_1'){
    if(request.method()==='PATCH'){
      const body=request.postDataJSON();
      if(body.action==='approve-settlement')approved=true;
      if(body.action==='record-payment')paid+=Number(body.amountUsdt||0);
    }
    return settlementPayload();
  }
  if(parsed.pathname==='/api/campaign-talent-recommendations')return {intelligence:{criteria:{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},eligibleCount:0,recommendations:[],basket:{budgetUsd:0,items:[]},partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL'],contentTypes:['ALL'],regions:['ALL']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}}};
  if(parsed.pathname==='/api/creator-kol-intelligence')return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if(parsed.pathname==='/api/delivery-partner-intelligence')return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if(parsed.pathname.startsWith('/api/campaign-planning/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-01',endDate:'2026-08-31',overview:{currentTokenPrice:0.5},planning:{status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300,notes:'',selections:[]},summary:{status:'APPROVED',effectiveStatus:'APPROVED',approvalDrift:false,currentFingerprint:'fp_1',approvedFingerprint:'fp_1',talentCount:1,creatorCount:1,kolCount:0,partnerCount:0,plannedPosts:2,plannedReach:10000,cashAllocation:100,tokenAllocation:0,tokenPrice:0.5,estimatedTokenValue:0,reservedBonusPoolUsd:100,estimatedPlanCost:200,budgetUsd:300,remainingBudget:100,budgetUtilization:66.7,budgetReconciled:true,compensationEnabled:true,compensationCalculationCurrent:true},planItems:[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',expectedPosts:2,expectedReach:10000,allocatedUsd:100,active:true}]},recommendations:{criteria:{objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300},eligibleCount:0,recommendations:[],partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}},deliveryPartners:[],permissions:{canWrite:true,canManage:true},methodology:{approvedSnapshot:true,driftDetection:true,recommendationVersion:'R8.5E-1'}};
  if(parsed.pathname.startsWith('/api/campaign-compensation/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-01',endDate:'2026-08-31',planningStatus:'APPROVED',planningBudgetUsd:300,compensation:{enabled:true,budgetUsdt:200,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:50,platformWeights:{X:100,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},postingCadence:'WEEKLY_2',dailyEngagementRequired:false,engagementActions:[],talentInputs:[],lastAppliedFingerprint:'fp'},summary:{enabled:true,currency:'USDT',engineVersion:'R8.5G-1',activeTalentCount:1,includedTalentCount:1,verifiedTalentCount:1,unsupportedTalentCount:0,budgetUsdt:200,baseBudgetUsdt:100,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:50,calculatedBaseAllocationUsdt:100,unallocatedBaseUsdt:0,calculationCurrent:true,currentFingerprint:'fp',lastAppliedFingerprint:'fp',calculationError:null,calculation:{items:[]}},planSummary:{estimatedPlanCost:200,remainingBudget:100},talent:[]},permissions:{canWrite:true,canManage:true},methodology:{engineVersion:'R8.5G-1'}};
  if(parsed.pathname==='/api/service-delivery')return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async({page})=>{
  approved=false;paid=0;
  await page.clock.setFixedTime(new Date('2026-08-08T20:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{const request=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request))});});
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('Creator settlement approves performance bonus and records partial payment separately',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.campaign-settlement-r58');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Creator / KOL Settlement Control')).toBeVisible();
  const row=panel.locator('[data-settlement-talent="cca_1"]');
  await expect(row.getByText('2 / 2 Approved')).toBeVisible();
  await expect(row.getByText('50 USDT',{exact:true})).toBeVisible();

  await row.getByRole('button',{name:'Review / approve'}).click();
  const approveModal=page.locator('.campaign-settlement-modal-r58');
  await approveModal.getByLabel('Approval note').fill('Reviewed Approved delivery and performance evidence.');
  await approveModal.getByRole('button',{name:'Approve settlement'}).click();
  await expect(row.getByText('DUE',{exact:true})).toBeVisible();

  await row.getByRole('button',{name:'Record payment'}).click();
  const paymentModal=page.locator('.campaign-settlement-modal-r58');
  await paymentModal.getByLabel('Amount (USDT)').fill('75');
  await paymentModal.getByLabel('Reference').fill('0xsettlement123');
  await paymentModal.getByRole('button',{name:'Record payment'}).click();
  await expect(row.getByText('PARTIALLY PAID',{exact:true})).toBeVisible();
  await expect(panel.getByText('0xsettlement123',{exact:true})).toBeVisible();
  await expect(panel.getByText(/Recommendations are not payments/i)).toBeVisible();
});
