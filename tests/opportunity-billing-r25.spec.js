import { test, expect } from '@playwright/test';

function mePayload() {
  return {
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
}

test('every commercial opportunity remains visible across active and closed stages', async ({ page }) => {
  const items = [
    {
      id: 'opp_new', project_id: 'project_travls', project_name: 'TRAVLS', name: 'TRAVLS campaign',
      service_type: 'MARKETING_CAMPAIGN', stage: ' new ', estimated_value: 15000, currency: 'USD',
      probability_percentage: 10, next_action: 'Book discovery call', owner_name: 'Muaz Test',
    },
    {
      id: 'opp_verbal', project_id: 'project_two', project_name: 'Project Two', name: 'Verbal confirmation deal',
      service_type: 'ADVISORY', stage: 'verbal confirmed', estimated_value: 25000, currency: 'USD',
      probability_percentage: 80, next_action: 'Send final agreement', owner_name: 'Muaz Test',
    },
    {
      id: 'opp_hold', project_id: 'project_three', project_name: 'Project Three', name: 'Paused partnership',
      service_type: 'PARTNERSHIP', stage: 'ON_HOLD', estimated_value: 5000, currency: 'USD',
      probability_percentage: 30, next_action: 'Review in September', owner_name: 'Muaz Test',
    },
    {
      id: 'opp_won', project_id: 'project_four', project_name: 'Won Client', name: 'Won campaign',
      service_type: 'MARKETING_CAMPAIGN', stage: 'WON', estimated_value: 10000, currency: 'USD',
      probability_percentage: 100, next_action: 'Complete client onboarding', owner_name: 'Muaz Test',
    },
    {
      id: 'opp_lost', project_id: 'project_five', project_name: 'Closed Prospect', name: 'Lost advisory deal',
      service_type: 'ADVISORY', stage: 'LOST', estimated_value: 7500, currency: 'USD',
      probability_percentage: 0, next_action: 'Record loss learning', owner_name: 'Muaz Test',
    },
  ];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mePayload()) });
      return;
    }
    if (url.pathname === '/api/opportunities') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, total: items.length }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();

  const pipeline = page.locator('#view-root .pipeline');
  await expect(pipeline).toHaveAttribute('data-akari-opportunity-visibility', 'r26');
  await expect(pipeline).toHaveAttribute('data-akari-opportunity-count', '5');
  await expect(pipeline).toHaveAttribute('data-akari-open-opportunity-count', '3');
  await expect(pipeline).toHaveAttribute('data-akari-closed-opportunity-count', '2');
  await expect(pipeline).toHaveAttribute('data-akari-visible-opportunity-count', '5');

  await expect(page.locator('[data-akari-stage="NEW"] [data-akari-opportunity-id="opp_new"]')).toContainText('TRAVLS campaign');
  await expect(page.locator('[data-akari-stage="VERBAL_CONFIRMATION"] [data-akari-opportunity-id="opp_verbal"]')).toContainText('Verbal confirmation deal');
  await expect(page.locator('[data-akari-stage="ON_HOLD"] [data-akari-opportunity-id="opp_hold"]')).toContainText('Paused partnership');
  await expect(page.locator('[data-akari-stage="WON"] [data-akari-opportunity-id="opp_won"]')).toContainText('Won campaign');
  await expect(page.locator('[data-akari-stage="LOST"] [data-akari-opportunity-id="opp_lost"]')).toContainText('Lost advisory deal');
  await expect(page.locator('[data-akari-closed-stage="WON"]')).toBeVisible();
  await expect(page.locator('[data-akari-closed-stage="LOST"]')).toBeVisible();
});

