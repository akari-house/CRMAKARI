import { test, expect } from '@playwright/test';

const me = { user: { userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'tenant-a',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true } };
const opportunity = {
  id:'opp_1',tenant_id:'tenant_a',project_id:'prj_1',project_name:'Project Alpha',project_lifecycle_status:'ACTIVE_OPPORTUNITY',
  name:'GTM Partnership',service_type:'GTM strategy',stage:'QUALIFIED',estimated_value:10000,currency:'USD',probability_percentage:50,
  owner_name:'Muaz Test',primary_contact_name:'Alice Founder',primary_contact_email:'alice@example.com',expected_close_date:'2030-03-20',
  budget_status:'CONFIRMED',need_confirmed:1,decision_maker_confirmed:1,timeline_confirmed:1,qualificationComplete:true,next_action:'Prepare proposal',
  referral_partner_id:'par_1',project_referral_partner_id:'par_1',default_referral_percentage:5,
};
const qualifiedWorkspace = {
  opportunity,
  proposals:[],negotiations:[],closures:[],engagements:[],finance:{invoices:[],receipts:[],referrals:[]},
  permissions:{canWrite:true,canFinance:true},
};
const wonWorkspace = {
  opportunity:{...opportunity,stage:'WON',probability_percentage:100,project_lifecycle_status:'CLIENT'},
  proposals:[{id:'act_prop',subject:'GTM proposal · v1',outcome:'SENT',occurredAt:'2030-02-01T10:00:00Z',metadata:{recordType:'AKARI_PROPOSAL_V1',title:'GTM proposal',version:1,status:'SENT',amount:10000,currency:'USD'}}],
  negotiations:[{id:'act_neg',subject:'Negotiation round 1',outcome:'AGREED_IN_PRINCIPLE',occurredAt:'2030-02-05T10:00:00Z',metadata:{recordType:'AKARI_NEGOTIATION_V1',round:1,outcome:'AGREED_IN_PRINCIPLE',currentOffer:10000,currency:'USD'}}],
  closures:[],
  engagements:[{id:'eng_1',projectId:'prj_1',opportunityId:'opp_1',name:'Project Alpha · GTM Partnership',status:'ONBOARDING',serviceType:'GTM strategy',commercialModel:'FIXED_FEE',startDate:'2030-03-01',endDate:'2030-05-31',deliverables:'GTM strategy and creator campaign',grossRevenue:10000,currency:'USD',campaignCost:500,creatorCost:1500,otherCost:0,directCosts:2000,marginBeforeReferral:8000,referralPartnerId:'par_1',referralPercentage:5,referralReward:400,akariNetRevenue:7600,amountInvoiced:10000,amountReceived:0,outstandingAmount:10000,paymentStatus:'INVOICED',nextAction:'Onboard client',metadata:{serviceType:'GTM strategy',commercialModel:'FIXED_FEE'}}],
  finance:{
    invoices:[{id:'inv_1',invoiceNumber:'AKARI-2030-0001',invoiceDate:'2030-03-01',dueDate:'2030-03-15',status:'INVOICED',currency:'USD',total:10000,received:0,outstanding:10000,recipient:{name:'Project Alpha'},engagementId:'eng_1'}],
    receipts:[],
    referrals:[{id:'ref_1',partnerId:'par_1',partnerName:'Referral Partner',engagementId:'eng_1',revenueBasis:8000,percentage:5,amount:400,currency:'USD',status:'DUE',dueDate:'2030-03-22'}],
  },
  permissions:{canWrite:true,canFinance:true},
};

