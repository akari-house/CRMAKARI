import { test, expect } from '@playwright/test';

let planning;
let planItems;

function recommendation(){
  return {identityKey:'social:X:alice',identityConfidence:'HIGH',name:'Alice Creator',handle:'@alice',creatorType:'CREATOR',platforms:['X'],agencies:['Agency One'],regions:['EMEA'],approvedPosts:6,approvedReach:25000,averageDeliveryCompletion:100,campaignReliability:100,historicalAverageAllocation:250,recommendationScore:94,recommendationReasons:['Proven Approved performance on X','High delivery completion'],riskSignals:[]};
}
function summary(){
  const cash=planItems.reduce((sum,item)=>sum+Number(item.allocatedUsd||0),0);
  const tokens=planItems.reduce((sum,item)=>sum+Number(item.allocatedTokens||0),0);
  const tokenValue=tokens*0.5;
  const total=cash+tokenValue;
  const budget=Number(planning.budgetUsd||0);
  return {status:planning.status,effectiveStatus:planning.status,approvalDrift:false,currentFingerprint:'r8.5f-test1234',approvedFingerprint:planning.approvedFingerprint||null,talentCount:planItems.length,creatorCount:planItems.filter((i)=>i.creatorType==='CREATOR').length,kolCount:planItems.filter((i)=>i.creatorType==='KOL').length,partnerCount:planItems.filter((i)=>i.agencyPartnerId).length,plannedPosts:planItems.reduce((s,i)=>s+Number(i.expectedPosts||0),0),plannedReach:planItems.reduce((s,i)=>s+Number(i.expectedReach||0),0),cashAllocation:cash,tokenAllocation:tokens,tokenPrice:0.5,estimatedTokenValue:tokenValue,estimatedPlanCost:total,budgetUsd:budget,remainingBudget:budget-total,budgetUtilization:budget?total/budget*100:0,budgetReconciled:budget>0&&total<=budget};
}
function planningPayload(){
  return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-01',endDate:'2026-08-31',overview:{currentTokenPrice:0.5},planning:{...planning},summary:summary(),planItems:[...planItems]},recommendations:{criteria:{objective:planning.objective,platform:planning.platform,creatorType:planning.creatorType,contentType:planning.contentType,region:planning.region,budgetUsd:planning.budgetUsd},eligibleCount:planItems.length?0:1,recommendations:planItems.length?[]:[recommendation()],partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED','REACH'],creatorTypes:['ALL','CREATOR','KOL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}},deliveryPartners:[{id:'p1',name:'Agency One',partner_type:'CREATOR_AGENCY',status:'ACTIVE'}],permissions:{canWrite:true,canManage:true},methodology:{approvedSnapshot:true,driftDetection:true,recommendationVersion:'R8.5E-1'}};
}

function responseFor(url,request){
  const parsed=new URL(url);
  if(parsed.pathname==='/api/me')return {user:{userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(parsed.pathname==='/api/dashboard')return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:1,outstandingPayments:0,referralRewardsDue:0}};
  if(parsed.pathname==='/api/tasks')return {items:[],total:0};
  if(parsed.pathname==='/api/opportunities')return {items:[],total:0};
  if(parsed.pathname==='/api/akari-leads')return {items:[],total:0,categories:[],canWrite:true};
  if(parsed.pathname==='/api/campaigns')return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-31',currency:'USD'}],total:1};
  if(parsed.pathname==='/api/campaign-talent-recommendations')return {intelligence:{criteria:{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},eligibleCount:1,recommendations:[recommendation()],basket:{budgetUsd:0,items:[]},partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED','REACH','ENGAGEMENT','RELIABILITY'],creatorTypes:['ALL','CREATOR','KOL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}}};
  if(parsed.pathname==='/api/creator-kol-intelligence')return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if(parsed.pathname==='/api/delivery-partner-intelligence')return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if(parsed.pathname==='/api/campaign-planning/cam_1'){
    if(request.method()==='PATCH'){
      const body=request.postDataJSON();
      if(body.action==='add-recommended-talent')planItems=[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',agencyPartnerId:'p1',agencyName:'Agency One',category:'Thread',region:'EMEA',expectedPosts:1,expectedReach:4000,allocatedUsd:250,allocatedTokens:0,tgeUnlockPercent:25,cliffMonths:1,vestingMonths:4,notes:'Added from AKARI recommendation intelligence.',active:true,recommendation:{identityKey:'social:X:alice',recommendationScore:94,recommendationVersion:'R8.5E-1'}}];
      if(body.action==='update-plan')planning={...planning,...body.planning,status:'DRAFT'};
      if(body.action==='submit-plan')planning={...planning,status:'READY_FOR_APPROVAL',submittedAt:'2026-08-08T10:00:00Z',submittedBy:'usr_owner'};
      if(body.action==='approve-plan')planning={...planning,status:'APPROVED',approvedAt:'2026-08-08T10:05:00Z',approvedBy:'usr_owner',approvedFingerprint:'r8.5f-test1234'};
      if(body.action==='reopen-plan')planning={...planning,status:'DRAFT',approvedAt:null,approvedBy:null,approvedFingerprint:null};
    }
    return planningPayload();
  }
  if(parsed.pathname==='/api/service-delivery')return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async({page})=>{
  planning={status:'DRAFT',objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,notes:'Launch plan',selections:[]};
  planItems=[];
  await page.clock.setFixedTime(new Date('2026-08-08T10:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{const request=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request))});});
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('Campaign Planning turns recommendations into an approved canonical talent basket',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.campaign-planning-r56');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Talent Basket & Approval Workspace')).toBeVisible();
  await expect(panel.locator('.campaign-plan-status-r56').getByText('Draft')).toBeVisible();
  await expect(panel.locator('.campaign-plan-shortlist-r56').getByText('Alice Creator')).toBeVisible();

  await panel.locator('[data-rec="social:X:alice"] [data-add]').click();
  await expect(panel.locator('.campaign-plan-table-r56').getByText('Alice Creator')).toBeVisible();
  await expect(panel.locator('.campaign-plan-kpis-r56').getByText('$250')).toBeVisible();
  await expect(panel.getByText('1 posts')).toBeVisible();

  await panel.getByRole('button',{name:'Submit for approval'}).click();
  await expect(panel.locator('.campaign-plan-status-r56').getByText('Ready For Approval')).toBeVisible();
  await expect(panel.getByRole('button',{name:'Approve plan'})).toBeVisible();

  await panel.getByRole('button',{name:'Approve plan'}).click();
  await expect(panel.locator('.campaign-plan-status-r56').getByText('Approved')).toBeVisible();
  await expect(panel.getByText('r8.5f-test1234')).toBeVisible();
  await expect(panel.locator('.campaign-plan-table-r56').getByText('Locked')).toBeVisible();
});
