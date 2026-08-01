import { test, expect } from '@playwright/test';

const opportunity = {
  id:'opp_1', project_id:'prj_1', project_name:'Project Alpha', name:'Creator campaign', stage:'QUALIFIED',
  service_type:'MARKETING_CAMPAIGN', estimated_value:1000, currency:'USD', probability_percentage:50,
  owner_name:'Muaz Test', next_action:'Prepare proposal', qualificationComplete:true,
  need_confirmed:1, decision_maker_confirmed:1, timeline_confirmed:1, budget_status:'CONFIRMED',
  project_lifecycle_status:'ACTIVE_OPPORTUNITY', primary_contact_name:'Alice', primary_contact_email:'alice@example.com',
};

const proposal = {
  id:'prop_1', opportunityId:'opp_1', projectId:'prj_1', subject:'Creator campaign proposal · v1', outcome:'INTERNAL_REVIEW',
  occurredAt:'2026-08-01T10:00:00Z', metadata:{ recordType:'AKARI_PROPOSAL_V1', title:'Creator campaign proposal', version:1, status:'INTERNAL_REVIEW', amount:1000, currency:'USD', scope:'Scope', deliverables:'Deliverables' },
};

const invoice = {
  id:'inv_1', projectId:'prj_1', projectName:'Project Alpha', engagementId:'eng_1', opportunityId:'opp_1',
  invoiceNumber:'AKARI-2026-0001', invoiceDate:'2026-08-01', dueDate:'2026-08-10', status:'INVOICED', displayStatus:'OVERDUE',
  currency:'USD', subtotal:1000, taxRate:0, taxAmount:0, total:1000, received:200, credited:0, outstanding:800,
  recipient:{ name:'Project Alpha' }, lineItems:[{ description:'Campaign', quantity:1, unitPrice:1000, amount:1000 }], paymentSchedule:[], isOverdue:true,
};

const overview = {
  metrics:{ invoiced:1000, collected:200, outstanding:800, overdue:800, draftInvoices:0, overdueInvoices:1, referralDue:50, proposalReview:1, proposalApproved:0 },
  invoices:[invoice],
  proposals:[{ id:'prop_1', title:'Creator campaign proposal', version:1, status:'INTERNAL_REVIEW', amount:1000, currency:'USD' }],
  referrals:[{ id:'ref_1', partnerName:'Referral Partner', projectName:'Project Alpha', engagementName:'Creator campaign', amount:50, currency:'USD', status:'DUE' }],
  currency:'USD',
};

const workspace = {
  opportunity,
  proposals:[proposal], negotiations:[], closures:[],
  engagements:[{ id:'eng_1', projectId:'prj_1', opportunityId:'opp_1', name:'Creator campaign', status:'ONBOARDING', serviceType:'MARKETING_CAMPAIGN', commercialModel:'FIXED_FEE', grossRevenue:1000, currency:'USD', directCosts:100, akariNetRevenue:850, referralReward:50, nextAction:'Kickoff' }],
  finance:{ invoices:[invoice], receipts:[], credits:[], referrals:overview.referrals },
  permissions:{ canWrite:true, canFinance:true, canApproveProposal:true },
};

function baseResponse(url) {
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;
  const map = {
    '/api/me':{ user:{ userId:'usr_1', tenantId:'tenant_a', tenantSlug:'akari-house', email:'owner@example.com', fullName:'Muaz Test', role:'OWNER', financeAccess:true } },
    '/api/dashboard':{ currency:'USD', metrics:{ monthlyTarget:10000, revenueBooked:1000, revenueCollected:200, netRevenue:850, weightedPipeline:1000, activeOpportunities:1, yearToDateRevenue:200, activeCustomers:1, activeCampaigns:1, activePartners:1, outstandingPayments:800, referralRewardsDue:50 } },
    '/api/tasks?scope=mine':{ items:[], total:0 },
    '/api/opportunities':{ items:[opportunity], total:1 },
    '/api/akari-leads?limit=8&offset=0':{ items:[], total:0, categories:[], canWrite:true },
    '/api/campaigns':{ items:workspace.engagements, total:1 },
    '/api/payments':{ items:[], total:0 },
    '/api/commercial/overview':overview,
    '/api/commercial/templates':{ items:[{ id:'tpl_1', name:'Creator activation', serviceType:'MARKETING_CAMPAIGN', commercialModel:'FIXED_FEE', scope:'Template scope', deliverables:'Template deliverables', timeline:'Four weeks', paymentTerms:'50% upfront', assumptions:'Client approvals', active:true }], total:1 },
    '/api/invoices/inv_1':{ item:invoice, receipts:[], credits:[] },
    '/api/opportunities/opp_1/workspace':workspace,
  };
  if (map[key]) return map[key];
  if (parsed.pathname === '/api/commercial/overview' && parsed.searchParams.get('opportunityId')) return overview;
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items:[], total:0, categories:[], canWrite:true };
  return { items:[], total:0 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ updated:true, created:true, invoiceStatus:'PAID' }) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(baseResponse(request.url())) });
  });
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.getByRole('heading', { name:/Good evening, Muaz/i })).toBeVisible();
});

