import { test, expect } from '@playwright/test';

const providerPayload = {
  enabled:false,
  primaryProvider:'OPENAI',
  fallbackProvider:'ANTHROPIC',
  allowFallback:false,
  models:{ OPENAI:'gpt-test', ANTHROPIC:'claude-test' },
  enabledPurposes:['INVESTOR_RESEARCH','FIT_EXPLANATION','INTRODUCTION_DRAFT','MEETING_BRIEF','FOLLOW_UP_DRAFT','DILIGENCE_RESPONSE'],
  maxOutputTokens:1200,
  canManage:true,
  providers:[
    { provider:'OPENAI', label:'OpenAI · ChatGPT models', secretConfigured:true, model:'gpt-test', configured:true },
    { provider:'ANTHROPIC', label:'Anthropic · Claude models', secretConfigured:false, model:'claude-test', configured:false },
  ],
  purposes:['INVESTOR_RESEARCH','FIT_EXPLANATION','INTRODUCTION_DRAFT','MEETING_BRIEF','FOLLOW_UP_DRAFT','DILIGENCE_RESPONSE'],
  secretRule:'Provider API keys must be configured as Cloudflare secrets. They are never stored in D1 or entered in the CRM.',
};

function genericPayload(url) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return { user:{ userId:'usr_owner', tenantId:'tenant_akari_house', tenantSlug:'akari-house', email:'owner@example.com', fullName:'Muaz Test', role:'OWNER', financeAccess:true } };
  if (path === '/api/profile') return { user:{ id:'usr_owner', fullName:'Muaz Test', email:'owner@example.com', jobTitle:'Owner', bio:'', status:'ACTIVE' } };
  if (path === '/api/team') return { items:[{userId:'usr_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true}], total:1 };
  if (path === '/api/billing-profile') return { tenant:{name:'AKARI House',baseCurrency:'USD'}, billingProfile:{legalName:'AKARI House',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14} };
  if (path === '/api/dashboard') return { currency:'USD', metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:0,outstandingPayments:0,referralRewardsDue:0} };
  if (path === '/api/production-readiness') return { tenant:{name:'AKARI House',plan_code:'FOUNDING',timezone:'Europe/Berlin'}, generatedAt:'2026-08-03T11:00:00.000Z', counts:{}, roles:[], automaticChecks:[], manualChecks:[], readinessScore:0, canManage:true, canExport:true };
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items:[], total:0 };
  if (path === '/api/projects?limit=5') return { items:[], total:0 };
  if (path === '/api/opportunities' || path === '/api/campaigns' || path === '/api/payments' || path === '/api/invoices' || path === '/api/partners' || path === '/api/contacts') return { items:[], total:0 };
  if (path === '/api/reports') return { pipelineByStage:[], revenueByMonth:[] };
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items:[],total:0,categories:[],owners:[],canWrite:true };
  return { items:[], total:0 };
}

async function boot(page, captures = []) {
  let current = structuredClone(providerPayload);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (parsed.pathname === '/api/ai/providers') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        captures.push(body);
        current = {
          ...current,
          ...body,
          providers:current.providers.map((provider) => ({
            ...provider,
            model:body.models?.[provider.provider] || provider.model,
            configured:provider.secretConfigured && Boolean(body.models?.[provider.provider] || provider.model),
          })),
        };
      }
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(current) });
      return;
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(genericPayload(request.url())) });
  });
  await page.goto('/app/akari-house/dashboard');
  await expect(page.getByRole('heading', { name:/Good (morning|afternoon|evening), Muaz/i })).toBeVisible();
}

test('Settings offers both OpenAI ChatGPT models and Anthropic Claude models', async ({ page }) => {
  const captures = [];
  await boot(page, captures);
  await page.locator('[data-route="settings"]').first().click();
  await expect(page.getByRole('heading', { name:'Settings & Profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'AI model providers' })).toBeVisible();
  await expect(page.getByText('OpenAI · ChatGPT models')).toBeVisible();
  await expect(page.getByText('Anthropic · Claude models')).toBeVisible();
  await expect(page.locator('#ai-providers-root input[type="password"]')).toHaveCount(0);
  await expect(page.getByText(/Cloudflare secrets/)).toBeVisible();

  await page.locator('[data-ai17-provider="ANTHROPIC"] .ai17-primary-choice').click();
  await page.locator('.ai17-enable').click();
  await page.locator('.ai17-toggle-row').click();
  await expect(page.locator('input[name="ai17-primary"][value="ANTHROPIC"]')).toBeChecked();
  await expect(page.locator('[data-ai17-enabled]')).toBeChecked();
  await expect(page.locator('[data-ai17-fallback]')).toBeChecked();
  await page.locator('[data-ai17-model="ANTHROPIC"]').fill('claude-production');
  await page.locator('[data-ai17-model="OPENAI"]').fill('gpt-production');
  await page.locator('[data-ai17-tokens]').fill('1600');
  await page.locator('[data-ai17-save]').click();

  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0].primaryProvider).toBe('ANTHROPIC');
  expect(captures[0].fallbackProvider).toBe('OPENAI');
  expect(captures[0].allowFallback).toBe(true);
  expect(captures[0].models).toEqual({ OPENAI:'gpt-production', ANTHROPIC:'claude-production' });
  expect(captures[0].apiKey).toBeUndefined();
  expect(captures[0].openaiApiKey).toBeUndefined();
  expect(captures[0].anthropicApiKey).toBeUndefined();
  await expect(page.getByText('AI provider configuration updated')).toBeVisible();
});

test('dual AI provider controls remain usable without mobile page overflow', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await boot(page);
  await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
  await page.locator('#sidebar [data-route="settings"]').click();
  await expect(page.getByRole('heading', { name:'AI model providers' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-ai17-provider="OPENAI"]')).toBeVisible();
  await expect(page.locator('[data-ai17-provider="ANTHROPIC"]')).toBeVisible();
});
