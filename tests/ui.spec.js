import { test, expect } from '@playwright/test';

const dashboardProjects = [
  { id: 'prj_1', name: 'Project Alpha', category: 'Web3', lifecycle_status: 'LEAD' },
  { id: 'prj_2', name: 'A long relationship name that must truncate cleanly', category: 'Agent Infrastructure', lifecycle_status: 'PROSPECT' },
  { id: 'prj_3', name: 'Project Gamma', category: 'Gaming', lifecycle_status: 'CLIENT' },
  { id: 'prj_4', name: 'Project Delta', category: 'AI', lifecycle_status: 'LEAD' },
  { id: 'prj_5', name: 'Project Epsilon', category: 'Fintech', lifecycle_status: 'PARTNER' },
];

const responses = {
  '/api/me': { user: { userId: 'usr_test', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } },
  '/api/dashboard': { currency: 'USD', metrics: { monthlyTarget: 25000, revenueBooked: 12500, revenueCollected: 9000, netRevenue: 6200, weightedPipeline: 32000, activeOpportunities: 2, yearToDateRevenue: 80000, activeCustomers: 3, activeCampaigns: 1, activePartners: 2, outstandingPayments: 3500, referralRewardsDue: 400 } },
  '/api/tasks?scope=mine': { items: [{ id: 'tsk_1', title: 'Follow up Project Alpha', status: 'TODO', priority: 'HIGH', due_at: '2030-01-01T12:00:00Z', project_name: 'Project Alpha' }], total: 1 },
  '/api/tasks?scope=mine&includeCompleted=1': { items: [
    { id: 'tsk_1', title: 'Follow up Project Alpha', status: 'TODO', priority: 'HIGH', due_at: '2030-01-01T12:00:00Z', project_name: 'Project Alpha' },
    { id: 'tsk_2', title: 'Prepare discovery notes', status: 'IN_PROGRESS', priority: 'MEDIUM', due_at: '2030-01-02T12:00:00Z', project_name: 'Project Beta' },
    { id: 'tsk_3', title: 'Await partner reply', status: 'WAITING', priority: 'LOW', due_at: '2030-01-03T12:00:00Z', project_name: 'Project Gamma' },
  ], total: 3 },
  '/api/projects?limit=5': { items: dashboardProjects, total: dashboardProjects.length },
  '/api/opportunities': { items: [{ id: 'opp_1', project_id: 'prj_1', project_name: 'Project Alpha', name: 'Creator campaign', stage: 'QUALIFIED', estimated_value: 10000, currency: 'USD', probability_percentage: 60, owner_name: 'Muaz Test', next_action: 'Send proposal' }], total: 1 },
  '/api/akari-leads?limit=8&offset=0': { items: dashboardProjects.map((project) => ({ ...project, priority: 'HIGH', source_name: 'Referral', contact_count: 1 })), total: dashboardProjects.length, categories: [{ category: 'Web3', count: 1 }], canWrite: true },
  '/api/campaigns': { items: [], total: 0 },
  '/api/payments': { items: [], total: 0 },
  '/api/akari-leads?limit=50&offset=0': { items: [{ id: 'prj_1', name: 'Project Alpha', category: 'Web3', lifecycle_status: 'LEAD', priority: 'HIGH', owner: 'Muaz Test', primary_contact: 'Alice', contact_count: 1, open_opportunities: 1, pipeline_value: 10000, source_name: 'Referral' }], total: 1, categories: [{ category: 'Web3', count: 1 }], canWrite: true },
  '/api/contacts': { items: [], total: 0 },
  '/api/partners': { items: [], total: 0 },
  '/api/reports': { pipelineByStage: [], revenueByMonth: [] },
  '/api/team': { items: [{ id: 'usr_test', full_name: 'Muaz Test', email: 'owner@example.com', role: 'OWNER', finance_access: 1, status: 'ACTIVE' }], total: 1 },
  '/api/projects/prj_1': { id: 'prj_1', name: 'Project Alpha', lifecycle_status: 'LEAD', priority: 'HIGH', category: 'Web3', contacts: [], opportunities: [], activities: [] },
};

function responseFor(url) {
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;
  if (responses[key]) return responses[key];
  if (parsed.pathname.startsWith('/api/akari-leads')) return responses['/api/akari-leads?limit=50&offset=0'];
  if (parsed.pathname.startsWith('/api/projects/')) return responses['/api/projects/prj_1'];
  if (parsed.pathname.startsWith('/api/tasks/')) return { updated: true };
  return { items: [], total: 0 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(route.request().url())) });
  });
  await page.goto('http://127.0.0.1:4173/#/dashboard');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-akari-interactive', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-akari-ui', 'v1');
  await expect(page.locator('body')).toHaveClass(/ak-ui/);
  await expect(page.locator('.kpi').first()).toHaveClass(/ak-card/);
  await expect(page.locator('.panel').first()).toHaveClass(/ak-panel/);
});

