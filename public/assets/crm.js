const ROUTES = {
  dashboard: { label: 'Home', section: 'WORKSPACE', icon: '⌂' },
  day: { label: 'My Day', section: 'WORKSPACE', icon: '✓' },
  leads: { label: 'AKARI Leads', section: 'RELATIONSHIPS', icon: '◇' },
  contacts: { label: 'Contacts', section: 'RELATIONSHIPS', icon: '◎' },
  opportunities: { label: 'Opportunities', section: 'BUSINESS', icon: '▥' },
  fundraising: { label: 'Fundraising', section: 'BUSINESS', icon: '↗' },
  campaigns: { label: 'Campaigns', section: 'DELIVERY', icon: '◫' },
  partners: { label: 'Partners', section: 'DELIVERY', icon: '⌁' },
  finance: { label: 'Finance', section: 'COMMERCIAL', icon: '$' },
  reports: { label: 'Reports', section: 'COMMERCIAL', icon: '▤' },
  team: { label: 'Team', section: 'ADMIN', icon: '♙' },
  settings: { label: 'Settings', section: 'ADMIN', icon: '⚙' },
};

const STAGES = ['NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION','WON','LOST','ON_HOLD'];
const PIPELINE_STAGES = ['CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION'];
const CAMPAIGN_STATUSES = ['CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','COMPLETED','PAUSED','CANCELLED'];
const PRIORITIES = ['URGENT','HIGH','MEDIUM','LOW'];
const SHEETJS_MODULE = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

const state = {
  route: 'dashboard',
  me: null,
  drawer: null,
  cache: new Map(),
  financeHidden: false,
  sidebarOpen: false,
  leads: { page: 0, limit: 50, total: 0, search: '', category: '', priority: '', categories: [], items: [] },
  contacts: { search: '', items: [] },
  opportunities: [],
  tasks: [],
  campaigns: [],
  partners: [],
  payments: [],
  reports: null,
  import: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initials(value) {
  return String(value || 'AK').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function titleCase(value) {
  return String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
}

function money(value, currency = 'USD', compact = false) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(amount);
}

function dateLabel(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }
  ).format(date);
}

function isOverdue(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function normalize(input) {
  return String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.details = payload.details;
    throw err;
  }
  return payload;
}

