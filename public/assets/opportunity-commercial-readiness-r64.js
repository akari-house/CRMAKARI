(() => {
  'use strict';
  if (window.__AKARI_OPPORTUNITY_READINESS_R64__) return;
  window.__AKARI_OPPORTUNITY_READINESS_R64__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const text = (node) => String(node?.textContent || '').trim();

  function findStep(workspace, label) {
    return $$('.revenue-step', workspace).find((step) => text(step.querySelector('strong')).toLowerCase() === label.toLowerCase());
  }

  function polishLifecycle(workspace) {
    const stepper = $('.revenue-stepper', workspace);
    if (!stepper) return;

    // "Opportunity" duplicates the workspace context. Referral reward remains a real revenue stage.
    findStep(workspace, 'Opportunity')?.remove();

    const outcome = findStep(workspace, 'Won / Lost');
    const client = findStep(workspace, 'Client');
    const engagement = findStep(workspace, 'Engagement');
    if (client && outcome?.classList.contains('complete') && engagement?.classList.contains('complete')) {
      client.classList.remove('current', 'pending', 'na');
      client.classList.add('complete');
      const marker = client.querySelector('span');
      if (marker) marker.textContent = '✓';
    }

    stepper.dataset.r64Polished = 'ready';
  }

  function removeDuplicateNextAction(workspace) {
    const summary = $('.revenue-summary-grid', workspace);
    if (!summary) return;
    for (const property of $$('.revenue-property', summary)) {
      if (text(property.querySelector('span')).toLowerCase() === 'next action') property.remove();
    }
    summary.dataset.r64Polished = 'ready';
  }

  function invoiceMeta(panel) {
    const invoiceItem = $$('.bd-readiness-item', panel).find((item) => text(item.querySelector('strong')).toLowerCase() === 'invoice and collection');
    const detail = text(invoiceItem?.querySelector('small'));
    const match = detail.match(/(\d+)\s+invoice(?:\(s\)|s)?/i);
    const count = match ? Number(match[1]) : 0;
    if (!count) return 'Invoice balance requires attention';
    return `${count} invoice${count === 1 ? '' : 's'} · balance remaining`;
  }

  function canonicalAction(raw) {
    const value = String(raw || '').trim();
    if (/collect or reconcile (?:the outstanding invoice balance|.+? outstanding\.?$)/i.test(value)) return { code: 'COLLECT_PAYMENT', title: 'Collect outstanding invoice balance' };
    if (/issue the first invoice/i.test(value)) return { code: 'CREATE_INVOICE', title: 'Issue the first invoice' };
    if (/complete the client billing profile/i.test(value)) return { code: 'CLIENT_BILLING', title: 'Complete the client billing profile' };
    if (/complete akari organisation billing details/i.test(value)) return { code: 'ISSUER_BILLING', title: 'Complete AKARI billing details' };
    if (/create or restore the client engagement/i.test(value)) return { code: 'ENGAGEMENT', title: 'Create or restore client engagement' };
    if (/confirm delivery, referral obligations and renewal follow-up/i.test(value)) return { code: 'COMPLETE_CYCLE', title: 'Complete delivery and renewal follow-up' };
    return { code: 'GENERAL', title: value || 'Review the next commercial action' };
  }

  function financePanel(workspace) {
    return $$('.revenue-panel', workspace).find((panel) => text(panel.querySelector('.revenue-panel-head strong')).toLowerCase() === 'invoices and payments');
  }

  function scrollToInvoices(workspace) {
    const panel = financePanel(workspace);
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.add('r64-focus-panel');
    window.setTimeout(() => panel.classList.remove('r64-focus-panel'), 1800);
  }

  function buildActionButtons(panel, workspace, action) {
    const host = document.createElement('div');
    host.className = 'bd-next-required-actions-r64';

    if (action.code === 'COLLECT_PAYMENT') {
      host.innerHTML = '<button type="button" class="btn" data-r64-action="view-invoices">View invoices</button><button type="button" class="btn primary" data-revenue-action="payment">Record payment</button>';
    } else if (action.code === 'CREATE_INVOICE') {
      const existing = panel.querySelector('.bd-commercial-readiness__actions [data-revenue-action="invoice"]');
      if (existing) {
        existing.textContent = 'Create invoice';
        host.appendChild(existing);
      }
    } else if (action.code === 'CLIENT_BILLING') {
      const existing = panel.querySelector('.bd-commercial-readiness__actions [data-client-billing-action="edit"]');
      if (existing) {
        existing.textContent = 'Complete billing profile';
        host.appendChild(existing);
      }
    }

    host.querySelector('[data-r64-action="view-invoices"]')?.addEventListener('click', () => scrollToInvoices(workspace));
    return host.childElementCount ? host : null;
  }

  function tidyLegacyFooter(panel, action) {
    const footer = $('.bd-commercial-readiness__actions', panel);
    if (!footer) return;
    if (action.code === 'COLLECT_PAYMENT') {
      footer.remove();
      return;
    }
    // Keep secondary billing maintenance available when it still adds value.
    if (!footer.querySelector('button')) footer.remove();
  }

  function polishReadiness(workspace) {
    const panel = $('[data-bd-commercial-readiness]', workspace);
    if (!panel || panel.dataset.r64Polished === 'ready') return;

    const helper = $('.bd-commercial-readiness__head > div span', panel);
    if (helper) helper.textContent = 'Track progress from opportunity to full revenue collection.';

    const oldAction = $('.bd-next-action', panel);
    const rawAction = text(oldAction?.querySelector('strong'));
    const action = canonicalAction(rawAction);
    if (oldAction) {
      const meta = action.code === 'COLLECT_PAYMENT' ? invoiceMeta(panel) : action.code === 'CREATE_INVOICE' ? 'Invoice-ready engagement' : action.code === 'CLIENT_BILLING' ? 'Billing identity required before invoicing' : '';
      oldAction.className = 'bd-next-action bd-next-required-action-r64';
      oldAction.innerHTML = `<div class="bd-next-required-copy-r64"><span>NEXT REQUIRED ACTION</span><strong>${action.title}</strong>${meta ? `<small>${meta}</small>` : ''}</div>`;
      const buttons = buildActionButtons(panel, workspace, action);
      if (buttons) oldAction.appendChild(buttons);
    }

    tidyLegacyFooter(panel, action);

    const badge = $('.bd-commercial-readiness__head > .revenue-pill', panel);
    if (badge && action.code === 'COLLECT_PAYMENT') {
      badge.classList.remove('green');
      badge.classList.add('yellow');
      badge.textContent = 'Action required';
    }

    panel.dataset.r64Polished = 'ready';
  }

  function polish() {
    const workspace = $('#modal-root .revenue-workspace');
    if (!workspace) return;
    polishLifecycle(workspace);
    removeDuplicateNextAction(workspace);
    polishReadiness(workspace);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      polish();
    });
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('akari:route-rendered', schedule);
  schedule();
})();