test('dashboard cards and lead rows remain vertically structured', async ({ page }) => {
  const dashboardLeads = page.locator('#view-root .grid-2 .panel').nth(1).locator('.panel-body');
  await expect(dashboardLeads.locator('.task-card').first()).toBeVisible();

  const firstCard = page.locator('.kpi').first();
  const labelBox = await firstCard.locator('.kpi-label').boundingBox();
  const valueBox = await firstCard.locator('.kpi-value').boundingBox();
  const metaBox = await firstCard.locator('.kpi-meta').boundingBox();
  expect(labelBox).not.toBeNull();
  expect(valueBox).not.toBeNull();
  expect(metaBox).not.toBeNull();
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(valueBox.y + 1);
  expect(valueBox.y + valueBox.height).toBeLessThanOrEqual(metaBox.y + 1);

  await dashboardLeads.evaluate((root) => {
    const first = root.querySelector('.task-card');
    if (first && root.querySelectorAll('.task-card').length === 5) {
      const clone = first.cloneNode(true);
      clone.removeAttribute('data-open-lead');
      clone.setAttribute('aria-label', 'Layout regression sample');
      root.appendChild(clone);
    }
  });

  const rows = dashboardLeads.locator('.task-card');
  await expect(rows).toHaveCount(6);
  const firstRow = await rows.nth(0).boundingBox();
  const secondRow = await rows.nth(1).boundingBox();
  expect(firstRow).not.toBeNull();
  expect(secondRow).not.toBeNull();
  expect(secondRow.y).toBeGreaterThanOrEqual(firstRow.y + firstRow.height - 1);
  expect(firstRow.width).toBeGreaterThan(300);

  const overflow = await dashboardLeads.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('desktop navigation and forms are clickable', async ({ page }) => {
  await page.locator('.sidebar [data-route="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();

  await page.getByRole('button', { name: /New lead/i }).click();
  await expect(page.getByRole('heading', { name: 'New AKARI lead' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'New AKARI lead' })).toHaveCount(0);

  await page.getByText('Project Alpha', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Project Alpha' })).toBeVisible();
  await page.locator('#drawer-root button[data-action="close-drawer"]').click();
});

test('returning Dashboard after viewing Opportunities restores the rich dashboard', async ({ page }) => {
  await page.locator('.sidebar [data-route="opportunities"]').click();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect(page.locator('#view-root .pipeline .stage')).toHaveCount(6);
  await expect(page.locator('#view-root .kanban')).toHaveCount(0);

  await page.locator('.sidebar [data-route="dashboard"]').click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  await expect(page.locator('#view-root .kpi-grid .kpi')).toHaveCount(5);
});

test('command palette and task interaction work', async ({ page }) => {
  await page.keyboard.press('Control+K');
  await expect(page.locator('#command-input')).toBeVisible();
  await page.locator('[data-command="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();

  await page.locator('.sidebar [data-route="day"]').click();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  const todoCard=page.locator('[data-task-card="tsk_1"]');
  await expect(todoCard).toBeVisible();
  await todoCard.dragTo(page.locator('[data-task-column="IN_PROGRESS"] .task-board-dropzone'));
  await expect(page.locator('[data-task-column="IN_PROGRESS"] [data-task-card="tsk_1"]')).toBeVisible();
  await expect(page.getByText('Task moved to In Progress')).toBeVisible();
});

test('outreach flow exposes the full call and follow-up sequence', async ({ page }) => {
  await page.locator('.sidebar [data-route="flows"]').click();
  await expect(page.getByRole('heading', { name: 'Outreach Flows' })).toBeVisible();
  await expect(page.locator('.flow-node')).toHaveCount(12);
  await expect(page.getByText('First call', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Second follow-up email', { exact: true })).toBeVisible();
  await page.locator('[data-action="select-flow-node"][data-id="email-1"]').first().click();
  await expect(page.locator('.flow-inspector').getByRole('heading', { name: 'First follow-up email' })).toBeVisible();
  await expect(page.locator('.flow-inspector').getByText('Replied')).toBeVisible();
  await expect(page.locator('.flow-inspector').getByText('No reply')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#flow-zoom-label')).toContainText('%');
});

test('public Home is concise, interactive and separate from the CRM Dashboard', async ({ page }) => {
  await expect(page.locator('.sidebar .nav-item--public')).toHaveAttribute('href', '/');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /From relationships/i })).toBeVisible();
  await expect(page.locator('.landing-shot-grid').getByText('KlineO', { exact: true })).toBeVisible();
  await expect(page.locator('.landing-shot-grid').getByText('Yokai', { exact: true })).toBeVisible();
  await expect(page.getByText(/BotChain|Digimaaya/i)).toHaveCount(0);
  await page.locator('[data-action="select-landing-flow-node"][data-id="call"]').click();
  await expect(page.locator('#landing-flow-inspector')).toContainText('Discovery call');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
});

test('mobile navigation remains interactive', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-bottom [data-route="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
});