function toast(message, type = 'success', duration = 3200) {
  const root = $('#toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), duration);
}

function routeFromLocation() {
  const route = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  return ROUTES[route] ? route : 'dashboard';
}

function setRoute(route, options = {}) {
  if (!ROUTES[route]) route = 'dashboard';
  state.route = route;
  if (!options.silent) history.pushState(null, '', `#/${route}`);
  renderShell();
  loadRoute(route);
  closeSidebar();
}

function navGroups() {
  const order = ['WORKSPACE','RELATIONSHIPS','BUSINESS','DELIVERY','COMMERCIAL','ADMIN'];
  return order.map((section) => ({ section, items: Object.entries(ROUTES).filter(([, config]) => config.section === section) }));
}

function shellHtml() {
  const user = state.me?.user || {};
  const displayName = user.fullName || user.email || 'AKARI User';
  const role = titleCase(user.role || 'Member');
  const tenant = user.tenantSlug === 'akari-house' ? 'AKARI House' : titleCase(user.tenantSlug || 'Workspace');
  const nav = navGroups().map(({ section, items }) => `
    <div class="nav-group">
      <div class="nav-label">${escapeHtml(section)}</div>
      ${items.map(([key, config]) => `
        <button class="nav-item ${state.route === key ? 'active' : ''}" data-route="${key}">
          <span class="nav-icon">${config.icon}</span>
          <span class="nav-text">${escapeHtml(config.label)}</span>
          ${key === 'leads' ? `<span class="nav-badge" id="nav-lead-count">${state.leads.total || 0}</span>` : ''}
          ${key === 'day' ? `<span class="nav-badge" id="nav-task-count">${state.tasks.length || 0}</span>` : ''}
        </button>`).join('')}
    </div>`).join('');

  return `
    <div class="shell ${state.financeHidden ? 'finance-hidden' : ''}">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar">
        <div class="brand">
          <img class="brand-lockup" src="./assets/brand/akari-crm-lockup.png" alt="AKARI CRM" />
        </div>
        <button class="workspace-button" data-action="workspace">
          <span class="workspace-main">
            <span class="workspace-avatar">AH</span>
            <span class="workspace-meta"><strong>${escapeHtml(tenant)}</strong><span>Customer 001 · Production</span></span>
          </span><span style="color:var(--muted-2)">⌄</span>
        </button>
        <div class="nav-scroll">${nav}</div>
        <div class="profile-card">
          <div class="avatar">${initials(displayName)}</div>
          <div class="profile-meta"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(role)} · ${escapeHtml(tenant)}</span></div>
        </div>
      </aside>
      <div class="sidebar-backdrop ${state.sidebarOpen ? 'open' : ''}" data-action="close-sidebar"></div>
      <main class="main">
        <header class="topbar">
          <button class="mobile-menu" data-action="open-sidebar" aria-label="Open navigation">☰</button>
          <div class="breadcrumb">${escapeHtml(tenant)} / <strong>${escapeHtml(ROUTES[state.route].label)}</strong></div>
          <div class="global-search">
            <span class="search-symbol">⌕</span>
            <input id="global-search" placeholder="Search AKARI leads, contacts and projects…" autocomplete="off" />
            <span class="kbd">Ctrl K</span>
          </div>
          <div class="top-actions">
            <button class="btn topbar-tool hide-mobile" data-action="toggle-finance" title="Hide or reveal financial values for screen sharing" aria-label="Toggle screen-share privacy"><span class="topbar-tool__icon" aria-hidden="true">◉</span><span class="topbar-tool__label">Privacy</span></button>
            <button class="btn" data-action="quick-create"><b>＋</b><span class="hide-mobile">Create</span></button>
            <button class="btn topbar-tool" data-action="refresh" title="Refresh the current CRM view" aria-label="Refresh current view"><span class="topbar-tool__icon" aria-hidden="true">↻</span><span class="topbar-tool__label">Refresh</span></button>
            <div class="avatar">${initials(displayName)}</div>
          </div>
        </header>
        <div class="content" id="view-root"></div>
      </main>
      <nav class="mobile-bottom">
        <button class="${state.route === 'dashboard' ? 'active' : ''}" data-route="dashboard">⌂<span>Home</span></button>
        <button class="${state.route === 'day' ? 'active' : ''}" data-route="day">✓<span>My Day</span></button>
        <button class="${state.route === 'leads' ? 'active' : ''}" data-route="leads">◇<span>Leads</span></button>
        <button data-action="open-sidebar">⋯<span>More</span></button>
      </nav>
    </div>`;
}

function renderShell() {
  const app = $('#app');
  app.className = '';
  app.innerHTML = shellHtml();
  const root = $('#view-root');
  root.innerHTML = loadingView();
}

function loadingView() {
  return `
    <div class="page-head"><div><div class="eyebrow">AKARI HOUSE</div><h1 class="skeleton" style="width:230px">Loading</h1><p class="skeleton" style="width:360px">Loading workspace data</p></div></div>
    <div class="kpi-grid">${Array.from({length:5}, () => `<div class="kpi"><div class="kpi-label skeleton">Metric</div><div class="kpi-value skeleton" style="width:90px">—</div></div>`).join('')}</div>`;
}

function pageHead(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="head-actions">${actions}</div></div>`;
}

function emptyState(title, text, action = '') {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>${action}</div></div>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(titleCase(value || '—'))}</span>`;
}

function priorityPill(value) {
  const key = String(value || 'MEDIUM').toUpperCase();
  return pill(key, key === 'URGENT' ? 'red' : key === 'HIGH' ? 'yellow' : key === 'LOW' ? 'blue' : '');
}

function lifecyclePill(value) {
  const key = String(value || 'LEAD').toUpperCase();
  return pill(key, key === 'CLIENT' ? 'green' : key === 'ACTIVE_OPPORTUNITY' ? 'pink' : '');
}

async function loadRoute(route, force = false) {
  const root = $('#view-root');
  if (!root) return;
  root.innerHTML = loadingView();
  try {
    if (route === 'dashboard') await renderDashboard(force);
    else if (route === 'day') await renderMyDay(force);
    else if (route === 'leads') await renderLeads(force);
    else if (route === 'contacts') await renderContacts(force);
    else if (route === 'opportunities') await renderOpportunities(force);
    else if (route === 'fundraising') await renderFundraising(force);
    else if (route === 'campaigns') await renderCampaigns(force);
    else if (route === 'partners') await renderPartners(force);
    else if (route === 'finance') await renderFinance(force);
    else if (route === 'reports') await renderReports(force);
    else if (route === 'team') await renderTeam(force);
    else if (route === 'settings') await renderSettings(force);
    document.documentElement.dataset.akariInteractive = 'ready';
  } catch (error) {
    document.documentElement.dataset.akariInteractive = 'error';
    root.innerHTML = pageHead('WORKSPACE ERROR', ROUTES[route].label, 'The view could not be loaded.') + `
      <div class="panel"><div class="panel-body">${emptyState('Unable to load this view', error.message || 'Unknown error', `<button class="btn primary" data-action="refresh">Try again</button>`)}</div></div>`;
    toast(error.message || 'View failed to load', 'error');
  }
}

async function cached(key, loader, force = false) {
  if (!force && state.cache.has(key)) return state.cache.get(key);
  const value = await loader();
  state.cache.set(key, value);
  return value;
}

function invalidate(...keys) { keys.forEach((key) => state.cache.delete(key)); }

async function renderDashboard(force = false) {
  const financeRequest = state.me?.user?.financeAccess ? api('/api/payments').catch(() => ({items:[]})) : Promise.resolve({items:[]});
  const [dashboard, tasksPayload, oppPayload, leadPayload, campaignPayload, paymentPayload] = await Promise.all([
    cached('dashboard', () => api('/api/dashboard'), force),
    cached('tasks', () => api('/api/tasks?scope=mine'), force),
    cached('opportunities', () => api('/api/opportunities'), force),
    cached('leads:recent', () => api('/api/akari-leads?limit=8&offset=0'), force),
    cached('campaigns', () => api('/api/campaigns'), force),
    force ? financeRequest : cached('payments', () => financeRequest),
  ]);
  state.tasks = tasksPayload.items || [];
  state.opportunities = oppPayload.items || [];
  state.campaigns = campaignPayload.items || [];
  state.payments = paymentPayload.items || [];
  state.leads.total = leadPayload.total || state.leads.total;
  const m = dashboard.metrics || {};
  const currency = dashboard.currency || 'USD';
  const activeOpps = state.opportunities.filter((o) => !['WON','LOST'].includes(o.stage));
  const attention = buildAttention(activeOpps, state.tasks, state.campaigns, state.payments);
  const root = $('#view-root');
  root.innerHTML = `
    ${pageHead('LIVE · AKARI HOUSE', `Good evening, ${escapeHtml((state.me?.user?.fullName || 'Muaz').split(' ')[0])}.`, 'Your relationships, opportunities, delivery and revenue in one operating view.', `
      <button class="btn yellow" data-action="open-import">⇧ Import AKARI leads</button>
      <button class="btn primary" data-action="new-lead">＋ New lead</button>`)}
    <div class="live-banner">Live tenant data is connected. Every number below comes from the AKARI House workspace.</div>
    <div class="kpi-grid">
      ${kpi('Monthly target', m.monthlyTarget, currency, 'Target for the current month', 'yellow')}
      ${kpi('Revenue booked', m.revenueBooked, currency, 'Confirmed campaign revenue')}
      ${kpi('Collected', m.revenueCollected, currency, 'Payments received', 'green')}
      ${kpi('AKARI net revenue', m.netRevenue, currency, 'After direct costs and referral share')}
      ${kpi('Weighted pipeline', m.weightedPipeline, currency, `${m.activeOpportunities || 0} active opportunities`, 'yellow', 'opportunities')}
    </div>
    <div class="mini-grid">
      ${miniKpi('Year-to-date revenue', money(m.yearToDateRevenue, currency))}
      ${miniKpi('AKARI leads', String(leadPayload.total || 0))}
      ${miniKpi('Active customers', String(m.activeCustomers || 0))}
      ${miniKpi('Active campaigns', String(m.activeCampaigns || 0))}
      ${miniKpi('Outstanding payments', money(m.outstandingPayments, currency))}
      ${miniKpi('Referral rewards due', money(m.referralRewardsDue, currency))}
    </div>
    <div class="grid-main">
      <div class="panel">
        <div class="panel-head"><div class="panel-title"><strong>Opportunity funnel</strong><span>Count and value by active stage</span></div><button class="btn small" data-route="opportunities">Open pipeline</button></div>
        <div class="panel-body">${funnelHtml(activeOpps)}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title"><strong>Business attention</strong><span>Items requiring action</span></div>${pill(attention.length + ' items', attention.length ? 'red' : 'green')}</div>
        <div class="panel-body">${attentionHtml(attention)}</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title"><strong>My tasks</strong><span>${state.tasks.length} open tasks</span></div><button class="btn small" data-route="day">Open My Day</button></div>
        <div class="panel-body">${tasksHtml(state.tasks.slice(0, 6))}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title"><strong>Recently added leads</strong><span>AKARI House lead database</span></div><button class="btn small" data-route="leads">View all</button></div>
        <div class="panel-body">${recentLeadsHtml(leadPayload.items || [])}</div>
      </div>
    </div>`;
  updateNavBadges();
}

function kpi(label, value, currency, meta, tone = '', route = '') {
  const display = value === undefined ? 'Restricted' : money(value, currency);
  return `<div class="kpi ${tone}" ${route ? `data-route="${route}"` : ''}><div class="kpi-accent"></div><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value finance-value">${escapeHtml(display)}</div><div class="kpi-meta">${escapeHtml(meta)}</div></div>`;
}
function miniKpi(label, value) { return `<div class="mini-kpi"><span>${escapeHtml(label)}</span><strong class="finance-value">${escapeHtml(value)}</strong></div>`; }

function funnelHtml(items) {
  if (!items.length) return emptyState('No opportunities yet', 'Create an opportunity from an AKARI lead to begin forecasting.', `<button class="btn primary" data-action="new-opportunity">Create opportunity</button>`);
  const summary = PIPELINE_STAGES.map((stage) => {
    const stageItems = items.filter((item) => item.stage === stage);
    return { stage, count: stageItems.length, value: stageItems.reduce((sum, item) => sum + Number(item.estimated_value_base_currency || item.estimated_value || 0), 0) };
  });
  const max = Math.max(...summary.map((item) => item.count), 1);
  return `<div class="chart-bars">${summary.map((item) => `
    <div class="chart-row"><div class="chart-label">${escapeHtml(titleCase(item.stage))}</div><div class="chart-track"><div class="chart-fill" style="width:${Math.max(item.count / max * 100, item.count ? 7 : 0)}%"></div></div><div class="chart-value">${item.count} · ${money(item.value, 'USD', true)}</div></div>`).join('')}</div>`;
}

function buildAttention(opps, tasks, campaigns, payments) {
  const items = [];
  const overdueTasks = tasks.filter((task) => isOverdue(task.due_at));
  const noNext = opps.filter((opp) => !opp.next_action);
  const overdueOpps = opps.filter((opp) => isOverdue(opp.next_follow_up_at));
  const reporting = campaigns.filter((campaign) => campaign.reporting_due_date && isOverdue(campaign.reporting_due_date) && campaign.status !== 'COMPLETED');
  const overduePayments = payments.filter((payment) => payment.status === 'OVERDUE' || (payment.due_date && isOverdue(payment.due_date) && payment.status !== 'PAID'));
  if (overdueTasks.length) items.push({ type: 'task', title: `${overdueTasks.length} task${overdueTasks.length === 1 ? '' : 's'} overdue`, text: 'Open My Day and reschedule or complete them.', route: 'day' });
  if (noNext.length) items.push({ type: 'opportunity', title: `${noNext.length} active opportunit${noNext.length === 1 ? 'y has' : 'ies have'} no next action`, text: 'Add a clear next step to protect pipeline momentum.', route: 'opportunities' });
  if (overdueOpps.length) items.push({ type: 'followup', title: `${overdueOpps.length} opportunity follow-up${overdueOpps.length === 1 ? '' : 's'} overdue`, text: 'Review the pipeline and contact the project owner.', route: 'opportunities' });
  if (reporting.length) items.push({ type: 'campaign', title: `${reporting.length} campaign report${reporting.length === 1 ? '' : 's'} overdue`, text: 'Update reporting status and deliverables.', route: 'campaigns' });
  if (overduePayments.length) items.push({ type: 'payment', title: `${overduePayments.length} payment${overduePayments.length === 1 ? '' : 's'} overdue`, text: 'Follow up with the client and update the payment record.', route: 'finance' });
  return items;
}

function attentionHtml(items) {
  if (!items.length) return `<div class="attention-card"><div class="task-copy"><strong>No urgent operational risks</strong><span>Your current records have no overdue action signals.</span></div></div>`;
  return `<div class="attention-list">${items.map((item) => `<div class="attention-card" data-route="${item.route}"><div class="task-row"><div class="record-logo">!</div><div class="task-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></div></div></div>`).join('')}</div>`;
}

function tasksHtml(items) {
  if (!items.length) return emptyState('No open tasks', 'Create a task or import the workbook tasks.', `<button class="btn primary" data-action="new-task">Create task</button>`);
  return `<div class="task-list">${items.map((task) => taskHtml(task)).join('')}</div>`;
}

function taskHtml(task) {
  const overdue = task.status !== 'DONE' && isOverdue(task.due_at);
  return `<div class="task-card"><div class="task-row">
    <button class="task-check ${task.status === 'DONE' ? 'done' : ''}" data-action="toggle-task" data-id="${escapeHtml(task.id)}">✓</button>
    <div class="task-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.project_name || task.opportunity_name || task.campaign_name || task.description || 'AKARI House')}</span></div>
    <div class="task-due ${overdue ? 'overdue' : ''}">${escapeHtml(dateLabel(task.due_at, true))}</div>
  </div></div>`;
}

function recentLeadsHtml(items) {
  if (!items.length) return emptyState('No AKARI leads yet', 'Use the protected workbook importer to load the approved AKARI lead database.', `<button class="btn yellow" data-action="open-import">Import workbook</button>`);
  return `<div class="task-list">${items.map((lead) => `<div class="task-card" data-open-lead="${escapeHtml(lead.id)}"><div class="task-row"><div class="record-logo">${initials(lead.name)}</div><div class="task-copy"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.category || 'Uncategorized')} · ${escapeHtml(lead.source_name || 'AKARI Leads')}</span></div>${priorityPill(lead.priority)}</div></div>`).join('')}</div>`;
}

async function renderMyDay(force = false) {
  const payload = await cached('tasks', () => api('/api/tasks?scope=mine'), force);
  state.tasks = payload.items || [];
  const overdue = state.tasks.filter((task) => isOverdue(task.due_at)).length;
  const today = state.tasks.filter((task) => task.due_at && new Date(task.due_at).toDateString() === new Date().toDateString()).length;
  $('#view-root').innerHTML = `
    ${pageHead('DAILY OPERATING VIEW', 'My Day', `${state.tasks.length} open tasks · ${overdue} overdue · ${today} due today`, `<button class="btn primary" data-action="new-task">＋ Add task</button>`)}
    <div class="grid-main">
      <div class="panel">
        <div class="panel-head"><div class="panel-title"><strong>Priority queue</strong><span>Complete work directly from this screen</span></div><div class="segmented"><button class="active" data-task-filter="all">All</button><button data-task-filter="overdue">Overdue</button><button data-task-filter="today">Today</button></div></div>
        <div class="panel-body" id="task-list-root">${tasksHtml(state.tasks)}</div>
      </div>
      <div>
        <div class="panel" style="margin-bottom:13px"><div class="panel-head"><div class="panel-title"><strong>Daily scorecard</strong><span>Activity completion</span></div>${pill(state.tasks.length ? `${Math.max(0,100 - overdue * 10)}%` : '100%', overdue ? 'yellow' : 'green')}</div><div class="panel-body">
          ${scoreRow('Open tasks', state.tasks.length, 10)}
          ${scoreRow('Overdue', overdue, 0, overdue ? 'red' : 'green')}
          ${scoreRow('Due today', today, 5)}
          ${scoreRow('High priority', state.tasks.filter((t) => ['URGENT','HIGH'].includes(t.priority)).length, 5)}
        </div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Quick actions</strong><span>Keep relationship records current</span></div></div><div class="panel-body"><div class="task-list">
          <button class="btn" data-action="new-lead">＋ Add lead</button>
          <button class="btn" data-action="new-opportunity">＋ Create opportunity</button>
          <button class="btn" data-action="new-campaign">＋ Create campaign</button>
          <button class="btn yellow" data-action="open-import">⇧ Import AKARI workbook</button>
        </div></div></div>
      </div>
    </div>`;
  updateNavBadges();
}

