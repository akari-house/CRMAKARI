const viewNames = { home: 'Home', day: 'My Day', projects: 'Projects', pipeline: 'Opportunities' };
const liveState = {
  api: null,
  auth: null,
  dashboard: null,
  projects: [],
  tasks: [],
  opportunities: [],
  mode: 'preview',
};

function switchView(name, navEl) {
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  if (navEl?.classList.contains('nav-item')) navEl.classList.add('active');
  document.getElementById('crumb').textContent = viewNames[name] || name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toggleSidebar(false);
}

function toggleSidebar(force) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const shouldOpen = typeof force === 'boolean' ? force : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  backdrop.classList.toggle('open', shouldOpen);
}

function toggleCreate() {
  document.getElementById('quickCreate').classList.toggle('open');
}

function createAction(type) {
  document.getElementById('quickCreate').classList.remove('open');
  showToast(`${type} form is the next build step`);
}

function openProject(name) {
  const initials = initialsFor(name);
  document.getElementById('drawerTitle').textContent = name;
  document.getElementById('drawerLogo').textContent = initials;
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}

async function openProjectById(id) {
  if (!liveState.api) return openProject(id);
  try {
    const project = await liveState.api.project(id);
    renderProjectDrawer(project);
    document.getElementById('drawerOverlay').classList.add('open');
    document.getElementById('drawer').classList.add('open');
  } catch (cause) {
    showToast(cause.message || 'Project could not be opened');
  }
}

function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}

async function completeTask(button) {
  const taskId = button.dataset.taskId;
  const nextDoneState = !button.classList.contains('checked');
  if (taskId && liveState.api) {
    button.disabled = true;
    try {
      await liveState.api.updateTask(taskId, { status: nextDoneState ? 'DONE' : 'TODO' });
      button.classList.toggle('checked', nextDoneState);
      await refreshTasks();
      showToast(nextDoneState ? 'Task completed' : 'Task restored');
    } catch (cause) {
      showToast(cause.message || 'Task update failed');
    } finally {
      button.disabled = false;
    }
    return;
  }
  button.classList.toggle('checked');
  showToast(button.classList.contains('checked') ? 'Task completed' : 'Task restored');
}

function toggleScreenShare() {
  document.body.classList.toggle('screen-share-hidden');
  const active = document.body.classList.contains('screen-share-hidden');
  document.getElementById('shareBtn').style.color = active ? 'var(--pink)' : '';
  showToast(active ? 'Screen-share mode enabled - financial values hidden' : 'Screen-share mode disabled');
}

function openCommand() {
  document.getElementById('command').classList.add('open');
  setTimeout(() => document.getElementById('commandInput').focus(), 20);
}

