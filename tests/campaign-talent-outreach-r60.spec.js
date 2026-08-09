import { test, expect } from '@playwright/test';

let outreachStatus='NOT_CONTACTED';
let outreach={};

function outreachPayload(){
  const confirmed=outreachStatus==='CONFIRMED';
  const commercialMatch=Number(outreach.agreedUsd||0)===100&&Number(outreach.agreedTokens||0)===0;
  return {
    item:{
      id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',campaignStatus:'LIVE',startDate:'2026-08-10',endDate:'2026-08-31',planningStatus:'APPROVED',
      planSummary:{approvalDrift:false,budgetReconciled:true,compensationCalculationCurrent:true,currentFingerprint:'fp_1',approvedFingerprint:'fp_1'},
      summary:{talentCount:1,confirmedCount:confirmed?1:0,contactedCount:outreachStatus==='NOT_CONTACTED'?0:1,negotiatingCount:outreachStatus==='NEGOTIATING'?1:0,acceptedCount:['ACCEPTED','CONFIRMED'].includes(outreachStatus)?1:0,declinedCount:0,commercialMismatchCount:['ACCEPTED','CONFIRMED'].includes(outreachStatus)&&!commercialMatch?1:0,pendingCount:confirmed?0:1,readyForActivation:confirmed&&commercialMatch,currentFingerprint:'cto_1'},
      talent:[{assignmentId:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',agencyName:'',allocatedUsd:100,allocatedTokens:0,commercialMatch,agencyRequired:false,confirmationEvidenceComplete:confirmed,confirmed,outreachOwnerName:outreach.outreachOwnerId?'Muaz Test':null,outreach:{assignmentId:'cca_1',status:outreachStatus,channel:outreach.channel||'',contactReference:outreach.contactReference||'',outreachOwnerId:outreach.outreachOwnerId||null,firstContactedAt:outreach.firstContactedAt||null,lastContactedAt:outreach.lastContactedAt||null,quotedUsd:Number(outreach.quotedUsd||0),quotedTokens:Number(outreach.quotedTokens||0),agreedUsd:Number(outreach.agreedUsd||0),agreedTokens:Number(outreach.agreedTokens||0),deliverablesConfirmed:Boolean(outreach.deliverablesConfirmed),scheduleConfirmed:Boolean(outreach.scheduleConfirmed),compensationConfirmed:Boolean(outreach.compensationConfirmed),agencyConfirmed:false,termsConfirmed:Boolean(outreach.termsConfirmed),consentConfirmed:Boolean(outreach.consentConfirmed),evidenceReference:outreach.evidenceReference||'',notes:outreach.notes||'',nextFollowUpAt:outreach.nextFollowUpAt||null}}],
    },
    members:[{id:'usr_owner',full_name:'Muaz Test',email:'owner@example.com',role:'OWNER'}],
    permissions:{canWrite:true,canConfirm:true},methodology:{version:'R8.5J-1',manualOutreach:true,noAutomaticMessaging:true,confirmationEvidenceRequired:true,approvedAllocationMustMatch:true},
  };
}

function responseFor(url,request){
  const parsed=new URL(url);
  if(parsed.pathname==='/api/me')return {user:{userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(parsed.pathname==='/api/dashboard')return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:1,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(parsed.pathname==='/api/tasks')return {items:[],total:0};
  if(parsed.pathname==='/api/opportunities')return {items:[],total:0};
  if(parsed.pathname==='/api/akari-leads')return {items:[],total:0,categories:[],canWrite:true};
  if(parsed.pathname==='/api/campaigns')return {items:[{id:'cam_1',project_id:'prj_1',name:'Launch Campaign',project_name:'Project One',status:'LIVE',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-31',currency:'USD'}],total:1};
  if(parsed.pathname==='/api/campaign-talent-outreach/cam_1'){
    if(request.method()==='PATCH'){
      const body=request.postDataJSON();
      if(body.action==='mark-contacted'){
        outreachStatus='CONTACTED';outreach={...outreach,...body,outreachOwnerId:body.outreachOwnerId||'usr_owner',firstContactedAt:'2026-08-09T10:00:00Z',lastContactedAt:'2026-08-09T10:00:00Z'};
      }
      if(body.action==='start-negotiation')outreachStatus='NEGOTIATING';
      if(body.action==='accept'){outreachStatus='ACCEPTED';outreach={...outreach,...body};}
      if(body.action==='confirm')outreachStatus='CONFIRMED';
    }
    return outreachPayload();
  }
  if(parsed.pathname==='/api/campaign-activation/cam_1')return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',campaignStatus:'LIVE',startDate:'2026-08-10',endDate:'2026-08-31',planningStatus:'APPROVED',activation:{status:'NOT_ACTIVATED',taskIds:[],taskPlan:[]},summary:{status:'NOT_ACTIVATED',effectiveStatus:outreachStatus==='CONFIRMED'?'READY_TO_ACTIVATE':'NOT_ACTIVATED',governanceReady:outreachStatus==='CONFIRMED',planApproved:true,planApprovalDrift:false,activationDrift:false,outreachDrift:false,currentPlanFingerprint:'fp_1',talentConfirmationRequired:true,talentConfirmationReady:outreachStatus==='CONFIRMED',confirmedTalentCount:outreachStatus==='CONFIRMED'?1:0,talentCount:1,pendingTalentCount:outreachStatus==='CONFIRMED'?0:1,budgetReconciled:true,compensationCalculationCurrent:true,plannedPosts:2,plannedReach:10000,approvedPosts:0,approvedReach:0,approvedEngagements:0,approvedDeliveryComplete:false,deliveryCompletionPercent:0,taskCount:0,taskFoundCount:0,taskDoneCount:0,taskOpenCount:0,taskCompletionPercent:0,completionReady:false},tasks:[]},members:[{id:'usr_owner',full_name:'Muaz Test',role:'OWNER'}],permissions:{canManage:true}};
  if(parsed.pathname==='/api/campaign-settlement/cam_1')return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',planningStatus:'APPROVED',summary:{governanceReady:true,bonusPoolUsdt:0,maximumBonusPerTalentUsdt:0,talentCount:0,baseReadyCount:0,bonusEligibleCount:0,recommendedBonusUsdt:0,approvedBaseUsdt:0,approvedBonusUsdt:0,paidUsdt:0,outstandingUsdt:0,disputedCount:0,driftCount:0,paidCount:0},talent:[]},permissions:{canManage:true,canFinance:true,canApprove:true,canVoid:true}};
  if(parsed.pathname==='/api/campaign-talent-recommendations')return {intelligence:{criteria:{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},eligibleCount:0,recommendations:[],basket:{budgetUsd:0,items:[]},partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL'],contentTypes:['ALL'],regions:['ALL']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}}};
  if(parsed.pathname==='/api/creator-kol-intelligence')return {portfolio:{contributorCount:0,activeContributors:0,creators:0,kols:0,totalApprovedPosts:0,totalApprovedReach:0,totalTrackedAllocationValue:0,needsAttention:0,lowConfidenceIdentities:0,items:[]}};
  if(parsed.pathname==='/api/delivery-partner-intelligence')return {portfolio:{partnerCount:0,partnersWithCampaignHistory:0,activePartners:0,totalApprovedPosts:0,totalApprovedReach:0,totalCampaignCost:0,needsAttention:0,legacyUnmappedAssignments:0,items:[]}};
  if(parsed.pathname.startsWith('/api/campaign-planning/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',status:'LIVE',region:'EMEA',startDate:'2026-08-10',endDate:'2026-08-31',overview:{currentTokenPrice:0.5},planning:{status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300,notes:'',selections:[]},summary:{status:'APPROVED',effectiveStatus:'APPROVED',approvalDrift:false,currentFingerprint:'fp_1',approvedFingerprint:'fp_1',talentCount:1,creatorCount:1,kolCount:0,partnerCount:0,plannedPosts:2,plannedReach:10000,cashAllocation:100,tokenAllocation:0,tokenPrice:0.5,estimatedTokenValue:0,reservedBonusPoolUsd:100,estimatedPlanCost:200,budgetUsd:300,remainingBudget:100,budgetUtilization:66.7,budgetReconciled:true,compensationEnabled:true,compensationCalculationCurrent:true},planItems:[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',expectedPosts:2,expectedReach:10000,allocatedUsd:100,allocatedTokens:0,active:true}]},recommendations:{criteria:{objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300},eligibleCount:0,recommendations:[],partnerRecommendations:[],insights:{underusedReliable:[],spendWithoutDelivery:[],mostUsed:[]},facets:{objectives:['BALANCED'],creatorTypes:['ALL'],platforms:['ALL','X'],contentTypes:['ALL','Thread'],regions:['ALL','EMEA']},methodology:{approvedOnly:true,deterministic:true,rankingVersion:'R8.5E-1'}},deliveryPartners:[],permissions:{canWrite:true,canManage:true}};
  if(parsed.pathname.startsWith('/api/campaign-compensation/'))return {item:{id:'cam_1',name:'Launch Campaign',projectId:'prj_1',projectName:'Project One',planningStatus:'APPROVED',planningBudgetUsd:300,compensation:{enabled:true,budgetUsdt:200,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:50,platformWeights:{X:100},talentInputs:[],lastAppliedFingerprint:'fp'},summary:{enabled:true,currency:'USDT',activeTalentCount:1,includedTalentCount:1,verifiedTalentCount:1,unsupportedTalentCount:0,budgetUsdt:200,baseBudgetUsdt:100,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:50,calculatedBaseAllocationUsdt:100,unallocatedBaseUsdt:0,calculationCurrent:true,currentFingerprint:'fp',lastAppliedFingerprint:'fp',calculationError:null,calculation:{items:[]}},planSummary:{estimatedPlanCost:200,remainingBudget:100},talent:[]},permissions:{canWrite:true,canManage:true}};
  if(parsed.pathname==='/api/service-delivery')return {metrics:{},items:[],total:0,financeVisible:true};
  return {items:[],total:0};
}

test.beforeEach(async({page})=>{
  outreachStatus='NOT_CONTACTED';outreach={};
  await page.clock.setFixedTime(new Date('2026-08-09T00:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{const request=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request))});});
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
});

test('Creator KOL outreach moves from contact to evidence-backed confirmed participation',async({page})=>{
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading',{name:'Campaigns'})).toBeVisible();
  const panel=page.locator('.campaign-talent-outreach-r60');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Acceptance & Consent Workspace')).toBeVisible();
  await expect(panel.getByText('Not Contacted',{exact:true})).toBeVisible();

  await panel.getByRole('button',{name:'Record contact'}).click();
  const contactModal=page.locator('.campaign-talent-outreach-modal-r60');
  await contactModal.getByLabel('Outreach channel').selectOption('Telegram');
  await contactModal.getByRole('button',{name:'Record contact'}).click();
  await expect(panel.getByText('Contacted',{exact:true})).toBeVisible();

  await panel.getByRole('button',{name:'Start negotiation'}).click();
  await expect(panel.getByText('Negotiating',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Record acceptance'}).click();
  const termsModal=page.locator('.campaign-talent-outreach-modal-r60');
  await termsModal.getByLabel('Agreed USDT').fill('100');
  await termsModal.getByLabel('Deliverables confirmed').check();
  await termsModal.getByLabel('Campaign dates / schedule confirmed').check();
  await termsModal.getByLabel('Compensation confirmed').check();
  await termsModal.getByLabel('Campaign terms confirmed').check();
  await termsModal.getByLabel('Participation / outreach consent confirmed').check();
  await termsModal.getByLabel('Acceptance evidence reference').fill('telegram-thread-123');
  await termsModal.getByRole('button',{name:'Record acceptance'}).click();
  await expect(panel.getByText('Accepted',{exact:true})).toBeVisible();
  await expect(panel.getByText('Matches plan',{exact:true})).toBeVisible();

  await panel.getByRole('button',{name:'Confirm participation'}).click();
  await expect(panel.getByText('Confirmed',{exact:true})).toBeVisible();
  await expect(panel.getByText('1 / 1',{exact:true})).toBeVisible();
  await expect(panel.getByText('Talent confirmed',{exact:true})).toBeVisible();
});