function scoreRow(label, value, target, tone = '') {
  const percentage = target > 0 ? Math.min(value / target * 100, 100) : value > 0 ? 100 : 0;
  return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:7px"><span>${escapeHtml(label)}</span><strong>${value}${target ? ` / ${target}` : ''}</strong></div><div class="progress"><div style="width:${percentage}%;${tone === 'red' ? 'background:var(--red)' : tone === 'green' ? 'background:var(--green)' : ''}"></div></div></div>`;
}

async function renderLeads(force = false) {
  const params = new URLSearchParams({ limit: state.leads.limit, offset: state.leads.page * state.leads.limit });
  if (state.leads.search) params.set('search', state.leads.search);
  if (state.leads.category) params.set('category', state.leads.category);
  if (state.leads.priority) params.set('priority', state.leads.priority);
  const key = `leads:${params.toString()}`;
  const payload = await cached(key, () => api(`/api/akari-leads?${params}`), force);
  Object.assign(state.leads, { items: payload.items || [], total: payload.total || 0, categories: payload.categories || [] });
  const totalPages = Math.max(Math.ceil(state.leads.total / state.leads.limit), 1);
  const high = state.leads.items.filter((item) => ['URGENT','HIGH'].includes(item.priority)).length;
  const contacts = state.leads.items.filter((item) => Number(item.contact_count || 0) > 0).length;
  const followups = state.leads.items.filter((item) => item.next_follow_up_at).length;
  $('#view-root').innerHTML = `
    ${pageHead('AKARI HOUSE · PRIVATE DATA', 'AKARI Leads', 'Projects, companies and organisations sourced for AKARI business development.', `
      <button class="btn yellow" data-action="open-import">⇧ Import workbook</button>
      <button class="btn primary" data-action="new-lead">＋ New lead</button>`)}
    <div class="mini-grid">
      ${miniKpi('Total AKARI leads', String(state.leads.total))}
      ${miniKpi('Visible high priority', String(high))}
      ${miniKpi('Visible with contacts', String(contacts))}
      ${miniKpi('Visible follow-ups', String(followups))}
      ${miniKpi('Categories', String(state.leads.categories.length))}
      ${miniKpi('Current page', `${state.leads.page + 1} / ${totalPages}`)}
    </div>
    <div class="toolbar">
      <input class="field search-wide grow" id="lead-search" value="${escapeHtml(state.leads.search)}" placeholder="Search project, website, X, Telegram or source…" />
      <select class="select" id="lead-category"><option value="">All categories</option>${state.leads.categories.map((row) => `<option value="${escapeHtml(row.category === 'Uncategorized' ? '' : row.category)}" ${state.leads.category === row.category ? 'selected' : ''}>${escapeHtml(row.category)} (${row.count})</option>`).join('')}</select>
      <select class="select" id="lead-priority"><option value="">All priorities</option>${PRIORITIES.map((value) => `<option value="${value}" ${state.leads.priority === value ? 'selected' : ''}>${titleCase(value)}</option>`).join('')}</select>
      <button class="btn" data-action="apply-lead-filters">Apply</button>
      <button class="btn ghost" data-action="clear-lead-filters">Clear</button>
    </div>
    <div class="table-shell">
      <table><thead><tr><th>Project / Organisation</th><th>Category</th><th>Priority</th><th>Primary contact</th><th>Channels</th><th>Owner</th><th>Next follow-up</th><th>Source</th></tr></thead>
      <tbody>${leadRows(state.leads.items)}</tbody></table>
    </div>
    <div class="pagination"><span>Showing ${state.leads.items.length ? state.leads.page * state.leads.limit + 1 : 0}–${Math.min((state.leads.page + 1) * state.leads.limit, state.leads.total)} of ${state.leads.total}</span><div class="pagination-actions"><button class="btn small" data-action="lead-prev" ${state.leads.page === 0 ? 'disabled' : ''}>Previous</button><button class="btn small" data-action="lead-next" ${state.leads.page + 1 >= totalPages ? 'disabled' : ''}>Next</button></div></div>`;
  updateNavBadges();
}

function leadRows(items) {
  if (!items.length) return `<tr><td colspan="8">${emptyState('No leads match this view', 'Clear the filters, add a lead, or import the AKARI workbook.', `<button class="btn yellow" data-action="open-import">Import workbook</button>`)}</td></tr>`;
  return items.map((lead) => {
    const channels = [lead.website ? 'Web' : '', lead.x_url ? 'X' : '', lead.telegram ? 'TG' : '', lead.primary_contact_email ? 'Email' : ''].filter(Boolean).join(' · ') || '—';
    return `<tr data-open-lead="${escapeHtml(lead.id)}">
      <td><div class="record-cell"><div class="record-logo">${initials(lead.name)}</div><div class="record-name"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.region || lead.original_status || 'AKARI Lead')}</span></div></div></td>
      <td>${escapeHtml(lead.category || 'Uncategorized')}</td>
      <td>${priorityPill(lead.priority)}</td>
      <td>${escapeHtml(lead.primary_contact || '—')} ${Number(lead.contact_count || 0) > 1 ? `<span class="pill">+${Number(lead.contact_count)-1}</span>` : ''}</td>
      <td>${escapeHtml(channels)}</td>
      <td><div class="person"><span class="person-bubble">${initials(lead.owner || '—')}</span>${escapeHtml(lead.owner || 'Unassigned')}</div></td>
      <td>${isOverdue(lead.next_follow_up_at) ? pill(dateLabel(lead.next_follow_up_at), 'red') : escapeHtml(dateLabel(lead.next_follow_up_at))}</td>
      <td>${escapeHtml(lead.source_name || '—')}</td>
    </tr>`;
  }).join('');
}

