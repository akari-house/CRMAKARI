import { test, expect } from '@playwright/test';

let houseAddCalls=0;
let planned=false;

function directoryPayload(){
  return {directory:{source:'AKARI_HOUSE_PUBLIC_CREATOR_DIRECTORY',schemaVersion:'1',generatedAt:'2026-08-09T18:00:00Z',profileDataStatus:'PROFILE_PROVIDED',publicProfilesOnly:true,sourceAvailable:true,sourceWarning:null,creatorCount:1,withCrmHistory:planned?1:0,withPerformanceEvidence:0,plannedWithoutPerformance:planned?1:0,newToCrm:planned?0:1,externalUnlinkedCount:1,items:[{akariCreatorId:'house_1',username:'alice',displayName:'Alice Creator',profileUrl:'https://akarihouse.com/profiles/alice',avatarUrl:null,headline:'Crypto educator',location:'Berlin',websiteUrl:'',expertise:'FinTech · Education',openTo:'Creator campaigns',languages:['English'],creatorVerificationStatus:'verified',sorsaScore:640,sorsaSource:'partner_verified',xScore:720,xScoreSource:'partner_verified',socials:[{platform:'X',housePlatform:'x',profileUrl:'https://x.com/alice',followerCount:25000,followerCountAvailable:true,countSource:'member_reported',syncStatus:'manual',lastSyncedAt:null}],identitySource:'AKARI_HOUSE',profileDataStatus:'PROFILE_PROVIDED',totalFollowers:25000,platforms:['X'],crmLink:{linked:planned,method:planned?'AKARI_CREATOR_ID':'NONE',identityKey:planned?'social:X:alice':null},historyState:planned?'CRM_PLANNED_NO_PERFORMANCE':'NEW_NO_CAMPAIGN_HISTORY',crmCampaignCount:planned?1:0,performance:null}],external:[{identityKey:'social:X:legacy',name:'Legacy Creator',handle:'@legacy',profileUrl:'https://x.com/legacy',creatorType:'CREATOR',platforms:['X'],identityConfidence:'HIGH',historyState:'EXTERNAL_UNLINKED',classification:'RELIABLE',portfolioScore:70,campaignCount:2,approvedPosts:3,approvedReach:9000,approvedEngagements:500,trackedAllocationValue:300,lastActiveDate:'2026-07-30'}]},methodology:{version:'R8.5K-1',identitySource:'AKARI_HOUSE',profileDataStatus:'PROFILE_PROVIDED',publicProfilesOnly:true,tenantPrivatePerformance:true,approvedOnlyPerformance:true,noAutomaticLegacyLinkingWhenAmbiguous:true,noSocialOAuthRequired:true}};
}

