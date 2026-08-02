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

async function openLeadModal(page) {
  await page.locator('.sidebar [data-route="leads"]').click();
  await expect(page.getByRole('heading', { name:'AKARI Leads' })).toBeVisible();
  await page.getByRole('button', { name:/New lead/i }).click();
  await expect(page.getByRole('heading', { name:'New AKARI lead' })).toBeVisible();
  await expect(page.locator('#modal-root .modal')).toHaveClass(/ak-modal-standard/);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(responseFor(route.request().url())) });
  });
  await page.goto('/app/akari-house/home');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
});

test('Tasks is a clear top-level navigation item and dense forms open comfortably', async ({ page }) => {
  const tasksNav = page.locator('.sidebar [data-route="day"]');
  await expect(tasksNav).toContainText('Tasks');
  await expect(tasksNav).not.toContainText('My Day');

  await openLeadModal(page);
  const dialog = page.locator('#modal-root .modal');
  await expect(dialog).toHaveClass(/ak-modal--wide/);
  await expect(page.locator('body')).toHaveClass(/ak-modal-open/);

  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('#modal-root .modal');
    const label = dialog?.querySelector('.form-group > label');
    const input = dialog?.querySelector('.form-group input');
    const body = dialog?.querySelector('.modal-body');
    const footer = dialog?.querySelector('.modal-foot');
    const dialogBox = dialog?.getBoundingClientRect();
    const labelBox = label?.getBoundingClientRect();
    const inputBox = input?.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    return {
      width:dialogBox?.width || 0,
      labelBottom:labelBox?.bottom || 0,
      inputTop:inputBox?.top || 0,
      footerBottom:footerBox?.bottom || 0,
      dialogBottom:dialogBox?.bottom || 0,
      dialogOverflow:getComputedStyle(dialog).overflow,
      bodyOverflow:getComputedStyle(body).overflowY,
    };
  });

  expect(geometry.width).toBeGreaterThan(900);
  expect(geometry.labelBottom).toBeLessThanOrEqual(geometry.inputTop + 1);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.dialogBottom + 1);
  expect(geometry.dialogOverflow).toBe('hidden');
  expect(['auto','scroll']).toContain(geometry.bodyOverflow);

  await page.getByRole('button', { name:'Cancel' }).click();
  await expect(page.locator('body')).not.toHaveClass(/ak-modal-open/);
});

test('commercial and billing-style forms inherit the same non-overlapping modal system', async ({ page }) => {
  await page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'commercial-modal-root';
    root.innerHTML = `<div class="commercial-modal-backdrop"><section class="commercial-modal" role="dialog"><header><div><h2>Organisation billing details</h2><p>These details appear on every new invoice.</p></div><button class="close">×</button></header><form><div class="commercial-modal-body"><div class="commercial-form-grid">${Array.from({length:16},(_,index)=>`<label class="commercial-field"><span>Billing field ${index+1}</span><input value="${index===0?'AKARI House':''}" /></label>`).join('')}</div></div><footer><button type="button">Cancel</button><button type="submit">Save details</button></footer></form></section></div>`;
    document.body.appendChild(root);
  });

  const dialog = page.locator('#commercial-modal-root .commercial-modal');
  await expect(dialog).toHaveClass(/ak-modal-standard/);
  await expect(dialog).toHaveClass(/ak-modal--wide/);

  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('#commercial-modal-root .commercial-modal');
    const label = dialog?.querySelector('.commercial-field > span');
    const input = dialog?.querySelector('.commercial-field > input');
    const dialogBox = dialog?.getBoundingClientRect();
    const labelBox = label?.getBoundingClientRect();
    const inputBox = input?.getBoundingClientRect();
    const body = dialog?.querySelector('.commercial-modal-body');
    return {
      width:dialogBox?.width || 0,
      labelBottom:labelBox?.bottom || 0,
      inputTop:inputBox?.top || 0,
      scrollable:(body?.scrollHeight || 0) > (body?.clientHeight || 0),
      bodyOverflow:getComputedStyle(body).overflowY,
    };
  });

  expect(geometry.width).toBeGreaterThan(900);
  expect(geometry.labelBottom).toBeLessThanOrEqual(geometry.inputTop + 1);
  expect(geometry.scrollable).toBeTruthy();
  expect(['auto','scroll']).toContain(geometry.bodyOverflow);
});

test('modal fields remain readable and single-column on mobile', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await openLeadModal(page);

  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('#modal-root .modal');
    const fields = [...dialog.querySelectorAll('.form-group')].slice(0,2).map((field) => field.getBoundingClientRect());
    const input = dialog.querySelector('input');
    return {
      width:dialog.getBoundingClientRect().width,
      firstX:fields[0]?.x || 0,
      secondX:fields[1]?.x || 0,
      secondY:fields[1]?.y || 0,
      firstBottom:fields[0]?.bottom || 0,
      fontSize:parseFloat(getComputedStyle(input).fontSize),
      pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    };
  });

  expect(geometry.width).toBeGreaterThanOrEqual(389);
  expect(Math.abs(geometry.firstX-geometry.secondX)).toBeLessThanOrEqual(1);
  expect(geometry.secondY).toBeGreaterThanOrEqual(geometry.firstBottom-1);
  expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
});
