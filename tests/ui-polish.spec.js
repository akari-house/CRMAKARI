import { test, expect } from '@playwright/test';

const lead = {
  id: 'prj_1',
  name: 'Project Alpha',
  category: 'Web3',
  lifecycle_status: 'LEAD',
  priority: 'HIGH',
  owner: 'Muaz Test',
  owner_user_id: 'usr_test',
  primary_contact: 'Alice',
  primary_contact_x: '@alice',
  primary_contact_telegram: '@alice',
  contact_count: 1,
  pipeline_value: 10000,
  source_name: 'Referral',
  identity_complete: 1,
  contact_identity_complete: 1,
};

function payloadFor(url) {
  const { pathname } = new URL(url);
  if (pathname === '/api/me') return { user: { userId: 'usr_test', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } };
  if (pathname === '/api/dashboard') return { currency: 'USD', metrics: { monthlyTarget: 0, revenueBooked: 0, revenueCollected: 0, netRevenue: 0, weightedPipeline: 10000, yearToDateRevenue: 0, activeCustomers: 0, activeCampaigns: 0, activePartners: 0, outstandingPayments: 0, referralRewardsDue: 0 } };
  if (pathname === '/api/tasks') return { items: [], total: 0 };
  if (pathname === '/api/opportunities') return { items: [], total: 0 };
  if (pathname === '/api/akari-leads') return { items: [lead], total: 1, categories: [{ category: 'Web3', count: 1 }], canWrite: true };
  if (pathname === '/api/campaigns' || pathname === '/api/payments' || pathname === '/api/contacts' || pathname === '/api/partners') return { items: [], total: 0 };
  if (pathname === '/api/team') return { items: [{ id: 'usr_test', full_name: 'Muaz Test', email: 'owner@example.com', role: 'OWNER', finance_access: 1, status: 'ACTIVE' }], total: 1 };
  if (pathname === '/api/reports') return { pipelineByStage: [], revenueByMonth: [] };
  if (pathname.startsWith('/api/projects/')) return { ...lead, contacts: [], opportunities: [], activities: [] };
  return { items: [], total: 0 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payloadFor(route.request().url())) });
  });
});

test('desktop shell hides redundant menu and keeps operational headers compact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeVisible();
  await expect(page.locator('.mobile-menu')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeVisible();

  await page.locator('.sidebar [data-route="day"]').click();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  const dayHeader = await page.locator('#view-root .page-head').boundingBox();
  expect(dayHeader).not.toBeNull();
  expect(dayHeader.height).toBeLessThan(105);

  await page.locator('.sidebar [data-route="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();
  const leadHeader = await page.locator('#view-root .page-head').boundingBox();
  expect(leadHeader).not.toBeNull();
  expect(leadHeader.height).toBeLessThan(105);

  const toolbar = page.locator('#view-root .toolbar').first();
  await expect(toolbar).toBeVisible();
  const search = await toolbar.locator('input').first().boundingBox();
  const category = await toolbar.locator('select').first().boundingBox();
  expect(search).not.toBeNull();
  expect(category).not.toBeNull();
  expect(Math.abs(search.y - category.y)).toBeLessThan(8);
});

test('mobile shell keeps the navigation menu available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeVisible();
  await expect(page.locator('.mobile-menu')).toBeVisible();
  await page.locator('.mobile-menu').click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
});