function responseFor(url,request){
  const parsed=new URL(url);
  if(parsed.pathname==='/api/me')return {user:{userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(parsed.pathname==='/api/dashboard')return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(parsed.pathname==='/api/tasks')return {items:[],total:0};
  if(parsed.pathname==='/api/opportunities')return {items:[],total:0};
  if(parsed.pathname==='/api/akari-leads')return {items:[],total:0,categories:[],canWrite:true};
  if(parsed.pathname==='/api/campaigns')return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'PLANNED',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-31',currency:'USD'}],total:1};
  if(parsed.pathname==='/api/creator-directory')return directoryPayload();
  if(parsed.pathname==='/api/campaign-planning/cam_1/house-talent'&&request.method()==='POST'){
    houseAddCalls+=1;planned=true;
    return {updated:true,assignment:{id:'cca_house',name:'Alice Creator',platform:'X',expectedPosts:1,expectedReach:0,allocatedUsd:0,allocatedTokens:0},houseCreator:{akariCreatorId:'house_1',profileDataStatus:'PROFILE_PROVIDED'}};
  }
  if(parsed.pathname==='/api/campaign-talent-outreach/cam_1')return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',campaignStatus:'PLANNED',planningStatus:'DRAFT',planSummary:{approvalDrift:false,budgetReconciled:false,compensationCalculationCurrent:true},summary:{talentCount:0,confirmedCount:0,contactedCount:0,negotiatingCount:0,acceptedCount:0,declinedCount:0,commercialMismatchCount:0,pendingCount:0,readyForActivation:false,currentFingerprint:'cto_0'},talent:[]},members:[{id:'usr_owner',full_name:'Muaz Test',role:'OWNER'}],permissions:{canWrite:true,canConfirm:true}};
  if(parsed.pathname==='/api/campaign-activation/cam_1')return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',planningStatus:'DRAFT',activation:{status:'NOT_ACTIVATED',taskIds:[],taskPlan:[]},summary:{status:'NOT_ACTIVATED',effectiveStatus:'NOT_ACTIVATED',governanceReady:false,planApproved:false,planApprovalDrift:false,activationDrift:false,outreachDrift:false,currentPlanFingerprint:'fp_1',talentConfirmationRequired:true,talentConfirmationReady:false,confirmedTalentCount:0,talentCount:planned?1:0,pendingTalentCount:planned?1:0,budgetReconciled:false,compensationCalculationCurrent:true,plannedPosts:planned?1:0,plannedReach:0,approvedPosts:0,approvedReach:0,approvedEngagements:0,approvedDeliveryComplete:false,deliveryCompletionPercent:0,taskCount:0,taskFoundCount:0,taskDoneCount:0,taskOpenCount:0,taskCompletionPercent:0,completionReady:false},tasks:[]},members:[{id:'usr_owner',full_name:'Muaz Test',role:'OWNER'}],permissions:{canManage:true}};
  if(parsed.pathname==='/api/campaign-settlement/cam_1')return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',planningStatus:'DRAFT',summary:{governanceReady:false,bonusPoolUsdt:0,maximumBonusPerTalentUsdt:0,talentCount:0,baseReadyCount:0,bonusEligibleCount:0,recommendedBonusUsdt:0,approvedBaseUsdt:0,approvedBonusUsdt:0,paidUsdt:0,outstandingUsdt:0,disputedCount:0,driftCount:0,paidCount:0},talent:[]},permissions:{canManage:true,canFinance:true,canApprove:true,canVoid:true}};
  if(parsed.pathname==='/api/campaign-talent-recommendations')return {intelligence:{criteria:{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},eligibleCount:0,recommendations:[],basket:{budgetUsd:0,items:[]},partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL'],contentTypes:['ALL'],regions:['ALL']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}}};
  if(parsed.pathname==='/api/creator-kol-intelligence')return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if(parsed.pathname==='/api/delivery-partner-intelligence')return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if(parsed.pathname.startsWith('/api/campaign-planning/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'PLANNED',region:'EMEA',startDate:'2026-08-10',endDate:'2026-08-31',overview:{currentTokenPrice:0.5},planning:{status:'DRAFT',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'EMEA',budgetUsd:500,notes:'',selections:planned?[{assignmentId:'cca_house',identityKey:'social:X:alice',akariCreatorId:'house_1'}]:[]},summary:{status:'DRAFT',effectiveStatus:'DRAFT',approvalDrift:false,currentFingerprint:'fp_1',approvedFingerprint:null,talentCount:planned?1:0,creatorCount:planned?1:0,kolCount:0,partnerCount:0,plannedPosts:planned?1:0,plannedReach:0,cashAllocation:0,tokenAllocation:0,tokenPrice:0.5,estimatedTokenValue:0,reservedBonusPoolUsd:0,estimatedPlanCost:0,budgetUsd:500,remainingBudget:500,budgetUtilization:0,budgetReconciled:true,compensationEnabled:false,compensationCalculationCurrent:true},planItems:planned?[{id:'cca_house',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',expectedPosts:1,expectedReach:0,allocatedUsd:0,allocatedTokens:0,active:true}]:[]},recommendations:{criteria:{objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'EMEA',budgetUsd:500},eligibleCount:0,recommendations:[],partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL','X'],contentTypes:['ALL','Post'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}},deliveryPartners:[],permissions:{canWrite:true,canManage:true}};
  if(parsed.pathname.startsWith('/api/campaign-compensation/'))return {item:{id:'cam_1',name:'Launch Campaign',planningStatus:'DRAFT',planningBudgetUsd:500,compensation:{enabled:false},summary:{enabled:false,currency:'USDT',activeTalentCount:planned?1:0,includedTalentCount:0,verifiedTalentCount:0,unsupportedTalentCount:0,budgetUsdt:0,baseBudgetUsdt:0,bonusPoolUsdt:0,maximumBaseAllocationUsdt:0,maximumBonusPerTalentUsdt:0,calculatedBaseAllocationUsdt:0,unallocatedBaseUsdt:0,calculationCurrent:true,currentFingerprint:'fp',lastAppliedFingerprint:null,calculationError:null,calculation:{items:[]}},planSummary:{estimatedPlanCost:0,remainingBudget:500},talent:[]},permissions:{canWrite:true,canManage:true}};
  if(parsed.pathname==='/api/service-delivery')return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async({page})=>{
  houseAddCalls=0;planned=false;
  await page.clock.setFixedTime(new Date('2026-08-09T18:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{const request=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request))});});
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('AKARI House Creator directory shows source semantics and adds no-history talent without fabricated performance',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.akari-house-creator-directory-r61');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('House Creator Directory')).toBeVisible();
  const card=panel.locator('[data-house-creator="house_1"]');
  await expect(card.getByText('Alice Creator',{exact:true})).toBeVisible();
  await expect(card.getByText('New · No campaign history',{exact:true})).toBeVisible();
  await expect(card.getByText('New to CRM',{exact:true})).toBeVisible();
  await expect(card.getByText('Member reported',{exact:true})).toBeVisible();
  await expect(card.getByText('Partner verified',{exact:true}).first()).toBeVisible();
  await expect(card.getByText(/No campaign history or performance score/i)).toBeVisible();
  await expect(panel.getByText(/Profile Provided/i)).toBeVisible();

  await card.getByRole('button',{name:'Add to campaign plan'}).click();
  await expect.poll(()=>houseAddCalls).toBe(1);
  await expect(panel.getByText('Planned · No performance evidence',{exact:true})).toBeVisible();
  await expect(panel.getByText(/No Approved delivery evidence yet\. No portfolio score is assigned/i)).toBeVisible();
});
