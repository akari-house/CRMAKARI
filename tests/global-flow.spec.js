import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const lead = {
  id: 'lead-1',
  name: 'Example Project',
  category: 'AI',
  priority: 'HIGH',
  lifecycle_status: 'LEAD',
  source_name: 'Referral',
  contact_count: 1,
  primary_contact: 'Alex Example',
  primary_contact_email: 'alex@example.test',
  owner: 'Muaz Xinthi',
};

async function mockApi(page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let payload = {};

    if (path === '/api/me') {
      payload = { user: { fullName: 'Muaz Xinthi', email: 'muaz@example.test', role: 'OWNER', tenantSlug: 'akari-house', financeAccess: true } };
    } else if (path === '/api/dashboard') {
      payload = {
        currency: 'USD',
        metrics: {
          monthlyTarget: 0,
          revenueBooked: 0,
          revenueCollected: 0,
          netRevenue: 0,
          weightedPipeline: 0,
          yearToDateRevenue: 0,
          activeCustomers: 0,
          activeCampaigns: 0,
          outstandingPayments: 0,
          referralRewardsDue: 0,
          activeOpportunities: 0,
        },
      };
    } else if (path === '/api/tasks') {
      payload = { items: [] };
    } else if (path === '/api/opportunities') {
      payload = { items: [] };
    } else if (path === '/api/akari-leads') {
      payload = { items: [lead], total: 1, categories: [{ category: 'AI', count: 1 }], owners: [] };
    } else if (path === '/api/campaigns') {
      payload = { items: [] };
    } else if (path === '/api/payments') {
      payload = { items: [] };
    } else if (path === '/api/partners') {
      payload = { items: [] };
    } else if (path === '/api/contacts') {
      payload = { items: [] };
    } else if (path === '/api/reports') {
      payload = { pipelineByStage: [], revenueByMonth: [] };
    } else if (path.startsWith('/api/projects/')) {
      payload = { ...lead, contacts: [], opportunities: [], activities: [] };
    } else if (request.method() !== 'GET') {
      payload = { ok: true, id: 'created-1' };
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

async function ready(page) {
  await expect(page.locator('html')).toHaveAttribute('data-akari-interactive', 'ready');
}

test('clean paths preserve navigation and restore the rich dashboard', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app/akari-house/home');
  await ready(page);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await expect(page.locator('.kpi-grid .kpi')).toHaveCount(5);
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await page.locator('.nav-item[data-route="day"]').click();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/akari-house/day');
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await page.locator('.nav-item[data-route="opportunities"]').click();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/akari-house/opportunities');

  await page.locator('.nav-item[data-route="dashboard"]').click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/akari-house/home');

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/akari-house/opportunities');
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/akari-house/day');

  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();

  await page.locator('.nav-item[data-route="dashboard"]').click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await expect(page.locator('.kpi-grid .kpi')).toHaveCount(5);
});

test('modal fields remain interactive and only an intentional dismissal closes the modal', async ({ page }) => {
  await mockApi(page);
  await page.goto('/app/akari-house/home');
  await ready(page);

  await page.locator('.nav-item[data-route="campaigns"]').click();
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  await page.locator('[data-action="new-campaign"]').first().click();

  const modal = page.locator('#modal-root .modal');
  await expect(modal).toBeVisible();
  const name = modal.locator('input[name="name"]');
  await name.click();
  await name.fill('AKARI Creator Activation');
  await modal.locator('input[name="region"]').fill('Asia');
  await modal.locator('textarea[name="deliverablesSummary"]').fill('Creator posts and reporting');
  await expect(name).toHaveValue('AKARI Creator Activation');
  await expect(modal).toBeVisible();

  await page.locator('#modal-root .modal-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(modal).toHaveCount(0);

  await page.locator('[data-action="new-campaign"]').first().click();
  await expect(page.locator('#modal-root .modal')).toBeVisible();
  await page.locator('#modal-root .modal .close').click();
  await expect(page.locator('#modal-root .modal')).toHaveCount(0);
});

test('Cloudflare Pages rewrites cover every clean CRM route', async () => {
  const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
  for (const path of ['/dashboard', '/day', '/flows', '/leads', '/contacts', '/opportunities', '/fundraising', '/campaigns', '/partners', '/finance', '/reports', '/team', '/settings']) {
    expect(redirects).toContain(`${path} /enter-crm 302`);
  }
});
