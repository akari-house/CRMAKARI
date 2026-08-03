import { test, expect } from '@playwright/test';

const normalizedPayload = {
  storageMode:'NORMALIZED_D1',
  migrationRequired:false,
  readOnly:false,
  organisations:[{
    id:'org_a', name:'North Star Ventures', investor_type:'VC', website:'https://northstar.example', headquarters:'Berlin',
    current_fund:'Fund III', minimum_check:100000, maximum_check:1000000, typical_check:350000, lead_behavior:'Lead and co-lead',
    conflict_status:'POSSIBLE', status:'ACTIVE', people_count:1, claim_count:2, verified_claim_count:1, portfolio_count:1, target_count:1, best_fit_score:82,
  },{
    id:'org_b', name:'Northstar Venture Partners', investor_type:'FUND', website:'', headquarters:'London',
    current_fund:'', conflict_status:'UNKNOWN', status:'ACTIVE', people_count:0, claim_count:0, verified_claim_count:0, portfolio_count:0, target_count:0, best_fit_score:0,
  }],
  people:[{
    id:'person_a', organisation_id:'org_a', organisation_name:'North Star Ventures', full_name:'Alex Partner', title:'General Partner', city:'Berlin', is_decision_maker:1, status:'ACTIVE',
    contacts:[{ id:'contact_a', person_id:'person_a', kind:'WORK_EMAIL', value:'alex@northstar.example', visibility:'PRIVATE', is_primary:1 }],
  }],
  sources:[{
    id:'source_a', canonical_url:'https://northstar.example/fund', title:'North Star Fund III', publisher:'North Star Ventures', source_type:'FUND_PAGE',
    observed_at:'2026-08-01T00:00:00.000Z', redistribution_status:'UNKNOWN', confidence_status:'ASSERTED',
  }],
  claims:[{
    id:'claim_a', entity_type:'ORGANISATION', entity_id:'org_a', field:'investment_stages', value:['Seed','Series A'], source_id:'source_a', source_title:'North Star Fund III', source_publisher:'North Star Ventures', status:'VERIFIED', confidence:0.9,
  },{
    id:'claim_b', entity_type:'ORGANISATION', entity_id:'org_a', field:'sectors', value:['AI infrastructure'], source_id:'source_a', source_title:'North Star Fund III', status:'ASSERTED', confidence:0.6,
  }],
  portfolio:[{
    id:'portfolio_a', organisation_id:'org_a', organisation_name:'North Star Ventures', company_name:'Signal Stack', round_name:'Seed', sector:'AI infrastructure', confidence_status:'VERIFIED', source_id:'source_a', source_title:'North Star Fund III',
  }],
  targets:[{
    id:'target_a', round_id:'round_a', organisation_id:'org_a', stage:'MEETING', priority:90, fit_score:82,
    fit_components:{ stage:{ points:20, maximum:20 } }, fit_reasons:['Invests at Seed stage.','Published cheque range covers the target ticket.'], fit_warnings:['Possible portfolio conflict requires evidence review.'],
    conflict_signal:'POSSIBLE', expected_check:350000, probability_percentage:45, next_action:'Prepare meeting brief', round_name:'Seed', project_name:'Founder A',
  }],
  reviewQueue:[
    { id:'source:source_a', kind:'SOURCE', entityId:'source_a', label:'North Star Fund III', status:'ASSERTED', priority:55, reasons:['Source is asserted','Redistribution is unknown'] },
    { id:'claim:claim_b', kind:'CLAIM', entityId:'claim_b', organisationId:'org_a', label:'Sectors: AI infrastructure', status:'ASSERTED', priority:50, reasons:['Claim is asserted'] },
    { id:'conflict:org_a', kind:'CONFLICT', entityId:'org_a', organisationId:'org_a', label:'North Star Ventures', status:'POSSIBLE', priority:85, reasons:['possible portfolio conflict requires review'] },
  ],
  duplicates:[{
    id:'org_a:org_b', left:{ id:'org_a', name:'North Star Ventures', website:'https://northstar.example' }, right:{ id:'org_b', name:'Northstar Venture Partners', website:'' }, score:75, reason:'Similar investor organisation names', action:'REVIEW_REQUIRED',
  }],
  summary:{ organisations:2, people:1, decisionMakers:1, sources:1, verifiedSources:0, claims:2, verifiedClaims:1, portfolioEvidence:1, possibleConflicts:1, reviewItems:3, duplicateCandidates:1 },
  permissions:{ canWrite:true, canReview:true },
};

