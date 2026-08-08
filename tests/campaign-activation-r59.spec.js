import { test, expect } from '@playwright/test';

let state='NOT_ACTIVATED';
let pauseReason='';

function activationPayload(){
  const active=state!=='NOT_ACTIVATED';
  const tasks=active?[
    {id:'tsk_1',slug:'kickoff',phase:'LAUNCH',title:'Campaign kickoff & execution brief — Launch Campaign',ownerUserId:'usr_owner',ownerName:'Muaz Test',status:'TODO',priority:'HIGH',dueAt:'2026-08-10T10:00:00.000Z'},
    {id:'tsk_2',slug:'talent-cca_1',phase:'EXECUTION',assignmentId:'cca_1',title:'Deliver & monitor 2 Approved posts — Alice Creator',ownerUserId:'usr_owner',ownerName:'Muaz Test',status:'TODO',priority:'HIGH',dueAt:'2026-08-31T12:00:00.000Z'},
  ]:[];
  return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',campaignStatus:'LIVE',startDate:'2026-08-10',endDate:'2026-08-31',planningStatus:'APPROVED',activation:{version:1,status:state,executionOwnerId:active?'usr_owner':null,executionOwnerName:active?'Muaz Test':null,activationNote:active?'Kickoff approved':'',approvedPlanFingerprint:active?'fp_1':null,taskIds:tasks.map((task)=>task.id),taskPlan:tasks,activatedAt:active?'2026-08-09T00:00:00Z':null,pausedAt:state==='PAUSED'?'2026-08-09T00:10:00Z':null,pauseReason},summary:{status:state,effectiveStatus:state==='NOT_ACTIVATED'?'READY_TO_ACTIVATE':state,governanceReady:true,planApproved:true,planApprovalDrift:false,activationDrift:false,currentPlanFingerprint:'fp_1',approvedPlanFingerprint:active?'fp_1':null,budgetReconciled:true,compensationCalculationCurrent:true,talentCount:1,plannedPosts:2,plannedReach:10000,approvedPosts:0,approvedReach:0,approvedEngagements:0,approvedDeliveryComplete:false,deliveryCompletionPercent:0,taskCount:tasks.length,taskFoundCount:tasks.length,taskDoneCount:0,taskOpenCount:tasks.length,taskCompletionPercent:0,completionReady:false},tasks},members:[{id:'usr_owner',full_name:'Muaz Test',email:'owner@example.com',role:'OWNER'}],permissions:{canManage:true},methodology:{version:'R8.5I-1',canonicalTasks:true,approvedPlanSnapshot:true,creatorAcceptanceSeparate:true}};
}

