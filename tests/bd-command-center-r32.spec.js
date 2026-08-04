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
  id: 'opp_priority',
  project_id: 'project_priority',
  project_name: 'Priority Project',
  project_lifecycle_status: 'ACTIVE_OPPORTUNITY',
  name: 'Priority Project campaign',
  service_type: 'MARKETING_CAMPAIGN',
  stage: 'NEGOTIATION',
  estimated_value: 25000,
  estimated_value_base_currency: 25000,
  currency: 'USD',
  probability_percentage: 80,
  expected_close_date: '2026-08-07',
  owner_name: 'Muaz Test',
  primary_contact_name: 'Alice',
  primary_contact_email: 'alice@example.com',
  next_action: 'Confirm final scope',
  next_follow_up_at: '2026-08-03T09:00:00Z',
  need_confirmed: 1,
  decision_maker_confirmed: 1,
  timeline_confirmed: 1,
  budget_status: 'CONFIRMED',
  qualificationComplete: true,
};

const topAction = {
  id: 'opportunity:opp_priority:overdue',
  entityType: 'OPPORTUNITY',
  entityId: 'opp_priority',
  projectId: 'project_priority',
  opportunityId: 'opp_priority',
  projectName: 'Priority Project',
  title: 'Progress Priority Project campaign',
  reason: 'Opportunity follow-up is 1 day overdue.',
  evidence: ['Stage: NEGOTIATION', 'Next action: Confirm final scope', 'Owner: Muaz Test'],
  score: 119,
  urgency: 'CRITICAL',
  route: 'opportunities',
  actionLabel: 'Manage deal',
  dueAt: '2026-08-03T09:00:00Z',
  ownerName: 'Muaz Test',
  priority: 'HIGH',
  category: 'OPPORTUNITY_OVERDUE',
};

const secondAction = {
  id: 'lead:lead_due:today',
  entityType: 'PROJECT',
  entityId: 'lead_due',
  projectId: 'lead_due',
  opportunityId: null,
  projectName: 'Lead Due Today',
  title: 'Follow up with Lead Due Today today',
  reason: 'The next relationship action is due today.',
  evidence: ['Priority: HIGH', 'Owner: Muaz Test'],
  score: 98,
  urgency: 'HIGH',
  route: 'leads',
  actionLabel: 'Open lead',
  dueAt: '2026-08-04T15:00:00Z',
  ownerName: 'Muaz Test',
  priority: 'HIGH',
  category: 'DUE_TODAY',
};

function commandPayload(scope) {
  const team = scope === 'team';
  return {
    generatedAt: '2026-08-04T12:00:00Z',
    scope: team ? 'TEAM' : 'MINE',
    canManage: true,
    canFinance: true,
    summary: {
      dueToday: 1,
      overdueFollowUps: 1,
      unassigned: team ? 2 : 0,
      staleLeads: team ? 3 : 0,
      opportunityRisks: 1,
      proposalFollowUps: 1,
      closingThisWeek: 1,
      commercialHandoffs: team ? 2 : 1,
      totalActions: team ? 5 : 2,
    },
    rankedActions: team ? [
      { ...topAction, title: 'Assign Team Risk', reason: 'No accountable owner is assigned.', category: 'UNASSIGNED', score: 122, entityType: 'PROJECT', entityId: 'team_risk', projectId: 'team_risk', opportunityId: null, actionLabel: 'Open lead', projectName: 'Team Risk', ownerName: null },
      topAction,
      secondAction,
    ] : [topAction, secondAction],
    queues: {},
    evidence: { leadRecordsReviewed: team ? 896 : 84, opportunityRecordsReviewed: team ? 12 : 3 },
  };
}

function workspacePayload() {
  return {
    opportunity,
    proposals: [],
    negotiations: [],
    closures: [],
    engagements: [],
    finance: { invoices: [], receipts: [], credits: [], referrals: [] },
    clientBilling: {
      profile: { legalName: 'Priority Project', billingEmail: 'billing@example.com', addressLine1: '', city: '', country: 'Germany' },
      saved: false,
      readiness: { complete: false, missing: ['addressLine1', 'city'] },
    },
    issuerBilling: { readiness: { complete: true, missing: [] } },
    commercialReadiness: {
      qualified: true,
      proposalRecorded: false,
      proposalAccepted: false,
      negotiationRecorded: false,
      won: false,
      lost: false,
      clientConverted: false,
      engagementReady: false,
      invoiceEligible: false,
      clientBillingReady: false,
      clientBillingMissing: ['addressLine1', 'city'],
      issuerBillingReady: true,
      issuerBillingMissing: [],
      invoiceReady: false,
      invoiceCount: 0,
      received: 0,
      outstanding: 0,
      nextAction: 'Create the first commercial proposal.',
      nextActionCode: 'CREATE_PROPOSAL',
    },
    permissions: { canWrite: true, canFinance: true, canApproveProposal: true, canEditClientBilling: true },
  };
}

