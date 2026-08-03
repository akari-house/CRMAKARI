import { test, expect } from '@playwright/test';

const targetingPayload = {
  storageMode:'NORMALIZED_D1',migrationRequired:false,readOnly:false,
  stages:['RESEARCHING','READY','INTRO_REQUESTED','CONTACTED','MEETING','DILIGENCE','PARTNER_MEETING','SOFT_CIRCLE','COMMITTED','PASSED','NOT_NOW'],
  rounds:[{
    id:'round_a',project_id:'project_a',project_name:'Founder A',round_name:'Seed',stage:'OUTREACH',currency:'USD',target_amount:2000000,minimum_ticket:100000,maximum_ticket:500000,
    expectedChecks:{ researched:600000,softCircle:250000,committed:0 },
    stageSummary:[
      { stage:'READY',count:1,expectedCheck:350000,weightedExpected:175000 },
      { stage:'SOFT_CIRCLE',count:1,expectedCheck:250000,weightedExpected:200000 },
    ],
    targets:[{
      id:'target_a',round_id:'round_a',organisation_id:'org_a',organisation_name:'North Star Ventures',investor_type:'VC',stage:'READY',priority:90,fit_score:84,
      primary_person_id:'person_a',primary_person_name:'Alex Partner',primary_person_title:'General Partner',expected_check:350000,probability_percentage:50,next_follow_up_at:'2026-08-02T10:00:00.000Z',next_action:'Request warm introduction',notes:'',
      minimum_check:100000,maximum_check:1000000,typical_check:350000,conflict_status:'NONE',evidence_count:3,evidence_verified:2,open_task_count:0,
      fit_reasons:['Seed fit','Cheque range covers target'],fit_warnings:[],introduction_paths:[{
        id:'intro_a',target_id:'target_a',target_person_id:'person_a',target_person_name:'Alex Partner',connector_contact_id:'contact_a',connector_contact_name:'Connector A',connector_project_name:'Network Co',connector_name:'Connector A',relationship_owner_user_id:'user_owner',relationship_owner_name:'Muaz',relationship_strength:'STRONG',evidence_source_id:'source_a',evidence_source_title:'Network bio',verification_status:'VERIFIED',consent_status:'GRANTED',request_status:'PLANNED',notes:'Verified by relationship owner',
      }],
    },{
      id:'target_b',round_id:'round_a',organisation_id:'org_b',organisation_name:'Beacon Fund',investor_type:'FUND',stage:'SOFT_CIRCLE',priority:75,fit_score:77,
      primary_person_id:'person_b',primary_person_name:'Dana Principal',expected_check:250000,probability_percentage:80,next_follow_up_at:'2026-08-06T10:00:00.000Z',next_action:'Confirm allocation',minimum_check:200000,maximum_check:750000,conflict_status:'NONE',evidence_count:2,evidence_verified:2,open_task_count:1,fit_reasons:['Stage fit'],fit_warnings:[],introduction_paths:[],
    }],
  }],
  people:[
    { id:'person_a',organisation_id:'org_a',full_name:'Alex Partner',title:'General Partner',is_decision_maker:1 },
    { id:'person_b',organisation_id:'org_b',full_name:'Dana Principal',title:'Principal',is_decision_maker:1 },
  ],
  connectors:[{ id:'contact_a',full_name:'Connector A',project_id:'network_a',project_name:'Network Co',relationship_strength:'STRONG' }],
  members:[{ id:'user_owner',full_name:'Muaz',role:'OWNER' },{ id:'user_bd',full_name:'BD Manager',role:'BD_MANAGER' }],
  sources:[{ id:'source_a',title:'Network bio',canonical_url:'https://network.example/bio',confidence_status:'VERIFIED' }],
  focusedLists:{
    overdueFollowUps:[{ id:'target_a',organisation_name:'North Star Ventures',stage:'READY',fit_score:84,priority:90 }],
    followUpsThisWeek:[{ id:'target_b',organisation_name:'Beacon Fund',stage:'SOFT_CIRCLE',fit_score:77,priority:75 }],
    readyForIntroduction:[{ id:'target_a',organisation_name:'North Star Ventures',stage:'READY',fit_score:84,priority:90 }],
    consentRequired:[],researchNeeded:[],highFitNoAction:[],softCircle:[{ id:'target_b',organisation_name:'Beacon Fund',stage:'SOFT_CIRCLE',fit_score:77,priority:75 }],
  },
  summary:{ rounds:1,targets:2,warmPaths:1,verifiedPaths:1,consentGranted:1,overdueFollowUps:1,expectedPipeline:600000,softCircle:250000 },
  permissions:{ canWrite:true,canApprove:true },
};