async function renderContacts(force = false) {
  const query = state.contacts.search ? `?search=${encodeURIComponent(state.contacts.search)}` : '';
  const payload = await cached(`contacts:${state.contacts.search}`, () => api(`/api/contacts${query}`), force);
  state.contacts.items = payload.items || [];
  $('#view-root').innerHTML = `
    ${pageHead('RELATIONSHIP DIRECTORY', 'Contacts', 'People connected to AKARI leads, customers, investors and partners.', `<button class="btn primary" data-action="new-contact">＋ New contact</button>`)}
    <div class="toolbar"><input class="field search-wide grow" id="contact-search" value="${escapeHtml(state.contacts.search)}" placeholder="Search name, email, Telegram or project…" /><button class="btn" data-action="apply-contact-search">Search</button></div>
    <div class="table-shell"><table><thead><tr><th>Contact</th><th>Project</th><th>Role</th><th>Email</th><th>Telegram</th><th>Primary</th><th>Last contacted</th></tr></thead><tbody>
      ${state.contacts.items.length ? state.contacts.items.map((contact) => `<tr data-open-lead="${escapeHtml(contact.project_id)}"><td><div class="record-cell"><div class="record-logo">${initials(contact.full_name)}</div><div class="record-name"><strong>${escapeHtml(contact.full_name)}</strong><span>${escapeHtml(contact.preferred_channel || 'Contact')}</span></div></div></td><td>${escapeHtml(contact.project_name || '—')}</td><td>${escapeHtml(contact.job_title || contact.contact_role || '—')}</td><td>${escapeHtml(contact.email || '—')}</td><td>${escapeHtml(contact.telegram || '—')}</td><td>${contact.is_primary_contact ? pill('Primary','green') : '—'}</td><td>${escapeHtml(dateLabel(contact.last_contacted_at))}</td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No contacts yet', 'Contacts will appear after the AKARI workbook import or manual creation.', `<button class="btn primary" data-action="new-contact">Add contact</button>`)}</td></tr>`}
    </tbody></table></div>`;
}

async function renderOpportunities(force = false) {
  const payload = await cached('opportunities', () => api('/api/opportunities'), force);
  state.opportunities = payload.items || [];
  const active = state.opportunities.filter((item) => !['WON','LOST'].includes(item.stage) && !String(item.service_type || '').includes('FUNDRAISING'));
  $('#view-root').innerHTML = `
    ${pageHead('BUSINESS DEVELOPMENT', 'Opportunity Pipeline', 'Move marketing, advisory and partnership opportunities forward with clear next actions.', `<button class="btn primary" data-action="new-opportunity">＋ New opportunity</button>`)}
    <div class="pipeline">${PIPELINE_STAGES.map((stage) => stageColumn(stage, active.filter((item) => item.stage === stage))).join('')}</div>`;
}

function stageColumn(stage, items) {
  const value = items.reduce((sum, item) => sum + Number(item.estimated_value_base_currency || item.estimated_value || 0), 0);
  return `<section class="stage"><div class="stage-head"><div><strong>${escapeHtml(titleCase(stage))}</strong><span>${items.length} opportunities · ${money(value,'USD',true)}</span></div>${pill(items.length)}</div>
    ${items.length ? items.map(dealCard).join('') : `<div class="deal-card"><div class="deal-title">No opportunities in this stage</div></div>`}</section>`;
}

function dealCard(item) {
  const risk = !item.next_action || isOverdue(item.next_follow_up_at);
  return `<article class="deal-card" data-open-lead="${escapeHtml(item.project_id)}"><strong>${escapeHtml(item.project_name || 'Project')}</strong><div class="deal-title">${escapeHtml(item.name)}</div><div class="deal-values"><span class="finance-value">${money(item.estimated_value_base_currency || item.estimated_value || 0, item.currency || 'USD')}</span><span>${Number(item.probability_percentage || 0)}%</span></div><div class="deal-foot"><span>${escapeHtml(item.owner_name || 'Unassigned')}</span><span style="color:${risk ? 'var(--red)' : 'var(--muted-2)'}">${escapeHtml(item.next_action || 'No next action')}</span></div><select class="stage-select" data-action="change-stage" data-id="${escapeHtml(item.id)}" onclick="event.stopPropagation()">${STAGES.map((stage) => `<option value="${stage}" ${item.stage === stage ? 'selected' : ''}>${titleCase(stage)}</option>`).join('')}</select></article>`;
}

async function renderFundraising(force = false) {
  const payload = await cached('opportunities', () => api('/api/opportunities'), force);
  state.opportunities = payload.items || [];
  const mandates = state.opportunities.filter((item) => String(item.service_type || '').includes('FUNDRAISING'));
  const target = mandates.reduce((sum, item) => sum + Number(item.estimated_value || 0), 0);
  const weighted = mandates.reduce((sum, item) => sum + Number(item.weighted_value || 0), 0);
  $('#view-root').innerHTML = `
    ${pageHead('CAPITAL RAISE OS', 'Fundraising', 'Track founder mandates, investor outreach, expected fees and closing progress.', `<button class="btn primary" data-action="new-fundraising">＋ New mandate</button>`)}
    <div class="mini-grid">${miniKpi('Active mandates', String(mandates.filter((m) => !['WON','LOST'].includes(m.stage)).length))}${miniKpi('Target capital / mandate value', money(target))}${miniKpi('Weighted value', money(weighted))}${miniKpi('Investor meetings', '0')}${miniKpi('Commitments', money(0))}${miniKpi('Funds closed', money(0))}</div>
    <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Fundraising mandates</strong><span>Initial working module using the opportunity engine</span></div></div><div class="panel-body">
      ${mandates.length ? `<div class="table-shell"><table><thead><tr><th>Founder / Project</th><th>Mandate</th><th>Stage</th><th>Target / Fee Value</th><th>Probability</th><th>Next action</th></tr></thead><tbody>${mandates.map((item) => `<tr data-open-lead="${escapeHtml(item.project_id)}"><td>${escapeHtml(item.project_name)}</td><td>${escapeHtml(item.name)}</td><td>${pill(item.stage,'pink')}</td><td class="finance-value">${money(item.estimated_value,item.currency || 'USD')}</td><td>${item.probability_percentage || 0}%</td><td>${escapeHtml(item.next_action || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No fundraising mandates yet', 'Create a founder mandate. Investor pipeline, diligence, commitments and data room are the next data-model expansion.', `<button class="btn primary" data-action="new-fundraising">Create mandate</button>`)}
    </div></div>`;
}

async function renderCampaigns(force = false) {
  const payload = await cached('campaigns', () => api('/api/campaigns'), force);
  state.campaigns = payload.items || [];
  $('#view-root').innerHTML = `
    ${pageHead('MARKETING OPERATIONS', 'Campaigns', 'Plan, deliver and measure AKARI client campaigns.', `<button class="btn primary" data-action="new-campaign">＋ New campaign</button>`)}
    <div class="grid-2">${state.campaigns.length ? state.campaigns.map(campaignCard).join('') : `<div class="panel" style="grid-column:1/-1"><div class="panel-body">${emptyState('No campaigns yet', 'Create a campaign after an opportunity is won.', `<button class="btn primary" data-action="new-campaign">Create campaign</button>`)}</div></div>`}</div>`;
}

function campaignCard(campaign) {
  const cost = Number(campaign.campaign_cost || 0) + Number(campaign.creator_cost || 0) + Number(campaign.other_cost || 0);
  return `<div class="panel"><div class="panel-head"><div class="panel-title"><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.project_name || 'AKARI client')}</span></div>${pill(campaign.status, campaign.status === 'LIVE' ? 'green' : campaign.status === 'COMPLETED' ? 'blue' : 'pink')}</div><div class="panel-body">
    <div class="property-grid"><div class="property"><span>Gross revenue</span><strong class="finance-value">${money(campaign.gross_revenue,campaign.currency || 'USD')}</strong></div><div class="property"><span>Direct costs</span><strong class="finance-value">${money(cost,campaign.currency || 'USD')}</strong></div><div class="property"><span>AKARI net</span><strong class="finance-value">${money(campaign.akari_net_revenue,campaign.currency || 'USD')}</strong></div><div class="property"><span>Outstanding</span><strong class="finance-value">${money(campaign.outstanding_amount,campaign.currency || 'USD')}</strong></div></div>
    <select class="stage-select" data-action="change-campaign-status" data-id="${escapeHtml(campaign.id)}">${CAMPAIGN_STATUSES.map((status) => `<option value="${status}" ${campaign.status === status ? 'selected' : ''}>${titleCase(status)}</option>`).join('')}</select>
  </div></div>`;
}

async function renderPartners(force = false) {
  const payload = await cached('partners', () => api('/api/partners'), force);
  state.partners = payload.items || [];
  $('#view-root').innerHTML = `
    ${pageHead('VALUE ATTRIBUTION', 'Partners & Referrals', 'Track who introduced value and the commercial terms attached to that relationship.', `<button class="btn primary" data-action="new-partner">＋ New partner</button>`)}
    <div class="table-shell"><table><thead><tr><th>Partner</th><th>Type</th><th>Status</th><th>Main contact</th><th>Default referral</th><th>Agreement</th><th>Updated</th></tr></thead><tbody>
      ${state.partners.length ? state.partners.map((partner) => `<tr><td><div class="record-cell"><div class="record-logo">${initials(partner.name)}</div><div class="record-name"><strong>${escapeHtml(partner.name)}</strong><span>${escapeHtml(partner.website || partner.telegram || 'Partner')}</span></div></div></td><td>${escapeHtml(titleCase(partner.partner_type))}</td><td>${pill(partner.status, partner.status === 'ACTIVE' ? 'green' : '')}</td><td>${escapeHtml(partner.contact_name || partner.contact_email || '—')}</td><td>${Number(partner.default_referral_percentage || 0)}%</td><td>${escapeHtml(partner.agreement_status || 'Not recorded')}</td><td>${escapeHtml(dateLabel(partner.updated_at))}</td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No partners yet', 'Create a referral partner before assigning revenue-sharing terms.', `<button class="btn primary" data-action="new-partner">Add partner</button>`)}</td></tr>`}
    </tbody></table></div>`;
}

async function renderFinance(force = false) {
  if (!state.me?.user?.financeAccess) {
    $('#view-root').innerHTML = pageHead('RESTRICTED', 'Finance', 'Your role does not include finance access.') + `<div class="panel"><div class="panel-body">${emptyState('Finance access required', 'Ask the organisation owner to enable finance permission for your membership.')}</div></div>`;
    return;
  }
  const payload = await cached('payments', () => api('/api/payments'), force);
  state.payments = payload.items || [];
  const total = state.payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const received = state.payments.filter((item) => item.status === 'PAID').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const outstanding = state.payments.filter((item) => !['PAID','CANCELLED'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  $('#view-root').innerHTML = `
    ${pageHead('REVENUE OPERATIONS', 'Finance', 'Invoices, payments, outstanding balances and collection status.', `<button class="btn primary" data-action="new-payment">＋ Add payment</button>`)}
    <div class="mini-grid">${miniKpi('Recorded value', money(total))}${miniKpi('Received', money(received))}${miniKpi('Outstanding', money(outstanding))}${miniKpi('Payment records', String(state.payments.length))}${miniKpi('Overdue', String(state.payments.filter((p) => p.status === 'OVERDUE').length))}${miniKpi('Currency', 'USD')}</div>
    <div class="table-shell"><table><thead><tr><th>Project</th><th>Invoice</th><th>Type</th><th>Amount</th><th>Status</th><th>Due</th><th>Received</th><th>Action</th></tr></thead><tbody>
      ${state.payments.length ? state.payments.map((payment) => `<tr><td>${escapeHtml(payment.project_name || '—')}</td><td>${escapeHtml(payment.invoice_reference || '—')}</td><td>${escapeHtml(payment.payment_type || '—')}</td><td class="finance-value">${money(payment.amount,payment.currency || 'USD')}</td><td>${pill(payment.status,payment.status === 'PAID' ? 'green' : payment.status === 'OVERDUE' ? 'red' : 'yellow')}</td><td>${escapeHtml(dateLabel(payment.due_date))}</td><td>${escapeHtml(dateLabel(payment.received_date))}</td><td>${payment.status !== 'PAID' ? `<button class="btn small" data-action="mark-payment-paid" data-id="${escapeHtml(payment.id)}">Mark paid</button>` : '—'}</td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No payment records yet', 'Add the first invoice or client payment.', `<button class="btn primary" data-action="new-payment">Add payment</button>`)}</td></tr>`}
    </tbody></table></div>`;
}

async function renderReports(force = false) {
  const payload = await cached('reports', () => api('/api/reports'), force);
  state.reports = payload;
  const pipeline = payload.pipelineByStage || [];
  const revenue = payload.revenueByMonth || [];
  $('#view-root').innerHTML = `
    ${pageHead('BUSINESS INTELLIGENCE', 'Reports', 'Source-linked pipeline and revenue reporting for AKARI House.', `<button class="btn" data-action="refresh">↻ Refresh</button>`)}
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Pipeline by stage</strong><span>Opportunity count and weighted value</span></div></div><div class="panel-body">${pipeline.length ? reportBars(pipeline.map((row) => ({label:titleCase(row.stage), value:Number(row.weighted_value || 0), meta:`${row.opportunity_count} · ${money(row.pipeline_value,'USD',true)}`}))) : emptyState('No pipeline report yet','Create opportunities to populate this report.')}</div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Revenue collected by month</strong><span>Paid payment records</span></div></div><div class="panel-body">${revenue.length ? reportBars(revenue.map((row) => ({label:row.month,value:Number(row.collected || 0),meta:money(row.collected)}))) : emptyState('No revenue report yet','Add paid payment records to populate this report.')}</div></div>
    </div>`;
}

function reportBars(items) {
  const max = Math.max(...items.map((item) => item.value),1);
  return `<div class="chart-bars">${items.map((item) => `<div class="chart-row"><div class="chart-label">${escapeHtml(item.label)}</div><div class="chart-track"><div class="chart-fill" style="width:${item.value / max * 100}%"></div></div><div class="chart-value">${escapeHtml(item.meta)}</div></div>`).join('')}</div>`;
}

async function renderTeam() {
  const user = state.me?.user || {};
  $('#view-root').innerHTML = `
    ${pageHead('ORGANISATION ADMINISTRATION', 'Team', 'AKARI House membership and role controls.', `<button class="btn primary" data-action="invite-user">＋ Invite user</button>`)}
    <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Current membership</strong><span>Live authenticated account</span></div></div><div class="panel-body"><div class="table-shell"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Finance</th><th>Tenant</th><th>Status</th></tr></thead><tbody><tr><td><div class="record-cell"><div class="record-logo">${initials(user.fullName || user.email)}</div><div class="record-name"><strong>${escapeHtml(user.fullName || 'AKARI User')}</strong><span>Current session</span></div></div></td><td>${escapeHtml(user.email || '—')}</td><td>${pill(user.role,'pink')}</td><td>${user.financeAccess ? pill('Enabled','green') : pill('Disabled')}</td><td>${escapeHtml(user.tenantSlug || '—')}</td><td>${pill('Active','green')}</td></tr></tbody></table></div></div></div>`;
}

async function renderSettings() {
  const user = state.me?.user || {};
  $('#view-root').innerHTML = `
    ${pageHead('WORKSPACE CONFIGURATION', 'Settings', 'Tenant identity, privacy and import controls.', '')}
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Workspace</strong><span>AKARI House tenant</span></div></div><div class="panel-body"><div class="property-grid"><div class="property"><span>Tenant slug</span><strong>${escapeHtml(user.tenantSlug || 'akari-house')}</strong></div><div class="property"><span>Role</span><strong>${escapeHtml(titleCase(user.role))}</strong></div><div class="property"><span>Finance access</span><strong>${user.financeAccess ? 'Enabled' : 'Disabled'}</strong></div><div class="property"><span>Authentication</span><strong>Cloudflare Access OTP</strong></div></div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Data management</strong><span>Private AKARI tenant controls</span></div></div><div class="panel-body"><div class="task-list"><button class="btn yellow" data-action="open-import">⇧ Import AKARI workbook</button><button class="btn" data-route="leads">Open AKARI Leads</button><button class="btn" data-action="toggle-finance">Toggle screen-share privacy</button></div></div></div>
    </div>`;
}

function openSidebar() { state.sidebarOpen = true; renderShell(); loadRoute(state.route); }
function closeSidebar() { if (!state.sidebarOpen) return; state.sidebarOpen = false; renderShell(); loadRoute(state.route); }

function modal({ title, subtitle = '', body, submitText = '', submitClass = 'primary', onSubmit, wide = false, footerExtra = '' }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="close" data-action="close-modal">×</button></div><form id="active-form"><div class="modal-body">${body}</div><div class="modal-foot">${footerExtra}<button type="button" class="btn" data-action="close-modal">Cancel</button>${submitText ? `<button type="submit" class="btn ${submitClass}">${escapeHtml(submitText)}</button>` : ''}</div></form></div></div>`;
  const form = $('#active-form');
  if (form && onSubmit) form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Saving…';
    try { await onSubmit(form); }
    catch (error) { toast(error.message || 'Action failed', 'error'); submit.disabled = false; submit.textContent = original; }
  });
}

function closeModal() { $('#modal-root').innerHTML = ''; }

function field(name, label, options = {}) {
  const { type = 'text', value = '', required = false, placeholder = '', full = false, help = '', options: choices = null, min = '', step = '', checked = false } = options;
  let control;
  if (type === 'textarea') control = `<textarea class="form-control" name="${name}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}>${escapeHtml(value)}</textarea>`;
  else if (type === 'select') control = `<select class="form-control" name="${name}" ${required ? 'required' : ''}>${(choices || []).map((choice) => typeof choice === 'string' ? `<option value="${escapeHtml(choice)}" ${String(value) === choice ? 'selected' : ''}>${escapeHtml(titleCase(choice))}</option>` : `<option value="${escapeHtml(choice.value)}" ${String(value) === String(choice.value) ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`).join('')}</select>`;
  else if (type === 'checkbox') return `<label class="checkbox ${full ? 'form-group full' : ''}"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} />${escapeHtml(label)}</label>`;
  else control = `<input class="form-control" type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} ${min !== '' ? `min="${min}"` : ''} ${step !== '' ? `step="${step}"` : ''} />`;
  return `<div class="form-group ${full ? 'full' : ''}"><label>${escapeHtml(label)}${required ? ' *' : ''}</label>${control}${help ? `<small>${escapeHtml(help)}</small>` : ''}</div>`;
}

function formDataObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  $$('input[type=checkbox]', form).forEach((input) => { data[input.name] = input.checked; });
  return data;
}

function openNewLead(existing = null) {
  modal({
    title: existing ? 'Edit AKARI lead' : 'New AKARI lead',
    subtitle: 'This record belongs only to the AKARI House tenant.',
    submitText: existing ? 'Save changes' : 'Create lead',
    body: `<div class="form-grid">
      ${field('name','Project / organisation',{value:existing?.name,required:true,placeholder:'Project name'})}
      ${field('category','Primary category',{value:existing?.category,placeholder:'DeFi, AI, VC, Gaming…'})}
      ${field('website','Website',{type:'url',value:existing?.website,placeholder:'https://'})}
      ${field('xUrl','X profile',{type:'url',value:existing?.x_url,placeholder:'https://x.com/'})}
      ${field('telegram','Telegram',{value:existing?.telegram,placeholder:'@handle or group URL'})}
      ${field('region','Country / region',{value:existing?.region})}
      ${field('priority','Priority',{type:'select',value:existing?.priority || 'MEDIUM',options:PRIORITIES})}
      ${field('sourceName','Lead source',{value:existing?.source_name,placeholder:'Referral, outreach, event…'})}
      ${field('nextFollowUpAt','Next follow-up',{type:'datetime-local',value:existing?.next_follow_up_at ? new Date(existing.next_follow_up_at).toISOString().slice(0,16) : ''})}
      ${field('description','Partnership scope',{type:'textarea',value:existing?.description,full:true,placeholder:'What value or service could AKARI create?'})}
      ${field('notes','Internal notes',{type:'textarea',value:existing?.original_notes,full:true})}
      ${field('assignToMe','Assign to me',{type:'checkbox',checked:existing ? Boolean(existing.owner_user_id) : true,full:true})}
    </div>`,
    onSubmit: async (form) => {
      const data = formDataObject(form);
      if (existing) await api(`/api/akari-leads/${encodeURIComponent(existing.id)}`, { method:'PATCH', body:JSON.stringify(data) });
      else await api('/api/akari-leads', { method:'POST', body:JSON.stringify(data) });
      closeModal(); invalidate('dashboard','leads:recent'); state.cache.forEach((_,key) => { if (key.startsWith('leads:')) state.cache.delete(key); }); toast(existing ? 'Lead updated' : 'AKARI lead created');
      if (existing) await openLead(existing.id); else setRoute('leads');
    },
  });
}

async function projectOptions() {
  const payload = await api('/api/akari-leads?limit=100&offset=0');
  return (payload.items || []).map((item) => ({ value:item.id, label:item.name }));
}

async function openNewContact(project = null) {
  const options = project ? [{value:project.id,label:project.name}] : await projectOptions();
  modal({
    title:'New contact', subtitle:'Connect a person to an AKARI lead or project.', submitText:'Create contact',
    body:`<div class="form-grid">
      ${field('projectId','Project',{type:'select',required:true,options})}
      ${field('fullName','Full name',{required:true})}
      ${field('jobTitle','Role / title')}${field('email','Email',{type:'email'})}
      ${field('telegram','Telegram')}${field('xHandle','X profile / handle')}
      ${field('phone','Phone / other contact')}${field('preferredChannel','Preferred channel',{type:'select',options:['TELEGRAM','EMAIL','X','PHONE','LINKEDIN']})}
      ${field('isPrimaryContact','Primary contact',{type:'checkbox',checked:true,full:true})}
      ${field('notes','Notes',{type:'textarea',full:true})}
    </div>`,
    onSubmit:async(form)=>{ const data=formDataObject(form); await api('/api/contacts',{method:'POST',body:JSON.stringify(data)}); closeModal(); invalidate('contacts:','leads:recent'); toast('Contact created'); if(project) await openLead(project.id); else setRoute('contacts'); }
  });
}

async function openNewTask(project = null, opportunity = null, campaign = null) {
  modal({
    title:'New task', subtitle:'Create a clear next action.', submitText:'Create task',
    body:`<div class="form-grid">
      ${field('title','Task',{required:true,full:true})}
      ${field('priority','Priority',{type:'select',value:'MEDIUM',options:PRIORITIES})}
      ${field('dueAt','Due date and time',{type:'datetime-local'})}
      ${field('description','Description',{type:'textarea',full:true})}
      <input type="hidden" name="projectId" value="${escapeHtml(project?.id || '')}" />
      <input type="hidden" name="opportunityId" value="${escapeHtml(opportunity?.id || '')}" />
      <input type="hidden" name="campaignId" value="${escapeHtml(campaign?.id || '')}" />
    </div>`,
    onSubmit:async(form)=>{ const data=formDataObject(form); await api('/api/tasks',{method:'POST',body:JSON.stringify(data)}); closeModal(); invalidate('tasks','dashboard'); toast('Task created'); if(state.route==='day') renderMyDay(true); }
  });
}

async function openNewOpportunity(project = null, fundraising = false) {
  const options = project ? [{value:project.id,label:project.name}] : await projectOptions();
  modal({
    title:fundraising ? 'New fundraising mandate' : 'New opportunity',
    subtitle:fundraising ? 'Track a founder capital-raise engagement.' : 'Create a commercial opportunity connected to an AKARI lead.',
    submitText:fundraising ? 'Create mandate' : 'Create opportunity',
    body:`<div class="form-grid">
      ${field('projectId','Project',{type:'select',required:true,options})}
      ${field('name',fundraising ? 'Mandate / round name' : 'Opportunity name',{required:true})}
      ${field('serviceType','Service type',{value:fundraising ? 'FUNDRAISING_MANDATE' : 'MARKETING_CAMPAIGN',required:true})}
      ${field('stage','Stage',{type:'select',value:'NEW',options:STAGES})}
      ${field('estimatedValue',fundraising ? 'Target raise / AKARI fee basis' : 'Estimated value',{type:'number',min:0,step:'0.01'})}
      ${field('currency','Currency',{type:'select',value:'USD',options:['USD','EUR','USDT','GBP']})}
      ${field('probabilityPercentage','Probability %',{type:'number',value:10,min:0,step:1})}
      ${field('expectedCloseDate','Expected close',{type:'date'})}
      ${field('nextAction','Next action',{required:true})}
      ${field('nextFollowUpAt','Next follow-up',{type:'datetime-local'})}
      ${field('description','Description',{type:'textarea',full:true})}
    </div>`,
    onSubmit:async(form)=>{ const data=formDataObject(form); await api('/api/opportunities',{method:'POST',body:JSON.stringify(data)}); closeModal(); invalidate('opportunities','dashboard','reports'); toast(fundraising?'Fundraising mandate created':'Opportunity created'); setRoute(fundraising?'fundraising':'opportunities'); }
  });
}

async function openNewCampaign(project = null) {
  const options = project ? [{value:project.id,label:project.name}] : await projectOptions();
  modal({
    title:'New campaign', subtitle:'Create a delivery and profitability record.', submitText:'Create campaign',
    body:`<div class="form-grid">
      ${field('projectId','Client / project',{type:'select',required:true,options})}
      ${field('name','Campaign name',{required:true})}
      ${field('status','Status',{type:'select',value:'CONFIRMED',options:CAMPAIGN_STATUSES})}
      ${field('region','Region')}
      ${field('startDate','Start date',{type:'date'})}${field('endDate','End date',{type:'date'})}
      ${field('grossRevenue','Gross revenue',{type:'number',value:0,min:0,step:'0.01'})}${field('currency','Currency',{type:'select',value:'USD',options:['USD','EUR','USDT']})}
      ${field('campaignCost','Campaign cost',{type:'number',value:0,min:0,step:'0.01'})}${field('creatorCost','Creator cost',{type:'number',value:0,min:0,step:'0.01'})}
      ${field('otherCost','Other cost',{type:'number',value:0,min:0,step:'0.01'})}${field('referralPercentage','Referral %',{type:'number',value:0,min:0,step:'0.01'})}
      ${field('deliverablesSummary','Deliverables',{type:'textarea',full:true})}
      ${field('notes','Internal notes',{type:'textarea',full:true})}
    </div>`,
    onSubmit:async(form)=>{ const data=formDataObject(form); await api('/api/campaigns',{method:'POST',body:JSON.stringify(data)}); closeModal(); invalidate('campaigns','dashboard'); toast('Campaign created'); setRoute('campaigns'); }
  });
}

function openNewPartner() {
  modal({
    title:'New partner', subtitle:'Record an introducer, referral partner or strategic relationship.', submitText:'Create partner',
    body:`<div class="form-grid">
      ${field('name','Partner name',{required:true})}${field('partnerType','Partner type',{type:'select',value:'REFERRAL',options:['REFERRAL','INVESTOR_INTRODUCER','FUNDRAISING_PARTNER','AGENCY','CREATOR_NETWORK','STRATEGIC','OTHER']})}
      ${field('website','Website',{type:'url'})}${field('telegram','Telegram')}
      ${field('contactName','Main contact')}${field('contactEmail','Email',{type:'email'})}
      ${field('defaultReferralPercentage','Default referral %',{type:'number',value:0,min:0,step:'0.01'})}${field('agreementStatus','Agreement status',{type:'select',value:'DRAFT',options:['DRAFT','ACTIVE','EXPIRED','TERMINATED']})}
      ${field('notes','Notes',{type:'textarea',full:true})}
    </div>`,
    onSubmit:async(form)=>{ await api('/api/partners',{method:'POST',body:JSON.stringify(formDataObject(form))}); closeModal(); invalidate('partners','dashboard'); toast('Partner created'); setRoute('partners'); }
  });
}

async function openNewPayment(project = null) {
  const options = project ? [{value:project.id,label:project.name}] : await projectOptions();
  modal({
    title:'New payment record', subtitle:'Record an invoice or received payment.', submitText:'Create payment',
    body:`<div class="form-grid">
      ${field('projectId','Project / client',{type:'select',required:true,options})}
      ${field('invoiceReference','Invoice reference')}
      ${field('paymentType','Payment type',{type:'select',value:'CAMPAIGN_FEE',options:['CAMPAIGN_FEE','FUNDRAISING_RETAINER','FUNDRAISING_SUCCESS_FEE','ADVISORY_FEE','OTHER']})}
      ${field('amount','Amount',{type:'number',required:true,min:0,step:'0.01'})}
      ${field('currency','Currency',{type:'select',value:'USD',options:['USD','EUR','USDT','GBP']})}
      ${field('status','Status',{type:'select',value:'INVOICED',options:['DRAFT','INVOICED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED']})}
      ${field('dueDate','Due date',{type:'date'})}${field('receivedDate','Received date',{type:'date'})}
      ${field('paymentMethod','Payment method')}${field('reference','Transaction / bank reference')}
      ${field('notes','Notes',{type:'textarea',full:true})}
    </div>`,
    onSubmit:async(form)=>{ await api('/api/payments',{method:'POST',body:JSON.stringify(formDataObject(form))}); closeModal(); invalidate('payments','dashboard'); toast('Payment record created'); setRoute('finance'); }
  });
}

function openQuickCreate() {
  modal({ title:'Create', subtitle:'Add a record to the AKARI House workspace.', body:`<div class="grid-2">
    <button type="button" class="btn" data-action="new-lead">◇ New AKARI lead</button>
    <button type="button" class="btn" data-action="new-task">✓ New task</button>
    <button type="button" class="btn" data-action="new-opportunity">▥ New opportunity</button>
    <button type="button" class="btn" data-action="new-fundraising">↗ Fundraising mandate</button>
    <button type="button" class="btn" data-action="new-campaign">◫ New campaign</button>
    <button type="button" class="btn" data-action="new-partner">⌁ New partner</button>
    ${state.me?.user?.financeAccess ? '<button type="button" class="btn" data-action="new-payment">$ New payment</button>' : ''}
    <button type="button" class="btn yellow" data-action="open-import">⇧ Import workbook</button>
  </div>` });
}

async function openLead(id) {
  try {
    const project = await api(`/api/projects/${encodeURIComponent(id)}`);
    state.drawer = project;
    renderDrawer('overview');
  } catch (error) { toast(error.message || 'Lead could not be opened','error'); }
}

function renderDrawer(tab = 'overview') {
  const p = state.drawer;
  if (!p) return;
  let root = $('#drawer-root');
  if (!root) { root = document.createElement('div'); root.id = 'drawer-root'; document.body.appendChild(root); }
  const contacts = p.contacts || [];
  const opportunities = p.opportunities || [];
  const activities = p.activities || [];
  const content = tab === 'overview' ? drawerOverview(p, contacts, opportunities)
    : tab === 'contacts' ? drawerContacts(p, contacts)
    : tab === 'opportunities' ? drawerOpportunities(p, opportunities)
    : drawerActivities(p, activities);
  root.innerHTML = `<div class="drawer-backdrop open" data-action="close-drawer"></div><aside class="drawer open"><div class="drawer-head"><div class="drawer-top"><div class="drawer-title"><div class="drawer-title-logo">${initials(p.name)}</div><div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(titleCase(p.lifecycle_status || 'LEAD'))} · ${escapeHtml(titleCase(p.priority || 'MEDIUM'))} priority</p></div></div><button class="close" data-action="close-drawer">×</button></div><div class="drawer-actions"><button class="btn primary small" data-action="edit-lead">Edit lead</button><button class="btn small" data-action="new-contact-for-lead">＋ Contact</button><button class="btn small" data-action="new-opportunity-for-lead">＋ Opportunity</button><button class="btn small" data-action="new-task-for-lead">＋ Task</button></div></div><div class="drawer-tabs">${['overview','contacts','opportunities','activity'].map((name) => `<button class="drawer-tab ${tab === name ? 'active' : ''}" data-drawer-tab="${name}">${titleCase(name)}</button>`).join('')}</div><div class="drawer-body">${content}</div></aside>`;
}

function drawerOverview(p, contacts, opportunities) {
  const activeOpps = opportunities.filter((item) => !['WON','LOST'].includes(item.stage));
  const pipeline = activeOpps.reduce((sum,item)=>sum+Number(item.estimated_value || 0),0);
  const weighted = activeOpps.reduce((sum,item)=>sum+Number(item.weighted_value || 0),0);
  return `<div class="drawer-section"><h3>Relationship overview</h3><div class="property-grid">
    ${property('Lifecycle',titleCase(p.lifecycle_status))}${property('Priority',titleCase(p.priority))}${property('Category',p.category || 'Uncategorized')}${property('Region',p.region || '—')}${property('Owner',p.owner_user_id ? 'Assigned' : 'Unassigned')}${property('Next follow-up',dateLabel(p.next_follow_up_at,true))}
  </div></div>
  <div class="drawer-section"><h3>Channels</h3><div class="property-grid">${property('Website',linkValue(p.website))}${property('X profile',linkValue(p.x_url))}${property('Telegram',p.telegram || '—')}${property('Lead source',p.source_name || '—')}</div></div>
  <div class="drawer-section"><h3>Commercial summary</h3><div class="property-grid">${property('Open opportunities',String(activeOpps.length))}${property('Pipeline value',money(pipeline),'finance-value')}${property('Weighted value',money(weighted),'finance-value')}${property('Contacts',String(contacts.length))}</div></div>
  <div class="drawer-section"><h3>Partnership scope</h3><div class="notes">${escapeHtml(p.description || 'No partnership scope recorded.')}</div></div>
  <div class="drawer-section"><h3>Internal notes</h3><div class="notes">${escapeHtml(p.original_notes || 'No notes recorded.')}</div></div>`;
}
function drawerContacts(p, contacts) { return `<div class="drawer-section"><h3>Contacts</h3>${contacts.length ? `<div class="task-list">${contacts.map((c)=>`<div class="task-card"><div class="task-row"><div class="record-logo">${initials(c.full_name)}</div><div class="task-copy"><strong>${escapeHtml(c.full_name)}</strong><span>${escapeHtml(c.job_title || c.contact_role || 'Contact')} · ${escapeHtml(c.email || c.telegram || c.x_handle || 'No channel')}</span></div>${c.is_primary_contact ? pill('Primary','green') : ''}</div></div>`).join('')}</div>` : emptyState('No contacts','Add the decision-maker or primary project contact.',`<button class="btn primary" data-action="new-contact-for-lead">Add contact</button>`)}</div>`; }
function drawerOpportunities(p, items) { return `<div class="drawer-section"><h3>Opportunities</h3>${items.length ? `<div class="task-list">${items.map((o)=>`<div class="task-card"><div class="task-copy"><strong>${escapeHtml(o.name)}</strong><span>${escapeHtml(titleCase(o.stage))} · ${money(o.estimated_value,o.currency || 'USD')} · ${escapeHtml(o.next_action || 'No next action')}</span></div></div>`).join('')}</div>` : emptyState('No opportunities','Create a commercial or fundraising opportunity from this project.',`<button class="btn primary" data-action="new-opportunity-for-lead">Create opportunity</button>`)}</div>`; }
function drawerActivities(p, items) { return `<div class="drawer-section"><h3>Recent activity</h3>${items.length ? `<div class="activity-list">${items.map((a)=>`<div class="activity-card"><div class="task-copy"><strong>${escapeHtml(a.subject || titleCase(a.activity_type))}</strong><span>${escapeHtml(dateLabel(a.occurred_at,true))}${a.outcome ? ` · ${escapeHtml(a.outcome)}` : ''}</span></div></div>`).join('')}</div>` : emptyState('No activities recorded','Record Telegram, X, calls, meetings and notes from this lead.',`<button class="btn primary" data-action="new-activity-for-lead">Record activity</button>`)}</div>`; }
function property(label,value,className='') { return `<div class="property"><span>${escapeHtml(label)}</span><strong class="${className}">${value}</strong></div>`; }
function linkValue(value) { if(!value) return '—'; const url = /^https?:\/\//.test(value) ? value : `https://${value}`; return `<a class="link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`; }
function closeDrawer() { const root=$('#drawer-root'); if(root) root.innerHTML=''; state.drawer=null; }

function openActivity(project) {
  modal({ title:'Record activity', subtitle:project.name, submitText:'Record activity', body:`<div class="form-grid">${field('activityType','Activity type',{type:'select',value:'TELEGRAM',options:['TELEGRAM','X_DM','EMAIL','CALL','MEETING','PROPOSAL','FOLLOW_UP','INTERNAL_NOTE']})}${field('subject','Subject',{required:true})}${field('outcome','Outcome')}${field('followUpAt','Follow-up',{type:'datetime-local'})}${field('description','Notes',{type:'textarea',full:true})}<input type="hidden" name="projectId" value="${escapeHtml(project.id)}" /></div>`, onSubmit:async(form)=>{ await api('/api/activities',{method:'POST',body:JSON.stringify(formDataObject(form))}); closeModal(); toast('Activity recorded'); await openLead(project.id); } });
}

function openInviteUser() {
  modal({ title:'Invite team member', subtitle:'Invitation management will be sent through the protected workspace.', submitText:'Prepare invitation', body:`<div class="form-grid">${field('email','Email',{type:'email',required:true})}${field('role','Role',{type:'select',value:'BD_MEMBER',options:['ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER','EXTERNAL_COLLABORATOR']})}${field('financeAccess','Finance access',{type:'checkbox',full:true})}</div>`, onSubmit:async()=>{ closeModal(); toast('Invitation workflow is prepared; email delivery is the next administration integration.'); } });
}

function openCommand() {
  const root=$('#modal-root');
  root.innerHTML=`<div class="command-backdrop" data-action="close-modal"><div class="command"><div class="command-search"><span>⌕</span><input id="command-input" placeholder="Search or run a command…" autofocus/><span class="pill">ESC</span></div><div class="command-list" id="command-list">${commandItems('')}</div></div></div>`;
  const input=$('#command-input'); input.focus(); input.addEventListener('input',()=>{$('#command-list').innerHTML=commandItems(input.value);});
}
function commandItems(query) {
  const items=[
    ['dashboard','Open dashboard','Business overview'],['leads','Open AKARI Leads','Search private lead database'],['day','Open My Day','Tasks and follow-ups'],['opportunities','Open pipeline','Business development opportunities'],['fundraising','Open fundraising','Founder capital-raise mandates'],['campaigns','Open campaigns','Delivery operations'],['new-lead','Create lead','Add a project or organisation'],['new-task','Create task','Add a next action'],['open-import','Import workbook','Upload AKARI lead database']
  ].filter((item)=>!query || item.join(' ').toLowerCase().includes(query.toLowerCase()));
  return items.map(([action,title,subtitle])=>`<div class="command-item" data-command="${action}"><div class="command-icon">${ROUTES[action]?.icon || '+'}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div></div>`).join('') || `<div class="empty-state"><div><strong>No matching command</strong></div></div>`;
}

function openImport() {
  if (!['OWNER','ADMIN'].includes(state.me?.user?.role)) { toast('Owner or Admin permission is required to import leads.','error'); return; }
  state.import=null;
  modal({ title:'Import AKARI lead workbook', subtitle:'Private data is parsed in this browser and written only to the AKARI House tenant.', wide:true, body:importStartHtml(), footerExtra:'', submitText:'' });
  setupDropzone();
}
function importStartHtml() {
  return `<div class="live-banner warning">The workbook is never committed to the public GitHub repository. Import requires an explicit dry-run review and approval.</div><label class="dropzone" id="import-dropzone"><input id="import-file" type="file" accept=".xlsx,.xls" hidden/><div><strong>Choose AKARI_AppSheet_Ready_CRM.xlsx</strong><span>Click or drag the workbook here. Expected sheets: Leads, Contacts and Tasks.</span></div></label><div id="import-workspace"></div>`;
}
function setupDropzone() {
  const zone=$('#import-dropzone'), input=$('#import-file');
  zone.addEventListener('click',()=>input.click());
  zone.addEventListener('dragover',(event)=>{event.preventDefault();zone.classList.add('drag');});
  zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));
  zone.addEventListener('drop',(event)=>{event.preventDefault();zone.classList.remove('drag');const file=event.dataTransfer.files[0];if(file)inspectWorkbook(file);});
  input.addEventListener('change',()=>{if(input.files[0])inspectWorkbook(input.files[0]);});
}

