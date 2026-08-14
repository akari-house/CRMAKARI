(() => {
  'use strict';

  const state = {
    scope: 'mine',
    payloads: new Map(),
    mountedRoot: null,
    loading: false,
    scheduled: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]));

  function isDashboard() {
    const heading = $('#view-root .page-head h1')?.textContent || '';
    return /^Good (morning|afternoon|evening),/i.test(heading.trim());
  }

  function dateLabel(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', hour: date.getHours() || date.getMinutes() ? '2-digit' : undefined,
      minute: date.getHours() || date.getMinutes() ? '2-digit' : undefined,
    }).format(date);
  }

  async function request(scope, force = false) {
    if (!force && state.payloads.has(scope)) return state.payloads.get(scope);
    const response = await fetch(`/api/bd-command-center?scope=${encodeURIComponent(scope)}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `BD command centre failed (${response.status})`);
    state.payloads.set(scope, payload);
    return payload;
  }

  function summaryMetric(label, value, tone = '', category = '') {
    const count = Number(value || 0);
    const toneClass = tone ? `is-${tone}` : '';
    const zeroClass = count === 0 ? 'is-zero' : '';
    return `<div class="bd-command-metric ${toneClass} ${zeroClass}" role="group" aria-label="${esc(label)}: ${count}" ${category ? `data-bd-command-category="${esc(category)}"` : ''}>
      <span>${esc(label)}</span><strong>${count}</strong>
    </div>`;
  }

  function actionTarget(action, compact = false) {
    const label = esc(action.actionLabel || 'Open record');
    const classes = compact ? 'btn small' : 'btn primary';
    if (action.entityType === 'PROJECT' && action.projectId) {
      return `<button type="button" class="${classes}" data-open-lead="${esc(action.projectId)}">${label}</button>`;
    }
    if (action.opportunityId) {
      return `<button type="button" class="${classes}" data-revenue-action="open" data-id="${esc(action.opportunityId)}">${label}</button>`;
    }
    return `<button type="button" class="${classes}" data-route="${esc(action.route || 'dashboard')}">${label}</button>`;
  }

  function evidenceHtml(action) {
    const evidence = Array.isArray(action.evidence) ? action.evidence : [];
    if (!evidence.length) return '';
    return `<div class="bd-command-evidence">${evidence.map((item) => `<span>${esc(item)}</span>`).join('')}</div>`;
  }

  function topActionHtml(action) {
    if (!action) {
      return `<div class="bd-command-clear">
        <span aria-hidden="true">✓</span><div><strong>No immediate BD action is blocked</strong><p>Your current scope has no overdue, incomplete or closing-risk records.</p></div>
      </div>`;
    }
    const score = Number(action.score || 0);
    const scoreHelp = 'Priority score is based on urgency, overdue status, ownership, pipeline evidence and commercial readiness.';
    const actionTitle = esc(action.title);
    return `<article class="bd-command-next is-${String(action.urgency || 'normal').toLowerCase()}">
      <div class="bd-command-next__rank" aria-label="Priority score ${score}. ${esc(scoreHelp)}"><small title="${esc(scoreHelp)}">Priority score <span aria-hidden="true">ⓘ</span></small><strong>${score}</strong></div>
      <div class="bd-command-next__copy">
        <span>Next best action · ${esc(action.category?.replaceAll('_', ' ') || 'BD action')}</span>
        <h3 title="${actionTitle}">${actionTitle}</h3>
        <p>${esc(action.reason)}</p>
        ${evidenceHtml(action)}
        <div class="bd-command-next__meta"><span title="${esc(action.projectName || 'AKARI House')}">${esc(action.projectName || 'AKARI House')}</span><span title="${esc(action.ownerName || 'Unassigned')}">${esc(action.ownerName || 'Unassigned')}</span><span>${esc(action.dueAt ? dateLabel(action.dueAt) : action.priority || 'Medium')}</span></div>
      </div>
      <div class="bd-command-next__action">${actionTarget(action)}</div>
    </article>`;
  }

  function actionRowHtml(action, index) {
    const actionTitle = esc(action.title);
    const recordMeta = `${action.projectName || 'AKARI House'} · ${action.ownerName || 'Unassigned'}${action.dueAt ? ` · ${dateLabel(action.dueAt)}` : ''}`;
    return `<article class="bd-command-row" data-bd-command-category-row="${esc(action.category || '')}">
      <div class="bd-command-row__rank">${index + 2}</div>
      <div class="bd-command-row__copy">
        <div><strong title="${actionTitle}">${actionTitle}</strong><span class="bd-command-urgency is-${String(action.urgency || 'normal').toLowerCase()}">${esc(action.urgency || 'Normal')}</span></div>
        <p>${esc(action.reason)}</p>
        <small title="${esc(recordMeta)}">${esc(recordMeta)}</small>
      </div>
      <div class="bd-command-row__score"><span aria-label="Priority score ${Number(action.score || 0)}">${Number(action.score || 0)}</span>${actionTarget(action, true)}</div>
    </article>`;
  }

  function emptyRowsHtml() {
    return `<div class="bd-command-empty"><strong>Queue clear</strong><span>No additional ranked actions in this scope.</span></div>`;
  }

  function panelHtml(payload) {
    const summary = payload.summary || {};
    const actions = payload.rankedActions || [];
    const top = actions[0] || null;
    const rest = actions.slice(1, 7);
    const scope = String(payload.scope || state.scope).toLowerCase();
    return `<section class="panel bd-command-center" data-bd-command-center="ready" data-bd-command-scope="${esc(scope)}">
      <div class="panel-head bd-command-center__head">
        <div class="panel-title"><strong>BD command centre</strong><span>Ranked from current ownership, follow-ups, pipeline evidence and invoice readiness</span></div>
        <div class="bd-command-toolbar">
          ${payload.canManage ? `<div class="segmented" aria-label="BD command centre scope"><button type="button" class="${scope === 'mine' ? 'active' : ''}" data-bd-command-scope="mine">My priorities</button><button type="button" class="${scope === 'team' ? 'active' : ''}" data-bd-command-scope="team">Team risks</button></div>` : '<span class="pill">My priorities</span>'}
          <button type="button" class="btn small" data-bd-command-refresh>Refresh priorities</button>
        </div>
      </div>
      <div class="panel-body bd-command-center__body">
        <div class="bd-command-metrics" aria-label="BD execution summary">
          ${summaryMetric('Due today', summary.dueToday, summary.dueToday ? 'yellow' : '', 'DUE_TODAY')}
          ${summaryMetric('Overdue', summary.overdueFollowUps, summary.overdueFollowUps ? 'red' : '', 'OVERDUE')}
          ${summaryMetric('Unassigned', summary.unassigned, summary.unassigned ? 'yellow' : '', 'UNASSIGNED')}
          ${summaryMetric('At-risk deals', summary.opportunityRisks, summary.opportunityRisks ? 'red' : '', 'OPPORTUNITY_RISK')}
          ${summaryMetric('Closing this week', summary.closingThisWeek, summary.closingThisWeek ? 'green' : '', 'CLOSING_THIS_WEEK')}
          ${summaryMetric('Commercial handoffs', summary.commercialHandoffs, summary.commercialHandoffs ? 'yellow' : '', 'COMMERCIAL')}
        </div>
        ${topActionHtml(top)}
        <div class="bd-command-list-head"><div><strong>Next ranked actions</strong><span>${Math.max(0, actions.length - 1)} remaining in ${scope === 'team' ? 'the team queue' : 'your queue'}</span></div><small>${Number(payload.evidence?.leadRecordsReviewed || 0)} leads · ${Number(payload.evidence?.opportunityRecordsReviewed || 0)} deals reviewed</small></div>
        <div class="bd-command-list">${rest.length ? rest.map(actionRowHtml).join('') : emptyRowsHtml()}</div>
      </div>
    </section>`;
  }

  function loadingHtml() {
    return `<section class="panel bd-command-center" data-bd-command-center="loading" aria-busy="true">
      <div class="panel-head"><div class="panel-title"><strong>BD command centre</strong><span>Ranking today’s relationship and commercial work…</span></div></div>
      <div class="panel-body"><div class="bd-command-loading"><i></i><i></i><i></i></div></div>
    </section>`;
  }

  function errorHtml(message) {
    return `<section class="panel bd-command-center" data-bd-command-center="error">
      <div class="panel-head"><div class="panel-title"><strong>BD command centre</strong><span>Daily execution view is temporarily unavailable</span></div><button class="btn small" data-bd-command-refresh>Retry</button></div>
      <div class="panel-body"><div class="bd-command-error"><strong>Could not rank today’s work</strong><span>${esc(message)}</span></div></div>
    </section>`;
  }

  function insertionPoint() {
    return $('#view-root .dashboard-command-strip');
  }

  async function mount({ force = false } = {}) {
    state.scheduled = false;
    if (!isDashboard()) return;
    const point = insertionPoint();
    if (!point) return;
    const existing = $('#view-root [data-bd-command-center]');
    if (existing && !force) return;
    if (state.loading) return;

    state.loading = true;
    if (existing) existing.remove();
    point.insertAdjacentHTML('afterend', loadingHtml());
    const loading = $('#view-root [data-bd-command-center="loading"]');
    state.mountedRoot = loading;

    try {
      const payload = await request(state.scope, force);
      if (!isDashboard()) return;
      const target = $('#view-root [data-bd-command-center]');
      if (!target) return;
      target.outerHTML = panelHtml(payload);
    } catch (cause) {
      const target = $('#view-root [data-bd-command-center]');
      if (target) target.outerHTML = errorHtml(cause.message || 'Unknown command-centre error');
    } finally {
      state.loading = false;
    }
  }

  function scheduleMount() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => mount());
  }

  document.addEventListener('click', (event) => {
    const scopeButton = event.target.closest('[data-bd-command-scope]');
    if (scopeButton && scopeButton.tagName === 'BUTTON') {
      event.preventDefault();
      state.scope = scopeButton.dataset.bdCommandScope || 'mine';
      mount({ force: true });
      return;
    }
    if (event.target.closest('[data-bd-command-refresh]')) {
      event.preventDefault();
      state.payloads.delete(state.scope);
      mount({ force: true });
    }
  });

  new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scheduleMount);
  document.addEventListener('akari:route-rendered', scheduleMount);
  window.addEventListener('popstate', scheduleMount);
  window.addEventListener('hashchange', scheduleMount);
  scheduleMount();
})();
