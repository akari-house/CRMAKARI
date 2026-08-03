import { test,expect } from '@playwright/test';

const target={id:'target_a',round_id:'round_a',organisation_id:'org_a',primary_person_id:'person_a',stage:'CONTACTED',fit_score:82,expected_check:250000,next_action:'Send follow-up',next_follow_up_at:'2026-08-08T10:00:00.000Z',project_id:'project_a',project_name:'Founder A',round_name:'Seed',currency:'USD',investor_name:'North Star Ventures',person_name:'Alex Partner',primary_contact:'alex@northstar.example',primary_contact_kind:'WORK_EMAIL'};
const approvedDraft={
  id:'draft_a',projectId:'project_a',roundId:'round_a',targetId:'target_a',organisationId:'org_a',investorName:'North Star Ventures',personId:'person_a',personName:'Alex Partner',recipient:'alex@northstar.example',channel:'EMAIL',purpose:'FOLLOW_UP_DRAFT',disclosurePolicy:'SAFE_FOR_OUTREACH',subject:'Seed follow-up',body:'Hi Alex, following up on the Seed round and the product milestones we discussed.',status:'FULLY_APPROVED',contentHash:'hash_a',founderApproval:{status:'APPROVED',contentHash:'hash_a'},akariApproval:{status:'APPROVED',contentHash:'hash_a'},approvalState:{founder:true,akari:true,fullyApproved:true},followUpAt:'2026-08-10T10:00:00.000Z',createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-02T00:00:00.000Z',ai:{provider:'OPENAI',model:'gpt-model',fallbackUsed:false,requestId:'req_a'}
};
const meeting={id:'meeting_a',projectId:'project_a',roundId:'round_a',targetId:'target_a',organisationId:'org_a',investorName:'North Star Ventures',personId:'person_a',personName:'Alex Partner',title:'Investor meeting · North Star Ventures',meetingAt:'2026-08-12T10:00:00.000Z',durationMinutes:30,timezone:'Europe/Berlin',meetingLink:'https://meet.example/a',agenda:'Round, product milestones and investor fit',brief:'Review the evidence-backed investor profile and expected cheque assumptions.',status:'SCHEDULED',ownerUserId:'user_owner',followUpAt:'2026-08-13T10:00:00.000Z',createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z'};
const outreachPayload={
  storageMode:'NORMALIZED_D1',targets:[target],drafts:[approvedDraft],meetings:[meeting],members:[{id:'user_owner',full_name:'Muaz',role:'OWNER'},{id:'user_bd',full_name:'BD Manager',role:'BD_MANAGER'}],summary:{drafts:1,awaitingFounder:0,awaitingAkari:0,approved:1,sent:0,upcomingMeetings:1,followUpsDue:0},permissions:{canWrite:true,canApprove:true},controls:{channels:['EMAIL','LINKEDIN','TELEGRAM','X','OTHER'],purposes:['INTRODUCTION_DRAFT','FOLLOW_UP_DRAFT','DILIGENCE_RESPONSE','MEETING_FOLLOW_UP','OTHER'],disclosures:['INTERNAL','SAFE_FOR_OUTREACH','MEETING_ONLY','DILIGENCE_ONLY'],draftStates:['DRAFT','FOUNDER_APPROVED','FULLY_APPROVED','EXPORTED','SENT','REPLIED','CLOSED'],replyStates:['NONE','POSITIVE','NEUTRAL','NEGATIVE','MEETING_BOOKED','NOT_NOW','PASSED'],meetingStates:['SCHEDULED','COMPLETED','CANCELLED','NO_SHOW']},safety:{directSend:false,approvalRequired:true,exactContentApproval:true}
};
const targetingPayload={storageMode:'NORMALIZED_D1',migrationRequired:false,readOnly:false,stages:[],rounds:[],people:[],connectors:[],members:[],sources:[],focusedLists:{},summary:{},permissions:{canWrite:true,canApprove:true}};
const universePayload={storageMode:'NORMALIZED_D1',migrationRequired:false,readOnly:false,organisations:[],people:[],sources:[],claims:[],portfolio:[],targets:[],reviewQueue:[],duplicates:[],summary:{},permissions:{canWrite:true,canReview:true}};

function genericPayload(url){
  const parsed=new URL(url);const path=`${parsed.pathname}${parsed.search}`;
  if(path==='/api/me')return{user:{userId:'user_owner',tenantId:'tenant_akari_house',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
  if(path==='/api/profile')return{user:{id:'user_owner',fullName:'Muaz Test',email:'owner@example.com',jobTitle:'Owner',bio:'',status:'ACTIVE'}};
  if(path==='/api/team')return{items:[{userId:'user_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true}],total:1};
  if(path==='/api/billing-profile')return{tenant:{name:'AKARI House',baseCurrency:'USD'},billingProfile:{legalName:'AKARI House',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14}};
  if(path==='/api/dashboard')return{currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(path==='/api/fundraising')return{items:[],projects:[],investorProjects:[],summary:{active:0,total:0,target:0,committed:0,remaining:0,investors:0,averageReadiness:0},permissions:{canWrite:true,canFinance:true}};
  if(path==='/api/fundraising/universe')return universePayload;
  if(path==='/api/fundraising/targeting')return targetingPayload;
  if(path==='/api/ai/providers')return{enabled:true,primaryProvider:'OPENAI',fallbackProvider:'ANTHROPIC',allowFallback:true,models:{OPENAI:'gpt-model',ANTHROPIC:'claude-model'},enabledPurposes:['INTRODUCTION_DRAFT','FOLLOW_UP_DRAFT','DILIGENCE_RESPONSE','MEETING_BRIEF'],maxOutputTokens:1200,canManage:true,providers:[],purposes:[],secretRule:'Cloudflare secrets only'};
  if(path==='/api/production-readiness')return{tenant:{name:'AKARI House',plan_code:'FOUNDING',timezone:'Europe/Berlin'},generatedAt:'2026-08-03T11:00:00.000Z',counts:{},roles:[],automaticChecks:[],manualChecks:[],readinessScore:0,canManage:true,canExport:true};
  if(path==='/api/tasks?scope=mine'||path==='/api/tasks?scope=mine&includeCompleted=1')return{items:[],total:0};
  if(path==='/api/projects?limit=5')return{items:[],total:0};
  if(path==='/api/opportunities'||path==='/api/campaigns'||path==='/api/payments'||path==='/api/invoices'||path==='/api/partners'||path==='/api/contacts')return{items:[],total:0};
  if(path==='/api/reports')return{pipelineByStage:[],revenueByMonth:[]};
  if(parsed.pathname.startsWith('/api/akari-leads'))return{items:[],total:0,categories:[],owners:[],canWrite:true};
  return{items:[],total:0};
}

async function boot(page,{payload=outreachPayload,captures=[],aiCaptures=[]}={}){
  await page.route('**/api/**',async(route)=>{
    const request=route.request();const parsed=new URL(request.url());
    if(parsed.pathname==='/api/fundraising/outreach'){
      if(request.method()==='POST')captures.push(request.postDataJSON());
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(request.method()==='GET'?payload:{item:{id:'saved'}})});return;
    }
    if(parsed.pathname==='/api/ai/propose'){
      aiCaptures.push(request.postDataJSON());
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({proposal:'Subject: Seed round follow-up\n\nHi Alex, sharing a concise update and proposing a short next-step call.',provider:'OPENAI',model:'gpt-model',fallbackUsed:false,requestId:'req_ai_1',approvalRequired:true})});return;
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(genericPayload(request.url()))});
  });
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
}
async function openFundraising(page){await page.locator('[data-route="fundraising"]').first().click();await expect(page.getByRole('heading',{name:'Fundraising'})).toBeVisible();await expect(page.getByRole('heading',{name:'Controlled Outreach & Meetings'})).toBeVisible();}

test('controlled outreach clearly separates AI proposals approvals and manual sending',async({page})=>{
  await boot(page);await openFundraising(page);
  await expect(page.getByText('Human approval controls are active')).toBeVisible();
  await expect(page.getByText(/AKARI never sends the message automatically/i)).toBeVisible();
  const draftCard=page.locator('[data-fo20-draft="draft_a"]');
  await expect(draftCard.getByText('OPENAI · gpt-model',{exact:true})).toBeVisible();
  const approvalChips=draftCard.locator('.fo20-approval.is-approved');
  await expect(approvalChips).toHaveCount(2);
  await expect(approvalChips.filter({hasText:'Founder'})).toHaveCount(1);
  await expect(approvalChips.filter({hasText:'AKARI'})).toHaveCount(1);
  await expect(draftCard.locator('[data-fo20-action="mark-sent"]')).toBeVisible();
  await expect(page.getByText('Send now',{exact:true})).toHaveCount(0);
});

test('manual outreach draft captures exact recipient subject body and disclosure policy',async({page})=>{
  const captures=[];await boot(page,{captures});await openFundraising(page);
  await page.locator('[data-fo20-action="new-draft"]').click();
  await expect(page.getByRole('heading',{name:'Create outreach draft'})).toBeVisible();
  await page.locator('#fundraising-outreach-modal-root select[name="targetId"]').selectOption('target_a');
  await page.locator('#fundraising-outreach-modal-root input[name="subject"]').fill('Investor update');
  await page.locator('#fundraising-outreach-modal-root textarea[name="body"]').fill('Hi Alex, here is the approved investor update.');
  await page.locator('#fundraising-outreach-modal-root button[type="submit"]').click();
  await expect.poll(()=>captures.length).toBe(1);
  expect(captures[0]).toMatchObject({action:'save-draft',targetId:'target_a',channel:'EMAIL',recipient:'alex@northstar.example',subject:'Investor update',body:'Hi Alex, here is the approved investor update.',disclosurePolicy:'SAFE_FOR_OUTREACH'});
});

test('ChatGPT or Claude proposal remains unsent and is saved with provider metadata',async({page})=>{
  const captures=[],aiCaptures=[];await boot(page,{captures,aiCaptures});await openFundraising(page);
  await page.locator('[data-fo20-action="new-ai-draft"]').click();
  await expect(page.getByRole('heading',{name:'Generate AI outreach proposal'})).toBeVisible();
  await page.locator('#fundraising-outreach-modal-root button[type="submit"]').click();
  await expect.poll(()=>aiCaptures.length).toBe(1);
  expect(aiCaptures[0]).toMatchObject({purpose:'FOLLOW_UP_DRAFT',disclosurePolicy:'SAFE_FOR_OUTREACH'});
  await expect(page.getByRole('heading',{name:'Create outreach draft'})).toBeVisible();
  await expect(page.locator('#fundraising-outreach-modal-root input[name="subject"]')).toHaveValue('Seed round follow-up');
  await expect(page.locator('#fundraising-outreach-modal-root textarea[name="body"]')).toHaveValue(/Hi Alex/);
  await page.locator('#fundraising-outreach-modal-root button[type="submit"]').click();
  await expect.poll(()=>captures.length).toBe(1);
  expect(captures[0].ai).toMatchObject({provider:'OPENAI',model:'gpt-model',fallbackUsed:false,requestId:'req_ai_1'});
  expect(captures.some((item)=>item.action==='send')).toBe(false);
});

test('fully approved message records export or manual send rather than dispatching email',async({page})=>{
  const captures=[];await boot(page,{captures});await openFundraising(page);
  await page.locator('[data-fo20-action="mark-sent"]').click();
  await expect(page.getByRole('heading',{name:'Record manual send'})).toBeVisible();
  await page.locator('#fundraising-outreach-modal-root input[name="reference"]').fill('gmail-message-123');
  await page.locator('#fundraising-outreach-modal-root button[type="submit"]').click();
  await expect.poll(()=>captures.length).toBe(1);
  expect(captures[0]).toEqual({action:'mark-sent',reference:'gmail-message-123',id:'draft_a'});
  await expect(page.getByText('Manual send recorded')).toBeVisible();
});

test('investor meeting records agenda completion outcome and linked follow-up task',async({page})=>{
  const captures=[];await boot(page,{captures});await openFundraising(page);
  await page.locator('[data-fo20-tab="meetings"]').click();
  await expect(page.getByText('Investor meeting · North Star Ventures')).toBeVisible();
  await page.locator('[data-fo20-action="complete-meeting"]').click();
  await expect(page.getByRole('heading',{name:'Complete investor meeting'})).toBeVisible();
  await page.locator('#fundraising-outreach-modal-root textarea[name="notes"]').fill('Discussed product traction and round timing.');
  await page.locator('#fundraising-outreach-modal-root textarea[name="outcome"]').fill('Positive; requested diligence materials.');
  await page.locator('#fundraising-outreach-modal-root textarea[name="nextSteps"]').fill('Send diligence pack and schedule partner call.');
  await page.locator('#fundraising-outreach-modal-root button[type="submit"]').click();
  await expect.poll(()=>captures.length).toBe(1);
  expect(captures[0]).toMatchObject({action:'complete-meeting',id:'meeting_a',outcome:'Positive; requested diligence materials.'});
});

test('controlled outreach and meetings avoid mobile page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await boot(page);
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();await page.locator('#sidebar [data-route="fundraising"]').click();
  await expect(page.getByRole('heading',{name:'Controlled Outreach & Meetings'})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('[data-fo20-action="new-draft"]').click();
  await expect(page.getByRole('heading',{name:'Create outreach draft'})).toBeVisible();
  const modalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);expect(modalOverflow).toBeLessThanOrEqual(1);
});