const compatibilityPayload = {
  storageMode:'LEGACY_COMPATIBILITY', migrationRequired:true, readOnly:true,
  organisations:[{ id:'legacy_fund', name:'Legacy Fund', investor_type:'OTHER', conflict_status:'UNKNOWN', people_count:1, claim_count:0, verified_claim_count:0, portfolio_count:0, target_count:1, best_fit_score:70 }],
  people:[{ id:'legacy_person', organisation_id:'legacy_fund', organisation_name:'Legacy Fund', full_name:'Legacy Partner', title:'', is_decision_maker:1, contacts:[], status:'ACTIVE' }],
  sources:[], claims:[], portfolio:[], targets:[], duplicates:[],
  reviewQueue:[{ id:'migration:0002', kind:'MIGRATION', entityId:'0002', label:'Enable normalized Investor Universe', status:'BLOCKED', priority:100, reasons:['Apply migration 0002 after a production backup and sanitized preview validation.'] }],
  summary:{ organisations:1, people:1, decisionMakers:1, sources:0, verifiedSources:0, claims:0, verifiedClaims:0, portfolioEvidence:0, possibleConflicts:0, reviewItems:1, duplicateCandidates:0 },
  permissions:{ canWrite:false, canReview:false, roleCanWrite:true },
};

function genericPayload(url) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return { user:{ userId:'usr_owner', tenantId:'tenant_akari_house', tenantSlug:'akari-house', email:'owner@example.com', fullName:'Muaz Test', role:'OWNER', financeAccess:true } };
  if (path === '/api/profile') return { user:{ id:'usr_owner', fullName:'Muaz Test', email:'owner@example.com', jobTitle:'Owner', bio:'', status:'ACTIVE' } };
  if (path === '/api/team') return { items:[{userId:'usr_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true}], total:1 };
  if (path === '/api/billing-profile') return { tenant:{name:'AKARI House',baseCurrency:'USD'}, billingProfile:{legalName:'AKARI House',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14} };
  if (path === '/api/dashboard') return { currency:'USD', metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:0,outstandingPayments:0,referralRewardsDue:0} };
  if (path === '/api/fundraising') return { items:[], projects:[], investorProjects:[], summary:{ active:0,total:0,target:0,committed:0,remaining:0,investors:0,averageReadiness:0 }, permissions:{ canWrite:true, canFinance:true } };
  if (path === '/api/ai/providers') return { enabled:false, primaryProvider:'OPENAI', fallbackProvider:'ANTHROPIC', allowFallback:false, models:{}, enabledPurposes:[], maxOutputTokens:1200, canManage:true, providers:[], purposes:[], secretRule:'Cloudflare secrets only' };
  if (path === '/api/production-readiness') return { tenant:{name:'AKARI House',plan_code:'FOUNDING',timezone:'Europe/Berlin'}, generatedAt:'2026-08-03T11:00:00.000Z', counts:{}, roles:[], automaticChecks:[], manualChecks:[], readinessScore:0, canManage:true, canExport:true };
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items:[], total:0 };
  if (path === '/api/projects?limit=5') return { items:[], total:0 };
  if (path === '/api/opportunities' || path === '/api/campaigns' || path === '/api/payments' || path === '/api/invoices' || path === '/api/partners' || path === '/api/contacts') return { items:[], total:0 };
  if (path === '/api/reports') return { pipelineByStage:[], revenueByMonth:[] };
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items:[],total:0,categories:[],owners:[],canWrite:true };
  return { items:[], total:0 };
}

async function boot(page, { payload = normalizedPayload, captures = [] } = {}) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (parsed.pathname === '/api/fundraising/universe') {
      if (request.method() === 'POST') captures.push(request.postDataJSON());
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(request.method() === 'GET' ? payload : { item:{ id:'saved_item' } }) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(genericPayload(request.url())) });
  });
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
}

