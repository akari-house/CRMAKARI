import { test, expect } from '@playwright/test';

let actions = [];

const workPayload = {
  scope: 'mine',
  tasks: [
    {
      id: 'tsk_work_1',
      title: 'Draft partnership quote',
      description: 'Prepare the announcement quote for partner review.',
      ownerUserId: 'usr_marketing',
      ownerName: 'Maya Marketing',
      status: 'TODO',
      priority: 'HIGH',
      dueAt: '2026-08-05T14:00:00.000Z',
      projectId: 'prj_1',
      projectName: 'Project Alpha',
      opportunityId: 'opp_won',
      opportunityName: 'Strategic partnership',
      campaignId: 'eng_1',
      campaignName: 'Partnership activation',
      activityType: 'WORKSTREAM:CONTENT',
      workstream: 'CONTENT',
      recurrenceRule: null,
      showOnHome: true,
    },
    {
      id: 'tsk_work_2',
      title: 'Create announcement graphics',
      description: 'Use approved partner assets.',
      ownerUserId: 'usr_design',
      ownerName: 'Dina Design',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueAt: '2026-08-06T16:00:00.000Z',
      projectId: 'prj_1',
      projectName: 'Project Alpha',
      opportunityId: 'opp_won',
      opportunityName: 'Strategic partnership',
      campaignId: 'eng_1',
      campaignName: 'Partnership activation',
      activityType: 'WORKSTREAM:DESIGN',
      workstream: 'DESIGN',
      recurrenceRule: null,
      showOnHome: true,
    },
  ],
  members: [
    { id: 'usr_owner', fullName: 'Muaz Test', email: 'owner@example.com', role: 'OWNER' },
    { id: 'usr_marketing', fullName: 'Maya Marketing', email: 'maya@example.com', role: 'BD_MEMBER' },
    { id: 'usr_design', fullName: 'Dina Design', email: 'dina@example.com', role: 'BD_MEMBER' },
  ],
  projects: [{ id: 'prj_1', name: 'Project Alpha', ownerUserId: 'usr_owner', lifecycleStatus: 'CLIENT' }],
  opportunities: [{ id: 'opp_won', projectId: 'prj_1', name: 'Strategic partnership', projectName: 'Project Alpha', stage: 'WON', ownerUserId: 'usr_owner' }],
  campaigns: [{ id: 'eng_1', projectId: 'prj_1', opportunityId: 'opp_won', name: 'Partnership activation', projectName: 'Project Alpha', status: 'ONBOARDING', ownerUserId: 'usr_owner' }],
  calendarEvents: [
    { id: 'TASK:tsk_work_1', sourceId: 'tsk_work_1', type: 'TASK', title: 'Draft partnership quote', startsAt: '2026-08-05T14:00:00.000Z', date: '2026-08-05', projectId: 'prj_1', projectName: 'Project Alpha', relation: 'Strategic partnership', status: 'TODO', priority: 'HIGH', workstream: 'CONTENT', readOnly: false },
    { id: 'INVESTOR_FOLLOW_UP:inv_1', sourceId: 'inv_1', type: 'INVESTOR_FOLLOW_UP', title: 'Investor follow-up: Horizon Ventures', startsAt: '2026-08-07T10:00:00.000Z', date: '2026-08-07', projectId: 'prj_1', projectName: 'Project Alpha', relation: 'Seed round', workstream: 'FUNDRAISING', readOnly: true },
  ],
  partnershipCandidates: [{ opportunityId: 'opp_won', opportunityName: 'Strategic partnership', projectId: 'prj_1', projectName: 'Project Alpha', campaignId: 'eng_1', campaignName: 'Partnership activation', ownerUserId: 'usr_owner' }],
  fundraisingPlans: [{ id: 'room_1', projectId: 'prj_1', projectName: 'Project Alpha', roundName: 'Seed round', stage: 'OPEN', targetCloseDate: '2026-09-30' }],
  permissions: { canWrite: true, canManage: true, canFinance: true },
};