function closeCommand() {
  document.getElementById('command').classList.remove('open');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function filterProjects() {
  const query = document.getElementById('projectSearch').value.toLowerCase().trim();
  document.querySelectorAll('#projectsTable tbody tr').forEach((row) => {
    row.style.display = row.innerText.toLowerCase().includes(query) ? '' : 'none';
  });
}

function setMobileActive(button) {
  document.querySelectorAll('.mobile-bottom button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initialsFor(value) {
  return String(value || 'AK')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function formatMoney(value, currency = 'USD', compact = false) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(amount);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function isOverdue(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function setLiveNotice(message, tone = 'neutral') {
  let notice = document.getElementById('liveDataNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'liveDataNotice';
    notice.style.cssText = 'margin:0 0 14px;padding:11px 13px;border-radius:10px;border:1px solid var(--line);font-size:11px;color:var(--muted);background:rgba(17,21,34,.78);';
    document.querySelector('.content').prepend(notice);
  }
  const tones = {
    error: ['var(--red-soft)', 'rgba(255,111,124,.24)', '#ffb1b8'],
    success: ['var(--green-soft)', 'rgba(80,216,144,.2)', '#9cf0c4'],
    neutral: ['rgba(17,21,34,.78)', 'var(--line)', 'var(--muted)'],
  };
  const [background, border, color] = tones[tone] || tones.neutral;
  notice.style.background = background;
  notice.style.borderColor = border;
  notice.style.color = color;
  notice.textContent = message;
  notice.hidden = !message;
}

function findPanelByTitle(title) {
  return [...document.querySelectorAll('.panel')].find((panel) => panel.querySelector('.panel-title strong')?.textContent.trim() === title);
}

function renderIdentity(payload) {
  const user = payload?.user;
  if (!user) return;
  liveState.auth = user;
  const name = user.fullName || user.email || 'AKARI user';
  const firstName = name.split(/\s+/)[0];
  const greeting = document.querySelector('#view-home .page-header h1');
  if (greeting) greeting.textContent = `Good evening, ${firstName}.`;
  document.querySelectorAll('.avatar').forEach((avatar) => { avatar.textContent = initialsFor(name); });
  const profileName = document.querySelector('.profile-mini strong');
  const profileRole = document.querySelector('.profile-mini span');
  if (profileName) profileName.textContent = name;
  if (profileRole) profileRole.textContent = `${titleCase(user.role)} · ${user.tenantSlug || 'Workspace'}`;
}

function renderDashboard(payload) {
  liveState.dashboard = payload;
  const metrics = payload?.metrics || {};
  const currency = payload?.currency || 'USD';
  const metricValues = document.querySelectorAll('#view-home .metrics-grid .metric-value');
  const orderedValues = [
    metrics.monthlyTarget,
    metrics.revenueBooked,
    metrics.revenueCollected,
    metrics.netRevenue,
    metrics.weightedPipeline,
  ];
  metricValues.forEach((node, index) => {
    node.textContent = orderedValues[index] === undefined ? 'Restricted' : formatMoney(orderedValues[index], currency);
  });

  const cards = document.querySelectorAll('#view-home .metrics-grid .metric-card');
  const target = Number(metrics.monthlyTarget || 0);
  const booked = Number(metrics.revenueBooked || 0);
  const achievement = target > 0 ? Math.round((booked / target) * 100) : 0;
  if (cards[0]) cards[0].querySelector('.metric-sub').innerHTML = `<span class="trend-up">${achievement}%</span> achieved`;
  if (cards[1]) cards[1].querySelector('.metric-sub').textContent = 'Confirmed campaign revenue';
  if (cards[2]) cards[2].querySelector('.metric-sub').textContent = 'Payments received this month';
  if (cards[3]) cards[3].querySelector('.metric-sub').textContent = 'After direct costs and referral share';
  if (cards[4]) cards[4].querySelector('.metric-sub').textContent = `${Number(metrics.activeOpportunities || 0)} active opportunities`;

  const miniValues = document.querySelectorAll('#view-home .mini-metrics strong');
  const miniOrdered = [
    metrics.yearToDateRevenue,
    metrics.activeCustomers,
    metrics.activeCampaigns,
    metrics.activePartners,
    metrics.outstandingPayments,
    metrics.referralRewardsDue,
  ];
  miniValues.forEach((node, index) => {
    const value = miniOrdered[index];
    const financial = [0, 4, 5].includes(index);
    node.textContent = value === undefined ? 'Restricted' : financial ? formatMoney(value, currency) : String(Number(value || 0));
  });

  const progressPanel = findPanelByTitle('Monthly target progress');
  if (progressPanel) {
    const firstRow = progressPanel.querySelector('.progress-row');
    const label = firstRow?.querySelector('.progress-meta strong');
    const fill = firstRow?.querySelector('.progress-fill');
    if (label) label.textContent = `${formatMoney(booked, currency, true)} / ${formatMoney(target, currency, true)}`;
    if (fill) fill.style.width = `${Math.min(Math.max(achievement, 0), 100)}%`;
    const subtitle = progressPanel.querySelector('.panel-title span');
    if (subtitle && payload.month) subtitle.textContent = `Company performance for ${payload.month}`;
  }
}

function lifecyclePill(value) {
  const normalized = String(value || 'LEAD').toUpperCase();
  const tone = normalized === 'CLIENT' ? 'green' : normalized === 'ACTIVE_OPPORTUNITY' ? 'pink' : '';
  return `<span class="pill ${tone}">${escapeHtml(titleCase(normalized))}</span>`;
}

function priorityPill(value) {
  const normalized = String(value || 'MEDIUM').toUpperCase();
  const tone = normalized === 'URGENT' ? 'red' : normalized === 'HIGH' ? 'yellow' : '';
  return `<span class="pill ${tone}">${escapeHtml(titleCase(normalized))}</span>`;
}

function renderProjects(payload) {
  const items = payload?.items || [];
  liveState.projects = items;
  const tbody = document.querySelector('#projectsTable tbody');
  const eyebrow = document.querySelector('#view-projects .eyebrow');
  if (eyebrow) eyebrow.textContent = `${Number(payload?.total || items.length)} RECORDS`;
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="height:110px;text-align:center;color:var(--muted)">No project records yet. Use the controlled CSV import after the dry-run review.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((project) => {
    const followUp = project.next_follow_up_at;
    const followUpHtml = isOverdue(followUp)
      ? `<span class="pill red">${escapeHtml(formatDate(followUp))}</span>`
      : escapeHtml(formatDate(followUp));
    const owner = project.owner || 'Unassigned';
    return `<tr onclick="openProjectById('${escapeHtml(project.id)}')">
      <td><div class="project-cell"><div class="project-logo">${initialsFor(project.name)}</div><div class="project-name"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.category || 'Uncategorised')}</span></div></div></td>
      <td>${lifecyclePill(project.lifecycle_status)}</td>
      <td>${priorityPill(project.priority)}</td>
      <td><div class="person"><span class="person-dot">${initialsFor(owner)}</span>${escapeHtml(owner)}</div></td>
      <td>${escapeHtml(project.primary_contact || '-')}</td>
      <td>${Number(project.open_opportunities || 0)}</td>
      <td class="finance-value">${formatMoney(project.pipeline_value || 0)}</td>
      <td>${escapeHtml(formatDate(project.last_activity_at))}</td>
      <td>${followUpHtml}</td>
      <td>${escapeHtml(project.source_name || '-')}</td>
    </tr>`;
  }).join('');
}

function taskMarkup(task) {
  const due = task.due_at ? formatDate(task.due_at) : 'No due date';
  const overdue = isOverdue(task.due_at) && task.status !== 'DONE';
  return `<div class="task-item">
    <div class="task-top">
      <button class="task-check ${task.status === 'DONE' ? 'checked' : ''}" data-task-id="${escapeHtml(task.id)}" onclick="completeTask(this)">✓</button>
      <div class="task-copy">
        <strong>${escapeHtml(task.title)}</strong>
        <span>${escapeHtml(task.project_name || task.opportunity_name || task.campaign_name || task.description || 'AKARI House')}</span>
        <div class="priority"><i class="priority-dot" style="background:${overdue ? 'var(--red)' : task.priority === 'HIGH' ? 'var(--yellow)' : 'var(--pink)'}"></i>${escapeHtml(titleCase(task.priority || 'MEDIUM'))} priority · ${escapeHtml(task.owner_name || 'Unassigned')}</div>
      </div>
      <div class="task-right" style="${overdue ? 'color:var(--red)' : ''}">${escapeHtml(due)}</div>
    </div>
  </div>`;
}

function renderTasks(payload) {
  const items = payload?.items || [];
  liveState.tasks = items;
  const homePanel = findPanelByTitle('My tasks today');
  const dayPanel = findPanelByTitle('Priority queue');
  const markup = items.length
    ? items.slice(0, 10).map(taskMarkup).join('')
    : '<div class="task-item"><div class="task-copy"><strong>No open tasks</strong><span>Create a task or import approved records to begin.</span></div></div>';
  [homePanel, dayPanel].forEach((panel) => {
    const list = panel?.querySelector('.task-list');
    if (list) list.innerHTML = markup;
  });
  const homeSubtitle = homePanel?.querySelector('.panel-title span');
  if (homeSubtitle) homeSubtitle.textContent = `${items.length} open task${items.length === 1 ? '' : 's'}`;
  const daySubtitle = document.querySelector('#view-day .page-header p');
  if (daySubtitle) {
    const overdue = items.filter((task) => isOverdue(task.due_at)).length;
    daySubtitle.textContent = `${items.length} tasks remaining · ${overdue} overdue`;
  }
}

function renderFunnel(items) {
  const funnel = findPanelByTitle('Opportunity funnel')?.querySelector('.funnel');
  if (!funnel) return;
  const stages = ['CONTACTED', 'REPLIED', 'DISCOVERY', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON'];
  const summary = stages.map((stage) => {
    const stageItems = items.filter((item) => item.stage === stage);
    return {
      stage,
      count: stageItems.length,
      value: stageItems.reduce((sum, item) => sum + Number(item.estimated_value_base_currency || item.estimated_value || 0), 0),
    };
  });
  const maxCount = Math.max(...summary.map((item) => item.count), 1);
  funnel.innerHTML = summary.map((item) => `<div class="funnel-row">
    <div class="funnel-label">${escapeHtml(titleCase(item.stage))}</div>
    <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${Math.max((item.count / maxCount) * 100, item.count ? 8 : 0)}%"></div></div>
    <div class="funnel-value">${item.count} · ${formatMoney(item.value, 'USD', true)}</div>
  </div>`).join('');
}

function renderOpportunities(payload) {
  const items = payload?.items || [];
  liveState.opportunities = items;
  const eyebrow = document.querySelector('#view-pipeline .eyebrow');
  if (eyebrow) eyebrow.textContent = `${items.filter((item) => !['WON', 'LOST'].includes(item.stage)).length} ACTIVE OPPORTUNITIES`;
  renderFunnel(items);
  const board = document.querySelector('#view-pipeline .kanban');
  if (!board) return;
  const stages = ['CONTACTED', 'REPLIED', 'DISCOVERY', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'];
  if (!items.length) {
    board.innerHTML = '<div class="kanban-col" style="grid-column:1/-1"><div class="deal-card"><strong>No opportunities yet</strong><div class="deal-title">Create opportunities after projects are imported and reviewed.</div></div></div>';
    return;
  }
  board.innerHTML = stages.map((stage) => {
    const stageItems = items.filter((item) => item.stage === stage);
    const value = stageItems.reduce((sum, item) => sum + Number(item.estimated_value_base_currency || item.estimated_value || 0), 0);
    const cards = stageItems.length ? stageItems.map((item) => {
      const next = item.next_action || (item.next_follow_up_at ? `Follow-up ${formatDate(item.next_follow_up_at)}` : 'No next action');
      const risky = !item.next_action || isOverdue(item.next_follow_up_at);
      return `<div class="deal-card" onclick="openProjectById('${escapeHtml(item.project_id)}')">
        <strong>${escapeHtml(item.project_name || 'Project')}</strong>
        <div class="deal-title">${escapeHtml(item.name)}</div>
        <div class="deal-data"><span class="finance-value">${formatMoney(item.estimated_value_base_currency || item.estimated_value || 0, item.currency || 'USD')}</span><span>${Number(item.probability_percentage || 0)}%</span></div>
        <div class="deal-foot"><span>${escapeHtml(item.owner_name || 'Unassigned')}</span><span style="color:${risky ? 'var(--red)' : 'var(--muted-2)'}">${escapeHtml(next)}</span></div>
      </div>`;
    }).join('') : '<div class="deal-card"><div class="deal-title">No opportunities in this stage</div></div>';
    return `<div class="kanban-col">
      <div class="kanban-head"><div><strong>${escapeHtml(titleCase(stage))}</strong><span>${stageItems.length} opportunities · ${formatMoney(value, 'USD', true)}</span></div><div class="kanban-total">${stageItems.length}</div></div>
      ${cards}
    </div>`;
  }).join('');
}

function renderProjectDrawer(project) {
  const title = document.getElementById('drawerTitle');
  const logo = document.getElementById('drawerLogo');
  const subtitle = document.querySelector('.drawer-project p');
  if (title) title.textContent = project.name || 'Project';
  if (logo) logo.textContent = initialsFor(project.name);
  if (subtitle) subtitle.textContent = `${titleCase(project.lifecycle_status || 'LEAD')} · ${titleCase(project.priority || 'MEDIUM')} Priority`;

  const sections = document.querySelectorAll('.drawer-content .drawer-section');
  const contacts = project.contacts || [];
  const opportunities = project.opportunities || [];
  const activities = project.activities || [];
  if (sections[0]) {
    sections[0].innerHTML = `<h3>Relationship overview</h3><div class="property-grid">
      <div class="property"><span>Lifecycle</span><strong>${escapeHtml(titleCase(project.lifecycle_status || 'LEAD'))}</strong></div>
      <div class="property"><span>Relationship health</span><strong>${escapeHtml(project.relationship_health || 'Not assessed')}</strong></div>
      <div class="property"><span>Primary contact</span><strong>${escapeHtml(contacts.find((contact) => contact.is_primary_contact)?.full_name || contacts[0]?.full_name || '-')}</strong></div>
      <div class="property"><span>Category</span><strong>${escapeHtml(project.category || '-')}</strong></div>
      <div class="property"><span>Next follow-up</span><strong>${escapeHtml(formatDate(project.next_follow_up_at))}</strong></div>
      <div class="property"><span>Source</span><strong>${escapeHtml(project.source_name || project.source_type || '-')}</strong></div>
    </div>`;
  }
  if (sections[1]) {
    const pipeline = opportunities.filter((item) => !['WON', 'LOST'].includes(item.stage)).reduce((sum, item) => sum + Number(item.estimated_value || 0), 0);
    const weighted = opportunities.filter((item) => !['WON', 'LOST'].includes(item.stage)).reduce((sum, item) => sum + Number(item.weighted_value || 0), 0);
    sections[1].innerHTML = `<h3>Commercial summary</h3><div class="property-grid">
      <div class="property"><span>Open pipeline</span><strong class="finance-value">${formatMoney(pipeline)}</strong></div>
      <div class="property"><span>Weighted value</span><strong class="finance-value">${formatMoney(weighted)}</strong></div>
      <div class="property"><span>Open opportunities</span><strong>${opportunities.filter((item) => !['WON', 'LOST'].includes(item.stage)).length}</strong></div>
      <div class="property"><span>Contacts</span><strong>${contacts.length}</strong></div>
    </div>`;
  }
  if (sections[2]) {
    const nextOpportunity = opportunities.find((item) => item.next_action) || opportunities[0];
    sections[2].innerHTML = `<h3>Next action</h3><div style="border-left:2px solid var(--pink);padding-left:12px">
      <strong style="font-size:12px">${escapeHtml(nextOpportunity?.next_action || 'No next action recorded')}</strong>
      <div style="color:var(--muted);font-size:10px;margin-top:6px">${escapeHtml(nextOpportunity?.name || 'Create a task or follow-up to keep this relationship active.')}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="primary-btn" onclick="showToast('Activity composer is the next build step')">Record activity</button><button class="soft-btn" onclick="showToast('Follow-up form is the next build step')">Add follow-up</button></div>
    </div>`;
  }
  if (sections[3]) {
    const timeline = activities.length ? activities.map((activity) => `<div class="timeline-item">
      <div class="timeline-icon">${escapeHtml(initialsFor(activity.activity_type || 'A').slice(0, 1))}</div>
      <div class="timeline-copy"><strong>${escapeHtml(activity.subject || titleCase(activity.activity_type))}</strong><span>${escapeHtml(formatDate(activity.occurred_at))}${activity.outcome ? ` · ${escapeHtml(activity.outcome)}` : ''}</span></div>
    </div>`).join('') : '<div class="timeline-copy"><strong>No activity recorded yet</strong><span>Add the first interaction after import.</span></div>';
    sections[3].innerHTML = `<h3>Recent activity</h3><div class="timeline">${timeline}</div>`;
  }
}

async function refreshTasks() {
  if (!liveState.api) return;
  const payload = await liveState.api.tasks('mine');
  renderTasks(payload);
}

async function bootstrapLiveData() {
  if (location.protocol === 'file:') {
    setLiveNotice('Standalone preview mode - sample values are shown. Production uses tenant-scoped D1 data.', 'neutral');
    return;
  }

  setLiveNotice('Connecting to the AKARI House workspace…', 'neutral');
  try {
    const module = await import('./api-client.js');
    liveState.api = module.AkariApi;
    const [me, dashboard, projects, tasks, opportunities] = await Promise.all([
      liveState.api.me(),
      liveState.api.dashboard(),
      liveState.api.projects({ limit: 100 }),
      liveState.api.tasks('mine'),
      liveState.api.opportunities(),
    ]);
    liveState.mode = 'live';
    renderIdentity(me);
    renderDashboard(dashboard);
    renderProjects(projects);
    renderTasks(tasks);
    renderOpportunities(opportunities);
    setLiveNotice('Live tenant data connected. Empty sections reflect the current AKARI House D1 database.', 'success');
    setTimeout(() => {
      const notice = document.getElementById('liveDataNotice');
      if (notice) notice.hidden = true;
    }, 4500);
  } catch (cause) {
    liveState.mode = 'error';
    const message = cause.status === 403
      ? 'Cloudflare Access succeeded, but this email is not assigned to an active AKARI CRM workspace.'
      : `Live data could not be loaded: ${cause.message || 'Unknown error'}`;
    setLiveNotice(message, 'error');
  }
}

document.querySelectorAll('.drawer-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.drawer-tab').forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
  showToast(`${tab.textContent} tab selected`);
}));

document.querySelectorAll('.view-tab').forEach((tab) => tab.addEventListener('click', () => {
  const parent = tab.parentElement;
  parent.querySelectorAll('.view-tab').forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
}));

document.querySelectorAll('.segmented').forEach((segment) => segment.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
  segment.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
})));

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommand();
  }
  if (event.key === 'Escape') {
    closeCommand();
    closeDrawer();
    document.getElementById('quickCreate').classList.remove('open');
  }
});

document.addEventListener('click', (event) => {
  const menu = document.getElementById('quickCreate');
  if (menu.classList.contains('open') && !menu.contains(event.target) && !event.target.closest('.soft-btn')) menu.classList.remove('open');
});

Object.assign(window, {
  switchView,
  toggleSidebar,
  toggleCreate,
  createAction,
  openProject,
  openProjectById,
  closeDrawer,
  completeTask,
  toggleScreenShare,
  openCommand,
  closeCommand,
  showToast,
  filterProjects,
  setMobileActive,
});

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

document.addEventListener('DOMContentLoaded', bootstrapLiveData);
