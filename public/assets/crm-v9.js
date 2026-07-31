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

const state = {
  route: 'dashboard',
  me: null,
  financeHidden: false,
  sidebarOpen: false,
  currentProject: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const initials = (value) => String(value || 'AK').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const titleCase = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const dateLabel = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function routeFromLocation() {
  const route = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  return ROUTES[route] ? route : 'dashboard';
}

function navHtml() {
  const sections = ['WORKSPACE', 'RELATIONSHIPS', 'BUSINESS', 'DELIVERY', 'COMMERCIAL', 'ADMIN'];
  return sections.map((section) => `
    <div class="nav-group">
      <div class="nav-label">${section}</div>
      ${Object.entries(ROUTES).filter(([, config]) => config.section === section).map(([key, config]) => `
        <button class="nav-item ${state.route === key ? 'active' : ''}" data-route="${key}">
          <span class="nav-icon">${config.icon}</span>
          <span class="nav-text">${config.label}</span>
          ${key === 'leads' ? '<span class="nav-badge" id="nav-lead-count">0</span>' : ''}
          ${key === 'day' ? '<span class="nav-badge" id="nav-task-count">0</span>' : ''}
        </button>`).join('')}
    </div>`).join('');
}

function shellHtml() {
  const user = state.me?.user || {};
  const displayName = user.fullName || user.email || 'Muaz';
  const tenant = user.tenantSlug === 'akari-house' ? 'AKARI House' : titleCase(user.tenantSlug || 'AKARI House');
  return `
    <div class="shell ${state.financeHidden ? 'finance-hidden' : ''}">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar">
        <div class="brand">
          <div class="brand-logo"><img src="./assets/logo.svg" width="24" height="24" alt="" /></div>
          <div class="brand-copy"><strong>AKARI CRM</strong><span>Growth & Capital OS</span></div>
        </div>
        <button class="workspace-button" data-action="workspace">
          <span class="workspace-main"><span class="workspace-avatar">AH</span><span class="workspace-meta"><strong>${escapeHtml(tenant)}</strong><span>Customer 001 · Production</span></span></span><span>⌄</span>
        </button>
        <div class="nav-scroll">${navHtml()}</div>
        <div class="profile-card"><div class="avatar">${initials(displayName)}</div><div class="profile-meta"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(titleCase(user.role || 'OWNER'))} · ${escapeHtml(tenant)}</span></div></div>
      </aside>
      <div class="sidebar-backdrop ${state.sidebarOpen ? 'open' : ''}" data-action="close-sidebar"></div>
      <main class="main">
        <header class="topbar">
          <button class="mobile-menu" data-action="open-sidebar" aria-label="Open navigation">☰</button>
          <div class="breadcrumb">${escapeHtml(tenant)} / <strong>${escapeHtml(ROUTES[state.route].label)}</strong></div>
          <div class="global-search"><span class="search-symbol">⌕</span><input id="global-search" placeholder="Search AKARI leads, contacts and projects…" /><span class="kbd">Ctrl K</span></div>
          <div class="top-actions"><button class="icon-btn hide-mobile" data-action="toggle-finance" title="Screen-share privacy">◉</button><button class="btn" data-action="quick-create"><b>＋</b><span class="hide-mobile">Create</span></button><button class="icon-btn" data-action="refresh">↻</button><div class="avatar">${initials(displayName)}</div></div>
        </header>
        <div class="content" id="view-root"></div>
      </main>
      <nav class="mobile-bottom"><button class="${state.route === 'dashboard' ? 'active' : ''}" data-route="dashboard">⌂<span>Home</span></button><button class="${state.route === 'day' ? 'active' : ''}" data-route="day">✓<span>My Day</span></button><button class="${state.route === 'leads' ? 'active' : ''}" data-route="leads">◇<span>Leads</span></button><button data-action="open-sidebar">⋯<span>More</span></button></nav>
    </div>`;
}

function renderShell() {
  $('#app').className = '';
  $('#app').innerHTML = shellHtml();
  $('#view-root').innerHTML = loadingHtml();
}

function loadingHtml() {
  return `<div class="page-head"><div><div class="eyebrow">AKARI HOUSE</div><h1>Loading workspace…</h1><p>Fetching live tenant data.</p></div></div>`;
}

function pageHead(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="head-actions">${actions}</div></div>`;
}

function emptyState(title, message) {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div></div>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(titleCase(value || '—'))}</span>`;
}

function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toast-root').appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

function openModal(content, className = '') {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal ${className}" role="dialog" aria-modal="true">${content}</div></div>`;
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

async function setRoute(route, { push = true } = {}) {
  state.route = ROUTES[route] ? route : 'dashboard';
  if (push && location.hash !== `#/${state.route}`) history.pushState(null, '', `#/${state.route}`);
  renderShell();
  await loadRoute();
  state.sidebarOpen = false;
}

async function loadRoute() {
  try {
    if (state.route === 'dashboard') await renderDashboard();
    else if (state.route === 'day') await renderMyDay();
    else if (state.route === 'leads') await renderLeads();
    else if (state.route === 'contacts') await renderContacts();
    else if (state.route === 'opportunities') await renderOpportunities();
    else if (state.route === 'campaigns') await renderCampaigns();
    else if (state.route === 'partners') await renderPartners();
    else if (state.route === 'finance') await renderFinance();
    else if (state.route === 'reports') await renderReports();
    else if (state.route === 'team') await renderTeam();
    else renderComingSoon();
  } catch (error) {
    $('#view-root').innerHTML = pageHead('WORKSPACE ERROR', ROUTES[state.route].label, 'The view could not be loaded.') + `<section class="panel"><div class="panel-body">${emptyState('Unable to load this view', error.message)}</div></section>`;
    toast(error.message, 'error');
  }
}

async function renderDashboard() {
  const [dashboard, tasks, leads] = await Promise.all([
    api('/api/dashboard'),
    api('/api/tasks?scope=mine'),
    api('/api/akari-leads?limit=8&offset=0'),
  ]);
  const metrics = dashboard.metrics || {};
  const name = (state.me?.user?.fullName || 'Muaz').split(/\s+/)[0];
  $('#view-root').innerHTML = pageHead('AKARI HOUSE', `Good evening, ${name}.`, 'Performance, pipeline and actions that need attention.') + `
    <div class="kpi-grid">
      ${[
        ['Monthly Target', metrics.monthlyTarget, 'yellow', 'finance'],
        ['Revenue Booked', metrics.revenueBooked, '', 'finance'],
        ['Collected', metrics.revenueCollected, 'green', 'finance'],
        ['AKARI Net Revenue', metrics.netRevenue, '', 'finance'],
        ['Weighted Pipeline', metrics.weightedPipeline, 'yellow', 'opportunities'],
      ].map(([label, value, tone, route]) => `<button class="kpi ${tone}" data-route="${route}"><span class="kpi-accent"></span><span class="kpi-label">${label}</span><strong class="kpi-value finance-value">${value === undefined ? 'Restricted' : money(value, dashboard.currency || 'USD')}</strong><span class="kpi-meta">Open related records</span></button>`).join('')}
    </div>
    <div class="mini-grid">
      ${[
        ['Year-to-date revenue', metrics.yearToDateRevenue, true, 'finance'],
        ['Active customers', metrics.activeCustomers, false, 'leads'],
        ['Active campaigns', metrics.activeCampaigns, false, 'campaigns'],
        ['Active partners', metrics.activePartners, false, 'partners'],
        ['Outstanding payments', metrics.outstandingPayments, true, 'finance'],
        ['Referral rewards due', metrics.referralRewardsDue, true, 'partners'],
      ].map(([label, value, financial, route]) => `<button class="mini-kpi" data-route="${route}"><span>${label}</span><strong class="${financial ? 'finance-value' : ''}">${value === undefined ? 'Restricted' : financial ? money(value, dashboard.currency || 'USD') : Number(value || 0)}</strong></button>`).join('')}
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><div class="panel-title"><strong>My tasks today</strong><span>${(tasks.items || []).length} open tasks</span></div><button class="btn small" data-route="day">Open My Day</button></div><div class="panel-body task-list">${(tasks.items || []).length ? (tasks.items || []).slice(0, 5).map(taskRow).join('') : emptyState('No open tasks', 'Create a task to begin your daily queue.')}</div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title"><strong>AKARI Leads</strong><span>${leads.total || 0} tenant-scoped records</span></div><button class="btn small primary" data-action="new-lead">New lead</button></div><div class="panel-body">${(leads.items || []).length ? (leads.items || []).slice(0, 5).map(leadCard).join('') : emptyState('No leads yet', 'Import the approved workbook or create the first lead.')}</div></section>
    </div>`;
  updateBadges(leads.total || 0, (tasks.items || []).length);
}

function taskRow(task) {
  return `<div class="task-item"><div class="task-top"><button class="task-check" data-action="toggle-task" data-id="${escapeHtml(task.id)}">✓</button><div class="task-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.project_name || task.description || 'AKARI House')}</span></div><div class="task-right">${escapeHtml(dateLabel(task.due_at))}</div></div></div>`;
}

function leadCard(lead) {
  return `<button class="record-row" data-open-lead="${escapeHtml(lead.id)}"><span class="record-avatar">${initials(lead.name)}</span><span class="record-main"><strong>${escapeHtml(lead.name)}</strong><small>${escapeHtml(lead.category || 'Uncategorised')}</small></span>${pill(lead.lifecycle_status || 'LEAD', lead.lifecycle_status === 'CLIENT' ? 'green' : 'pink')}</button>`;
}

function updateBadges(leads, tasks) {
  const leadBadge = $('#nav-lead-count');
  const taskBadge = $('#nav-task-count');
  if (leadBadge) leadBadge.textContent = leads;
  if (taskBadge) taskBadge.textContent = tasks;
}

async function renderMyDay() {
  const data = await api('/api/tasks?scope=mine');
  const tasks = data.items || [];
  $('#view-root').innerHTML = pageHead('MY WORKSPACE', 'My Day', `${tasks.length} open tasks`, '<button class="btn primary" data-action="new-task">＋ Add task</button>') + `<section class="panel"><div class="panel-head"><div class="panel-title"><strong>Priority queue</strong><span>Complete work directly from this page</span></div></div><div class="panel-body task-list">${tasks.length ? tasks.map(taskRow).join('') : emptyState('No open tasks', 'Your queue is clear.')}</div></section>`;
  updateBadges(Number($('#nav-lead-count')?.textContent || 0), tasks.length);
}

async function renderLeads() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const search = params.get('search') || '';
  const data = await api(`/api/akari-leads?limit=50&offset=0${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const leads = data.items || [];
  $('#view-root').innerHTML = pageHead(`${data.total || leads.length} RECORDS`, 'AKARI Leads', 'AKARI House lead database. Search, review, create and import records.', '<button class="btn" data-action="import-leads">Import workbook</button><button class="btn primary" data-action="new-lead">＋ New lead</button>') + `
    <div class="table-tools"><input class="table-search" id="lead-search" placeholder="Search leads…" value="${escapeHtml(search)}"/><button class="btn" data-action="search-leads">Search</button></div>
    <div class="table-wrap"><table><thead><tr><th>Project</th><th>Lifecycle</th><th>Priority</th><th>Owner</th><th>Primary contact</th><th>Pipeline value</th><th>Next follow-up</th><th>Source</th></tr></thead><tbody>${leads.length ? leads.map((lead) => `<tr data-open-lead="${escapeHtml(lead.id)}"><td><div class="project-cell"><span class="project-logo">${initials(lead.name)}</span><span class="project-name"><strong>${escapeHtml(lead.name)}</strong><small>${escapeHtml(lead.category || 'Uncategorised')}</small></span></div></td><td>${pill(lead.lifecycle_status || 'LEAD', lead.lifecycle_status === 'CLIENT' ? 'green' : 'pink')}</td><td>${pill(lead.priority || 'MEDIUM', lead.priority === 'HIGH' ? 'yellow' : '')}</td><td>${escapeHtml(lead.owner || 'Unassigned')}</td><td>${escapeHtml(lead.primary_contact || '—')}</td><td class="finance-value">${money(lead.pipeline_value || 0)}</td><td>${escapeHtml(dateLabel(lead.next_follow_up_at))}</td><td>${escapeHtml(lead.source_name || '—')}</td></tr>`).join('') : `<tr><td colspan="8">${emptyState('No leads found', 'Create a lead or import the approved workbook.')}</td></tr>`}</tbody></table></div>`;
  updateBadges(data.total || leads.length, Number($('#nav-task-count')?.textContent || 0));
}

async function renderContacts() {
  const data = await api('/api/contacts');
  const items = data.items || [];
  $('#view-root').innerHTML = pageHead('RELATIONSHIPS', 'Contacts', 'People connected to AKARI projects.', '<button class="btn primary" data-action="new-contact">＋ New contact</button>') + `<section class="panel"><div class="panel-body">${items.length ? items.map((item) => `<div class="record-row"><span class="record-avatar">${initials(item.full_name)}</span><span class="record-main"><strong>${escapeHtml(item.full_name)}</strong><small>${escapeHtml(item.project_name || item.job_title || '')}</small></span><span>${escapeHtml(item.telegram || item.email || '—')}</span></div>`).join('') : emptyState('No contacts yet', 'Contacts will appear after lead import or manual creation.')}</div></section>`;
}

async function renderOpportunities() {
  const data = await api('/api/opportunities');
  const items = data.items || [];
  const stages = ['CONTACTED', 'REPLIED', 'DISCOVERY', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'];
  $('#view-root').innerHTML = pageHead(`${items.length} OPPORTUNITIES`, 'Opportunity Pipeline', 'Move deals forward with clear ownership and next actions.', '<button class="btn primary" data-action="new-opportunity">＋ New opportunity</button>') + `<div class="kanban">${stages.map((stage) => { const stageItems = items.filter((item) => item.stage === stage); return `<section class="kanban-col"><div class="kanban-head"><div><strong>${titleCase(stage)}</strong><span>${stageItems.length} opportunities</span></div><span class="kanban-total">${stageItems.length}</span></div>${stageItems.length ? stageItems.map((item) => `<button class="deal-card" data-open-lead="${escapeHtml(item.project_id)}"><strong>${escapeHtml(item.project_name || 'Project')}</strong><span class="deal-title">${escapeHtml(item.name)}</span><span class="deal-data"><b class="finance-value">${money(item.estimated_value || 0, item.currency || 'USD')}</b><b>${Number(item.probability_percentage || 0)}%</b></span><span class="deal-foot"><span>${escapeHtml(item.owner_name || 'Unassigned')}</span><span>${escapeHtml(item.next_action || 'No next action')}</span></span></button>`).join('') : emptyState('Empty stage', 'No opportunities here.')}</section>`; }).join('')}</div>`;
}

async function renderCampaigns() {
  const data = await api('/api/campaigns');
  const items = data.items || [];
  $('#view-root').innerHTML = pageHead('DELIVERY', 'Campaigns', 'Manage confirmed customer delivery and campaign performance.', '<button class="btn primary" data-action="new-campaign">＋ New campaign</button>') + `<div class="card-grid">${items.length ? items.map((item) => `<article class="campaign-card"><div class="campaign-head"><strong>${escapeHtml(item.name)}</strong>${pill(item.status, 'pink')}</div><p>${escapeHtml(item.project_name || '')}</p><div class="campaign-metrics"><span>Revenue <b class="finance-value">${money(item.gross_revenue || 0, item.currency || 'USD')}</b></span><span>Received <b class="finance-value">${money(item.amount_received || 0, item.currency || 'USD')}</b></span></div></article>`).join('') : emptyState('No campaigns yet', 'Create a campaign after a commercial opportunity is won.')}</div>`;
}

async function renderPartners() {
  const data = await api('/api/partners');
  const items = data.items || [];
  $('#view-root').innerHTML = pageHead('VALUE ATTRIBUTION', 'Partners', 'Referral and strategic partner relationships.', '<button class="btn primary" data-action="new-partner">＋ New partner</button>') + `<section class="panel"><div class="panel-body">${items.length ? items.map((item) => `<div class="record-row"><span class="record-avatar">${initials(item.name)}</span><span class="record-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(titleCase(item.partner_type))}</small></span><span>${Number(item.default_referral_percentage || 0)}%</span></div>`).join('') : emptyState('No partners yet', 'Create partner records and approved referral terms.')}</div></section>`;
}

async function renderFinance() {
  const data = await api('/api/payments');
  const items = data.items || [];
  $('#view-root').innerHTML = pageHead('COMMERCIAL', 'Finance', 'Payments, collection status and outstanding balances.', '<button class="btn primary" data-action="new-payment">＋ New payment</button>') + `<section class="panel"><div class="panel-body">${items.length ? items.map((item) => `<div class="record-row"><span class="record-main"><strong>${escapeHtml(item.project_name || item.invoice_reference || 'Payment')}</strong><small>${escapeHtml(titleCase(item.status))} · Due ${escapeHtml(dateLabel(item.due_date))}</small></span><strong class="finance-value">${money(item.amount || 0, item.currency || 'USD')}</strong></div>`).join('') : emptyState('No payments yet', 'Add payment records after campaigns are confirmed.')}</div></section>`;
}

async function renderReports() {
  const data = await api('/api/reports');
  $('#view-root').innerHTML = pageHead('INTELLIGENCE', 'Reports', 'Live pipeline and revenue reports.') + `<div class="grid-2"><section class="panel"><div class="panel-head"><div class="panel-title"><strong>Pipeline by stage</strong></div></div><div class="panel-body">${(data.pipelineByStage || []).length ? data.pipelineByStage.map((item) => `<div class="record-row"><span class="record-main"><strong>${escapeHtml(titleCase(item.stage))}</strong><small>${Number(item.opportunity_count || 0)} opportunities</small></span><strong class="finance-value">${money(item.pipeline_value || 0)}</strong></div>`).join('') : emptyState('No pipeline data', 'Reports populate automatically from opportunities.')}</div></section><section class="panel"><div class="panel-head"><div class="panel-title"><strong>Revenue by month</strong></div></div><div class="panel-body">${(data.revenueByMonth || []).length ? data.revenueByMonth.map((item) => `<div class="record-row"><span>${escapeHtml(item.month)}</span><strong class="finance-value">${money(item.collected || 0)}</strong></div>`).join('') : emptyState('No revenue data', 'Reports populate automatically from paid records.')}</div></section></div>`;
}

async function renderTeam() {
  const data = await api('/api/team').catch(() => ({ items: [] }));
  const items = data.items || [];
  $('#view-root').innerHTML = pageHead('ADMINISTRATION', 'Team', 'Manage AKARI House workspace access.') + `<section class="panel"><div class="panel-body">${items.length ? items.map((item) => `<div class="record-row"><span class="record-avatar">${initials(item.full_name)}</span><span class="record-main"><strong>${escapeHtml(item.full_name)}</strong><small>${escapeHtml(item.email)}</small></span>${pill(item.role, 'pink')}</div>`).join('') : emptyState('Team administration ready', 'User and role management will appear here.')}</div></section>`;
}

function renderComingSoon() {
  $('#view-root').innerHTML = pageHead('AKARI CRM', ROUTES[state.route].label, state.route === 'fundraising' ? 'Founder capital room, investor pipeline, diligence and closings.' : 'Tenant settings and administration.') + `<section class="panel"><div class="panel-body">${emptyState(`${ROUTES[state.route].label} workspace`, 'This module is connected to the same tenant and permission model and is ready for the next workflow layer.')}</div></section>`;
}

async function openLead(id) {
  const project = await api(`/api/projects/${encodeURIComponent(id)}`);
  state.currentProject = project;
  openModal(`<div class="modal-head"><div><div class="eyebrow">AKARI LEAD</div><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(titleCase(project.lifecycle_status || 'LEAD'))} · ${escapeHtml(project.category || 'Uncategorised')}</p></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><div class="property-grid"><div class="property"><span>Website</span><strong>${escapeHtml(project.website || '—')}</strong></div><div class="property"><span>Telegram</span><strong>${escapeHtml(project.telegram || '—')}</strong></div><div class="property"><span>Next follow-up</span><strong>${escapeHtml(dateLabel(project.next_follow_up_at))}</strong></div><div class="property"><span>Source</span><strong>${escapeHtml(project.source_name || '—')}</strong></div></div><div class="form-actions"><button class="btn" data-action="new-task" data-project="${escapeHtml(project.id)}">Add task</button><button class="btn" data-action="new-opportunity" data-project="${escapeHtml(project.id)}">Create opportunity</button><button class="btn primary" data-action="new-activity" data-project="${escapeHtml(project.id)}">Record activity</button></div></div>`);
}

function inputField(name, label, type = 'text', required = false, value = '') {
  return `<label class="field"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" ${required ? 'required' : ''} value="${escapeHtml(value)}" /></label>`;
}

function openForm(title, fields, submitLabel, submitHandler) {
  openModal(`<form id="record-form"><div class="modal-head"><div><div class="eyebrow">AKARI CRM</div><h2>${escapeHtml(title)}</h2></div><button type="button" class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><div class="form-grid">${fields}</div><div class="form-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">${escapeHtml(submitLabel)}</button></div></div></form>`);
  $('#record-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await submitHandler(Object.fromEntries(new FormData(event.currentTarget)));
      closeModal();
      toast(`${title} saved`);
      await loadRoute();
    } catch (error) {
      toast(error.message, 'error');
      submit.disabled = false;
    }
  });
}

