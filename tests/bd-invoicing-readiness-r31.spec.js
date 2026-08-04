import { test, expect } from '@playwright/test';

const me = {
  user: {
    userId: 'user_owner',
    tenantId: 'tenant_akari_house',
    tenantSlug: 'akari-house',
    email: 'owner@example.com',
    fullName: 'Muaz Test',
    role: 'OWNER',
    financeAccess: true,
  },
};

const opportunity = {
  id: 'opp_travls',
  project_id: 'project_travls',
  project_name: 'TRAVLS',
  project_lifecycle_status: 'CLIENT',
  name: 'TRAVLS creator campaign',
  service_type: 'MARKETING_CAMPAIGN',
  stage: 'WON',
  estimated_value: 15000,
  estimated_value_base_currency: 15000,
  currency: 'USD',
  probability_percentage: 100,
  expected_close_date: '2026-08-03',
  owner_name: 'Muaz Test',
  primary_contact_name: 'Alice',
  primary_contact_email: 'billing@travls.example',
  next_action: 'Issue first invoice',
  need_confirmed: 1,
  decision_maker_confirmed: 1,
  timeline_confirmed: 1,
  budget_status: 'CONFIRMED',
  qualificationComplete: true,
};

const engagement = {
  id: 'campaign_travls',
  projectId: 'project_travls',
  opportunityId: 'opp_travls',
  name: 'TRAVLS creator campaign',
  status: 'CONFIRMED',
  dealModel: 'SERVICE',
  invoiceEligible: true,
  serviceType: 'MARKETING_CAMPAIGN',
  commercialModel: 'FIXED_FEE',
  startDate: '2026-08-07',
  endDate: '2026-11-07',
  deliverables: 'Creator campaign and reporting',
  grossRevenue: 15000,
  currency: 'USD',
  directCosts: 0,
  akariNetRevenue: 15000,
  referralReward: 0,
  nextAction: 'Start onboarding',
  metadata: {},
};

function profile(ready) {
  return {
    legalName: 'TRAVLS Ltd',
    billingEmail: 'billing@travls.example',
    contactName: 'Alice',
    addressLine1: ready ? 'Client Street 2' : '',
    addressLine2: '',
    city: ready ? 'Berlin' : '',
    postalCode: ready ? '10115' : '',
    country: 'Germany',
    vatId: 'DE123456789',
    registrationNumber: 'HRB 12345',
    preferredCurrency: 'EUR',
    defaultTaxMode: 'EXCLUSIVE',
    defaultTaxRate: 19,
    paymentTermsDays: 15,
    paymentInstructions: '',
    internalNotes: '',
  };
}

function workspace(ready, invoiceCreated = false) {
  const client = profile(ready);
  const missing = ready ? [] : ['addressLine1', 'city'];
  return {
    opportunity,
    proposals: [{
      id: 'proposal_1',
      activityType: 'PROPOSAL',
      subject: 'TRAVLS proposal',
      outcome: 'ACCEPTED',
      occurredAt: '2026-08-01T10:00:00Z',
      metadata: { recordType: 'AKARI_PROPOSAL_V1', status: 'ACCEPTED', amount: 15000, currency: 'USD' },
    }],
    negotiations: [{
      id: 'negotiation_1',
      activityType: 'NEGOTIATION',
      subject: 'Final terms',
      outcome: 'AGREED_IN_PRINCIPLE',
      occurredAt: '2026-08-02T10:00:00Z',
      metadata: { recordType: 'AKARI_NEGOTIATION_V1', currentOffer: 15000, currency: 'USD' },
    }],
    closures: [],
    engagements: [engagement],
    finance: {
      invoices: invoiceCreated ? [{
        id: 'invoice_1', invoiceNumber: 'AKARI-2026-0001', invoiceDate: '2026-08-04',
        total: 119, received: 0, outstanding: 119, currency: 'EUR', status: 'INVOICED',
      }] : [],
      receipts: [],
      credits: [],
      referrals: [],
    },
    clientBilling: {
      profile: client,
      saved: ready,
      readiness: { complete: ready, missing },
      updatedAt: ready ? '2026-08-04T10:00:00Z' : null,
    },
    issuerBilling: { readiness: { complete: true, missing: [] } },
    commercialReadiness: {
      qualified: true,
      proposalRecorded: true,
      proposalAccepted: true,
      negotiationRecorded: true,
      won: true,
      lost: false,
      clientConverted: true,
      engagementReady: true,
      invoiceEligible: true,
      clientBillingReady: ready,
      clientBillingMissing: missing,
      issuerBillingReady: true,
      issuerBillingMissing: [],
      invoiceReady: ready,
      invoiceCount: invoiceCreated ? 1 : 0,
      received: 0,
      outstanding: invoiceCreated ? 119 : 0,
      nextAction: ready ? (invoiceCreated ? 'Collect or reconcile the outstanding invoice balance.' : 'Issue the first invoice from the won engagement.') : 'Complete the client billing profile before issuing an invoice.',
      nextActionCode: ready ? (invoiceCreated ? 'COLLECT_PAYMENT' : 'CREATE_INVOICE') : 'COMPLETE_CLIENT_BILLING',
    },
    permissions: {
      canWrite: true,
      canFinance: true,
      canApproveProposal: true,
      canEditClientBilling: true,
    },
  };
}

