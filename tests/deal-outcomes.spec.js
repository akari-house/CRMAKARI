import { test, expect } from '@playwright/test';

const me = { user: { userId:'usr_owner',tenantId:'tenant_a',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true } };
const opportunity = {
  id:'opp_1',tenant_id:'tenant_a',project_id:'prj_1',project_name:'Project Alpha',project_lifecycle_status:'ACTIVE_OPPORTUNITY',
  name:'Ecosystem relationship',service_type:'MARKETING',stage:'QUALIFIED',estimated_value:10000,currency:'USD',probability_percentage:50,
  owner_user_id:'usr_owner',owner_name:'Muaz Test',primary_contact_name:'Alice Founder',expected_close_date:'2030-03-20',
  budget_status:'CONFIRMED',need_confirmed:1,decision_maker_confirmed:1,timeline_confirmed:1,qualificationComplete:true,next_action:'Agree relationship model',
};
const qualifiedWorkspace = {
  opportunity,
  proposals:[],negotiations:[],closures:[],engagements:[],finance:{invoices:[],receipts:[],referrals:[]},
  permissions:{canWrite:true,canFinance:true},
};
const partnershipWorkspace = {
  opportunity:{...opportunity,stage:'WON',probability_percentage:100,project_lifecycle_status:'PARTNER',estimated_value:0},
  proposals:[],negotiations:[],closures:[],
  engagements:[{
    id:'eng_partner',projectId:'prj_1',opportunityId:'opp_1',name:'Project Alpha partnership',status:'ONBOARDING',
    dealModel:'PARTNERSHIP',invoiceEligible:false,partnershipIncluded:true,announcementRequested:true,announcementDate:'2030-04-10',
    valueContribution:'Distribution and ecosystem introductions',strategicValue:25000,
    serviceType:'STRATEGIC_PARTNERSHIP',commercialModel:'NON_BILLABLE',startDate:'2030-04-01',endDate:null,
    deliverables:'Joint ecosystem activation',grossRevenue:0,currency:'USD',campaignCost:0,creatorCost:0,otherCost:0,directCosts:0,
    marginBeforeReferral:0,referralPartnerId:null,referralPercentage:0,referralReward:0,akariNetRevenue:0,
    amountInvoiced:0,amountReceived:0,outstandingAmount:0,paymentStatus:'NOT_INVOICED',
    nextAction:'Prepare partnership announcement',
    metadata:{dealModel:'PARTNERSHIP',invoiceEligible:false,commercialModel:'NON_BILLABLE'},
  }],
  finance:{invoices:[],receipts:[],referrals:[]},
  permissions:{canWrite:true,canFinance:true},
};

function responseFor(url, method, mode) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return me;
  if (path === '/api/dashboard') return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:5000,activeOpportunities:1,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:1,outstandingPayments:0,referralRewardsDue:0}};
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return {items:[],total:0};
  if (path === '/api/work-os?scope=team') return {
    scope:'team',tasks:[],projects:[{id:'prj_1',name:'Project Alpha'}],opportunities:[opportunity],campaigns:[],
    calendarEvents:[],partnershipCandidates:[],fundraisingPlans:[],
    members:[
      {id:'usr_owner',fullName:'Muaz Test',email:'owner@example.com',role:'OWNER'},
      {id:'usr_marketing',fullName:'Marketing Lead',email:'marketing@example.com',role:'BD_MEMBER'},
      {id:'usr_design',fullName:'Design Lead',email:'design@example.com',role:'BD_MEMBER'},
    ],
    permissions:{canWrite:true,canManage:true,canFinance:true},
  };
  if (path === '/api/projects?limit=5') return {items:[{id:'prj_1',name:'Project Alpha'}],total:1};
  if (path === '/api/opportunities') return {items:[opportunity],total:1};
  if (path === '/api/campaigns') return {items:[],total:0};
  if (path === '/api/payments') return {items:[],total:0};
  if (path === '/api/partners') return {items:[],total:0};
  if (parsed.pathname === '/api/opportunities/opp_1/workspace') return mode === 'partnership' ? partnershipWorkspace : qualifiedWorkspace;
  if (parsed.pathname.startsWith('/api/akari-leads')) return {items:[],total:0,categories:[]};
  if (path === '/api/contacts') return {items:[],total:0};
  if (path === '/api/reports') return {pipelineByStage:[],revenueByMonth:[]};
  if (['POST','PATCH'].includes(method)) return {id:'saved_1',created:true,updated:true};
  return {items:[],total:0};
}