function newLeadForm() {
  openForm('New AKARI lead', inputField('name', 'Project name', 'text', true) + inputField('website', 'Website') + inputField('category', 'Category') + inputField('telegram', 'Telegram') + inputField('sourceName', 'Source') + `<label class="field"><span>Priority</span><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></label>`, 'Create lead', (data) => api('/api/projects', { method: 'POST', body: JSON.stringify(data) }));
}

function newTaskForm(projectId = '') {
  openForm('New task', inputField('title', 'Task title', 'text', true) + inputField('dueAt', 'Due date', 'datetime-local') + `<input type="hidden" name="projectId" value="${escapeHtml(projectId)}" /><label class="field"><span>Priority</span><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></label>`, 'Create task', (data) => api('/api/tasks', { method: 'POST', body: JSON.stringify(data) }));
}

function newOpportunityForm(projectId = '') {
  openForm('New opportunity', inputField('projectId', 'Project ID', 'text', true, projectId) + inputField('name', 'Opportunity name', 'text', true) + inputField('estimatedValue', 'Estimated value', 'number') + inputField('expectedCloseDate', 'Expected close date', 'date') + `<label class="field"><span>Stage</span><select name="stage"><option>NEW</option><option>CONTACTED</option><option>DISCOVERY</option><option>QUALIFIED</option><option>PROPOSAL</option></select></label>`, 'Create opportunity', (data) => api('/api/opportunities', { method: 'POST', body: JSON.stringify(data) }));
}