function genericPayload(path) {
  if (path === '/api/me') return me;
  if (path === '/api/profile') return { user: me.user };
  if (path === '/api/dashboard') {
    return {
      currency: 'USD',
      metrics: {
        monthlyTarget: 0, revenueBooked: 15000, revenueCollected: 0, netRevenue: 15000,
        weightedPipeline: 0, activeOpportunities: 0, yearToDateRevenue: 0,
        activeCustomers: 1, activeCampaigns: 1, outstandingPayments: 0, referralRewardsDue: 0,
      },
    };
  }
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items: [], total: 0 };
  if (path === '/api/akari-leads?limit=8&offset=0') return { items: [], total: 896, categories: [], canWrite: true };
  if (path.startsWith('/api/akari-leads')) return { items: [], total: 896, categories: [], canWrite: true };
  if (path === '/api/campaigns') return { items: [], total: 0 };
  if (path === '/api/partners') return { items: [], total: 0 };
  if (path === '/api/contacts') return { items: [], total: 0 };
  if (path === '/api/payments') return { items: [], total: 0 };
  if (path === '/api/reports') return { pipelineByStage: [], revenueByMonth: [] };
  return { items: [], total: 0 };
}

test('won deal becomes invoice-ready after saving the client profile and reuses it in the invoice', async ({ page }) => {
  let profileReady = false;
  let invoiceCreated = false;
  const profileWrites = [];
  const invoiceWrites = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;

    if (url.pathname === '/api/opportunities' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [opportunity], total: 1 }) });
      return;
    }
    if (url.pathname === '/api/opportunities/opp_travls/workspace') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspace(profileReady, invoiceCreated)) });
      return;
    }
    if (url.pathname === '/api/projects/project_travls/billing-profile' && request.method() === 'GET') {
      const current = profile(profileReady);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: { id: 'project_travls', name: 'TRAVLS' },
          profile: current,
          readiness: { complete: profileReady, missing: profileReady ? [] : ['addressLine1', 'city'] },
          saved: profileReady,
        }),
      });
      return;
    }
    if (url.pathname === '/api/projects/project_travls/billing-profile' && request.method() === 'PATCH') {
      const submitted = request.postDataJSON();
      profileWrites.push(submitted);
      profileReady = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: { id: 'project_travls', name: 'TRAVLS' },
          profile: { ...profile(true), ...submitted },
          readiness: { complete: true, missing: [] },
          saved: true,
          updated: true,
        }),
      });
      return;
    }
    if (url.pathname === '/api/billing-profile') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tenant: { name: 'AKARI House', baseCurrency: 'USD' },
          billingProfile: {
            legalName: 'AKARI House', addressLine1: 'Issuer Street 1', city: 'Frankfurt',
            postalCode: '60311', country: 'Germany', invoicePrefix: 'AKARI',
            defaultTaxRate: 0, defaultPaymentTermsDays: 14,
          },
        }),
      });
      return;
    }
    if (url.pathname === '/api/invoices' && request.method() === 'POST') {
      invoiceWrites.push(request.postDataJSON());
      invoiceCreated = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'invoice_1', invoiceNumber: 'AKARI-2026-0001', total: 119, status: 'INVOICED', created: true }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(genericPayload(path)) });
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  const card = page.locator('[data-akari-opportunity-id="opp_travls"]');
  await expect(card).toContainText('TRAVLS creator campaign');
  await card.getByRole('button', { name: 'Manage lifecycle' }).click();

  await expect(page.getByRole('dialog', { name: 'Revenue lifecycle workspace' })).toBeVisible();
  await expect(page.getByText('Commercial readiness', { exact: true })).toBeVisible();
  await expect(page.locator('.bd-next-action')).toContainText('Complete the client billing profile');
  await expect(page.locator('.bd-commercial-readiness')).toContainText('Missing: AddressLine1, City');

  await page.locator('[data-client-billing-action="edit"]').first().click();
  const billingForm = page.locator('#bd-client-billing-form');
  await expect(billingForm).toBeVisible();
  await billingForm.locator('[name="addressLine1"]').fill('Client Street 2');
  await billingForm.locator('[name="city"]').fill('Berlin');
  await billingForm.locator('[name="postalCode"]').fill('10115');
  await billingForm.locator('button[type="submit"]').click();

  await expect.poll(() => profileWrites.length).toBe(1);
  await expect(page.locator('.bd-commercial-readiness')).toContainText('Invoice ready');
  await expect(page.locator('.bd-next-action')).toContainText('Issue the first invoice');

  await page.locator('.bd-commercial-readiness [data-revenue-action="invoice"]').click();
  const invoiceForm = page.locator('#revenue-active-form');
  await expect(invoiceForm).toHaveAttribute('data-bd-invoice-readiness-r31', 'ready');
  await expect(invoiceForm.locator('[name="recipientName"]')).toHaveValue('TRAVLS Ltd');
  await expect(invoiceForm.locator('[name="recipientEmail"]')).toHaveValue('billing@travls.example');
  await expect(invoiceForm.locator('[name="recipientAddressLine1"]')).toHaveValue('Client Street 2');
  await expect(invoiceForm.locator('[name="recipientCity"]')).toHaveValue('Berlin');
  await expect(invoiceForm.locator('[name="recipientVatId"]')).toHaveValue('DE123456789');
  await expect(invoiceForm.locator('[name="currency"]')).toHaveValue('EUR');
  await expect(invoiceForm.locator('[name="taxMode"]')).toHaveValue('EXCLUSIVE');
  await expect(invoiceForm.locator('[name="taxRate"]')).toHaveValue('19');
  await expect(invoiceForm.locator('[name="dueDate"]')).toHaveValue('2026-08-19');

  await invoiceForm.locator('[name="amount"]').fill('100');
  await invoiceForm.locator('button[type="submit"]').click();
  await expect.poll(() => invoiceWrites.length).toBe(1);
  expect(profileWrites.length).toBe(2);
  expect(invoiceWrites[0].projectId).toBe('project_travls');
  expect(invoiceWrites[0].campaignId).toBe('campaign_travls');
  expect(invoiceWrites[0].opportunityId).toBe('opp_travls');
  expect(invoiceWrites[0].taxMode).toBe('EXCLUSIVE');
  expect(invoiceWrites[0].taxRate).toBe(19);
  expect(invoiceWrites[0].recipient.addressLine1).toBe('Client Street 2');
  expect(invoiceWrites[0].recipient.vatId).toBe('DE123456789');
});

test('commercial readiness and client billing remain usable on a phone viewport', async ({ page }) => {
  let profileReady = true;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;
    if (url.pathname === '/api/opportunities') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [opportunity], total: 1 }) });
      return;
    }
    if (url.pathname === '/api/opportunities/opp_travls/workspace') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspace(profileReady, false)) });
      return;
    }
    if (url.pathname === '/api/projects/project_travls/billing-profile') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ project: { id: 'project_travls', name: 'TRAVLS' }, profile: profile(true), readiness: { complete: true, missing: [] }, saved: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(genericPayload(path)) });
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  const card = page.locator('[data-akari-opportunity-id="opp_travls"]');
  await card.getByRole('button', { name: 'Manage lifecycle' }).click();
  await expect(page.getByText('Commercial readiness', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.bd-commercial-readiness').getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      panelLeft: panel.left,
      panelRight: panel.right,
      columns: getComputedStyle(document.querySelector('.bd-readiness-grid')).gridTemplateColumns,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.columns.split(' ').length).toBe(1);

  await page.locator('[data-client-billing-action="edit"]').first().click();
  await expect(page.locator('#bd-client-billing-form')).toBeVisible();
  await expect(page.locator('#bd-client-billing-form button[type="submit"]')).toBeVisible();
});