async function inspectWorkbook(file) {
  const workspace=$('#import-workspace');
  workspace.innerHTML='<div class="empty-state"><div><strong>Inspecting workbook…</strong><span>Reading sheets, validating columns and comparing existing AKARI lead records.</span></div></div>';
  try {
    const XLSX=await import(SHEETJS_MODULE);
    const workbook=XLSX.read(await file.arrayBuffer(),{raw:true,cellDates:false});
    const required=['Leads','Contacts','Tasks'];
    const missingSheets=required.filter((name)=>!workbook.SheetNames.includes(name));
    if(missingSheets.length) throw new Error(`Missing required sheets: ${missingSheets.join(', ')}`);
    const leads=XLSX.utils.sheet_to_json(workbook.Sheets.Leads,{defval:null,raw:true});
    const contacts=XLSX.utils.sheet_to_json(workbook.Sheets.Contacts,{defval:null,raw:true});
    const tasks=XLSX.utils.sheet_to_json(workbook.Sheets.Tasks,{defval:null,raw:true});
    const requiredLeadColumns=['Lead ID','Project / Organization'];
    const headers=leads[0] ? Object.keys(leads[0]) : [];
    const missingColumns=requiredLeadColumns.filter((name)=>!headers.includes(name));
    if(missingColumns.length) throw new Error(`Missing lead columns: ${missingColumns.join(', ')}`);
    const existing=await api('/api/imports/akari-leads/existing');
    const preview=buildImportPreview(file,leads,contacts,tasks,existing.items || []);
    state.import={file,leads,contacts,tasks,preview,batchId:`akari_${Date.now()}_${crypto.randomUUID().slice(0,8)}`};
    workspace.innerHTML=importPreviewHtml(preview);
    $('#approve-import').addEventListener('change',(event)=>{$('#commit-import').disabled=!event.target.checked;});
    $('#commit-import').addEventListener('click',commitImport);
  } catch(error) { workspace.innerHTML=`<div class="live-banner error">${escapeHtml(error.message || 'Workbook could not be inspected.')}</div>`; toast(error.message || 'Workbook inspection failed','error'); }
}