function genericPayload(path) {
  if (path === '/api/me') return me;
  if (path === '/api/profile') return { user: me.user };
  if (path === '/api/dashboard') {
    return {
      currency: 'USD',
      metrics: {
        monthlyTarget: 0,
        revenueBooked: 0,
        revenueCollected: 0,
        netRevenue: 0,
        weightedPipeline: 20000,
        activeOpportunities: 1,
        yearToDateRevenue: 0,
        activeCustomers: 0,
        activeCampaigns: 0,
        outstandingPayments: 0,
        referralRewardsDue: 0,
      },
    };
  }
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items: [], total: 0 };
  if (path.startsWith('/api/akari-leads')) return { items: [], total: 896, categories: [], canWrite: true };
  if (path === '/api/opportunities') return { items: [opportunity], total: 1 };
  if (path === '/api/campaigns') return { items: [], total: 0 };
  if (path === '/api/partners') return { items: [], total: 0 };
  if (path === '/api/contacts') return { items: [], total: 0 };
  if (path === '/api/payments') return { items: [], total: 0 };
  if (path === '/api/reports') return { pipelineByStage: [], revenueByMonth: [] };
  return { items: [], total: 0 };
}

async function mockApi(page, counters) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;

    if (url.pathname === '/api/bd-command-center') {
      const scope = url.searchParams.get('scope') || 'mine';
      counters[scope] = (counters[scope] || 0) + 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(commandPayload(scope)) });
      return;
    }
    if (url.pathname === '/api/opportunities/opp_priority/workspace') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspacePayload()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(genericPayload(path)) });
  });
}

test('dashboard ranks one explicit next action and managers can switch to team risks', async ({ page }) => {
  const counters = {};
  await mockApi(page, counters);

  await page.goto('http://127.0.0.1:4173/app/akari-house/dashboard');
  await expect(page.getByRole('heading', { name: /Good .* Muaz/i })).toBeVisible();

  const panel = page.locator('[data-bd-command-center="ready"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-bd-command-scope', 'mine');
  await expect(panel.getByText('BD command centre', { exact: true })).toBeVisible();
  await expect(panel.getByText('Progress Priority Project campaign', { exact: true })).toBeVisible();
  await expect(panel.getByText('Opportunity follow-up is 1 day overdue.', { exact: true })).toBeVisible();
  await expect(panel.getByText('Stage: NEGOTIATION', { exact: true })).toBeVisible();
  await expect(panel.getByText('119', { exact: true }).first()).toBeVisible();
  expect(counters.mine).toBe(1);

  await panel.getByRole('button', { name: 'Manage deal' }).click();
  await expect(page.getByRole('dialog', { name: 'Revenue lifecycle workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Close revenue workspace' }).click();

  await page.locator('[data-bd-command-center="ready"]').getByRole('button', { name: 'Team risks' }).click();
  const teamPanel = page.locator('[data-bd-command-center="ready"]');
  await expect(teamPanel).toHaveAttribute('data-bd-command-scope', 'team');
  await expect(teamPanel.getByText('Assign Team Risk', { exact: true })).toBeVisible();
  await expect(teamPanel.locator('.bd-command-metric').filter({ hasText: 'Unassigned' })).toContainText('2');
  await expect.poll(() => counters.team).toBe(1);
});

test('BD command centre remains within the phone viewport', async ({ page }) => {
  const counters = {};
  await mockApi(page, counters);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4173/app/akari-house/dashboard');

  const panel = page.locator('[data-bd-command-center="ready"]');
  await expect(panel).toBeVisible();
  const geometry = await page.evaluate(() => {
    const element = document.querySelector('[data-bd-command-center="ready"]');
    const box = element.getBoundingClientRect();
    const metrics = document.querySelector('.bd-command-metrics');
    const columns = getComputedStyle(metrics).gridTemplateColumns.split(' ').length;
    return {
      viewport: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      left: box.left,
      right: box.right,
      columns,
    };
  });

  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.columns).toBe(2);
  await expect(panel.getByRole('button', { name: 'Manage deal' })).toBeVisible();
});
