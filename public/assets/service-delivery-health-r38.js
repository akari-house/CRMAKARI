(() => {
  'use strict';

  if (window.__akariServiceDeliveryHealthR38) return;
  window.__akariServiceDeliveryHealthR38 = true;

  const numberFrom = (value, fallback = 0) => {
    const match = String(value || '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : fallback;
  };

  function health(progress, overdue, blocked) {
    const score = Math.max(0, Math.min(100, Math.round(Number(progress || 0) - Number(overdue || 0) * 8 - Number(blocked || 0) * 15)));
    const risk = blocked > 0 || overdue >= 3 || score < 45 ? 'HIGH' : overdue > 0 || score < 70 ? 'MEDIUM' : 'LOW';
    const nextAction = blocked > 0
      ? `Resolve ${blocked} blocked delivery item${blocked === 1 ? '' : 's'}`
      : overdue > 0
        ? `Complete or reschedule ${overdue} overdue item${overdue === 1 ? '' : 's'}`
        : progress < 100
          ? 'Advance the next required delivery item'
          : 'Prepare completion, report and renewal review';
    return { score, risk, nextAction };
  }

  function decorateRows() {
    document.querySelectorAll('.delivery-overview-row:not([data-health-r38])').forEach((row) => {
      const progressText = row.querySelector('.delivery-overview-progress span')?.textContent || '';
      const progress = numberFrom(progressText, 0);
      const overdueMatch = progressText.match(/(\d+)\s+overdue/i);
      const blockedMatch = progressText.match(/(\d+)\s+blocked/i);
      const overdue = overdueMatch ? Number(overdueMatch[1]) : 0;
      const blocked = blockedMatch ? Number(blockedMatch[1]) : 0;
      const result = health(progress, overdue, blocked);

      const meta = row.querySelector('.delivery-overview-meta');
      if (meta) {
        meta.insertAdjacentHTML('beforeend', `<span class="delivery-health-r38 delivery-health-r38--${result.risk.toLowerCase()}"><b>${result.score}</b> health · ${result.risk.toLowerCase()} risk</span>`);
      }
      const main = row.querySelector('.delivery-overview-main');
      if (main) {
        main.insertAdjacentHTML('beforeend', `<div class="delivery-next-r38"><span>Next action</span><strong>${result.nextAction}</strong></div>`);
      }
      row.dataset.healthR38 = 'ready';
    });
  }

  function decorateWorkspace() {
    const workspace = document.querySelector('.delivery-workspace:not([data-health-r38])');
    if (!workspace) return;
    const summaryCards = workspace.querySelectorAll('.delivery-summary article');
    if (!summaryCards.length) return;

    let progress = 0;
    let overdue = 0;
    let blocked = 0;
    summaryCards.forEach((card) => {
      const label = card.querySelector('span')?.textContent?.trim().toLowerCase();
      const strong = card.querySelector('strong')?.textContent || '';
      const small = card.querySelector('small')?.textContent || '';
      if (label === 'progress') progress = numberFrom(strong, 0);
      if (label === 'overdue') {
        overdue = numberFrom(strong, 0);
        blocked = numberFrom(small, 0);
      }
    });

    const result = health(progress, overdue, blocked);
    const body = workspace.querySelector('.delivery-workspace-body');
    if (body) {
      body.insertAdjacentHTML('afterbegin', `<section class="delivery-health-panel-r38" aria-label="Delivery health"><div><span>Delivery health</span><strong>${result.score}/100</strong></div><div><span>Risk level</span><strong class="risk-${result.risk.toLowerCase()}">${result.risk}</strong></div><div class="delivery-health-action-r38"><span>Recommended next action</span><strong>${result.nextAction}</strong></div></section>`);
    }
    workspace.dataset.healthR38 = 'ready';
  }

  function run() {
    decorateRows();
    decorateWorkspace();
  }

  const observer = new MutationObserver(() => requestAnimationFrame(run));
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(run, 0), true);
  run();
})();
