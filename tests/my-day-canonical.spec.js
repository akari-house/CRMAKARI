import { test, expect } from '@playwright/test';

let actions = [];
let liveWorkPayload;
let fullRequestDelayMs = 0;
let coreRequests = 0;
let fullResponses = 0;

const baseWorkPayload = {
  scope: 'mine',
  tasks: [
    {
      id: 'tsk_drag_1',
      title: 'Prepare partner launch copy',
      description: 'Draft and route for approval.',
      ownerUserId: 'usr_owner',
      ownerName: 'Muaz Test',
      status: 'TODO',
      priority: 'HIGH',
      dueAt: '2030-08-05T14:00:00.000Z',
      projectId: 'prj_1',
      projectName: 'Project Alpha',
      opportunityId: 'opp_1',
      opportunityName: 'Partnership launch',
      campaignId: null,
      campaignName: null,
      activityType: 'WORKSTREAM:CONTENT',
      workstream: 'CONTENT',
      recurrenceRule: null,
      showOnHome: true,
    },
  ],
  members: [{ id: 'usr_owner', fullName: 'Muaz Test', email: 'owner@example.com', role: 'OWNER' }],
  projects: [{ id: 'prj_1', name: 'Project Alpha', ownerUserId: 'usr_owner', lifecycleStatus: 'CLIENT' }],
  opportunities: [{ id: 'opp_1', projectId: 'prj_1', name: 'Partnership launch', projectName: 'Project Alpha', stage: 'WON', ownerUserId: 'usr_owner' }],
  campaigns: [],
  calendarEvents: [
    {
      id: 'TASK:tsk_drag_1', sourceId: 'tsk_drag_1', type: 'TASK', title: 'Prepare partner launch copy',
      startsAt: '2030-08-05T14:00:00.000Z', date: '2030-08-05', projectId: 'prj_1', projectName: 'Project Alpha',
      relation: 'Partnership launch', status: 'TODO', priority: 'HIGH', workstream: 'CONTENT', readOnly: false,
    },
  ],
  partnershipCandidates: [],
  fundraisingPlans: [],
  permissions: { canWrite: true, canManage: true, canFinance: true },
};

function corePayload() {
  return {
    ...structuredClone(liveWorkPayload),
    partial: true,
    projects: [],
    opportunities: [],
    campaigns: [],
    partnershipCandidates: [],
    fundraisingPlans: [],
    performance: { mode:'core', durationMs:5 },
  };
}

function genericResponse(url) {
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;
  const responses = {
    '/api/me': { user: { userId: 'usr_owner', tenantId: 'tenant_akari_house', tenantSlug: 'akari-house', email: 'owner@example.com', fullName: 'Muaz Test', role: 'OWNER', financeAccess: true } },
    '/api/tasks?scope=mine&includeCompleted=1': { items: [], total: 0 },
    '/api/tasks?scope=mine': { items: [], total: 0 },
    '/api/dashboard': { currency: 'USD', metrics: { monthlyTarget: 0, revenueBooked: 0, revenueCollected: 0, netRevenue: 0, weightedPipeline: 0, activeOpportunities: 0, yearToDateRevenue: 0, activeCustomers: 0, activeCampaigns: 0, activePartners: 0, outstandingPayments: 0, referralRewardsDue: 0 } },
    '/api/projects?limit=5': { items: [], total: 0 },
    '/api/opportunities': { items: [], total: 0 },
    '/api/akari-leads?limit=8&offset=0': { items: [], total: 0, categories: [], canWrite: true },
    '/api/campaigns': { items: [], total: 0 },
    '/api/payments': { items: [], total: 0 },
  };
  return responses[key] || { items: [], total: 0 };
}

