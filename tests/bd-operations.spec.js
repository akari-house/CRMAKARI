import { test, expect } from '@playwright/test';

const operations = {
  summary: {
    totalLeads: 12,
    unassignedLeads: 3,
    missingFollowUp: 5,
    overdueFollowUp: 2,
    missingProjectIdentity: 1,
    missingPrimaryContact: 4,
    archivedLeads: 0,
  },
  members: [
    { id: 'usr_owner', fullName: 'Muaz Test', email: 'owner@example.com', userStatus: 'ACTIVE', role: 'OWNER', financeAccess: true, membershipStatus: 'ACTIVE', assignedLeads: 7, missingFollowUp: 2, overdueFollowUp: 1, activeOpportunities: 2, openTasks: 3 },
    { id: 'usr_bd', fullName: 'BD Member', email: 'bd@example.com', userStatus: 'ACTIVE', role: 'BD_MEMBER', financeAccess: false, membershipStatus: 'ACTIVE', assignedLeads: 5, missingFollowUp: 3, overdueFollowUp: 1, activeOpportunities: 1, openTasks: 4 },
  ],
  canManage: true,
  canAdmin: true,
  actor: { userId: 'usr_owner', tenantId: 'tenant_akari_house', role: 'OWNER' },
};

const lead = {
  id: 'prj_1', name: 'Project Alpha', category: 'Web3', lifecycle_status: 'LEAD', priority: 'MEDIUM',
  owner_user_id: null, owner: null, primary_contact: 'Alice', primary_contact_x: 'https://x.com/alice',
  primary_contact_telegram: '@alice', contact_count: 1, website: 'https://alpha.example', x_url: 'https://x.com/alpha',
  telegram: '@alpha', region: 'Germany', source_name: 'Referral', identity_complete: true, contact_identity_complete: true,
};

function payloadFor(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/me') return { user: { userId: 'usr_owner', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } };
  if (parsed.pathname === '/api/dashboard') return { currency: 'USD', metrics: { monthlyTarget: 0, revenueBooked: 0, revenueCollected: 0, netRevenue: 0, weightedPipeline: 0, activeOpportunities: 0, yearToDateRevenue: 0, activeCustomers: 0, activeCampaigns: 0, activePartners: 0, outstandingPayments: 0, referralRewardsDue: 0 } };
  if (parsed.pathname === '/api/tasks') return { items: [], total: 0 };
  if (parsed.pathname === '/api/opportunities') return { items: [], total: 0 };
  if (parsed.pathname === '/api/campaigns') return { items: [], total: 0 };
  if (parsed.pathname === '/api/payments') return { items: [], total: 0 };
  if (parsed.pathname === '/api/bd-operations') return operations;
  if (parsed.pathname === '/api/akari-leads') return { items: [lead], total: 1, categories: [{ category: 'Web3', count: 1 }], lifecycles: [{ lifecycle: 'LEAD', count: 1 }], owners: operations.members.map((member) => ({ id: member.id, full_name: member.fullName })), canWrite: true };
  return { items: [], total: 0 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true, count: 1 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payloadFor(route.request().url())) });
  });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
});

test('BD leads expose quality queues selection bulk updates and saved views', async ({ page }) => {
  const posts = [];
  await page.unroute('**/api/**');
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true, count: 1 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payloadFor(route.request().url())) });
  });

  await page.locator('.sidebar [data-route="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();
  await expect(page.locator('[data-bdops-overview]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Unassigned 3/i })).toBeVisible();
  await expect(page.locator('[data-bdops-lead-select]')).toHaveCount(1);

  await page.locator('[data-bdops-lead-select]').check();
  await expect(page.locator('#bdops-bulk-toolbar')).toHaveClass(/active/);
  await page.locator('#bdops-bulk-owner').selectOption('usr_bd');
  await page.locator('#bdops-bulk-priority').selectOption('HIGH');
  await page.getByRole('button', { name: 'Apply update' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'bulk-update', projectIds: ['prj_1'], ownerUserId: 'usr_bd', priority: 'HIGH' });

  await page.locator('#bdops-view-name').fill('My high priority queue');
  await page.getByRole('button', { name: 'Save current view' }).click();
  await expect(page.locator('#bdops-view-select')).toContainText('My high priority queue');
});

test('Team page shows workload and submits controlled membership updates', async ({ page }) => {
  const posts = [];
  await page.unroute('**/api/**');
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true, member: { id: 'usr_bd' } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payloadFor(route.request().url())) });
  });

  await page.locator('.sidebar [data-route="team"]').click();
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  await expect(page.getByText('Team workload and controls')).toBeVisible();
  await expect(page.locator('.bdops-member')).toHaveCount(2);

  const controls = page.locator('[data-bdops-member="usr_bd"]');
  await controls.locator('[data-member-field="role"]').selectOption('BD_MANAGER');
  await controls.locator('[data-member-field="financeAccess"]').check();
  await controls.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ action: 'update-member', userId: 'usr_bd', role: 'BD_MANAGER', financeAccess: true, status: 'ACTIVE' });
});

test('BD operations remain usable without horizontal page overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-bottom [data-route="leads"]').click();
  await expect(page.locator('[data-bdops-overview]')).toBeVisible();
  const overflow = await page.locator('body').evaluate((body) => body.scrollWidth - body.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
