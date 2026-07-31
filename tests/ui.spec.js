import { test, expect } from '@playwright/test';

const responses = {
  '/api/me': { user: { userId: 'usr_test', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } },
  '/api/dashboard': { currency: 'USD', metrics: { monthlyTarget: 25000, revenueBooked: 12500, revenueCollected: 9000, netRevenue: 6200, weightedPipeline: 32000, activeOpportunities: 2, yearToDateRevenue: 80000, activeCustomers: 3, activeCampaigns: 1, activePartners: 2, outstandingPayments: 3500, referralRewardsDue: 400 } },
  '/api/tasks?scope=mine': { items: [{ id: 'tsk_1', title: 'Follow up Project Alpha', status: 'TODO', priority: 'HIGH', due_at: '2030-01-01T12:00:00Z', project_name: 'Project Alpha' }], total: 1 },
  '/api/opportunities': { items: [{ id: 'opp_1', project_id: 'prj_1', project_name: 'Project Alpha', name: 'Creator campaign', stage: 'QUALIFIED', estimated_value: 10000, currency: 'USD', probability_percentage: 60, owner_name: 'Muaz Test', next_action: 'Send proposal' }], total: 1 },
  '/api/akari-leads?limit=8&offset=0': { items: [{ id: 'prj_1', name: 'Project Alpha', category: 'Web3', priority: 'HIGH', source_name: 'Referral', contact_count: 1 }], total: 1, categories: [{ category: 'Web3', count: 1 }], canWrite: true },
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
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.getByRole('heading', { name: /Good evening, Muaz/i })).toBeVisible();
});

test('desktop navigation and forms are clickable', async ({ page }) => {
  await page.getByRole('button', { name: /AKARI Leads/i }).click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();

  await page.getByRole('button', { name: /New lead/i }).click();
  await expect(page.getByRole('heading', { name: 'New AKARI lead' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'New AKARI lead' })).toHaveCount(0);

  await page.getByText('Project Alpha', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Project Alpha' })).toBeVisible();
  await page.getByRole('button', { name: '×' }).click();
});

test('command palette and task interaction work', async ({ page }) => {
  await page.keyboard.press('Control+K');
  await expect(page.locator('#command-input')).toBeVisible();
  await page.locator('[data-command="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();

  await page.getByRole('button', { name: /My Day/i }).click();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await page.locator('[data-action="toggle-task"]').click();
  await expect(page.getByText('Task completed')).toBeVisible();
});

test('mobile navigation remains interactive', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Leads/i }).last().click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();
  await page.getByRole('button', { name: /More/i }).click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
});
