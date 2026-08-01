import { test, expect } from '@playwright/test';

const lead = {
  id: 'prj_1', name: 'Project Alpha', category: 'Web3', lifecycle_status: 'LEAD', priority: 'HIGH',
  website: 'https://alpha.example', x_url: 'https://x.com/projectalpha', telegram: '@projectalpha',
  owner: 'Muaz Test', owner_user_id: 'usr_test', primary_contact: 'Alice', primary_contact_telegram: '@alice',
  primary_contact_x: 'https://x.com/alice', contact_count: 1, identity_complete: true,
  contact_identity_complete: true, open_opportunities: 1, pipeline_value: 10000, source_name: 'Referral',
  referral_partner_name: 'Partner One', next_follow_up_at: '2030-01-01T10:00:00Z',
};
const project = {
  ...lead,
  contacts: [{ id: 'con_1', project_id: 'prj_1', full_name: 'Alice', job_title: 'Founder', email: 'alice@example.com', telegram: '@alice', x_handle: 'https://x.com/alice', preferred_channel: 'Telegram', is_primary_contact: 1, is_decision_maker: 1, notes: 'Primary decision maker' }],
  opportunities: [],
  activities: [{ id: 'act_1', activity_type: 'TELEGRAM', subject: 'Initial outreach', occurred_at: '2030-01-01T09:00:00Z', outcome: 'Replied' }],
};

function responseFor(request) {
  const url = new URL(request.url());
  const key = `${url.pathname}${url.search}`;
  if (url.pathname === '/api/me') return { user: { userId: 'usr_test', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } };
  if (url.pathname === '/api/dashboard') return { currency: 'USD', metrics: {} };
  if (url.pathname === '/api/tasks') return { items: [], total: 0 };
  if (url.pathname === '/api/opportunities') return { items: [], total: 0 };
  if (url.pathname === '/api/campaigns' || url.pathname === '/api/payments' || url.pathname === '/api/partners' || url.pathname === '/api/contacts') return { items: [], total: 0 };
  if (url.pathname === '/api/team') return { items: [], total: 0 };
  if (url.pathname === '/api/reports') return { pipelineByStage: [], revenueByMonth: [] };
  if (url.pathname === '/api/projects/prj_1/timeline') return { items: [
    { id: 'act_1', kind: 'ACTIVITY', type: 'TELEGRAM', title: 'Initial outreach', outcome: 'Replied', actor: 'Muaz Test', occurredAt: '2030-01-01T09:00:00Z' },
    { id: 'aud_1', kind: 'AUDIT', type: 'CONTACT_UPDATED', title: 'Contact Updated', actor: 'Muaz Test', occurredAt: '2030-01-01T10:00:00Z', before: { email: 'old@example.com' }, after: { email: 'alice@example.com' } },
  ], auditVisible: true };
  if (url.pathname === '/api/projects/prj_1') return project;
  if (url.pathname === '/api/projects') return { items: [lead], total: 1 };
  if (url.pathname === '/api/contacts/con_1' && request.method() === 'PATCH') return { id: 'con_1', updated: true };
  if (url.pathname === '/api/akari-leads') return {
    items: [lead], total: 1, categories: [{ category: 'Web3', count: 1 }],
    lifecycles: [{ lifecycle: 'LEAD', count: 1 }], owners: [{ id: 'usr_test', full_name: 'Muaz Test' }],
    limit: Number(url.searchParams.get('limit') || 50), offset: Number(url.searchParams.get('offset') || 0), canWrite: true,
  };
  if (key === '/api/tasks?scope=mine') return { items: [], total: 0 };
  return { items: [], total: 0 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(route.request())) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Good evening, Muaz/i })).toBeVisible();
});

test('advanced lead filters are server-driven and persist on the live Leads page', async ({ page }) => {
  await page.locator('.sidebar [data-route="leads"]').click();
  await expect(page.getByRole('heading', { name: 'AKARI Leads' })).toBeVisible();
  await expect(page.locator('.ak-lead-filter-toolbar[data-stabilization-m1="ready"]')).toBeVisible();
  await expect(page.locator('#m1-lead-lifecycle')).toBeVisible();
  await expect(page.locator('#m1-lead-follow-up')).toBeVisible();
  await expect(page.locator('#m1-lead-identity')).toBeVisible();
  await expect(page.locator('#m1-lead-owner')).toContainText('Muaz Test');

  await page.locator('#m1-lead-lifecycle').selectOption('LEAD');
  await page.locator('#m1-lead-follow-up').selectOption('scheduled');
  await page.locator('#m1-lead-identity').selectOption('complete');
  await page.locator('#m1-lead-sort').selectOption('updated');
  const requestPromise = page.waitForRequest((request) => request.url().includes('/api/akari-leads?') && request.url().includes('lifecycle=LEAD') && request.url().includes('identity=complete') && request.url().includes('sort=updated'));
  await page.locator('[data-action="apply-lead-filters"]').click();
  await requestPromise;
  await expect(page.getByText('Introduced by Partner One')).toBeVisible();
});

test('contact editing and operational timeline work in the live relationship modal', async ({ page }) => {
  await page.locator('.sidebar [data-route="leads"]').click();
  await expect(page.locator('.ak-lead-filter-toolbar[data-stabilization-m1="ready"]')).toBeVisible();
  await page.getByText('Project Alpha', { exact: true }).first().click();
  await expect(page.locator('#drawer-root .drawer.open')).toBeVisible();
  await expect(page.locator('#drawer-root h2')).toHaveText('Project Alpha');

  await page.locator('#drawer-root [data-drawer-tab="contacts"]').click();
  await expect(page.locator('#drawer-root [data-action="edit-contact-m1"]')).toBeVisible();
  await page.locator('#drawer-root [data-action="edit-contact-m1"]').click();
  await expect(page.getByRole('heading', { name: 'Edit Alice' })).toBeVisible();
  await page.locator('#m1-contact-form input[name="email"]').fill('alice+updated@example.com');
  const patch = page.waitForRequest((request) => request.url().endsWith('/api/contacts/con_1') && request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Save contact' }).click();
  await patch;
  await expect(page.getByText('Contact updated')).toBeVisible();
  await expect(page.locator('#drawer-root .drawer.open')).toBeVisible();

  await page.locator('#drawer-root [data-drawer-tab="activity"]').click();
  await expect(page.getByText('Contact Updated', { exact: true })).toBeVisible();
  await expect(page.getByText('Changed: Email')).toBeVisible();
});

test('stabilized lead workspace remains usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-bottom [data-route="leads"]').click();
  await expect(page.locator('.ak-lead-filter-toolbar[data-stabilization-m1="ready"]')).toBeVisible();
  await expect(page.locator('.ak-advanced-filter-row')).toBeVisible();
  await page.getByText('Project Alpha', { exact: true }).first().click();
  await expect(page.locator('#drawer-root .drawer.open')).toBeVisible();
  await page.locator('#drawer-root [data-drawer-tab="contacts"]').click();
  await expect(page.locator('#drawer-root [data-action="edit-contact-m1"]')).toBeVisible();
});
