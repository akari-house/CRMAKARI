(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  let scheduled = false;

  function invoiceForm() {
    const forms = [...document.querySelectorAll('form')];
    return forms.find((form) => {
      const heading = form.closest('[role="dialog"], .modal, .commercial-modal')?.querySelector('h2')?.textContent?.trim();
      return heading === 'Create invoice' || heading === 'Create scheduled invoice';
    }) || null;
  }

  function ensureClientCity(form) {
    if (!form || form.querySelector('[name="recipientCity"]')) return;
    const country = form.querySelector('[name="recipientCountry"]');
    const address = form.querySelector('[name="recipientAddressLine1"]');
    const anchor = country?.closest('label') || address?.closest('label');
    if (!anchor) return;
    const field = document.createElement('label');
    field.className = anchor.className || 'commercial-field';
    field.innerHTML = '<span>Client city *</span><input name="recipientCity" type="text" required autocomplete="address-level2">';
    anchor.insertAdjacentElement('beforebegin', field);
  }

  function invalidateInvoiceViews() {
    document.querySelector('#commercial-command-centre')?.remove();
    document.querySelector('[data-commercial-workspace]')?.remove();
    const workspace = document.querySelector('#modal-root .revenue-workspace');
    if (workspace) workspace.dataset.commercialHardening = '';
    document.dispatchEvent(new CustomEvent('akari:invoice-created'));
  }

  function patchFetch() {
    if (window.fetch?.invoiceVisibilityR34 === 'ready') return;
    const previousFetch = window.fetch.bind(window);

    async function invoiceVisibilityFetch(input, init = {}) {
      let nextInit = init;
      let isInvoiceCreate = false;
      try {
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        isInvoiceCreate = method === 'POST' && url.pathname === '/api/invoices';
        if (isInvoiceCreate && typeof init.body === 'string') {
          const form = invoiceForm();
          const city = form?.querySelector('[name="recipientCity"]')?.value?.trim();
          if (city) {
            const payload = JSON.parse(init.body);
            payload.recipient = { ...(payload.recipient || {}), city };
            nextInit = { ...init, body: JSON.stringify(payload) };
          }
        }
      } catch (cause) {
        console.warn('AKARI invoice visibility request patch skipped', cause);
      }

      const response = await previousFetch(input, nextInit);
      if (isInvoiceCreate && response.ok) queueMicrotask(invalidateInvoiceViews);
      return response;
    }

    invoiceVisibilityFetch.invoiceVisibilityR34 = 'ready';
    invoiceVisibilityFetch.nativeFetch = previousFetch;
    window.fetch = invoiceVisibilityFetch;
  }

  function maintain() {
    scheduled = false;
    patchFetch();
    ensureClientCity(invoiceForm());
  }

  function scheduleMaintain() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(maintain);
  }

  new MutationObserver(scheduleMaintain).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', maintain);
  maintain();
})();
