import { test, expect } from '@playwright/test';

const me = {
  user: {
    userId: 'user_owner',
    tenantId: 'tenant_akari_house',
    tenantSlug: 'akari-house',
    email: 'owner@example.com',
    fullName: 'Muaz Test',
    role: 'OWNER',
    financeAccess: true,
  },
};

const project = {
  id: 'project_travls',
  name: 'TRAVLS',
  lifecycle_status: 'CLIENT',
};

function payloadFor(url, method) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === '/api/me') return me;
  if (path === '/api/invoices' && method === 'GET') return { items: [], total: 0 };
  if (path === '/api/payments') return { items: [], total: 0 };
  if (path === '/api/billing-profile') {
    return {
      tenant: { name: 'AKARI House', baseCurrency: 'USD' },
      billingProfile: {
        legalName: 'AKARI House',
        addressLine1: 'Example Street 1',
        country: 'Germany',
        email: 'billing@example.com',
        invoicePrefix: 'AKARI',
        defaultTaxRate: 19,
        defaultPaymentTermsDays: 14,
      },
    };
  }
  if (path === '/api/projects?limit=100&offset=0') return { items: [project], total: 1, limit: 100 };
  if (path === '/api/commercial/overview') return { metrics: {}, invoices: [], proposals: [], referrals: [], currency: 'USD' };
  if (path === '/api/profile') return { user: me.user };
  if (path === '/api/tasks?scope=mine' || path === '/api/tasks?scope=mine&includeCompleted=1') return { items: [], total: 0 };
  if (path === '/api/dashboard') {
    return {
      currency: 'USD',
      metrics: {
        monthlyTarget: 0,
        revenueBooked: 0,
        revenueCollected: 0,
        netRevenue: 0,
        weightedPipeline: 0,
        activeOpportunities: 0,
        yearToDateRevenue: 0,
        activeCustomers: 1,
        activeCampaigns: 0,
        activePartners: 0,
        outstandingPayments: 0,
        referralRewardsDue: 0,
      },
    };
  }
  if (path === '/api/akari-leads?limit=8&offset=0') return { items: [], total: 0, categories: [], canWrite: true };
  if (parsed.pathname.startsWith('/api/akari-leads')) return { items: [], total: 0, categories: [], canWrite: true };
  if (path === '/api/opportunities' || path === '/api/campaigns' || path === '/api/partners' || path === '/api/contacts') return { items: [], total: 0 };
  if (path === '/api/reports') return { pipelineByStage: [], revenueByMonth: [] };
  if (path === '/api/invoices' && method === 'POST') {
    return { id: 'invoice_1', invoiceNumber: 'AKARI-2026-0001', total: 100, status: 'INVOICED', created: true };
  }
  return { items: [], total: 0 };
}

async function bootFinance(page, captures = []) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/invoices') {
      captures.push(request.postDataJSON());
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payloadFor(request.url(), request.method())),
    });
  });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Muaz/i })).toBeVisible();

  const mobile = await page.evaluate(() => window.innerWidth <= 760);
  if (mobile) {
    await page.locator('.mobile-bottom [data-action="open-sidebar"]').click();
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toHaveClass(/open/);
    const finance = page.locator('#sidebar [data-route="finance"]');
    await finance.scrollIntoViewIfNeeded();
    await finance.click();
    await expect(page.getByRole('heading', { name: 'Invoices & Finance' })).toBeVisible();

    const backdrop = page.locator('.sidebar-backdrop.open[data-action="close-sidebar"]');
    const backdropBox = await backdrop.boundingBox();
    if (!backdropBox) throw new Error('Mobile navigation backdrop is not visible');
    await page.mouse.click(
      backdropBox.x + backdropBox.width - 6,
      backdropBox.y + Math.min(120, backdropBox.height - 6),
    );
    await expect(sidebar).not.toHaveClass(/open/);
  } else {
    await page.locator('.sidebar [data-route="finance"]').click();
    await expect(page.getByRole('heading', { name: 'Invoices & Finance' })).toBeVisible();
  }
}

async function openInvoice(page) {
  await page.locator('[data-ops-action="new-invoice"]').first().click();
  await expect(page.getByRole('heading', { name: 'Create invoice' })).toBeVisible();
  const form = page.locator('#ops-form');
  await expect(form).toHaveAttribute('data-invoice-builder-r27', 'ready');
  await expect(page.locator('.ops-invoice-modal-r27')).toBeVisible();
  return form;
}

