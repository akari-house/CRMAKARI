(() => {
  'use strict';

  if (window.__akariInvoiceDateStabilityR37) return;
  window.__akariInvoiceDateStabilityR37 = true;

  let timer = null;
  let attempts = 0;
  let governedDueDate = '';

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    attempts = 0;
    governedDueDate = '';
  }

  function inspectInvoiceForm() {
    attempts += 1;
    const form = document.querySelector('#revenue-active-form');
    const heading = form?.querySelector('header h3')?.textContent?.trim();
    if (!form || heading !== 'Create engagement invoice') {
      if (attempts > 100) stop();
      return;
    }

    const dueDate = form.elements?.dueDate;
    if (!dueDate) return;
    if (!governedDueDate) governedDueDate = dueDate.getAttribute('value') || dueDate.value || '';

    if (form.dataset.bdInvoiceReadinessR31 !== 'ready') return;
    if (governedDueDate) dueDate.value = governedDueDate;
    form.dataset.invoiceDateStabilityR37 = 'ready';
    stop();
  }

  function schedule() {
    stop();
    timer = setInterval(inspectInvoiceForm, 40);
    inspectInvoiceForm();
  }

  document.addEventListener('click', schedule, true);
  document.addEventListener('akari:revenue-workspace-refresh', schedule);
})();
