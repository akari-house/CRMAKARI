(() => {
  'use strict';

  const TAX_MODES = new Set(['EXCLUSIVE', 'INCLUSIVE', 'NONE']);
  const modeCopy = {
    EXCLUSIVE: {
      option: 'Tax excluded from prices · add tax',
      help: 'Line-item prices are net. The selected tax rate is added on top of the subtotal.',
      summary: 'Tax is added to the entered line-item prices.',
      subtotal: 'Subtotal (net)',
      tax: 'Tax added',
      unitPrice: 'Unit price (tax excl.)',
    },
    INCLUSIVE: {
      option: 'Tax included in prices · extract tax',
      help: 'Line-item prices already include tax. AKARI calculates the net subtotal and included tax without increasing the final total.',
      summary: 'Tax is already included in the entered line-item prices.',
      subtotal: 'Subtotal (net)',
      tax: 'Tax included',
      unitPrice: 'Unit price (tax incl.)',
    },
    NONE: {
      option: 'No tax · exempt / outside scope',
      help: 'No tax is calculated. Use the tax note to explain an exemption, reverse charge or out-of-scope supply when needed.',
      summary: 'No tax is calculated for this invoice.',
      subtotal: 'Subtotal',
      tax: 'Tax',
      unitPrice: 'Unit price',
    },
  };

  let scheduled = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

  function money(value, currency = 'USD') {
    const amount = Number(value || 0);
    const safeCurrency = String(currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: safeCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${safeCurrency} ${amount.toFixed(2)}`;
    }
  }

  function invoiceForm() {
    const form = $('#modal-root #ops-form');
    const heading = form?.querySelector('.modal-head h2')?.textContent?.trim();
    return heading === 'Create invoice' ? form : null;
  }

  function selectedMode(form) {
    const value = String($('#ops-tax-mode', form)?.value || 'NONE').toUpperCase();
    return TAX_MODES.has(value) ? value : 'NONE';
  }

  function taxValues(form) {
    const rawSubtotal = roundMoney($$('.ops-line-row', form).reduce((sum, row) => {
      const quantity = Number(row.querySelector('[data-line="quantity"]')?.value || 0);
      const unitPrice = Number(row.querySelector('[data-line="unitPrice"]')?.value || 0);
      const lineTotal = roundMoney(quantity * unitPrice);
      const cell = row.querySelector('[data-line-total]');
      if (cell) cell.textContent = money(lineTotal, $('#ops-currency', form)?.value || 'USD');
      return sum + lineTotal;
    }, 0));

    const mode = selectedMode(form);
    const enteredRate = Number($('#ops-tax-rate', form)?.value || 0);
    const taxRate = mode === 'NONE' ? 0 : Math.min(Math.max(Number.isFinite(enteredRate) ? enteredRate : 0, 0), 100);

    if (mode === 'INCLUSIVE' && taxRate > 0) {
      const subtotal = roundMoney(rawSubtotal / (1 + taxRate / 100));
      const taxAmount = roundMoney(rawSubtotal - subtotal);
      return { mode, taxRate, subtotal, taxAmount, total: rawSubtotal };
    }

    if (mode === 'EXCLUSIVE') {
      const taxAmount = roundMoney(rawSubtotal * taxRate / 100);
      return { mode, taxRate, subtotal: rawSubtotal, taxAmount, total: roundMoney(rawSubtotal + taxAmount) };
    }

    return { mode: 'NONE', taxRate: 0, subtotal: rawSubtotal, taxAmount: 0, total: rawSubtotal };
  }

  function updateTaxPresentation(form) {
    if (!form?.isConnected) return;
    const mode = selectedMode(form);
    const copy = modeCopy[mode];
    const rate = $('#ops-tax-rate', form);
    const rateField = rate?.closest('label.field');
    const help = $('[data-tax-mode-help]', form);
    const summary = $('[data-tax-mode-label]', form);
    const subtotalLabel = $('[data-subtotal-label]', form);
    const taxLabel = $('[data-tax-label]', form);
    const unitPriceHeader = $('[data-unit-price-heading]', form);

    if (rate) {
      rate.disabled = mode === 'NONE';
      if (mode === 'NONE') rate.value = '0';
    }
    rateField?.classList.toggle('ops-tax-disabled', mode === 'NONE');
    if (help) help.textContent = copy.help;
    if (summary) summary.textContent = copy.summary;
    if (subtotalLabel) subtotalLabel.textContent = copy.subtotal;
    if (taxLabel) taxLabel.textContent = copy.tax;
    if (unitPriceHeader) unitPriceHeader.textContent = copy.unitPrice;

    const values = taxValues(form);
    const currency = $('#ops-currency', form)?.value || 'USD';
    const subtotal = $('#ops-subtotal', form);
    const tax = $('#ops-tax-total', form);
    const total = $('#ops-grand-total', form);
    if (subtotal) subtotal.textContent = money(values.subtotal, currency);
    if (tax) tax.textContent = money(values.taxAmount, currency);
    if (total) total.textContent = money(values.total, currency);

    form.dataset.akariTaxMode = mode;
    form.dataset.akariInvoiceSubtotal = String(values.subtotal);
    form.dataset.akariInvoiceTax = String(values.taxAmount);
    form.dataset.akariInvoiceTotal = String(values.total);
  }

  function scheduleUpdate(form) {
    requestAnimationFrame(() => updateTaxPresentation(form));
  }

  function enhanceInvoiceModal() {
    const form = invoiceForm();
    if (!form || form.dataset.invoiceBuilderR27 === 'ready') return;
    const dialog = form.closest('.modal');
    const body = form.querySelector('.modal-body');
    const taxRate = $('#ops-tax-rate', form);
    const taxGrid = taxRate?.closest('.form-grid');
    const totals = form.querySelector('.ops-totals');
    if (!dialog || !body || !taxRate || !taxGrid || !totals) return;

    form.dataset.invoiceBuilderR27 = 'ready';
    dialog.classList.add('ops-invoice-modal-r27', 'ak-modal-standard', 'ak-modal--wide');
    dialog.setAttribute('aria-label', 'Create invoice');
    dialog.querySelector('.close')?.setAttribute('aria-label', 'Close invoice builder');

    const firstGrid = body.querySelector(':scope > .form-grid');
    if (firstGrid && !body.querySelector('[data-invoice-details-intro]')) {
      const intro = document.createElement('div');
      intro.className = 'ops-invoice-section-intro';
      intro.dataset.invoiceDetailsIntro = 'ready';
      intro.innerHTML = '<div><strong>Invoice details</strong><span>Select the client, dates, currency and invoice state.</span></div>';
      firstGrid.before(intro);
    }

    const defaultMode = Number(taxRate.value || 0) > 0 ? 'EXCLUSIVE' : 'NONE';
    const modeField = document.createElement('label');
    modeField.className = 'field full ops-tax-mode-field';
    modeField.innerHTML = `
      <span>Tax treatment *</span>
      <select id="ops-tax-mode" name="taxMode" required>
        ${[...TAX_MODES].map((mode) => `<option value="${mode}" ${mode === defaultMode ? 'selected' : ''}>${modeCopy[mode].option}</option>`).join('')}
      </select>
      <small data-tax-mode-help>${modeCopy[defaultMode].help}</small>`;
    taxGrid.prepend(modeField);

    const totalRows = [...totals.children].filter((node) => node.matches?.('div'));
    totalRows[0]?.querySelector('span')?.setAttribute('data-subtotal-label', 'true');
    totalRows[1]?.querySelector('span')?.setAttribute('data-tax-label', 'true');
    const treatment = document.createElement('span');
    treatment.className = 'ops-tax-treatment-note';
    treatment.dataset.taxModeLabel = 'true';
    totals.prepend(treatment);

    const unitPriceHeading = form.querySelector('.ops-lines thead th:nth-child(3)');
    unitPriceHeading?.setAttribute('data-unit-price-heading', 'true');

    form.addEventListener('input', () => scheduleUpdate(form), true);
    form.addEventListener('change', () => scheduleUpdate(form), true);
    new MutationObserver(() => scheduleUpdate(form)).observe($('#ops-line-items', form), { childList: true, subtree: true });

    body.scrollTop = 0;
    scheduleUpdate(form);
  }

  function patchInvoiceRequest() {
    if (window.fetch?.invoiceTaxR27 === 'ready') return;
    const nativeFetch = window.fetch.bind(window);

    async function invoiceAwareFetch(input, init = {}) {
      try {
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        const form = invoiceForm();
        if (method === 'POST' && url.pathname === '/api/invoices' && form && typeof init.body === 'string') {
          const payload = JSON.parse(init.body);
          const mode = selectedMode(form);
          payload.taxMode = mode;
          if (mode === 'NONE') payload.taxRate = 0;
          return nativeFetch(input, { ...init, body: JSON.stringify(payload) });
        }
      } catch (error) {
        console.warn('AKARI invoice tax treatment could not be attached to the request', error);
      }
      return nativeFetch(input, init);
    }

    invoiceAwareFetch.invoiceTaxR27 = 'ready';
    invoiceAwareFetch.nativeFetch = nativeFetch;
    window.fetch = invoiceAwareFetch;
  }

  function maintain() {
    scheduled = false;
    patchInvoiceRequest();
    enhanceInvoiceModal();
  }

  function scheduleMaintain() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(maintain);
  }

  new MutationObserver(scheduleMaintain).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', maintain);
  document.addEventListener('akari:route-rendered', maintain);
  maintain();
})();
