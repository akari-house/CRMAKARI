import { test, expect } from '@playwright/test';

const projects = [{ id:'prj_1', name:'Project Alpha', category:'Web3', lifecycle_status:'LEAD', priority:'HIGH', source_name:'Referral', contact_count:1 }];

function responseFor(url) {
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;
  const responses = {
    '/api/me': { user:{ userId:'usr_owner', tenantId:'tenant_akari_house', tenantSlug:'akari-house', email:'owner@example.com', fullName:'Muaz Test', role:'OWNER', financeAccess:true } },
    '/api/dashboard': { currency:'USD', metrics:{ monthlyTarget:25000, revenueBooked:12500, revenueCollected:9000, netRevenue:6200, weightedPipeline:32000, activeOpportunities:1, yearToDateRevenue:80000, activeCustomers:1, activeCampaigns:0, activePartners:0, outstandingPayments:0, referralRewardsDue:0 } },
    '/api/tasks?scope=mine': { items:[], total:0 },
    '/api/tasks?scope=mine&includeCompleted=1': { items:[], total:0 },
    '/api/work-os?scope=mine': { scope:'mine', tasks:[], members:[{ id:'usr_owner', fullName:'Muaz Test', email:'owner@example.com', role:'OWNER' }], projects, opportunities:[], campaigns:[], calendarEvents:[], partnershipCandidates:[], fundraisingPlans:[], permissions:{ canWrite:true, canManage:true, canFinance:true } },
    '/api/projects?limit=5': { items:projects, total:1 },
    '/api/opportunities': { items:[], total:0 },
    '/api/akari-leads?limit=8&offset=0': { items:projects, total:1, categories:[{ category:'Web3', count:1 }], canWrite:true },
    '/api/akari-leads?limit=50&offset=0': { items:projects, total:1, categories:[{ category:'Web3', count:1 }], canWrite:true },
    '/api/campaigns': { items:[], total:0 },
    '/api/payments': { items:[], total:0 },
    '/api/contacts': { items:[], total:0 },
    '/api/partners': { items:[], total:0 },
    '/api/reports': { pipelineByStage:[], revenueByMonth:[] },
    '/api/team': { items:[{ id:'usr_owner', full_name:'Muaz Test', email:'owner@example.com', role:'OWNER', finance_access:1, status:'ACTIVE' }], total:1 },
  };
  if (responses[key]) return responses[key];
  if (parsed.pathname.startsWith('/api/akari-leads')) return responses['/api/akari-leads?limit=50&offset=0'];
  return { items:[], total:0 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(responseFor(route.request().url())) });
  });
});

test('legacy home alias resolves to the canonical Dashboard URL and navigation is unambiguous', async ({ page }) => {
  await page.goto('/app/akari-house/home');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/akari-house\/dashboard$/);

  const dashboard = page.locator('.sidebar [data-route="dashboard"]');
  await expect(dashboard).toHaveClass(/active/);
  await expect(dashboard).toContainText('Dashboard');

  const publicWebsite = page.locator('.sidebar .nav-item--public[data-public-home]');
  await expect(publicWebsite).toContainText('Public Website');
  await expect(publicWebsite).not.toContainText(/^Home$/);
  await expect(publicWebsite).toHaveAttribute('href', '/');
  await expect(publicWebsite).toHaveAttribute('aria-label', 'Open the public CRM by AKARI website');
});

test('Dashboard and Tasks keep clear protected URLs', async ({ page }) => {
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();

  const tasks = page.locator('.sidebar [data-route="day"]');
  await expect(tasks).toContainText('Tasks');
  await tasks.click();
  await expect(page).toHaveURL(/\/app\/akari-house\/day$/);

  await page.locator('.sidebar [data-route="dashboard"]').click();
  await expect(page).toHaveURL(/\/app\/akari-house\/dashboard$/);
  await expect(page.locator('.sidebar [data-route="dashboard"]')).toHaveClass(/active/);
});