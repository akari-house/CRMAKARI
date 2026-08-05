(() => {
  'use strict';

  if (window.__akariInvoiceDateStabilityR37) return;
  window.__akariInvoiceDateStabilityR37 = true;

  function stabilizeInitialDueDate() {
    const form = document.querySelector('#revenue-active-form');
    if (!form || form.dataset.invoiceDateStabilityR37 === 'ready') return;
    const heading = form.querySelector('header h3')?.textContent?.trim();
    if (heading !== 'Create engagement invoice') return;
    const dueDate = form.elements?.dueDate;
    if (!dueDate) return;

    const renderedDefault = dueDate.getAttribute('value');
    if (renderedDefault && dueDate.value !== renderedDefault) dueDate.value = renderedDefault;
    form.dataset.invoiceDateStabilityR37 = 'ready';
  }

  function schedule() {
    requestAnimationFrame(stabilizeInitialDueDate);
    setTimeout(stabilizeInitialDueDate, 80);
    setTimeout(stabilizeInitialDueDate, 220);
  }

  document.addEventListener('click', schedule, true);
  document.addEventListener('akari:revenue-workspace-refresh', schedule);
})();