function newActivityForm(projectId = '') {
  openForm('Record activity', `<input type="hidden" name="projectId" value="${escapeHtml(projectId)}" />` + inputField('subject', 'Subject', 'text', true) + `<label class="field"><span>Activity type</span><select name="activityType"><option>TELEGRAM</option><option>EMAIL</option><option>CALL</option><option>MEETING</option><option>INTERNAL_NOTE</option></select></label>` + inputField('followUpAt', 'Follow-up date', 'datetime-local'), 'Record activity', (data) => api('/api/activities', { method: 'POST', body: JSON.stringify(data) }));
}

function importLeadsModal() {
  openModal(`<div class="modal-head"><div><div class="eyebrow">AKARI HOUSE ONLY</div><h2>Import AKARI Leads</h2><p>The file is processed through the protected tenant import flow.</p></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><label class="field"><span>Select CSV or XLSX</span><input id="lead-import-file" type="file" accept=".csv,.xlsx,.xls" /></label><div class="live-banner warning">Inspect → map → validate → deduplicate → preview → approve → import.</div><div id="import-result"></div><div class="form-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="inspect-import">Inspect file</button></div></div>`);
}

function commandPalette() {
  openModal(`<div class="command"><div class="command-input"><span>⌕</span><input id="command-input" placeholder="Search or run a command…" autofocus /><button class="icon-btn" data-action="close-modal">×</button></div><div class="command-list"><button class="command-item" data-command="leads"><strong>AKARI Leads</strong><small>Open the AKARI House lead database</small></button><button class="command-item" data-command="day"><strong>My Day</strong><small>Open tasks and follow-ups</small></button><button class="command-item" data-command="opportunities"><strong>Opportunities</strong><small>Open the pipeline</small></button></div></div>`, 'command-modal');
  setTimeout(() => $('#command-input')?.focus(), 0);
}

