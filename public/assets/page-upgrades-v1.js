(() => {
  const root = () => document.querySelector('#view-root');
  const text = (selector, scope = document) => scope.querySelector(selector)?.textContent?.trim() || '';

  function buttonGroup(items, current, action) {
    return `<div class="akari-density" role="group" aria-label="View density">${items.map((item) => `<button type="button" class="${item.value === current ? 'active' : ''}" data-page-ui-action="${action}" data-value="${item.value}">${item.label}</button>`).join('')}</div>`;
  }

  function commandStrip(icon, title, description, controls) {
    return `<div class="akari-command-strip"><div class="akari-command-copy"><div class="akari-command-icon">${icon}</div><div><strong>${title}</strong><span>${description}</span></div></div>${controls || ''}</div>`;
  }

  function enhanceLeads(view) {
    if (view.dataset.uiLibraryApplied === 'leads') return;
    const heading = view.querySelector('.page-head h1');
    if (!heading || heading.textContent.trim() !== 'AKARI Leads') return;
    view.dataset.uiLibraryApplied = 'leads';
    view.classList.add('akari-page-leads', localStorage.getItem('akari-lead-density') || 'compact');
    document.body.dataset.akariPage = 'leads';

    const head = view.querySelector('.page-head');
    head?.insertAdjacentHTML('afterend', commandStrip(
      '◇',
      'Relationship command centre',
      'Search, prioritise, contact and convert each relationship without losing referral or activity history.',
      buttonGroup([{ value:'compact', label:'Compact' }, { value:'comfortable', label:'Comfortable' }], localStorage.getItem('akari-lead-density') || 'compact', 'lead-density')
    ));

    const metrics = view.querySelectorAll('.mini-grid .mini-kpi');
    metrics.forEach((metric, index) => {
      metric.dataset.metricIndex = String(index + 1);
      metric.setAttribute('role', 'status');
    });
    const table = view.querySelector('.table-shell table');
    if (table) table.setAttribute('aria-label', 'AKARI lead relationships');
    view.querySelectorAll('tbody tr[data-open-lead]').forEach((row) => {
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open ${text('.record-cell strong', row) || 'lead'}`);
    });
  }

  function enhanceMyDay(view) {
    if (view.dataset.uiLibraryApplied === 'day') return;
    const heading = view.querySelector('.page-head h1');
    if (!heading || heading.textContent.trim() !== 'My Day') return;
    view.dataset.uiLibraryApplied = 'day';
    view.classList.add('akari-page-day');
    if (localStorage.getItem('akari-day-focus') === '1') view.classList.add('focus-mode');
    document.body.dataset.akariPage = 'day';

    const subtitle = text('.page-head p', view);
    const counts = subtitle.match(/(\d+) open tasks.*?(\d+) overdue.*?(\d+) due today/i) || [];
    const open = counts[1] || '0';
    const overdue = counts[2] || '0';
    const today = counts[3] || '0';
    const focus = view.classList.contains('focus-mode');
    const head = view.querySelector('.page-head');
    head?.insertAdjacentHTML('afterend', `
      ${commandStrip('✓','Daily execution queue','Work from urgency to follow-up, then close the day with every relationship carrying a next action.',buttonGroup([{value:'normal',label:'Full view'},{value:'focus',label:'Focus mode'}],focus?'focus':'normal','day-focus'))}
      <div class="daily-flow" aria-label="Daily workflow summary">
        <div class="daily-flow-step active"><span>01 · Triage</span><strong>${overdue} overdue</strong></div>
        <div class="daily-flow-step"><span>02 · Execute</span><strong>${today} due today</strong></div>
        <div class="daily-flow-step"><span>03 · Follow up</span><strong>Update relationships</strong></div>
        <div class="daily-flow-step"><span>04 · Close</span><strong>${open} open tasks</strong></div>
      </div>`);

    view.querySelectorAll('.task-card').forEach((card) => {
      const due = text('.task-due', card);
      card.dataset.taskState = card.querySelector('.task-due.overdue') ? 'overdue' : /today/i.test(due) ? 'today' : 'open';
    });
  }

  function clearPageState(view) {
    if (!view?.querySelector('.page-head h1')) return;
    const title = text('.page-head h1', view);
    if (title !== 'AKARI Leads' && title !== 'My Day') delete document.body.dataset.akariPage;
  }

  function enhance() {
    const view = root();
    if (!view) return;
    enhanceLeads(view);
    enhanceMyDay(view);
    clearPageState(view);
  }

  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-page-ui-action]');
    if (!control) return;
    const view = root();
    const action = control.dataset.pageUiAction;
    const value = control.dataset.value;
    if (action === 'lead-density' && view) {
      view.classList.remove('compact','comfortable');
      view.classList.add(value);
      localStorage.setItem('akari-lead-density', value);
    }
    if (action === 'day-focus' && view) {
      const focus = value === 'focus';
      view.classList.toggle('focus-mode', focus);
      localStorage.setItem('akari-day-focus', focus ? '1' : '0');
    }
    control.parentElement?.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button === control));
  });

  document.addEventListener('keydown', (event) => {
    const row = event.target.closest('tr[data-open-lead][role="button"]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      row.click();
    }
  });

  new MutationObserver(enhance).observe(document.documentElement, { childList:true, subtree:true });
  enhance();
})();