function genericResponse(url) {
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;
  const responses = {
    '/api/me': { user: { userId: 'usr_owner', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } },
    '/api/dashboard': { currency: 'USD', metrics: { monthlyTarget: 25000, revenueBooked: 12500, revenueCollected: 9000, netRevenue: 6200, weightedPipeline: 32000, activeOpportunities: 1, yearToDateRevenue: 80000, activeCustomers: 1, activeCampaigns: 1, activePartners: 1, outstandingPayments: 0, referralRewardsDue: 0 } },
    '/api/tasks?scope=mine': { items: [], total: 0 },
    '/api/tasks?scope=mine&includeCompleted=1': { items: [], total: 0 },
    '/api/projects?limit=5': { items: [{ id: 'prj_1', name: 'Project Alpha', category: 'Web3', lifecycle_status: 'CLIENT' }], total: 1 },
    '/api/opportunities': { items: [{ id: 'opp_won', project_id: 'prj_1', project_name: 'Project Alpha', name: 'Strategic partnership', stage: 'WON', estimated_value: 25000, currency: 'USD', probability_percentage: 100, owner_name: 'Muaz Test' }], total: 1 },
    '/api/akari-leads?limit=8&offset=0': { items: [], total: 0, categories: [], canWrite: true },
    '/api/campaigns': { items: [], total: 0 },
    '/api/payments': { items: [], total: 0 },
  };
  return responses[key] || { items: [], total: 0 };
}

test.beforeEach(async ({ page }) => {
  actions = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (parsed.pathname === '/api/work-os') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        actions.push(body);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true, started: true, created: 11, id: body.taskId || 'tsk_new' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...workPayload, scope: parsed.searchParams.get('scope') || 'mine' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(genericResponse(request.url())) });
  });
  await page.goto('/app/akari-house/home');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await page.locator('.sidebar [data-route="day"]').click();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect(page.locator('#work-os-root')).toBeVisible();
});

test('Work OS provides fast creation, editable relations and four execution views', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toBeVisible();

  const quick = page.locator('#work-quick-form');
  await quick.locator('input[name="title"]').fill('Prepare partner approval pack');
  await quick.locator('select[name="ownerUserId"]').selectOption('usr_marketing');
  await quick.locator('select[name="projectId"]').selectOption('prj_1');
  await quick.locator('select[name="workstream"]').selectOption('MARKETING');
  await quick.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => actions.some((action) => action.action === 'create-task' && action.title === 'Prepare partner approval pack')).toBeTruthy();

  await page.getByRole('button', { name: 'Draft partnership quote', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
  const form = page.locator('#work-task-form');
  await form.locator('select[name="ownerUserId"]').selectOption('usr_design');
  await form.locator('select[name="workstream"]').selectOption('DESIGN');
  await form.getByRole('button', { name: 'Save task' }).click();
  await expect.poll(() => actions.some((action) => action.action === 'update-task' && action.taskId === 'tsk_work_1' && action.ownerUserId === 'usr_design')).toBeTruthy();

  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.work-list')).toBeVisible();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.work-calendar')).toBeVisible();
  await expect(page.getByTitle('Draft partnership quote')).toBeVisible();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.work-agenda')).toContainText('Investor follow-up: Horizon Ventures');
});

test('partnership and fundraising workflow starters create governed linked plans', async ({ page }) => {
  await page.getByRole('button', { name: 'Create announcement plan' }).click();
  await expect(page.getByRole('heading', { name: 'Project Alpha' })).toBeVisible();
  const partnership = page.locator('#work-partnership-form');
  await partnership.locator('select[name="relationshipOwnerId"]').selectOption('usr_owner');
  await partnership.locator('select[name="marketingOwnerId"]').selectOption('usr_marketing');
  await partnership.locator('select[name="designOwnerId"]').selectOption('usr_design');
  await partnership.getByRole('button', { name: 'Start activation' }).click();
  await expect.poll(() => actions.some((action) => action.action === 'start-partnership-activation' && action.opportunityId === 'opp_won')).toBeTruthy();

  await page.getByRole('button', { name: 'Create raise work plan' }).click();
  await expect(page.getByRole('heading', { name: 'Project Alpha' })).toBeVisible();
  const fundraising = page.locator('#work-fundraising-form');
  await fundraising.locator('select[name="fundraisingOwnerId"]').selectOption('usr_owner');
  await fundraising.locator('select[name="contentOwnerId"]').selectOption('usr_marketing');
  await fundraising.locator('select[name="designOwnerId"]').selectOption('usr_design');
  await fundraising.getByRole('button', { name: 'Start work plan' }).click();
  await expect.poll(() => actions.some((action) => action.action === 'start-fundraising-workplan' && action.roomId === 'room_1')).toBeTruthy();
});

test('Work OS remains usable without page-level mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.work-calendar')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.work-board')).toBeVisible();
});