function responseFor(url,request){
  const parsed=new URL(url);
  if(parsed.pathname==='/api/me')return {user:{userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(parsed.pathname==='/api/dashboard')return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(parsed.pathname==='/api/tasks')return {items:[],total:0};
  if(parsed.pathname==='/api/opportunities')return {items:[],total:0};
  if(parsed.pathname==='/api/akari-leads')return {items:[],total:0,categories:[],canWrite:true};
  if(parsed.pathname==='/api/campaigns')return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'LIVE',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-31',currency:'USD'}],total:1};
  if(parsed.pathname==='/api/campaign-activation/cam_1'){
    if(request.method()==='PATCH'){
      const body=request.postDataJSON();
      if(body.action==='activate')state='ACTIVE';
      if(body.action==='pause'){state='PAUSED';pauseReason=String(body.reason||'');}
      if(body.action==='resume'){state='ACTIVE';pauseReason='';}
    }
    return activationPayload();
  }
  if(parsed.pathname==='/api/campaign-settlement/cam_1')return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',planningStatus:'APPROVED',summary:{governanceReady:true,bonusPoolUsdt:0,maximumBonusPerTalentUsdt:0,talentCount:0,baseReadyCount:0,bonusEligibleCount:0,recommendedBonusUsdt:0,approvedBaseUsdt:0,approvedBonusUsdt:0,paidUsdt:0,outstandingUsdt:0,disputedCount:0,driftCount:0,paidCount:0},talent:[]},permissions:{canManage:true,canFinance:true,canApprove:true,canVoid:true}};
  if(parsed.pathname==='/api/campaign-talent-recommendations')return {intelligence:{criteria:{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},eligibleCount:0,recommendations:[],basket:{budgetUsd:0,items:[]},partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL'],contentTypes:['ALL'],regions:['ALL']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}}};
  if(parsed.pathname==='/api/creator-kol-intelligence')return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if(parsed.pathname==='/api/delivery-partner-intelligence')return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if(parsed.pathname.startsWith('/api/campaign-planning/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-10',endDate:'2026-08-31',overview:{currentTokenPrice:0.5},planning:{status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300,notes:'',selections:[]},summary:{status:'APPROVED',effectiveStatus:'APPROVED',approvalDrift:false,currentFingerprint:'fp_1',approvedFingerprint:'fp_1',talentCount:1,creatorCount:1,kolCount:0,partnerCount:0,plannedPosts:2,plannedReach:10000,cashAllocation:100,tokenAllocation:0,tokenPrice:0.5,estimatedTokenValue:0,reservedBonusPoolUsd:100,estimatedPlanCost:200,budgetUsd:300,remainingBudget:100,budgetUtilization:66.7,budgetReconciled:true,compensationEnabled:true,compensationCalculationCurrent:true},planItems:[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',expectedPosts:2,expectedReach:10000,allocatedUsd:100,active:true}]},recommendations:{criteria:{objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300},eligibleCount:0,recommendations:[],partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}},deliveryPartners:[],permissions:{canWrite:true,canManage:true}};
  if(parsed.pathname.startsWith('/api/campaign-compensation/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',planningStatus:'APPROVED',planningBudgetUsd:300,compensation:{enabled:true,budgetUsdt:200,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:50,platformWeights:{X:100},talentInputs:[],lastAppliedFingerprint:'fp'},summary:{enabled:true,currency:'USDT',activeTalentCount:1,includedTalentCount:1,verifiedTalentCount:1,unsupportedTalentCount:0,budgetUsdt:200,baseBudgetUsdt:100,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:50,calculatedBaseAllocationUsdt:100,unallocatedBaseUsdt:0,calculationCurrent:true,currentFingerprint:'fp',lastAppliedFingerprint:'fp',calculationError:null,calculation:{items:[]}},planSummary:{estimatedPlanCost:200,remainingBudget:100},talent:[]},permissions:{canWrite:true,canManage:true}};
  if(parsed.pathname==='/api/service-delivery')return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async({page})=>{
  state='NOT_ACTIVATED';pauseReason='';
  await page.clock.setFixedTime(new Date('2026-08-09T00:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{const request=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request))});});
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('approved campaign activates into canonical Work OS execution and preserves pause/resume governance',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.campaign-activation-r59');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Activation & Work OS Handoff')).toBeVisible();
  await expect(panel.getByText('Ready To Activate',{exact:true})).toBeVisible();

  await panel.getByRole('button',{name:'Activate campaign'}).click();
  const activateModal=page.locator('.campaign-activation-modal-r59');
  await activateModal.getByLabel('Activation note').fill('Kickoff approved for internal execution.');
  await activateModal.getByRole('button',{name:'Activate campaign'}).click();
  await expect(panel.getByText('Active',{exact:true})).toBeVisible();
  await expect(panel.getByText('Campaign kickoff & execution brief — Launch Campaign')).toBeVisible();
  await expect(panel.getByText('Deliver & monitor 2 Approved posts — Alice Creator')).toBeVisible();
  await expect(panel.getByRole('button',{name:'Open Work OS'})).toBeVisible();

  await panel.getByRole('button',{name:'Pause'}).click();
  const pauseModal=page.locator('.campaign-activation-modal-r59');
  await pauseModal.getByLabel('Pause reason').fill('Client launch date moved.');
  await pauseModal.getByRole('button',{name:'Pause execution'}).click();
  await expect(panel.getByText('Paused',{exact:true})).toBeVisible();
  await expect(panel.getByText('Client launch date moved.')).toBeVisible();

  await panel.getByRole('button',{name:'Resume'}).click();
  await expect(panel.getByText('Active',{exact:true})).toBeVisible();
  await expect(panel.getByText(/does not mean a Creator\/KOL has accepted/i)).toBeVisible();
});
