import { test, expect } from '@playwright/test';

const campaign = {
  id:'eng_1', project_id:'prj_1', opportunity_id:'opp_1', name:'Project Alpha Creator Campaign',
  project_name:'Project Alpha', owner_name:'Muaz Test', status:'ONBOARDING', region:'Global',
  start_date:'2026-08-01', end_date:'2026-08-31', reporting_due_date:'2026-09-05',
  deliverables_summary:'Creator campaign delivery', gross_revenue:10000, currency:'USD',
  campaign_cost:1000, creator_cost:2000, other_cost:0, referral_percentage:5,
  amount_invoiced:10000, amount_received:5000, payment_status:'PARTIALLY_PAID',
  next_action:'Complete client onboarding', akari_net_revenue:6650, outstanding_amount:5000,
};

const summary = {
  progress:40, requiredItems:10, completedItems:4, overdue:1, blocked:0,
  onboardingDone:2, onboardingTotal:4, milestoneDone:1, milestoneTotal:3,
  deliverableDone:1, deliverableTotal:3, publishedDeliverables:1,
  creators:2, activeCreators:1, reach:15000, engagements:900,
};

const deliveryItem = {
  id:'eng_1', projectId:'prj_1', projectName:'Project Alpha', opportunityId:'opp_1', opportunityName:'Creator campaign',
  name:'Project Alpha Creator Campaign', status:'ONBOARDING', region:'Global', startDate:'2026-08-01', endDate:'2026-08-31',
  reportingDueDate:'2026-09-05', nextAction:'Complete client onboarding', ownerId:'usr_owner', ownerName:'Muaz Test',
  serviceType:'MARKETING_CAMPAIGN', templateId:'system_creator_campaign', templateName:'Creator campaign',
  onboarding:[
    { id:'onb_1', label:'Kickoff completed', status:'DONE', required:true, ownerUserId:'usr_owner', dueDate:'2026-08-02' },
    { id:'onb_2', label:'Brand assets received', status:'IN_PROGRESS', required:true, ownerUserId:'usr_bd', dueDate:'2026-08-03' },
  ],
  milestones:[{ id:'mil_1', title:'Campaign strategy approved', status:'IN_PROGRESS', stage:'PLANNING', required:true, ownerUserId:'usr_owner', dueDate:'2026-08-08', internalNotes:'Review positioning' }],
  deliverables:[{ id:'del_1', title:'Published creator posts', type:'CONTENT', status:'PUBLISHED', required:true, ownerUserId:'usr_bd', dueDate:'2026-08-20', creatorName:'Creator One', platform:'X', publishedUrl:'https://x.com/example', internalApproval:true, clientApproval:true, performance:{ reach:15000, engagements:900, clicks:120, conversions:8 } }],
  creators:[{ id:'ctr_1', name:'Creator One', handle:'@creatorone', platform:'X', status:'ACTIVE', reward:300, currency:'USDT', postQuantity:3, submittedLinks:['https://x.com/example'], paymentStatus:'PENDING' }],
  report:{ executiveSummary:'Campaign is progressing.', workCompleted:'Strategy and first posts completed.', results:'15,000 reach.', recommendations:'Continue creator wave two.', approvedAt:null },
  completion:null, renewalOpportunityId:null, summary,
  grossRevenue:10000, campaignCost:1000, creatorCost:2000, otherCost:0, directCosts:3000,
  marginBeforeReferral:7000, referralPercentage:5, referralReward:350, akariNetRevenue:6650,
  amountInvoiced:10000, amountReceived:5000, outstandingAmount:5000, paymentStatus:'PARTIALLY_PAID', currency:'USD',
};

const overview = {
  metrics:{ active:1, onboarding:1, live:0, reporting:0, overdue:1, blocked:0, averageProgress:40, completed:0, outstanding:5000, netRevenue:6650 },
  items:[{ id:'eng_1', projectId:'prj_1', projectName:'Project Alpha', opportunityId:'opp_1', name:'Project Alpha Creator Campaign', status:'ONBOARDING', serviceType:'MARKETING_CAMPAIGN', ownerId:'usr_owner', ownerName:'Muaz Test', startDate:'2026-08-01', endDate:'2026-08-31', nextAction:'Complete client onboarding', templateId:'system_creator_campaign', templateName:'Creator campaign', progress:40, overdue:1, blocked:0, milestones:3, completedMilestones:1, deliverables:3, completedDeliverables:1, creators:2, activeCreators:1, reach:15000, engagements:900, grossRevenue:10000, directCosts:3000, akariNetRevenue:6650, amountInvoiced:10000, amountReceived:5000, outstandingAmount:5000, referralReward:350, currency:'USD' }],
  total:1, financeVisible:true,
};

const detail = {
  item:deliveryItem,
  members:[{ id:'usr_owner', fullName:'Muaz Test', email:'owner@example.com', role:'OWNER' },{ id:'usr_bd', fullName:'BD Member', email:'bd@example.com', role:'BD_MEMBER' }],
  permissions:{ canWrite:true, canManage:true, canFinance:true },
};

