(() => {
  'use strict';

  if (window.__akariRevenueUxR37) return;
  window.__akariRevenueUxR37 = true;

  const workspaceSnapshots = new Map();
  const nativeFetch = window.fetch.bind(window);

  function workspaceId(pathname) {
    const match = pathname.match(/^\/api\/opportunities\/([^/]+)\/workspace$/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function currency(value, code = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: code || 'USD', maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function activeInvoiceSummary(payload) {
    const invoices = Array.isArray(payload?.finance?.invoices) ? payload.finance.invoices : [];
    const cancelled = invoices.filter((item) => ['CANCELLED', 'CANCELED', 'VOID'].includes(String(item.status || '').toUpperCase()));
    const active = invoices.filter((item) => !['CANCELLED', 'CANCELED', 'VOID'].includes(String(item.status || '').toUpperCase()));
    const outstanding = active.reduce((sum, item) => sum + Number(item.outstanding || 0), 0);
    const received = active.reduce((sum, item) => sum + Number(item.received || 0), 0);
    return { invoices, active, cancelled, outstanding, received };
  }

  function replaceText(root, from, to) {
    [...root.querySelectorAll('*')].forEach((node) => {
      if (node.children.length === 0 && node.textContent.trim() === from) node.textContent = to;
    });
  }

  function decorateWonWorkspace(root, payload) {
    if (!root || String(payload?.opportunity?.stage || '').toUpperCase() !== 'WON') return;
    root.classList.add('revenue-post-won');

    const panels = [...root.querySelectorAll('.revenue-panel')];
    const qualification = panels.find((panel) => panel.querySelector('.revenue-panel-head strong')?.textContent.trim() === 'Qualification');
    if (qualification) {
      qualification.classList.add('revenue-history-panel');
      const heading = qualification.querySelector('.revenue-panel-head strong');
      const copy = qualification.querySelector('.revenue-panel-head span');
      const pill = qualification.querySelector('.revenue-pill');
      if (heading) heading.textContent = 'Pre-sale qualification history';
      if (copy) copy.textContent = 'Historical context is retained for audit and learning. It does not block post-sale delivery.';
      if (pill) {
        pill.textContent = 'Closed won';
        pill.classList.remove('yellow');
        pill.classList.add('green');
      }
    }

    const proposal = panels.find((panel) => panel.querySelector('.revenue-panel-head strong')?.textContent.trim() === 'Proposal history');
    if (proposal) {
      proposal.classList.add('revenue-history-panel');
      const copy = proposal.querySelector('.revenue-panel-head span');
      if (copy && !payload.proposals?.length) copy.textContent = 'No formal proposal was recorded. The won outcome remains the governing commercial record.';
    }

    const summary = activeInvoiceSummary(payload);
    replaceText(root, 'Invoice and collection', 'Invoice issued');
    const readinessCards = [...root.querySelectorAll('.readiness-card, .commercial-readiness-card, [class*="readiness"] article, [class*="readiness"] .card')];
    readinessCards.forEach((card) => {
      const text = card.textContent;
      if (text.includes('Qualification')) {
        const title = [...card.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent.trim() === 'Qualification');
        if (title) title.textContent = 'Pre-sale history';
        const small = card.querySelector('small, p');
        if (small) small.textContent = 'Retained for context; not a delivery blocker.';
        card.classList.add('is-history');
      }
      if (text.includes('Proposal')) {
        const title = [...card.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent.trim() === 'Proposal');
        if (title) title.textContent = 'Commercial agreement';
        const small = card.querySelector('small, p');
        if (small) small.textContent = payload.proposals?.length ? 'Proposal history is retained.' : 'Won outcome recorded without a formal proposal.';
        card.classList.add('is-history');
      }
      if (text.includes('invoice(s)') || text.includes('Invoice issued') || text.includes('Invoice and collection')) {
        const small = card.querySelector('small, p');
        if (small) {
          const activeLabel = `${summary.active.length} active invoice${summary.active.length === 1 ? '' : 's'}`;
          const cancelledLabel = summary.cancelled.length ? ` · ${summary.cancelled.length} cancelled` : '';
          small.textContent = `${activeLabel}${cancelledLabel} · ${currency(summary.outstanding, payload.opportunity.currency)} outstanding.`;
        }
      }
    });

    const nextAction = root.querySelector('.commercial-readiness-next strong, [class*="readiness"] [class*="next"] strong');
    if (nextAction && summary.outstanding > 0) nextAction.textContent = `Collect or reconcile ${currency(summary.outstanding, payload.opportunity.currency)} outstanding.`;
  }

  function ensureEconomicsSummary(form) {
    if (!form || form.querySelector('[data-engagement-economics]')) return;
    const gross = form.querySelector('input[name="grossRevenue"]');
    const campaign = form.querySelector('input[name="campaignCost"]');
    const creator = form.querySelector('input[name="creatorCost"]');
    const other = form.querySelector('input[name="otherCost"]');
    if (!gross || !campaign || !creator || !other) return;

    const block = document.createElement('section');
    block.className = 'engagement-economics';
    block.dataset.engagementEconomics = 'true';
    block.innerHTML = `
      <div><span>Total delivery cost</span><strong data-cost-total>$0.00</strong></div>
      <div><span>Gross profit</span><strong data-gross-profit>$0.00</strong></div>
      <div><span>Gross margin</span><strong data-gross-margin>0%</strong></div>
      <p data-margin-warning hidden></p>`;
    const referralField = form.querySelector('input[name="referralPercentage"]')?.closest('label');
    (referralField?.parentElement || form).insertBefore(block, referralField || null);

    const update = () => {
      const revenue = Number(gross.value || 0);
      const totalCost = Number(campaign.value || 0) + Number(creator.value || 0) + Number(other.value || 0);
      const profit = revenue - totalCost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      block.querySelector('[data-cost-total]').textContent = currency(totalCost);
      block.querySelector('[data-gross-profit]').textContent = currency(profit);
      block.querySelector('[data-gross-margin]').textContent = `${margin.toFixed(2)}%`;
      const warning = block.querySelector('[data-margin-warning]');
      if (revenue > 0 && margin < 20) {
        warning.hidden = false;
        warning.textContent = margin < 0 ? 'Warning: delivery costs exceed contract value.' : 'Margin warning: gross margin is below 20%.';
      } else {
        warning.hidden = true;
        warning.textContent = '';
      }
    };
    [gross, campaign, creator, other].forEach((input) => input.addEventListener('input', update));
    update();
  }

  function applyEnhancements() {
    const workspace = document.querySelector('.revenue-workspace');
    if (workspace) {
      const heading = workspace.querySelector('.revenue-workspace-head h2')?.textContent.trim();
      for (const payload of workspaceSnapshots.values()) {
        if (payload?.opportunity?.name === heading) {
          decorateWonWorkspace(workspace, payload);
          break;
        }
      }
    }
    const form = document.querySelector('#revenue-active-form');
    if (form && document.querySelector('h2, h3')?.textContent !== '') ensureEconomicsSummary(form);
  }

  window.fetch = async function revenueUxFetch(input, init = {}) {
    const response = await nativeFetch(input, init);
    try {
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const id = method === 'GET' ? workspaceId(url.pathname) : '';
      if (id && response.ok) {
        const payload = await response.clone().json();
        workspaceSnapshots.set(id, payload);
        queueMicrotask(applyEnhancements);
        setTimeout(applyEnhancements, 80);
      }
    } catch (error) {
      console.warn('AKARI revenue UX enhancement could not inspect response', error);
    }
    return response;
  };

  const observer = new MutationObserver(() => applyEnhancements());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('input', (event) => {
    if (event.target.closest('#revenue-active-form')) ensureEconomicsSummary(event.target.closest('#revenue-active-form'));
  });
})();
