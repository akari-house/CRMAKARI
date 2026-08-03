import { test, expect } from '@playwright/test';

const billingFields = [
  ['legalName','Legal / trading name *'], ['invoicePrefix','Invoice prefix'],
  ['addressLine1','Address line 1 *'], ['addressLine2','Address line 2'],
  ['city','City'], ['postalCode','Postal code'], ['country','Country *'],
  ['email','Billing email'], ['phone','Phone'], ['vatId','VAT ID'],
  ['registrationNumber','Registration / tax number'], ['bankName','Bank name'],
  ['iban','IBAN'], ['bic','BIC / SWIFT'], ['walletAddress','Crypto wallet'],
  ['logoUrl','Logo URL'], ['defaultTaxRate','Default tax rate %'],
  ['defaultPaymentTermsDays','Default payment terms (days)'],
];

function billingMarkup() {
  return `<div id="modal-root"><div class="modal-backdrop"><div class="modal wide ops-modal-wide" role="dialog"><form id="ops-form"><div class="modal-head"><div><div class="eyebrow">AKARI CRM</div><h2>Organisation billing details</h2><p>These details appear on every new invoice. Confirm them before issuing invoices.</p></div><button type="button" class="close">×</button></div><div class="modal-body"><div class="form-grid">${billingFields.map(([name,label]) => `<label class="field ${name === 'addressLine1' || name === 'addressLine2' ? 'full' : ''}"><span>${label}</span><input name="${name}" value="${name === 'legalName' ? 'AKARI House' : ''}" /></label>`).join('')}<label class="field full"><span>Payment instructions</span><textarea name="paymentInstructions"></textarea></label></div></div><div class="modal-foot"><button type="button">Cancel</button><button type="submit">Save billing details</button></div></form></div></div></div><div id="commercial-modal-root"></div><div id="work-os-modal-root"></div><div id="toast-root" class="toast-stack"></div>`;
}

test('billing profile uses grouped fields with a fixed header and footer', async ({ page }) => {
  await page.goto('/');
  await page.setContent(billingMarkup());
  await page.addStyleTag({ url:'/assets/modal-system-r9.css?v=1' });
  await page.addStyleTag({ url:'/assets/launch-hardening-r13.css?v=2' });
  await page.addScriptTag({ url:'/assets/launch-hardening-r13.js?v=1' });

  const dialog = page.locator('#modal-root .modal');
  await expect(dialog).toHaveClass(/ops-billing-profile-modal/);
  await expect(page.locator('.ops-billing-section')).toHaveCount(4);
  await expect(page.getByText('Organisation identity', { exact:true })).toBeVisible();
  await expect(page.getByText('Address and contact', { exact:true })).toBeVisible();
  await expect(page.getByText('Tax and payment details', { exact:true })).toBeVisible();
  await expect(page.getByText('Invoice defaults', { exact:true })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('#modal-root .modal');
    const header = dialog.querySelector('.modal-head');
    const body = dialog.querySelector('.modal-body');
    const footer = dialog.querySelector('.modal-foot');
    const label = dialog.querySelector('.field > span');
    const input = dialog.querySelector('.field > input');
    const section = label.closest('.ops-billing-section');
    const dialogBox = dialog.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    const sectionBox = section.getBoundingClientRect();
    return {
      dialogTop:dialogBox.top,
      dialogBottom:dialogBox.bottom,
      dialogWidth:dialogBox.width,
      headerTop:headerBox.top,
      headerBottom:headerBox.bottom,
      bodyTop:bodyBox.top,
      bodyBottom:bodyBox.bottom,
      footerTop:footerBox.top,
      footerBottom:footerBox.bottom,
      labelTop:labelBox.top,
      labelBottom:labelBox.bottom,
      labelHeight:labelBox.height,
      inputTop:inputBox.top,
      sectionTop:sectionBox.top,
      dialogOverflow:getComputedStyle(dialog).overflow,
      bodyOverflow:getComputedStyle(body).overflowY,
      bodyScrollable:body.scrollHeight > body.clientHeight,
    };
  });

  expect(Math.abs(geometry.headerTop - geometry.dialogTop)).toBeLessThanOrEqual(1);
  expect(geometry.bodyTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
  expect(geometry.footerTop).toBeGreaterThanOrEqual(geometry.bodyBottom - 1);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.dialogBottom + 1);
  expect(geometry.labelTop).toBeGreaterThan(geometry.sectionTop);
  expect(geometry.labelHeight).toBeGreaterThanOrEqual(15);
  expect(geometry.inputTop - geometry.labelBottom).toBeGreaterThanOrEqual(5);
  expect(geometry.dialogWidth).toBeLessThanOrEqual(1042);
  expect(geometry.dialogOverflow).toBe('hidden');
  expect(['auto','scroll']).toContain(geometry.bodyOverflow);
  expect(geometry.bodyScrollable).toBeTruthy();

  const headerTopBefore = await page.locator('.modal-head').evaluate((node) => node.getBoundingClientRect().top);
  await page.locator('.modal-body').evaluate((node) => { node.scrollTop = 500; });
  const headerTopAfter = await page.locator('.modal-head').evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(headerTopAfter - headerTopBefore)).toBeLessThanOrEqual(1);
});

test('technical error toasts are friendly, deduplicated and capped', async ({ page }) => {
  await page.goto('/');
  await page.setContent('<div id="modal-root"></div><div id="toast-root" class="toast-stack"></div>');
  await page.addScriptTag({ url:'/assets/launch-hardening-r13.js?v=1' });

  await page.evaluate(() => {
    const root = document.querySelector('#toast-root');
    for (let index = 0; index < 2; index += 1) {
      const toast = document.createElement('div');
      toast.className = 'toast error';
      toast.textContent = 'D1_ERROR: no such column: funding_stage at offset 39: SQLITE_ERROR';
      root.appendChild(toast);
    }
  });

  await expect(page.locator('#toast-root .toast')).toHaveCount(1);
  await expect(page.locator('#toast-root .toast')).toContainText('This workspace data could not be loaded');
  await expect(page.locator('#toast-root')).not.toContainText('D1_ERROR');

  await page.evaluate(() => {
    const root = document.querySelector('#toast-root');
    for (let index = 0; index < 6; index += 1) {
      const toast = document.createElement('div');
      toast.className = 'toast error';
      toast.textContent = `Unique launch error ${index}`;
      root.appendChild(toast);
    }
  });
  await expect(page.locator('#toast-root .toast')).toHaveCount(4);
});