test('Finance exposes proposal, invoice, collection and referral controls', async ({ page }) => {
  let receiptBody = null;
  await page.route('**/api/invoices/inv_1/receipts', async (route) => {
    receiptBody = route.request().postDataJSON();
    await route.fulfill({ status:201, contentType:'application/json', body:JSON.stringify({ created:true, invoiceStatus:'PAID', outstanding:0 }) });
  });

  await page.locator('.sidebar [data-route="finance"]').click();
  await expect(page.getByRole('heading', { name:'Finance' })).toBeVisible();
  await expect(page.locator('#commercial-command-centre')).toBeVisible();
  await expect(page.getByText('Commercial operations')).toBeVisible();
  await expect(page.getByText('AKARI-2026-0001')).toBeVisible();
  await expect(page.getByText('Referral Partner')).toBeVisible();

  await page.getByRole('button', { name:'Payment' }).click();
  await expect(page.locator('#commercial-modal-root .commercial-modal')).toBeVisible();
  await page.locator('#commercial-modal-root [name="amount"]').fill('800');
  await page.locator('#commercial-modal-root [name="reference"]').fill('BANK-REF-001');
  await page.locator('#commercial-modal-root button[type="submit"]').click();
  await expect.poll(() => receiptBody?.reference).toBe('BANK-REF-001');
  await expect(page.getByText('Payment allocated')).toBeVisible();
});

test('commercial forms do not destroy the revenue lifecycle workspace', async ({ page }) => {
  await page.locator('.sidebar [data-route="opportunities"]').click();
  await expect(page.getByRole('heading', { name:'Opportunity Pipeline' })).toBeVisible();
  await page.getByRole('button', { name:'Manage lifecycle' }).click();
  await expect(page.locator('#modal-root .revenue-workspace')).toBeVisible();
  await expect(page.getByText('Commercial control')).toBeVisible();

  await page.getByRole('button', { name:'New from template' }).click();
  await expect(page.locator('#commercial-modal-root .commercial-modal')).toBeVisible();
  await expect(page.locator('#modal-root .revenue-workspace')).toBeVisible();
  await page.locator('#commercial-modal-root').getByRole('button', { name:'Cancel' }).click();
  await expect(page.locator('#commercial-modal-root .commercial-modal')).toHaveCount(0);
  await expect(page.locator('#modal-root .revenue-workspace')).toBeVisible();
});

test('proposal approval uses the governed status endpoint', async ({ page }) => {
  let approvalBody = null;
  await page.route('**/api/proposals/prop_1', async (route) => {
    approvalBody = route.request().postDataJSON();
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ updated:true, item:{ status:'APPROVED' } }) });
  });
  await page.locator('.sidebar [data-route="finance"]').click();
  await expect(page.locator('#commercial-command-centre')).toBeVisible();
  await page.getByRole('button', { name:'Approve' }).click();
  await expect.poll(() => approvalBody?.status).toBe('APPROVED');
  await expect(page.getByText('Proposal moved to Approved')).toBeVisible();
});

test('commercial command centre remains usable without page-level mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
  await page.locator('#sidebar [data-route="finance"]').click();
  await expect(page.locator('#commercial-command-centre')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