function buildImportPreview(file,leads,contacts,tasks,existing) {
  const validLeads=leads.filter((row)=>String(row['Lead ID'] || '').trim() && String(row['Project / Organization'] || '').trim());
  const validContacts=contacts.filter((row)=>String(row['Contact ID'] || '').trim() && String(row['Lead ID'] || '').trim());
  const validTasks=tasks.filter((row)=>String(row['Task ID'] || '').trim() && String(row['Task'] || '').trim());
  const ids=new Map(), names=new Map(), telegrams=new Map(); const issues=[];
  for(const row of validLeads){
    const id=String(row['Lead ID']).trim(); const name=normalize(row['Project / Organization']); const tg=normalize(row.Telegram);
    ids.set(id,(ids.get(id)||0)+1); if(name)names.set(name,(names.get(name)||0)+1); if(tg)telegrams.set(tg,(telegrams.get(tg)||0)+1);
  }
  const duplicateIds=[...ids].filter(([,count])=>count>1); const duplicateNames=[...names].filter(([,count])=>count>1); const duplicateTelegrams=[...telegrams].filter(([,count])=>count>1);
  const existingIds=new Set(existing.map((item)=>item.id));
  const retryRows=validLeads.filter((row)=>existingIds.has(`prj_akari_${String(row['Lead ID']).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)}`)).length;
  const missingCategory=validLeads.filter((row)=>!String(row['Primary Category'] || '').trim()).length;
  const noChannel=validLeads.filter((row)=>!['Website','X Profile','Telegram','Email','Other Contact'].some((key)=>String(row[key] || '').trim())).length;
  const contactFallback=validContacts.filter((row)=>!String(row['Contact Name'] || '').trim()).length;
  if(duplicateIds.length)issues.push({type:'error',text:`${duplicateIds.length} duplicated Lead IDs must be reviewed.`});
  if(duplicateNames.length)issues.push({type:'warning',text:`${duplicateNames.length} repeated normalized project names were found. Stable Lead IDs prevent accidental merging.`});
  if(duplicateTelegrams.length)issues.push({type:'warning',text:`${duplicateTelegrams.length} repeated Telegram values were found and will not be auto-merged.`});
  if(missingCategory)issues.push({type:'warning',text:`${missingCategory} leads have no primary category.`});
  if(noChannel)issues.push({type:'warning',text:`${noChannel} leads have no direct contact channel.`});
  if(contactFallback)issues.push({type:'warning',text:`${contactFallback} contacts have no name; email, Telegram or project name will be used as a safe display name.`});
  if(retryRows)issues.push({type:'warning',text:`${retryRows} leads already exist in AKARI Leads and will be skipped safely.`});
  return {fileName:file.name,fileSize:file.size,leadCount:validLeads.length,contactCount:validContacts.length,taskCount:validTasks.length,invalidLeads:leads.length-validLeads.length,retryRows,missingCategory,noChannel,contactFallback,issues,validLeads,validContacts,validTasks};
}
function importPreviewHtml(p) {
  return `<div class="import-summary">${importStat('Lead records',p.leadCount)}${importStat('Contacts',p.contactCount)}${importStat('Tasks',p.taskCount)}${importStat('Existing / retry',p.retryRows)}</div><div class="panel"><div class="panel-head"><div class="panel-title"><strong>Dry-run report</strong><span>${escapeHtml(p.fileName)} · ${(p.fileSize/1024/1024).toFixed(2)} MB</span></div>${pill(p.issues.some((i)=>i.type==='error')?'Review required':'Ready',p.issues.some((i)=>i.type==='error')?'red':'green')}</div><div class="panel-body"><div class="issue-list">${p.issues.length?p.issues.map((issue)=>`<div class="issue ${issue.type}">${escapeHtml(issue.text)}</div>`).join(''):'<div class="issue">No structural issues found.</div>'}</div><label class="checkbox" style="margin-top:14px"><input type="checkbox" id="approve-import" ${p.issues.some((i)=>i.type==='error')?'disabled':''}/>I reviewed the dry-run report and approve writing these records only to the AKARI House tenant.</label><div style="margin-top:14px"><button type="button" class="btn primary" id="commit-import" disabled>Import to AKARI House</button></div><div id="import-progress" style="margin-top:14px"></div></div></div>`;
}
function importStat(label,value){return `<div class="import-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;}

async function commitImport() {
  const data=state.import; if(!data)return;
  const button=$('#commit-import'); button.disabled=true; button.textContent='Importing…';
  const progress=$('#import-progress');
  const groups=[['projects',data.preview.validLeads],['contacts',data.preview.validContacts],['tasks',data.preview.validTasks]];
  const total=groups.reduce((sum,[,rows])=>sum+rows.length,0); let completed=0; const results=[];
  try{
    for(const [entityType,rows] of groups){
      for(let index=0;index<rows.length;index+=75){
        const chunk=rows.slice(index,index+75);
        const result=await api('/api/imports/akari-leads/commit',{method:'POST',body:JSON.stringify({batchId:data.batchId,fileName:data.file.name,entityType,records:chunk})});
        results.push(result); completed+=chunk.length; progress.innerHTML=progressHtml(completed,total,`Importing ${titleCase(entityType)}…`);
      }
    }
    const summary={projects:data.preview.leadCount,contacts:data.preview.contactCount,tasks:data.preview.taskCount,results};
    await api('/api/imports/akari-leads/commit',{method:'POST',body:JSON.stringify({batchId:data.batchId,fileName:data.file.name,entityType:'complete',records:[],summary})});
    progress.innerHTML=progressHtml(total,total,'Import completed')+`<div class="live-banner" style="margin-top:12px">AKARI Leads import completed. Stable source IDs made the operation safe to retry.</div><button type="button" class="btn danger" id="rollback-import">Rollback this batch</button>`;
    $('#rollback-import').addEventListener('click',()=>rollbackImport(data.batchId,data.file.name));
    invalidate('dashboard','leads:recent','tasks','contacts:','opportunities'); state.cache.forEach((_,key)=>{if(key.startsWith('leads:'))state.cache.delete(key);});
    state.leads.page=0; toast(`Imported ${data.preview.leadCount} AKARI lead rows`); setTimeout(()=>{closeModal();setRoute('leads');},1800);
  }catch(error){progress.innerHTML=`<div class="live-banner error">${escapeHtml(error.message || 'Import failed. You can safely retry; stable source IDs prevent duplicates.')}</div>`;button.disabled=false;button.textContent='Retry import';toast(error.message || 'Import failed','error');}
}
function progressHtml(done,total,label){const pct=total?Math.round(done/total*100):100;return `<div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:7px"><span>${escapeHtml(label)}</span><strong>${pct}%</strong></div><div class="progress"><div style="width:${pct}%"></div></div>`;}
async function rollbackImport(batchId,fileName){if(!confirm('Rollback this import batch? This is blocked if opportunities, campaigns or activities were added.'))return;try{const result=await api('/api/imports/akari-leads/rollback',{method:'POST',body:JSON.stringify({batchId,fileName})});toast(`Rollback completed: ${result.projectsDeleted || 0} projects deleted`);closeModal();invalidate('dashboard','leads:recent');state.cache.forEach((_,key)=>{if(key.startsWith('leads:'))state.cache.delete(key);});setRoute('leads');}catch(error){toast(error.message || 'Rollback failed','error');}}

function updateNavBadges() {
  const lead=$('#nav-lead-count'); if(lead)lead.textContent=state.leads.total || 0;
  const task=$('#nav-task-count'); if(task)task.textContent=state.tasks.length || 0;
}

async function toggleTask(id) {
  const task=state.tasks.find((item)=>item.id===id); if(!task)return;
  await api(`/api/tasks/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:task.status==='DONE'?'TODO':'DONE'})});
  invalidate('tasks','dashboard'); toast(task.status==='DONE'?'Task restored':'Task completed'); loadRoute(state.route,true);
}

async function changeOpportunityStage(id,stage) {
  await api(`/api/opportunities/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({stage})}); invalidate('opportunities','dashboard','reports'); toast(`Opportunity moved to ${titleCase(stage)}`); renderOpportunities(true);
}
async function changeCampaignStatus(id,status){await api(`/api/campaigns/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status})});invalidate('campaigns','dashboard');toast(`Campaign status updated to ${titleCase(status)}`);renderCampaigns(true);}
async function markPaymentPaid(id){await api(`/api/payments/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:'PAID',receivedDate:new Date().toISOString().slice(0,10)})});invalidate('payments','dashboard','reports');toast('Payment marked as paid');renderFinance(true);}