const compatibilityPayload = {
  ...targetingPayload,
  storageMode:'LEGACY_COMPATIBILITY',migrationRequired:true,readOnly:true,
  rounds:[{ ...targetingPayload.rounds[0],targets:[{ ...targetingPayload.rounds[0].targets[0],stage:'RESEARCHING',introduction_paths:[{ id:'legacy_intro',target_id:'target_a',connector_name:'Connector A',verification_status:'UNVERIFIED',consent_status:'NOT_REQUESTED',request_status:'PLANNED' }] }] }],
  people:[],connectors:[],members:[],sources:[],permissions:{ canWrite:false,canApprove:false,roleCanWrite:true },
};

const universePayload = {
  storageMode:'NORMALIZED_D1',migrationRequired:false,readOnly:false,organisations:[],people:[],sources:[],claims:[],portfolio:[],targets:[],reviewQueue:[],duplicates:[],summary:{},permissions:{canWrite:true,canReview:true},
};

function genericPayload(url) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return { user:{ userId:'user_owner',tenantId:'tenant_akari_house',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true } };
  if (path === '/api/profile') return { user:{ id:'user_owner',fullName:'Muaz Test',email:'owner@example.com',jobTitle:'Owner',bio:'',status:'ACTIVE' } };
  if (path === '/api/team') return { items:[{userId:'user_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true}],total:1 };
  if (path === '/api/billing-profile') return { tenant:{name:'AKARI House',baseCurrency:'USD'},billingProfile:{legalName:'AKARI House',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14} };
  if (path === '/api/dashboard') return { currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:0,outstandingPayments:0,referralRewardsDue:0} };
  if (path === '/api/fundraising') return { items:[],projects:[],investorProjects:[],summary:{active:0,total:0,target:0,committed:0,remaining:0,investors:0,averageReadiness:0},permissions:{canWrite:true,canFinance:true} };
  if (path === '/api/fundraising/universe') return universePayload;
  if (path === '/api/ai/providers') return { enabled:false,primaryProvider:'OPENAI',fallbackProvider:'ANTHROPIC',allowFallback:false,models:{},enabledPurposes:[],maxOutputTokens:1200,canManage:true,providers:[],purposes:[],secretRule:'Cloudflare secrets only' };
  if (path === '/api/production-readiness') return { tenant:{name:'AKARI House',plan_code:'FOUNDING',timezone:'Europe/Berlin'},generatedAt:'2026-08-03T11:00:00.000Z',counts:{},roles:[],automaticChecks:[],manualChecks:[],readinessScore:0,canManage:true,canExport:true };
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items:[],total:0 };
  if (path === '/api/projects?limit=5') return { items:[],total:0 };
  if (path === '/api/opportunities' || path === '/api/campaigns' || path === '/api/payments' || path === '/api/invoices' || path === '/api/partners' || path === '/api/contacts') return { items:[],total:0 };
  if (path === '/api/reports') return { pipelineByStage:[],revenueByMonth:[] };
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items:[],total:0,categories:[],owners:[],canWrite:true };
  return { items:[],total:0 };
}

async function boot(page,{ payload = targetingPayload,captures = [] } = {}) {
  await page.route('**/api/**',async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (parsed.pathname === '/api/fundraising/targeting') {
      if (request.method() === 'POST') captures.push(request.postDataJSON());
      await route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(request.method() === 'GET' ? payload : { item:{id:'saved'} }) });
      return;
    }
    await route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(genericPayload(request.url())) });
  });
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
}

