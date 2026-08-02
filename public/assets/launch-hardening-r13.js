(() => {
  'use strict';

  const technicalError = /(D1_ERROR|SQLITE_ERROR|no such column|database is locked|SQLITE_BUSY|at offset \d+)/i;
  const toastWindowMs = 6000;
  const maxVisibleToasts = 4;
  let scheduled = false;

  function friendlyMessage(value) {
    const message = String(value || '').trim();
    if (!technicalError.test(message)) return message;
    console.error('AKARI CRM technical data error hidden from user:', message);
    return 'This workspace data could not be loaded. Refresh once; if it continues, contact the workspace administrator.';
  }

  function patchToastRoot() {
    const root = document.querySelector('#toast-root');
    if (!root || root.dataset.akLaunchToastGuard === 'ready') return;
    root.dataset.akLaunchToastGuard = 'ready';
    const nativeAppendChild = root.appendChild.bind(root);

    root.appendChild = function guardedAppendChild(node) {
      if (!(node instanceof HTMLElement) || !node.classList.contains('toast')) return nativeAppendChild(node);
      const message = friendlyMessage(node.textContent);
      node.textContent = message;
      node.classList.add('ak-launch-deduped');
      const now = Date.now();
      const duplicate = [...root.querySelectorAll('.toast')].find((item) =>
        item.textContent.trim() === message && now - Number(item.dataset.akToastAt || 0) < toastWindowMs
      );
      if (duplicate) {
        duplicate.dataset.akToastAt = String(now);
        duplicate.classList.remove('is-repeated');
        requestAnimationFrame(() => duplicate.classList.add('is-repeated'));
        return node;
      }
      node.dataset.akToastAt = String(now);
      while (root.querySelectorAll('.toast').length >= maxVisibleToasts) root.querySelector('.toast')?.remove();
      return nativeAppendChild(node);
    };
  }

  function fieldByName(grid, name) {
    return grid.querySelector(`:scope > label:has([name="${CSS.escape(name)}"])`);
  }

  function billingSection(title, description, modifier = '') {
    const section = document.createElement('section');
    section.className = `ops-billing-section ${modifier}`.trim();
    section.innerHTML = `<header><div><strong>${title}</strong><span>${description}</span></div></header><div class="ops-billing-section__grid"></div>`;
    return section;
  }

  function moveFields(source, target, names) {
    for (const name of names) {
      const field = fieldByName(source, name);
      if (field) target.appendChild(field);
    }
  }

  function enhanceBillingModal() {
    const dialog = document.querySelector('#modal-root .modal');
    const heading = dialog?.querySelector('.modal-head h2')?.textContent?.trim();
    if (!dialog || heading !== 'Organisation billing details') return;

    dialog.classList.add('ops-billing-profile-modal', 'ak-modal-standard', 'ak-modal--wide');
    dialog.setAttribute('aria-label', 'Organisation billing details');
    dialog.querySelector('.close')?.setAttribute('aria-label', 'Close billing details');

    const form = dialog.querySelector('form');
    const body = dialog.querySelector('.modal-body');
    const grid = body?.querySelector(':scope > .form-grid');
    if (!form || !body || !grid) return;

    if (grid.dataset.akBillingSections !== 'ready') {
      grid.dataset.akBillingSections = 'ready';
      const sections = document.createElement('div');
      sections.className = 'ops-billing-sections';

      const organisation = billingSection(
        'Organisation identity',
        'Legal identity and invoice numbering shown on every issued document.',
        'ops-billing-section--organisation'
      );
      moveFields(grid, organisation.querySelector('.ops-billing-section__grid'), ['legalName', 'invoicePrefix', 'logoUrl']);

      const address = billingSection(
        'Address and contact',
        'Registered address and the billing contact clients can use for invoice questions.',
        'ops-billing-section--address'
      );
      moveFields(grid, address.querySelector('.ops-billing-section__grid'), ['addressLine1', 'addressLine2', 'city', 'postalCode', 'country', 'email', 'phone']);

      const payment = billingSection(
        'Tax and payment details',
        'Tax identifiers and settlement information. Complete only the methods used by this workspace.',
        'ops-billing-section--payment'
      );
      moveFields(grid, payment.querySelector('.ops-billing-section__grid'), ['vatId', 'registrationNumber', 'bankName', 'iban', 'bic', 'walletAddress']);

      const defaults = billingSection(
        'Invoice defaults',
        'Default tax, payment terms and instructions can still be adjusted on individual invoices.',
        'ops-billing-section--defaults'
      );
      moveFields(grid, defaults.querySelector('.ops-billing-section__grid'), ['defaultTaxRate', 'defaultPaymentTermsDays', 'paymentInstructions']);

      const remaining = [...grid.children];
      if (remaining.length) {
        const additional = billingSection('Additional details', 'Optional billing fields used by this workspace.', 'ops-billing-section--additional');
        remaining.forEach((node) => additional.querySelector('.ops-billing-section__grid').appendChild(node));
        sections.append(organisation, address, payment, defaults, additional);
      } else {
        sections.append(organisation, address, payment, defaults);
      }
      grid.replaceWith(sections);
    }

    dialog.scrollTop = 0;
    form.scrollTop = 0;
    if (body.dataset.akBillingScrollReset !== 'ready') {
      body.scrollTop = 0;
      body.dataset.akBillingScrollReset = 'ready';
    }
  }

  function maintain() {
    scheduled = false;
    patchToastRoot();
    enhanceBillingModal();
  }

  function scheduleMaintain() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(maintain);
  }

  const observer = new MutationObserver(scheduleMaintain);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', maintain);
  document.addEventListener('akari:route-rendered', maintain);
  maintain();
})();