function applyTaskFilter(filter) {
  $$('.segmented button').forEach((button)=>button.classList.toggle('active',button.dataset.taskFilter===filter));
  let items=state.tasks;
  if(filter==='overdue')items=items.filter((item)=>isOverdue(item.due_at));
  if(filter==='today')items=items.filter((item)=>item.due_at&&new Date(item.due_at).toDateString()===new Date().toDateString());
  $('#task-list-root').innerHTML=tasksHtml(items);
}

function toggleFinance() { state.financeHidden=!state.financeHidden; renderShell(); loadRoute(state.route); toast(state.financeHidden?'Screen-share privacy enabled':'Financial values visible'); }

async function handleAction(action, element) {
  if(action==='open-sidebar')openSidebar();
  else if(action==='close-sidebar')closeSidebar();
  else if(action==='close-modal')closeModal();
  else if(action==='close-drawer')closeDrawer();
  else if(action==='quick-create')openQuickCreate();
  else if(action==='toggle-finance')toggleFinance();
  else if(action==='refresh'){invalidate(state.route,'dashboard');loadRoute(state.route,true);}
  else if(action==='new-lead'){closeModal();openNewLead();}
  else if(action==='new-contact'){closeModal();await openNewContact();}
  else if(action==='new-task'){closeModal();await openNewTask();}
  else if(action==='new-opportunity'){closeModal();await openNewOpportunity();}
  else if(action==='new-fundraising'){closeModal();await openNewOpportunity(null,true);}
  else if(action==='new-campaign'){closeModal();await openNewCampaign();}
  else if(action==='new-partner'){closeModal();openNewPartner();}
  else if(action==='new-payment'){closeModal();await openNewPayment();}
  else if(action==='open-import'){closeModal();openImport();}
  else if(action==='invite-user'){openInviteUser();}
  else if(action==='apply-lead-filters'){state.leads.search=$('#lead-search').value.trim();state.leads.category=$('#lead-category').value;state.leads.priority=$('#lead-priority').value;state.leads.page=0;renderLeads(true);}
  else if(action==='clear-lead-filters'){state.leads.search='';state.leads.category='';state.leads.priority='';state.leads.page=0;renderLeads(true);}
  else if(action==='lead-prev'){state.leads.page=Math.max(0,state.leads.page-1);renderLeads(true);}
  else if(action==='lead-next'){state.leads.page+=1;renderLeads(true);}
  else if(action==='apply-contact-search'){state.contacts.search=$('#contact-search').value.trim();renderContacts(true);}
  else if(action==='toggle-task')await toggleTask(element.dataset.id);
  else if(action==='change-stage')await changeOpportunityStage(element.dataset.id,element.value);
  else if(action==='change-campaign-status')await changeCampaignStatus(element.dataset.id,element.value);
  else if(action==='mark-payment-paid')await markPaymentPaid(element.dataset.id);
  else if(action==='edit-lead')openNewLead(state.drawer);
  else if(action==='new-contact-for-lead')await openNewContact(state.drawer);
  else if(action==='new-opportunity-for-lead')await openNewOpportunity(state.drawer);
  else if(action==='new-task-for-lead')await openNewTask(state.drawer);
  else if(action==='new-activity-for-lead')openActivity(state.drawer);
  else if(action==='workspace')toast('AKARI House is Customer 001. Future organisations will appear in this switcher.');
}