async function openFundraising(page) {
  await page.locator('[data-route="fundraising"]').first().click();
  await expect(page.getByRole('heading',{name:'Fundraising'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Investor Targeting & Introductions'})).toBeVisible();
}

test('targeting board separates expected cheques from published evidence and surfaces focused work',async ({page}) => {
  await boot(page);
  await openFundraising(page);
  await expect(page.getByText('North Star Ventures').first()).toBeVisible();
  await expect(page.getByText('$350,000').first()).toBeVisible();
  await expect(page.getByText('1 open tasks')).toBeVisible();
  await expect(page.getByText('Overdue follow-ups')).toBeVisible();
  await expect(page.getByText('Ready for introduction')).toBeVisible();
  await page.locator('[data-ft19-action="open-target"][data-id="target_a"]').first().click();
  await expect(page.getByRole('heading',{name:'North Star Ventures'})).toBeVisible();
  await expect(page.getByText('$100,000 – $1,000,000')).toBeVisible();
  await expect(page.getByText('Private expected cheques', { exact:false })).toBeVisible();
  await expect(page.getByText('Granted')).toBeVisible();
});

test('target workspace updates private expected cheque and accountable next action',async ({page}) => {
  const captures=[];
  await boot(page,{captures});
  await openFundraising(page);
  await page.locator('[data-ft19-action="open-target"][data-id="target_a"]').first().click();
  await page.locator('[data-ft19-action="edit-target"]').click();
  await expect(page.getByRole('heading',{name:'Edit investor target'})).toBeVisible();
  await page.locator('#fundraising-targeting-modal-root input[name="expectedCheck"]').fill('425000');
  await page.locator('#fundraising-targeting-modal-root input[name="nextAction"]').fill('Send founder-approved intro request');
  await page.locator('#fundraising-targeting-modal-root button[type="submit"]').click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toMatchObject({ action:'update-target',id:'target_a',expectedCheck:425000,nextAction:'Send founder-approved intro request' });
  await expect(page.getByText('Investor target updated')).toBeVisible();
});

test('warm introduction path records verification separately from consent and request status',async ({page}) => {
  const captures=[];
  await boot(page,{captures});
  await openFundraising(page);
  await page.locator('[data-ft19-action="open-target"][data-id="target_a"]').first().click();
  await page.locator('[data-ft19-action="new-introduction"]').click();
  await expect(page.getByRole('heading',{name:'Add introduction path'})).toBeVisible();
  await page.locator('#fundraising-targeting-modal-root select[name="targetPersonId"]').selectOption('person_a');
  await page.locator('#fundraising-targeting-modal-root select[name="connectorContactId"]').selectOption('contact_a');
  await page.locator('#fundraising-targeting-modal-root select[name="relationshipOwnerUserId"]').selectOption('user_owner');
  await page.locator('#fundraising-targeting-modal-root select[name="relationshipStrength"]').selectOption('STRONG');
  await page.locator('#fundraising-targeting-modal-root select[name="evidenceSourceId"]').selectOption('source_a');
  await page.locator('#fundraising-targeting-modal-root select[name="verificationStatus"]').selectOption('VERIFIED');
  await page.locator('#fundraising-targeting-modal-root textarea[name="notes"]').fill('Relationship verified from source and owner confirmation');
  await page.locator('#fundraising-targeting-modal-root button[type="submit"]').click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toMatchObject({ action:'upsert-introduction',targetId:'target_a',targetPersonId:'person_a',connectorContactId:'contact_a',verificationStatus:'VERIFIED' });
  expect(captures[0].consentStatus).toBeUndefined();
  expect(captures[0].requestStatus).toBeUndefined();
});

test('follow-up action creates a linked task rather than an untracked reminder',async ({page}) => {
  const captures=[];
  await boot(page,{captures});
  await openFundraising(page);
  await page.locator('[data-ft19-action="open-target"][data-id="target_a"]').first().click();
  await page.locator('[data-ft19-action="create-task"]').click();
  await expect(page.getByRole('heading',{name:'Create investor follow-up task'})).toBeVisible();
  await page.locator('#fundraising-targeting-modal-root select[name="ownerUserId"]').selectOption('user_owner');
  await page.locator('#fundraising-targeting-modal-root input[name="dueAt"]').fill('2026-08-10T10:00');
  await page.locator('#fundraising-targeting-modal-root button[type="submit"]').click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toMatchObject({ action:'create-follow-up-task',targetId:'target_a',ownerUserId:'user_owner',dueAt:'2026-08-10T10:00' });
  await expect(page.getByText('Investor follow-up task created')).toBeVisible();
});

test('compatibility mode preserves targets while consent and targeting writes remain disabled',async ({page}) => {
  await boot(page,{payload:compatibilityPayload});
  await openFundraising(page);
  await expect(page.getByText('Targeting is visible in compatibility mode')).toBeVisible();
  await expect(page.getByText('READ ONLY')).toBeVisible();
  await expect(page.getByText('North Star Ventures').first()).toBeVisible();
  await page.locator('[data-ft19-action="open-target"][data-id="target_a"]').first().click();
  await expect(page.locator('[data-ft19-action="edit-target"]')).toHaveCount(0);
  await expect(page.locator('[data-ft19-action="new-introduction"]')).toHaveCount(0);
  await expect(page.locator('[data-ft19-action="create-task"]')).toHaveCount(0);
});

test('targeting board and warm-path workspace avoid mobile page overflow',async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await boot(page);
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
  await page.locator('#sidebar [data-route="fundraising"]').click();
  await expect(page.getByRole('heading',{name:'Investor Targeting & Introductions'})).toBeVisible();
  const overflow=await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-ft19-target="target_a"]')).toBeVisible();
  await page.locator('[data-ft19-action="open-target"][data-id="target_a"]').first().click();
  await expect(page.getByRole('heading',{name:'North Star Ventures'})).toBeVisible();
  const modalOverflow=await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(modalOverflow).toBeLessThanOrEqual(1);
});