async function openFundraising(page) {
  await page.locator('[data-route="fundraising"]').first().click();
  await expect(page.getByRole('heading', { name:'Fundraising' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Investor Universe' })).toBeVisible();
}

test('Investor Universe exposes organisations people evidence and review workflow', async ({ page }) => {
  await boot(page);
  await openFundraising(page);
  await expect(page.getByText('North Star Ventures').first()).toBeVisible();
  await expect(page.getByText('1/2 verified')).toBeVisible();
  await expect(page.getByText('Fit 82')).toBeVisible();

  await page.locator('[data-iu18-tab="people"]').click();
  await expect(page.getByText('Alex Partner')).toBeVisible();
  await expect(page.getByText('Decision maker')).toBeVisible();
  await expect(page.getByText('Private contact recorded')).toBeVisible();
  await expect(page.getByText('alex@northstar.example')).toHaveCount(0);

  await page.locator('[data-iu18-tab="evidence"]').click();
  await expect(page.getByText('North Star Fund III')).toBeVisible();
  await expect(page.getByText('Seed,Series A')).toBeVisible();

  await page.locator('[data-iu18-tab="review"]').click();
  await expect(page.getByText('Review queue')).toBeVisible();
  await expect(page.getByText('Similar investor organisation names')).toBeVisible();
  await expect(page.getByText('Review only. No automated merge is performed.')).toBeVisible();
});

test('Investor Universe creates one canonical investor organisation through the governed API', async ({ page }) => {
  const captures = [];
  await boot(page, { captures });
  await openFundraising(page);
  await page.locator('[data-iu18-action="new-organisation"]').click();
  await expect(page.getByRole('heading', { name:'Add investor organisation' })).toBeVisible();
  await page.locator('#investor-universe-modal-root input[name="name"]').fill('Beacon Capital');
  await page.locator('#investor-universe-modal-root select[name="investorType"]').selectOption('FUND');
  await page.locator('#investor-universe-modal-root input[name="website"]').fill('https://beacon.example');
  await page.locator('#investor-universe-modal-root input[name="minimumCheck"]').fill('100000');
  await page.locator('#investor-universe-modal-root input[name="maximumCheck"]').fill('750000');
  await page.locator('#investor-universe-modal-root button[type="submit"]').click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toMatchObject({ action:'upsert-organisation', name:'Beacon Capital', investorType:'FUND', website:'https://beacon.example', minimumCheck:100000, maximumCheck:750000 });
  await expect(page.getByText('Investor organisation created')).toBeVisible();
});

test('Owner review records evidence status without automatic data merging', async ({ page }) => {
  const captures = [];
  await boot(page, { captures });
  await openFundraising(page);
  await page.locator('[data-iu18-tab="review"]').click();
  await page.locator('[data-iu18-action="review-source"]').click();
  await expect(page.getByRole('heading', { name:'Review evidence source' })).toBeVisible();
  await page.locator('#investor-universe-modal-root select[name="confidenceStatus"]').selectOption('VERIFIED');
  await page.locator('#investor-universe-modal-root select[name="redistributionStatus"]').selectOption('ATTRIBUTION_REQUIRED');
  await page.locator('#investor-universe-modal-root button[type="submit"]').click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toEqual({ action:'review-source', confidenceStatus:'VERIFIED', redistributionStatus:'ATTRIBUTION_REQUIRED', id:'source_a' });
  await expect(page.getByText('Evidence source reviewed')).toBeVisible();
  expect(captures.some((item) => /merge/i.test(item.action || ''))).toBe(false);
});

test('compatibility mode preserves legacy investors while normalized writes remain disabled', async ({ page }) => {
  await boot(page, { payload:compatibilityPayload });
  await openFundraising(page);
  await expect(page.getByText('Investor Universe is in compatibility mode')).toBeVisible();
  await expect(page.getByText('LEGACY COMPATIBILITY')).toBeVisible();
  await expect(page.getByText('Legacy Fund')).toBeVisible();
  await expect(page.locator('[data-iu18-action="new-organisation"]')).toHaveCount(0);
  await page.locator('[data-iu18-tab="review"]').click();
  await expect(page.getByText('Apply migration 0002 after a production backup and sanitized preview validation.')).toBeVisible();
});

test('Investor Universe remains usable without mobile page overflow', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await boot(page);
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
  await page.locator('#sidebar [data-route="fundraising"]').click();
  await expect(page.getByRole('heading', { name:'Investor Universe' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-iu18-organisation="org_a"]')).toBeVisible();
  await page.locator('[data-iu18-tab="people"]').click();
  await expect(page.getByText('Alex Partner')).toBeVisible();
});
