import { test, expect } from '@playwright/test';

const readiness = {
  tenant:{ id:'tenant_akari_house', name:'AKARI House', slug:'akari-house', status:'ACTIVE', base_currency:'USD', timezone:'Europe/Berlin', plan_code:'FOUNDING' },
  generatedAt:'2026-08-03T09:00:00.000Z',
  counts:{ projects:895, leads:895, leadsWithOwner:800, leadsWithFollowUp:500, contacts:217, openTasks:10, overdueTasks:2, openOpportunities:4, wonOpportunities:1, activeCampaigns:1, paymentRecords:1, activeMembers:3, activeOwners:1 },
  roles:[{role:'OWNER',count:1},{role:'BD_MEMBER',count:2}],
  automaticChecks:[
    {key:'database',label:'Production relationship database',status:'PASS',detail:'895 project and relationship records are visible.'},
    {key:'owner',label:'Active workspace owner',status:'PASS',detail:'1 active owner membership detected.'},
    {key:'followup',label:'Lead follow-up coverage',status:'WARNING',detail:'56% of leads have a next follow-up date.'},
  ],
  manualChecks:[
    {key:'accessBoundary',label:'Cloudflare Access boundary verified',description:'The public homepage is reachable without login while CRM routes remain protected.',completed:false,note:'',checkedAt:null,checkedBy:null},
    {key:'roleMatrix',label:'Role and permission matrix tested',description:'Owner, Admin, BD, Finance and Viewer behaviour has been checked with real accounts.',completed:false,note:'',checkedAt:null,checkedBy:null},
  ],
  readinessScore:64,
  lastBackup:null,
  lastAudit:null,
  canManage:true,
  canExport:true,
};

function genericPayload(url) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return { user:{ userId:'usr_owner', tenantId:'tenant_akari_house', tenantSlug:'akari-house', email:'owner@example.com', fullName:'Muaz Test', role:'OWNER', financeAccess:true } };
  if (path === '/api/profile') return { user:{ id:'usr_owner', fullName:'Muaz Test', email:'owner@example.com', jobTitle:'Owner', bio:'', status:'ACTIVE' } };
  if (path === '/api/team') return { items:[{userId:'usr_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true}], total:1 };
  if (path === '/api/billing-profile') return { tenant:{name:'AKARI House',baseCurrency:'USD'}, billingProfile:{legalName:'AKARI House',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14} };
  if (path === '/api/dashboard') return { currency:'USD', metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:0,outstandingPayments:0,referralRewardsDue:0} };
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items:[], total:0 };
  if (path === '/api/projects?limit=5') return { items:[], total:0 };
  if (path === '/api/opportunities' || path === '/api/campaigns' || path === '/api/payments' || path === '/api/invoices' || path === '/api/partners' || path === '/api/contacts') return { items:[], total:0 };
  if (path === '/api/reports') return { pipelineByStage:[], revenueByMonth:[] };
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items:[],total:0,categories:[],owners:[],canWrite:true };
  return { items:[], total:0 };
}

async function boot(page, captures = []) {
  let liveReadiness = structuredClone(readiness);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (parsed.pathname === '/api/production-readiness') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        captures.push({ path:parsed.pathname, method:request.method(), body });
        liveReadiness.manualChecks = liveReadiness.manualChecks.map((item) => item.key === body.key ? { ...item, completed:Boolean(body.completed), note:body.note, checkedAt:'2026-08-03T10:00:00.000Z', checkedBy:'owner@example.com' } : item);
        await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ...body, updated:true }) });
        return;
      }
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(liveReadiness) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(genericPayload(request.url())) });
  });
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
}

test('Settings exposes production checks, tenant backup and controlled sign-off', async ({ page }) => {
  const captures = [];
  await boot(page, captures);
  await page.locator('[data-route="settings"]').first().click();
  await expect(page.getByRole('heading', { name:'Settings & Profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Production readiness' })).toBeVisible();
  await expect(page.locator('.pr15-score')).toContainText('64%');
  await expect(page.getByText('895 project and relationship records are visible.')).toBeVisible();
  await expect(page.locator('[data-pr15-export]')).toHaveAttribute('href', '/api/tenant-export');
  await expect(page.locator('.pr15-role b', { hasText:/^OWNER$/ })).toBeVisible();

  const card = page.locator('[data-pr15-signoff="accessBoundary"]');
  await card.locator('[data-pr15-completed]').check();
  await card.locator('[data-pr15-note]').fill('Public homepage and protected application paths verified');
  await card.locator('[data-pr15-save]').click();

  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toEqual({
    path:'/api/production-readiness',
    method:'POST',
    body:{ key:'accessBoundary', completed:true, note:'Public homepage and protected application paths verified' },
  });
  await expect(page.getByText('Production sign-off updated')).toBeVisible();
});

test('production readiness remains usable without page-level mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await boot(page);
  await page.goto('/app/akari-house/settings');
  await expect(page.getByRole('heading', { name:'Settings & Profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Production readiness' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.pr15-signoffs')).toBeVisible();
});
