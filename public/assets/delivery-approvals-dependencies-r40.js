(() => {
  'use strict';

  if (window.__akariDeliveryApprovalsDependenciesR40) return;
  window.__akariDeliveryApprovalsDependenciesR40 = true;

  const text = (value) => String(value || '').trim();
  const parseDate = (value) => {
    const parsed = Date.parse(text(value));
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  };

  function readItems(workspace) {
    return [...workspace.querySelectorAll('.delivery-item-list article')].map((article, index) => {
      const copy = article.querySelector('.delivery-item-copy');
      const title = text(copy?.querySelector('strong')?.textContent) || `Delivery item ${index + 1}`;
      const meta = text(copy?.querySelector('span')?.textContent);
      const status = text(article.querySelector('.delivery-pill')?.textContent).toUpperCase();
      const dueText = meta.match(/Due\s+(.+?)(?:\s+·|$)/i)?.[1] || '';
      const due = dueText && dueText !== '-' ? parseDate(dueText) : null;
      const complete = /(COMPLETE|COMPLETED|DONE|APPROVED|PUBLISHED|PAID)/.test(status);
      const approval = /(WAITING|REVIEW|APPROVAL|SUBMITTED)/.test(status);
      const blocked = /(BLOCKED|DECLINED|DISPUTED)/.test(status);
      return { article, index, title, meta, status, due, complete, approval, blocked };
    });
  }

  function dependencyState(items, item) {
    if (item.complete || item.index === 0) return { state: 'clear', label: item.complete ? 'Complete' : 'No dependency' };
    const previous = items[item.index - 1];
    if (!previous || previous.complete) return { state: 'clear', label: 'Ready to start' };
    return { state: 'blocked', label: `Waiting for ${previous.title}` };
  }

  function escalation(item) {
    if (item.complete) return null;
    if (item.blocked) return { level: 'high', label: 'Escalate blocked work' };
    if (item.due && item.due.getTime() < Date.now()) return { level: 'high', label: 'Escalate overdue work' };
    if (item.approval) return { level: 'medium', label: 'Chase client approval' };
    if (item.due && item.due.getTime() - Date.now() < 3 * 86400000) return { level: 'medium', label: 'Deadline approaching' };
    return null;
  }

  function render() {
    const workspace = document.querySelector('.delivery-workspace:not([data-approvals-r40])');
    if (!workspace) return;
    const body = workspace.querySelector('.delivery-workspace-body');
    if (!body) return;

    const items = readItems(workspace);
    if (!items.length) {
      workspace.dataset.approvalsR40 = 'empty';
      return;
    }

    const pendingApprovals = items.filter((item) => item.approval && !item.complete);
    const blockedByDependency = items.filter((item) => dependencyState(items, item).state === 'blocked');
    const escalations = items.map((item) => ({ item, action: escalation(item) })).filter((entry) => entry.action);

    const panel = document.createElement('section');
    panel.className = 'delivery-governance-r40';
    panel.setAttribute('aria-label', 'Milestone dependencies, approvals and escalation');
    panel.innerHTML = `
      <header>
        <div><span>DELIVERY GOVERNANCE</span><strong>Dependencies & client approvals</strong></div>
        <div class="governance-counts-r40">
          <b class="${pendingApprovals.length ? 'attention' : ''}">${pendingApprovals.length} approvals</b>
          <b class="${blockedByDependency.length ? 'attention' : ''}">${blockedByDependency.length} dependency blocks</b>
          <b class="${escalations.length ? 'danger' : ''}">${escalations.length} escalations</b>
        </div>
      </header>
      <div class="governance-grid-r40">
        <section>
          <div class="governance-head-r40"><strong>Milestone dependency chain</strong><span>Work unlocks in delivery order</span></div>
          <div class="dependency-list-r40">${items.slice(0, 8).map((item) => {
            const dependency = dependencyState(items, item);
            return `<article class="${dependency.state}"><i>${item.index + 1}</i><div><strong>${item.title}</strong><span>${dependency.label}</span></div><b>${item.complete ? 'Done' : item.status || 'Open'}</b></article>`;
          }).join('')}</div>
        </section>
        <section>
          <div class="governance-head-r40"><strong>Approval & escalation queue</strong><span>Items needing intervention</span></div>
          <div class="escalation-list-r40">${escalations.length ? escalations.slice(0, 8).map(({ item, action }) => `
            <article class="${action.level}"><div><strong>${item.title}</strong><span>${item.meta || item.status}</span></div><b>${action.label}</b></article>`).join('') : '<p class="governance-empty-r40">No approval or escalation action is currently required.</p>'}</div>
        </section>
      </div>`;

    const planning = body.querySelector('.delivery-planning-r39');
    if (planning) planning.insertAdjacentElement('afterend', panel);
    else body.insertAdjacentElement('afterbegin', panel);
    workspace.dataset.approvalsR40 = 'ready';
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