function responseFor(url, method, mode) {
  const parsed = new URL(url); const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return me;
  if (path === '/api/dashboard') return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:5000,activeOpportunities:1,yearToDateRevenue:0,activeCustomers:mode==='won'?1:0,activeCampaigns:mode==='won'?1:0,activePartners:1,outstandingPayments:mode==='won'?10000:0,referralRewardsDue:mode==='won'?400:0}};
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return {items:[],total:0};
  if (path === '/api/projects?limit=5') return {items:[{id:'prj_1',name:'Project Alpha'}],total:1};
  if (path === '/api/opportunities') return {items:[opportunity],total:1};
  if (path === '/api/campaigns') return {items:[],total:0};
  if (path === '/api/payments') return {items:[],total:0};
  if (path === '/api/partners') return {items:[{id:'par_1',name:'Referral Partner',status:'ACTIVE',default_referral_percentage:5}],total:1};
  if (path === '/api/team') return {items:[{userId:'usr_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true}],total:1};
  if (path === '/api/billing-profile') return {tenant:{name:'AKARI House',baseCurrency:'USD'},billingProfile:{legalName:'AKARI House',addressLine1:'Example Street 1',country:'Germany',email:'billing@example.com',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14}};
  if (parsed.pathname === '/api/opportunities/opp_1/workspace') return mode === 'won' ? wonWorkspace : qualifiedWorkspace;
  if (parsed.pathname === '/api/projects/prj_1') return {id:'prj_1',name:'Project Alpha',opportunities:[opportunity],contacts:[],activities:[]};
  if (parsed.pathname.startsWith('/api/akari-leads')) return {items:[],total:0,categories:[]};
  if (path === '/api/contacts') return {items:[],total:0};
  if (path === '/api/reports') return {pipelineByStage:[],revenueByMonth:[]};
  if (['POST','PATCH'].includes(method)) return {id:'saved_1',created:true,updated:true};
  return {items:[],total:0};
}

async function boot(page, mode, captures) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (['POST','PATCH'].includes(request.method())) captures.push({path:new URL(request.url()).pathname,method:request.method(),body:request.postDataJSON()});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request.method(),mode))});
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.getByRole('heading',{name:/Good evening, Muaz/i})).toBeVisible();
  await page.locator('[data-route="opportunities"]').first().click();
  await expect(page.getByRole('heading',{name:'Opportunity Pipeline'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Manage lifecycle'})).toBeVisible();
}

test('qualified opportunity opens the unified lifecycle and updates qualification', async ({page}) => {
  const captures=[]; await boot(page,'qualified',captures);
  await page.getByRole('button',{name:'Manage lifecycle'}).click();
  const workspace = page.getByLabel('Revenue lifecycle workspace');
  await expect(workspace.getByRole('heading',{name:'GTM Partnership'})).toBeVisible();
  await expect(workspace.locator('.revenue-step').filter({hasText:'Qualified lead'})).toBeVisible();
  await expect(workspace.locator('.revenue-step').filter({hasText:'Referral reward'})).toBeVisible();
  await workspace.getByRole('button',{name:'Qualification'}).click();
  await expect(page.getByRole('heading',{name:'Qualification checklist'})).toBeVisible();
  await page.locator('#revenue-active-form').getByRole('button',{name:'Update qualification'}).click();
  await expect.poll(() => captures.some((item) => item.path === '/api/opportunities/opp_1/qualification' && item.method === 'PATCH')).toBeTruthy();
  const sent = captures.find((item) => item.path === '/api/opportunities/opp_1/qualification').body;
  expect(sent.needConfirmed).toBe(true);
  expect(sent.decisionMakerConfirmed).toBe(true);
  expect(sent.timelineConfirmed).toBe(true);
});

test('won lifecycle connects engagement invoice payment and referral payout', async ({page}) => {
  const captures=[]; await boot(page,'won',captures);
  await page.getByRole('button',{name:'Manage lifecycle'}).click();
  const workspace = page.getByLabel('Revenue lifecycle workspace');
  await expect(workspace.getByText('Project Alpha · GTM Partnership',{exact:true})).toBeVisible();
  await workspace.locator('[data-revenue-action="invoice"]').click();
  await expect(page.getByRole('heading',{name:'Create engagement invoice'})).toBeVisible();
  await page.fill('input[name="recipientAddressLine1"]','Client Street 2');
  await page.fill('input[name="recipientCountry"]','Germany');
  await page.locator('#revenue-active-form').getByRole('button',{name:'Create invoice'}).click();
  await expect.poll(() => captures.some((item) => item.path === '/api/invoices' && item.method === 'POST')).toBeTruthy();
  const invoice = captures.find((item) => item.path === '/api/invoices').body;
  expect(invoice.projectId).toBe('prj_1');
  expect(invoice.campaignId).toBe('eng_1');
  expect(invoice.opportunityId).toBe('opp_1');

  await workspace.getByRole('button',{name:'Record payment'}).click();
  await expect(page.getByRole('heading',{name:'Record client payment'})).toBeVisible();
  await page.fill('input[name="reference"]','BANK-REF-001');
  await page.locator('#revenue-active-form').getByRole('button',{name:'Record payment'}).click();
  await expect.poll(() => captures.some((item) => item.path === '/api/invoices/inv_1/receipts' && item.method === 'POST')).toBeTruthy();

  await workspace.getByRole('button',{name:'Record payout'}).click();
  await expect(page.getByRole('heading',{name:'Record referral payout'})).toBeVisible();
  await page.fill('input[name="transactionReference"]','0xreferral');
  await page.locator('#revenue-active-form').getByRole('button',{name:'Mark referral paid'}).click();
  await expect.poll(() => captures.some((item) => item.path === '/api/referrals/ref_1' && item.method === 'PATCH')).toBeTruthy();
  const payout = captures.find((item) => item.path === '/api/referrals/ref_1').body;
  expect(payout.status).toBe('PAID');
  expect(payout.transactionReference).toBe('0xreferral');
});