async function boot(page, mode, captures) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (['POST','PATCH'].includes(request.method())) {
      captures.push({path:new URL(request.url()).pathname,method:request.method(),body:request.postDataJSON()});
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responseFor(request.url(),request.method(),mode))});
  });
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
  await page.locator('[data-route="opportunities"]').first().click();
  await expect(page.getByRole('heading',{name:'Opportunity Pipeline'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Manage lifecycle'})).toBeVisible();
  await page.getByRole('button',{name:'Manage lifecycle'}).click();
  await expect(page.getByLabel('Revenue lifecycle workspace')).toBeVisible();
}

test('won form distinguishes partnership, service and hybrid outcomes', async ({page}) => {
  const captures=[];
  await boot(page,'qualified',captures);
  const workspace = page.getByLabel('Revenue lifecycle workspace');
  await workspace.getByRole('button',{name:'Mark won'}).click();

  const form = page.locator('#revenue-active-form');
  await expect(form.getByRole('heading',{name:'Close as won'})).toBeVisible();
  const dealModel = form.locator('select[name="dealModel"]');
  await expect(dealModel).toHaveValue('SERVICE');
  await expect(dealModel).toContainText('Paid service / campaign · invoice eligible');

  await dealModel.selectOption('PARTNERSHIP');
  await expect(form.locator('input[name="finalValue"]')).toBeHidden();
  await expect(form.locator('input[name="campaignCost"]')).toBeHidden();
  await expect(form.getByText('No invoice will be created.')).toBeVisible();
  await expect(form.locator('textarea[name="deliverables"]').locator('..').locator('span')).toContainText('Partnership scope');

  await form.locator('input[name="startDate"]').fill('2030-04-01');
  await form.locator('textarea[name="deliverables"]').fill('Joint ecosystem introductions and distribution');
  await form.locator('textarea[name="valueContribution"]').fill('Distribution, credibility and founder introductions');
  await form.locator('input[name="createAnnouncementPlan"]').check();
  await expect(form.locator('[data-announcement-fields]')).toBeVisible();
  await form.locator('input[name="announcementDate"]').fill('2030-04-10');
  await expect(form.locator('select[name="marketingOwnerId"] option')).toHaveCount(4);
  await form.locator('select[name="marketingOwnerId"]').selectOption('usr_marketing');
  await form.locator('select[name="designOwnerId"]').selectOption('usr_design');
  await form.getByRole('button',{name:'Close partnership'}).click();

  await expect.poll(() => captures.some((item) => item.path === '/api/opportunities/opp_1/close')).toBeTruthy();
  const sent = captures.find((item) => item.path === '/api/opportunities/opp_1/close').body;
  expect(sent.outcome).toBe('WON');
  expect(sent.dealModel).toBe('PARTNERSHIP');
  expect(sent.finalValue).toBe('0');
  expect(sent.createAnnouncementPlan).toBe('true');
  expect(sent.announcementDate).toBe('2030-04-10');
  expect(sent.marketingOwnerId).toBe('usr_marketing');
  expect(sent.designOwnerId).toBe('usr_design');
});

test('non-billable partnership removes invoice and payment actions from the lifecycle', async ({page}) => {
  const captures=[];
  await boot(page,'partnership',captures);
  const workspace = page.getByLabel('Revenue lifecycle workspace');

  await expect(workspace.getByText('No invoice required')).toBeVisible();
  await expect(workspace.locator('[data-revenue-action="invoice"]')).toHaveCount(0);
  await expect(workspace.getByText('No invoice is required for this non-billable partnership.')).toBeVisible();
  await expect(workspace.locator('.revenue-step').filter({hasText:'Invoice'})).toHaveClass(/na/);
  await expect(workspace.locator('.revenue-step').filter({hasText:'Payment'})).toHaveClass(/na/);
  await expect(workspace.getByText('Strategic partnership',{exact:true})).toBeVisible();
});