function quickCreate() {
  openModal(`<div class="modal-head"><div><div class="eyebrow">QUICK CREATE</div><h2>Create a record</h2></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><div class="command-list"><button class="command-item" data-action="new-lead"><strong>New AKARI lead</strong><small>Add a project to the tenant database</small></button><button class="command-item" data-action="new-task"><strong>New task</strong><small>Create work or a follow-up</small></button><button class="command-item" data-action="new-opportunity"><strong>New opportunity</strong><small>Create a commercial deal</small></button></div></div>`);
}

async function handleAction(action, element) {
  if (action === 'close-modal') return closeModal();
  if (action === 'open-sidebar') { state.sidebarOpen = true; $('#sidebar')?.classList.add('open'); $('.sidebar-backdrop')?.classList.add('open'); return; }
  if (action === 'close-sidebar') { state.sidebarOpen = false; $('#sidebar')?.classList.remove('open'); $('.sidebar-backdrop')?.classList.remove('open'); return; }
  if (action === 'refresh') return loadRoute();
  if (action === 'toggle-finance') { state.financeHidden = !state.financeHidden; $('.shell')?.classList.toggle('finance-hidden', state.financeHidden); return toast('Screen-share privacy toggled'); }
  if (action === 'quick-create') return quickCreate();
  if (action === 'new-lead') return newLeadForm();
  if (action === 'new-task') return newTaskForm(element.dataset.project || '');
  if (action === 'new-opportunity') return newOpportunityForm(element.dataset.project || '');
  if (action === 'new-activity') return newActivityForm(element.dataset.project || '');
  if (action === 'import-leads') return importLeadsModal();
  if (action === 'search-leads') {
    const value = $('#lead-search')?.value.trim() || '';
    history.pushState(null, '', `#/leads${value ? `?search=${encodeURIComponent(value)}` : ''}`);
    return renderLeads();
  }
  if (action === 'toggle-task') {
    await api(`/api/tasks/${encodeURIComponent(element.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) });
    toast('Task completed');
    return loadRoute();
  }
  if (action === 'inspect-import') {
    const file = $('#lead-import-file')?.files?.[0];
    $('#import-result').innerHTML = file ? `<div class="live-banner">Selected: ${escapeHtml(file.name)} · ${Math.round(file.size / 1024)} KB. Dry-run inspection is ready.</div>` : '<div class="live-banner error">Choose a file first.</div>';
    return;
  }
  if (action === 'workspace') return toast('AKARI House is Customer 001. Future customers receive isolated workspaces.');
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const modalBackdrop = event.target.matches('.modal-backdrop') ? event.target : null;
    if (modalBackdrop) { closeModal(); return; }
    const routeElement = event.target.closest('[data-route]');
    if (routeElement) { event.preventDefault(); await setRoute(routeElement.dataset.route); return; }
    const leadElement = event.target.closest('[data-open-lead]');
    if (leadElement) { event.preventDefault(); await openLead(leadElement.dataset.openLead); return; }
    const commandElement = event.target.closest('[data-command]');
    if (commandElement) { event.preventDefault(); closeModal(); await setRoute(commandElement.dataset.command); return; }
    const actionElement = event.target.closest('[data-action]');
    if (actionElement) {
      event.preventDefault();
      try { await handleAction(actionElement.dataset.action, actionElement); }
      catch (error) { toast(error.message || 'Action failed', 'error'); }
    }
  });

  document.addEventListener('keydown', async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandPalette(); }
    if (event.key === 'Escape') { closeModal(); await handleAction('close-sidebar', document.body); }
    if (event.key === 'Enter' && event.target.id === 'global-search') {
      const value = event.target.value.trim();
      history.pushState(null, '', `#/leads${value ? `?search=${encodeURIComponent(value)}` : ''}`);
      state.route = 'leads';
      renderShell();
      await renderLeads();
    }
  });

  window.addEventListener('popstate', async () => {
    state.route = routeFromLocation();
    renderShell();
    await loadRoute();
  });
}

async function bootstrap() {
  document.documentElement.dataset.akariInteractive = 'ready';
  bindEvents();
  try {
    state.me = await api('/api/me');
    state.route = routeFromLocation();
    renderShell();
    await loadRoute();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  } catch (error) {
    $('#app').className = 'boot-screen';
    $('#app').innerHTML = `<div class="boot-card"><img src="./assets/logo.svg" width="44" height="44" alt="AKARI"/><div><strong>AKARI CRM access issue</strong><span>${escapeHtml(error.message || 'The workspace could not be opened.')}</span><button class="btn primary" style="margin-top:12px" onclick="location.reload()">Retry</button></div></div>`;
  }
}

bootstrap();