function liveBillingMarkup() {
  const field = (name, label, value = '', full = false) => `<div class="form-group ${full ? 'full' : ''}"><label>${label}</label><input class="form-control" name="${name}" value="${value}"></div>`;
  return `<div id="modal-root"><div class="modal-backdrop"><div class="modal wide" role="dialog"><div class="modal-head"><div><div class="eyebrow">AKARI CRM</div><h2>Organisation billing details</h2><p>These details appear on every new invoice. Confirm them before issuing invoices.</p></div><button class="close">×</button></div><form><div class="modal-body"><div class="form-grid">
    ${field('legalName', 'Legal / trading name *', 'AKARI House')}
    ${field('invoicePrefix', 'Invoice prefix', 'AKARI')}
    ${field('logoUrl', 'Logo URL', '', true)}
    ${field('addressLine1', 'Address line 1 *', '', true)}
    ${field('addressLine2', 'Address line 2', '', true)}
    ${field('city', 'City')}
    ${field('postalCode', 'Postal code')}
    ${field('country', 'Country *', 'Germany')}
    ${field('email', 'Billing email')}
    ${field('phone', 'Phone')}
    ${field('vatId', 'VAT ID')}
    ${field('registrationNumber', 'Registration / tax number')}
    ${field('bankName', 'Bank name')}
    ${field('iban', 'IBAN')}
    ${field('bic', 'BIC / SWIFT')}
    ${field('walletAddress', 'Crypto wallet')}
    ${field('defaultTaxRate', 'Default tax rate %')}
    ${field('defaultPaymentTermsDays', 'Default payment terms (days)')}
    <div class="form-group full"><label>Payment instructions</label><textarea class="form-control" name="paymentInstructions"></textarea></div>
  </div></div><div class="modal-foot"><button type="button">Cancel</button><button type="submit">Save billing details</button></div></form></div></div></div><div id="toast-root"></div>`;
}

test('live billing form groups keep labels and controls in non-overlapping vertical stacks', async ({ page }) => {
  await page.goto('/');
  await page.setContent(liveBillingMarkup());
  await page.addStyleTag({ url: '/assets/modal-system-r9.css?v=1' });
  await page.addStyleTag({ url: '/assets/launch-hardening-r13.css?v=2' });
  await page.addStyleTag({ url: '/assets/billing-layout-r25.css?v=1' });
  await page.addScriptTag({ url: '/assets/launch-hardening-r13.js?v=1' });

  await expect(page.getByText('Organisation identity', { exact: true })).toBeVisible();
  await expect(page.getByText('Address and contact', { exact: true })).toBeVisible();
  await expect(page.getByText('Tax and payment details', { exact: true })).toBeVisible();
  await expect(page.getByText('Invoice defaults', { exact: true })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.ops-billing-section__grid > .form-group')];
    return groups.map((group) => {
      const label = group.querySelector(':scope > label');
      const control = group.querySelector(':scope > input, :scope > textarea, :scope > select');
      const groupBox = group.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const controlBox = control.getBoundingClientRect();
      return {
        name: control.getAttribute('name'),
        groupHeight: groupBox.height,
        labelBottom: labelBox.bottom,
        controlTop: controlBox.top,
        controlBottom: controlBox.bottom,
        groupBottom: groupBox.bottom,
      };
    });
  });

  for (const item of geometry) {
    expect(item.controlTop - item.labelBottom, `${item.name} label gap`).toBeGreaterThanOrEqual(6);
    expect(item.groupBottom, `${item.name} group contains control`).toBeGreaterThanOrEqual(item.controlBottom - 1);
    expect(item.groupHeight, `${item.name} group height`).toBeGreaterThanOrEqual(69);
  }

  const addressLine1 = page.locator('.form-group:has([name="addressLine1"])');
  const addressLine2 = page.locator('.form-group:has([name="addressLine2"])');
  const rowGap = await page.evaluate(() => {
    const first = document.querySelector('.form-group:has([name="addressLine1"])').getBoundingClientRect();
    const second = document.querySelector('.form-group:has([name="addressLine2"])').getBoundingClientRect();
    return second.top - first.bottom;
  });
  await expect(addressLine1).toBeVisible();
  await expect(addressLine2).toBeVisible();
  expect(rowGap).toBeGreaterThanOrEqual(15);
});