test.beforeEach(async ({ page }, testInfo) => {
  actions = [];
  liveWorkPayload = structuredClone(baseWorkPayload);
  coreRequests = 0;
  fullResponses = 0;
  fullRequestDelayMs = testInfo.title.includes('before slow full hydration') ? 5000 : 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());

    if (parsed.pathname === '/api/work-os-core') {
      coreRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corePayload()) });
      return;
    }

    if (parsed.pathname === '/api/work-os') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        actions.push(body);
        if (body.action === 'update-task') {
          const task = liveWorkPayload.tasks.find((item) => item.id === body.taskId);
          if (task && body.status) task.status = body.status;
          if (task && body.dueAt) task.dueAt = body.dueAt;
          const event = liveWorkPayload.calendarEvents.find((item) => item.type === 'TASK' && item.sourceId === body.taskId);
          if (event && body.status) event.status = body.status;
          if (event && body.dueAt) {
            event.startsAt = body.dueAt;
            event.date = body.dueAt.slice(0, 10);
          }
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: true }) });
        return;
      }

      if (fullRequestDelayMs) await new Promise((resolve) => setTimeout(resolve, fullRequestDelayMs));
      fullResponses += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(liveWorkPayload) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(genericResponse(request.url())) });
  });

  await page.goto('/app/akari-house/home');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
  await page.locator('.sidebar [data-route="day"]').click();
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect(page.locator('#work-os-root')).toBeVisible();
  await expect(page.locator('[data-work-task="tsk_drag_1"]')).toBeVisible();
});

test('core task board appears before slow full hydration finishes', async ({ page }) => {
  expect(coreRequests).toBe(1);
  expect(fullResponses).toBe(0);
  await expect(page.locator('#work-os-root')).not.toHaveClass(/work-os-loading/);
  await expect(page.locator('.work-column[data-work-drop-status="TODO"] [data-work-task="tsk_drag_1"]')).toBeVisible();
  await expect(page.getByText('Loading your tasks…')).toHaveCount(0);
  await expect.poll(() => fullResponses, { timeout: 7000 }).toBe(1);
  await expect(page.locator('[data-work-filter="project"] option[value="prj_1"]')).toHaveCount(1);
});

test('legacy My Day is removed and only one canonical Work OS remains', async ({ page }) => {
  await expect(page.locator('#work-os-root')).toHaveCount(1);
  await expect(page.locator('.task-board-panel')).toHaveCount(0);
  await expect(page.locator('.my-day-support')).toHaveCount(0);

  await page.evaluate(() => {
    const legacy = document.createElement('div');
    legacy.className = 'panel task-board-panel';
    legacy.textContent = 'Legacy board';
    document.querySelector('#view-root')?.appendChild(legacy);
  });

  await expect(page.locator('.task-board-panel')).toHaveCount(0);
  await expect(page.locator('#work-os-root')).toHaveCount(1);
});

test('drag and drop moves a task once and persists the new status', async ({ page }) => {
  const handle = page.locator('[data-work-task="tsk_drag_1"] [data-work-drag-handle]');
  const target = page.locator('.work-column[data-work-drop-status="IN_PROGRESS"]');

  await expect(handle).toBeVisible();
  await expect(target).toBeVisible();
  await page.evaluate(() => {
    const source = document.querySelector('[data-work-task="tsk_drag_1"] [data-work-drag-handle]');
    const destination = document.querySelector('.work-column[data-work-drop-status="IN_PROGRESS"]');
    if (!(source instanceof HTMLElement) || !(destination instanceof HTMLElement)) throw new Error('Drag source or destination is missing');
    const dataTransfer = new DataTransfer();
    const dispatch = (node, type) => node.dispatchEvent(new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    dispatch(source, 'dragstart');
    dispatch(destination, 'dragover');
    dispatch(destination, 'drop');
    dispatch(source, 'dragend');
  });

  await expect.poll(() => actions.filter((action) => action.action === 'update-task' && action.taskId === 'tsk_drag_1' && action.status === 'IN_PROGRESS').length).toBe(1);
  await expect(page.locator('.work-column[data-work-drop-status="IN_PROGRESS"] [data-work-task="tsk_drag_1"]')).toBeVisible();
  await expect(page.getByText('Task moved to In Progress')).toBeVisible();
});

test('keyboard movement provides an accessible drag alternative', async ({ page }) => {
  const handle = page.locator('[data-work-task="tsk_drag_1"] [data-work-drag-handle]');
  await handle.focus();
  await handle.press('ArrowRight');

  await expect.poll(() => actions.some((action) => action.action === 'update-task' && action.taskId === 'tsk_drag_1' && action.status === 'IN_PROGRESS')).toBeTruthy();
  await expect(page.locator('.work-column[data-work-drop-status="IN_PROGRESS"] [data-work-task="tsk_drag_1"]')).toBeVisible();
});
