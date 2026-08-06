(() => {
  'use strict';
  if (window.__akariDeliveryCloseoutRenewalR41) return;
  window.__akariDeliveryCloseoutRenewalR41 = true;

  const clean = (value) => String(value || '').trim();
  const statusOf = (article) => clean(article.querySelector('.delivery-pill')?.textContent).toUpperCase();
  const isDone = (status) => /(COMPLETE|COMPLETED|DONE|APPROVED|PUBLISHED|PAID)/.test(status);

  function readWorkspace(workspace) {
    const items = [...workspace.querySelectorAll('.delivery-item-list article')].map((article) => {
      const copy = article.querySelector('.delivery-item-copy');
      return {
        title: clean(copy?.querySelector('strong')?.textContent) || 'Delivery item',
        meta: clean(copy?.querySelector('span')?.textContent),
        status: statusOf(article)
      };
    });
    const completed = items.filter((item) => isDone(item.status)).length;
    const open = items.length - completed;
    const approvals = items.filter((item) => /(WAITING|REVIEW|APPROVAL|SUBMITTED)/.test(item.status)).length;
    const blocked = items.filter((item) => /(BLOCKED|DECLINED|DISPUTED)/.test(item.status)).length;
    const reports = items.filter((item) => /(REPORT|ANALYTICS|SUMMARY)/i.test(item.title));
    const reportDone = reports.some((item) => isDone(item.status));
    const allDone = items.length > 0 && open === 0;
    return { items, completed, open, approvals, blocked, reportDone, allDone };
  }

  function render() {
    const workspace = document.querySelector('.delivery-workspace:not([data-closeout-r41])');
    if (!workspace) return;
    const body = workspace.querySelector('.delivery-workspace-body');
    if (!body) return;

    const data = readWorkspace(workspace);
    const checks = [
      { title: 'Delivery work completed', note: `${data.completed} completed · ${data.open} open`, done: data.allDone },
      { title: 'Client approvals cleared', note: `${data.approvals} approval items remaining`, done: data.approvals === 0 },
      { title: 'Blocked work resolved', note: `${data.blocked} blocked items remaining`, done: data.blocked === 0 },
      { title: 'Final report delivered', note: data.reportDone ? 'Final reporting is complete' : 'Final report still required', done: data.reportDone },
      { title: 'Commercial balance reconciled', note: 'Confirm invoices and payments before closure', done: false }
    ];
    const completedChecks = checks.filter((check) => check.done).length;
    const score = Math.round((completedChecks / checks.length) * 100);
    const renewalReady = data.allDone && data.approvals === 0 && data.blocked === 0;

    const panel = document.createElement('section');
    panel.className = 'delivery-closeout-r41';
    panel.setAttribute('aria-label', 'Delivery closeout and renewal readiness');
    panel.innerHTML = `
      <header>
        <div><span>ENGAGEMENT CLOSEOUT</span><strong>Completion & renewal readiness</strong></div>
        <div class="closeout-score-r41"><b>${score}%</b><small>${completedChecks}/${checks.length} closeout controls ready</small></div>
      </header>
      <div class="closeout-grid-r41">
        <section>
          <div class="closeout-head-r41"><strong>Closeout checklist</strong><span>Requirements before completing the engagement</span></div>
          <div class="closeout-list-r41">${checks.map((check) => `
            <article class="${check.done ? 'done' : 'pending'}"><div><strong>${check.title}</strong><span>${check.note}</span></div><b>${check.done ? 'Ready' : 'Pending'}</b></article>`).join('')}</div>
        </section>
        <section>
          <div class="closeout-head-r41"><strong>Renewal signals</strong><span>Recommended commercial follow-up</span></div>
          <div class="renewal-list-r41">
            <article class="${renewalReady ? '' : 'attention'}"><div><strong>${renewalReady ? 'Renewal conversation ready' : 'Complete delivery before renewal'}</strong><span>${renewalReady ? 'Engagement is operationally ready for renewal or expansion.' : 'Open delivery controls should be resolved first.'}</span></div><b>${renewalReady ? 'Start renewal' : 'Not ready'}</b></article>
            <article class="${data.reportDone ? '' : 'attention'}"><div><strong>Client outcome review</strong><span>${data.reportDone ? 'Use the final report to review outcomes and next scope.' : 'Prepare the final report before the outcome review.'}</span></div><b>${data.reportDone ? 'Schedule review' : 'Report needed'}</b></article>
            <article><div><strong>Expansion opportunity</strong><span>Review additional services, creator campaigns, reporting or fundraising support.</span></div><b>Assess</b></article>
          </div>
        </section>
      </div>`;

    const governance = body.querySelector('.delivery-governance-r40');
    const planning = body.querySelector('.delivery-planning-r39');
    if (governance) governance.insertAdjacentElement('afterend', panel);
    else if (planning) planning.insertAdjacentElement('afterend', panel);
    else body.insertAdjacentElement('afterbegin', panel);
    workspace.dataset.closeoutR41 = 'ready';
  }

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node.nodeType === 1 && (node.matches?.('.delivery-workspace') || node.querySelector?.('.delivery-workspace'))))) queue();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-delivery-action]')) setTimeout(queue, 0);
  }, true);
  render();
})();