test('invoice builder keeps labels separated and calculates exclusive inclusive and no-tax totals', async ({ page }) => {
  const captures = [];
  await bootFinance(page, captures);
  const form = await openInvoice(page);

  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('.ops-invoice-modal-r27');
    const header = dialog.querySelector('.modal-head').getBoundingClientRect();
    const body = dialog.querySelector('.modal-body').getBoundingClientRect();
    const firstBodyContent = dialog.querySelector('.modal-body > :first-child').getBoundingClientRect();
    const fields = [...dialog.querySelectorAll('label.field')].slice(0, 12).map((field) => {
      const label = field.querySelector(':scope > span');
      const candidates = [...field.querySelectorAll(':scope > input, :scope > select, :scope > textarea, :scope > .ak-combobox, :scope > .ak-combobox .ak-combobox__trigger')];
      const control = candidates.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const fieldBox = field.getBoundingClientRect();
      const labelBox = label?.getBoundingClientRect();
      const controlBox = control?.getBoundingClientRect();
      return {
        fieldHeight: fieldBox.height,
        labelBottom: labelBox?.bottom || 0,
        controlTop: controlBox?.top || 0,
        controlBottom: controlBox?.bottom || 0,
        fieldBottom: fieldBox.bottom,
      };
    });
    return {
      headerBottom: header.bottom,
      bodyTop: body.top,
      firstBodyContentTop: firstBodyContent.top,
      fields,
    };
  });

  expect(geometry.bodyTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
  expect(geometry.firstBodyContentTop).toBeGreaterThanOrEqual(geometry.headerBottom + 20);
  for (const item of geometry.fields) {
    expect(item.controlTop - item.labelBottom).toBeGreaterThanOrEqual(6);
    expect(item.fieldBottom).toBeGreaterThanOrEqual(item.controlBottom - 1);
    expect(item.fieldHeight).toBeGreaterThanOrEqual(65);
  }

  await expect(page.getByText('Invoice details', { exact: true })).toBeVisible();
  await expect(page.getByText('Tax treatment *', { exact: true })).toBeVisible();

  await page.selectOption('#ops-project', 'project_travls');
  await page.fill('[data-line="description"]', 'Creator campaign');
  await page.fill('[data-line="unitPrice"]', '100');

  await page.selectOption('#ops-tax-mode', 'EXCLUSIVE');
  await page.fill('#ops-tax-rate', '19');
  await expect(page.locator('#ops-subtotal')).toHaveText('$100.00');
  await expect(page.locator('#ops-tax-total')).toHaveText('$19.00');
  await expect(page.locator('#ops-grand-total')).toHaveText('$119.00');
  await expect(page.locator('[data-tax-mode-label]')).toContainText('added');

  await page.selectOption('#ops-tax-mode', 'INCLUSIVE');
  await expect(page.locator('#ops-subtotal')).toHaveText('$84.03');
  await expect(page.locator('#ops-tax-total')).toHaveText('$15.97');
  await expect(page.locator('#ops-grand-total')).toHaveText('$100.00');
  await expect(page.locator('[data-unit-price-heading]')).toContainText('tax incl.');

  await page.selectOption('#ops-tax-mode', 'NONE');
  await expect(page.locator('#ops-tax-rate')).toBeDisabled();
  await expect(page.locator('#ops-tax-total')).toHaveText('$0.00');
  await expect(page.locator('#ops-grand-total')).toHaveText('$100.00');

  await page.selectOption('#ops-tax-mode', 'INCLUSIVE');
  await page.fill('#ops-tax-rate', '19');
  await form.locator('button[type="submit"]').click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0].taxMode).toBe('INCLUSIVE');
  expect(captures[0].taxRate).toBe(19);
  expect(captures[0].projectId).toBe('project_travls');
  expect(captures[0].lineItems[0].unitPrice).toBe(100);
});

test('invoice builder keeps its header footer and tax controls usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootFinance(page);
  await openInvoice(page);

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector('.ops-invoice-modal-r27').getBoundingClientRect();
    const header = document.querySelector('.ops-invoice-modal-r27 .modal-head').getBoundingClientRect();
    const body = document.querySelector('.ops-invoice-modal-r27 .modal-body').getBoundingClientRect();
    const footer = document.querySelector('.ops-invoice-modal-r27 .modal-foot').getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      dialogLeft: dialog.left,
      dialogRight: dialog.right,
      headerBottom: header.bottom,
      bodyTop: body.top,
      bodyBottom: body.bottom,
      footerTop: footer.top,
      footerBottom: footer.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.bodyTop).toBeGreaterThanOrEqual(layout.headerBottom - 1);
  expect(layout.footerTop).toBeGreaterThanOrEqual(layout.bodyBottom - 1);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  await expect(page.locator('#ops-tax-mode')).toBeAttached();
  await expect(page.locator('#ops-form button[type="submit"]')).toBeVisible();
});