function handleCommand(command) {
  closeModal();
  if(ROUTES[command])setRoute(command);
  else handleAction(command,document.body);
}

function bindGlobalEvents() {
  document.addEventListener('click',async(event)=>{
    const route=event.target.closest('[data-route]')?.dataset.route;
    if(route){event.preventDefault();setRoute(route);return;}
    const lead=event.target.closest('[data-open-lead]')?.dataset.openLead;
    if(lead){event.preventDefault();openLead(lead);return;}
    const tab=event.target.closest('[data-drawer-tab]')?.dataset.drawerTab;
    if(tab){renderDrawer(tab);return;}
    const command=event.target.closest('[data-command]')?.dataset.command;
    if(command){handleCommand(command);return;}
    const actionElement=event.target.closest('[data-action]');
    if(actionElement){event.preventDefault();try{await handleAction(actionElement.dataset.action,actionElement);}catch(error){toast(error.message || 'Action failed','error');}}
  });
  document.addEventListener('change',async(event)=>{
    const action=event.target.dataset.action;
    if(action==='change-stage'||action==='change-campaign-status'){try{await handleAction(action,event.target);}catch(error){toast(error.message || 'Update failed','error');}}
  });
  document.addEventListener('click',(event)=>{const filter=event.target.closest('[data-task-filter]')?.dataset.taskFilter;if(filter)applyTaskFilter(filter);});
  document.addEventListener('keydown',(event)=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openCommand();}
    if(event.key==='Escape'){closeModal();closeDrawer();closeSidebar();}
    if(event.key==='Enter'&&event.target.id==='global-search'){state.leads.search=event.target.value.trim();state.leads.page=0;setRoute('leads');}
  });
  window.addEventListener('popstate',()=>{state.route=routeFromLocation();renderShell();loadRoute(state.route);});
}

async function bootstrap() {
  bindGlobalEvents();
  try {
    state.me=await api('/api/me');
    state.route=routeFromLocation();
    renderShell();
    await loadRoute(state.route);
    if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>undefined);
  } catch(error) {
    $('#app').className='boot-screen';
    $('#app').innerHTML=`<div class="boot-card"><img src="./assets/brand/akari-icon.png" width="44" height="44" alt="AKARI"/><div><strong>AKARI CRM access issue</strong><span>${escapeHtml(error.status===403?'Your email passed Cloudflare Access but is not assigned to the AKARI House tenant.':error.message||'The workspace could not be opened.')}</span><button class="btn primary" style="margin-top:12px" onclick="location.reload()">Retry</button></div></div>`;
  }
}

bootstrap();