function responseFor(url) {
  const parsed = new URL(url);
  const key = `${parsed.pathname}${parsed.search}`;
  const map = {
    '/api/me':{ user:{ userId:'usr_owner', tenantId:'tenant_a', tenantSlug:'akari-house', email:'owner@example.com', fullName:'Muaz Test', role:'OWNER', financeAccess:true } },
    '/api/dashboard':{ currency:'USD', metrics:{ monthlyTarget:10000, revenueBooked:10000, revenueCollected:5000, netRevenue:6650, weightedPipeline:0, activeOpportunities:0, yearToDateRevenue:5000, activeCustomers:1, activeCampaigns:1, activePartners:0, outstandingPayments:5000, referralRewardsDue:0 } },
    '/api/tasks?scope=mine':{ items:[], total:0 },
    '/api/opportunities':{ items:[], total:0 },
    '/api/akari-leads?limit=8&offset=0':{ items:[], total:0, categories:[], canWrite:true },
    '/api/campaigns':{ items:[campaign], total:1 },
    '/api/payments':{ items:[], total:0 },
    '/api/service-delivery':overview,
    '/api/service-delivery/eng_1':detail,
    '/api/service-delivery/templates':{ items:[{ id:'system_creator_campaign', name:'Creator campaign', serviceType:'MARKETING_CAMPAIGN', durationDays:30, onboarding:['Kickoff'], milestones:['Strategy'], deliverables:['Posts'], system:true }], total:1 },
  };
  if (map[key]) return map[key];
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items:[], total:0, categories:[], canWrite:true };
  return { items:[], total:0 };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-08T09:00:00.000Z'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ updated:true, item:deliveryItem }) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(responseFor(request.url())) });
  });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
});

test('Campaigns exposes the service delivery command centre and workspace', async ({ page }) => {
  await page.locator('.sidebar [data-route="campaigns"]').click();
  await expect(page.getByRole('heading', { name:'Campaigns' })).toBeVisible();
  const command = page.locator('#service-delivery-command-centre');
  await expect(command).toBeVisible();
  await expect(command.getByText('Campaign and service delivery')).toBeVisible();
  await expect(command.getByText('Project Alpha Creator Campaign')).toBeVisible();

  await command.getByRole('button', { name:'Manage delivery' }).click();
  const workspace = page.getByLabel('Service delivery workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText('Client onboarding')).toBeVisible();
  await expect(workspace.locator('.delivery-item-copy > strong').filter({ hasText:'Campaign strategy approved' }).first()).toBeVisible();
  await expect(workspace.getByText('Creator One').first()).toBeVisible();
  await expect(workspace.getByText('Budget and profitability')).toBeVisible();
});

test('delivery sub-forms preserve the workspace and submit governed milestone changes', async ({ page }) => {
  let captured = null;
  await page.route('**/api/service-delivery/eng_1', async (route) => {
    if (route.request().method() === 'PATCH') {
      captured = route.request().postDataJSON();
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ updated:true, item:deliveryItem }) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(detail) });
  });
  await page.locator('.sidebar [data-route="campaigns"]').click();
  const command = page.locator('#service-delivery-command-centre');
  await expect(command).toBeVisible();
  await command.getByRole('button', { name:'Manage delivery' }).click();
  const workspace = page.getByLabel('Service delivery workspace');
  await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name:'Add milestone' }).click();
  await expect(page.locator('#delivery-active-form')).toBeVisible();
  await expect(workspace).toBeVisible();
  await page.locator('#delivery-active-form [name="title"]').fill('Second creator wave launched');
  await page.locator('#delivery-active-form [name="dueDate"]').fill('2026-08-25');
  await page.locator('#delivery-active-form button[type="submit"]').click();
  await expect.poll(() => captured?.action).toBe('upsert-milestone');
  expect(captured.item.title).toBe('Second creator wave launched');
  await expect(page.getByText('Milestone updated')).toBeVisible();
  await expect(workspace).toBeVisible();
});

test('applying a service template uses the current tenant engagement endpoint', async ({ page }) => {
  let captured = null;
  await page.route('**/api/service-delivery/eng_1', async (route) => {
    if (route.request().method() === 'PATCH') {
      captured = route.request().postDataJSON();
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ updated:true, item:deliveryItem }) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(detail) });
  });
  await page.locator('.sidebar [data-route="campaigns"]').click();
  const command = page.locator('#service-delivery-command-centre');
  await expect(command).toBeVisible();
  await command.getByRole('button', { name:'Manage delivery' }).click();
  const workspace = page.getByLabel('Service delivery workspace');
  await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name:'Apply template' }).click();
  await expect(page.getByRole('heading', { name:'Apply service template' })).toBeVisible();
  await page.locator('#delivery-active-form [name="replaceExisting"]').check();
  await page.locator('#delivery-active-form button[type="submit"]').click();
  await expect.poll(() => captured?.action).toBe('apply-template');
  expect(captured.templateId).toBe('system_creator_campaign');
  expect(captured.replaceExisting).toBe(true);
});

test('service delivery remains usable without page-level mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
  await page.locator('#sidebar [data-route="campaigns"]').click();
  const command = page.locator('#service-delivery-command-centre');
  await expect(command).toBeVisible();
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  await command.getByRole('button', { name:'Manage delivery' }).click();
  const workspace = page.getByLabel('Service delivery workspace');
  await expect(workspace).toBeVisible();
  const workspaceOverflow = await workspace.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(workspaceOverflow).toBeLessThanOrEqual(1);
});
