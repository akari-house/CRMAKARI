(() => {
  'use strict';

  const FILTER_KEY = 'akari-crm-lead-filters-m1';
  const selected = new Set();
  let overview = null;
  let overviewPromise = null;
  let enhancing = false;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const titleCase = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  const initials = (value) => String(value || 'AK').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const heading = () => document.querySelector('#view-root .page-head h1')?.textContent?.trim() || '';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message, type = 'success') {
    const root = document.querySelector('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  async function loadOverview(force = false) {
    if (!force && overview) return overview;
    if (!force && overviewPromise) return overviewPromise;
    overviewPromise = request('/api/bd-operations').then((payload) => {
      overview = payload;
      overviewPromise = null;
      return payload;
    }).catch((error) => {
      overviewPromise = null;
      throw error;
    });
    return overviewPromise;
  }

  function viewStorageKey(payload) {
    return `akari-bd-saved-views:${payload.actor?.tenantId || 'tenant'}:${payload.actor?.userId || 'user'}`;
  }

  function savedViews(payload) {
    try { return JSON.parse(localStorage.getItem(viewStorageKey(payload)) || '[]'); }
    catch { return []; }
  }

  function writeSavedViews(payload, items) {
    localStorage.setItem(viewStorageKey(payload), JSON.stringify(items.slice(0, 20)));
  }

  function currentFilters() {
    return {
      search: document.querySelector('#lead-search')?.value?.trim() || '',
      category: document.querySelector('#lead-category')?.value || '',
      priority: document.querySelector('#lead-priority')?.value || '',
      lifecycle: document.querySelector('#m1-lead-lifecycle')?.value || '',
      followUp: document.querySelector('#m1-lead-follow-up')?.value || '',
      identity: document.querySelector('#m1-lead-identity')?.value || '',
      owner: document.querySelector('#m1-lead-owner')?.value || '',
      sort: document.querySelector('#m1-lead-sort')?.value || 'priority',
      direction: document.querySelector('#m1-lead-direction')?.value || 'asc',
    };
  }

  function applyFilters(filters) {
    const map = {
      search: '#lead-search', category: '#lead-category', priority: '#lead-priority', lifecycle: '#m1-lead-lifecycle',
      followUp: '#m1-lead-follow-up', identity: '#m1-lead-identity', owner: '#m1-lead-owner',
      sort: '#m1-lead-sort', direction: '#m1-lead-direction',
    };
    Object.entries(map).forEach(([key, selector]) => {
      const input = document.querySelector(selector);
      if (input) input.value = filters[key] || (key === 'sort' ? 'priority' : key === 'direction' ? 'asc' : '');
    });
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(currentFilters()));
    document.querySelector('[data-action="apply-lead-filters"]')?.click();
  }

  function summaryCards(payload) {
    const data = payload.summary || {};
    const cards = [
      ['unassigned', 'Unassigned', data.unassignedLeads, 'Assign an owner'],
      ['missing-follow-up', 'No next action', data.missingFollowUp, 'Schedule follow-up'],
      ['overdue', 'Overdue', data.overdueFollowUp, 'Needs attention'],
      ['missing-contact', 'Missing POC', data.missingPrimaryContact, 'Add a decision-maker'],
      ['missing-identity', 'Missing channels', data.missingProjectIdentity, 'Complete X and Telegram'],
    ];
    return `<div class="bdops-metrics">${cards.map(([key, label, value, hint]) => `
      <button type="button" class="bdops-metric" data-bdops-filter="${key}">
        <span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong><small>${escapeHtml(hint)}</small>
      </button>`).join('')}</div>`;
  }

  function savedViewsHtml(payload) {
    const views = savedViews(payload);
    return `<div class="bdops-saved" aria-label="Saved lead views">
      <label><span>View name</span><input id="bdops-view-name" maxlength="60" placeholder="Example: Muaz overdue leads" /></label>
      <button type="button" class="btn small" data-bdops-action="save-view">Save current view</button>
      <label><span>Saved views</span><select id="bdops-view-select"><option value="">Choose a saved view</option>${views.map((view, index) => `<option value="${index}">${escapeHtml(view.name)}</option>`).join('')}</select></label>
      <button type="button" class="btn small" data-bdops-action="load-view">Load</button>
      <button type="button" class="btn small" data-bdops-action="delete-view">Delete</button>
    </div>`;
  }

  function bulkToolbarHtml(payload) {
    const members = (payload.members || []).filter((member) => member.membershipStatus === 'ACTIVE' && member.userStatus === 'ACTIVE');
    return `<div class="bdops-bulk" id="bdops-bulk-toolbar" aria-live="polite">
      <div class="bdops-bulk__count"><span id="bdops-selection-count">0 selected</span></div>
      <label><span>Owner</span><select id="bdops-bulk-owner"><option value="__UNCHANGED__">No change</option><option value="__UNASSIGNED__">Unassigned</option>${members.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.fullName || member.email)}</option>`).join('')}</select></label>
      <label><span>Priority</span><select id="bdops-bulk-priority"><option value="">No change</option>${['URGENT','HIGH','MEDIUM','LOW'].map((value) => `<option value="${value}">${titleCase(value)}</option>`).join('')}</select></label>
      <label><span>Lifecycle</span><select id="bdops-bulk-lifecycle"><option value="">No change</option>${['LEAD','PROSPECT','ACTIVE_OPPORTUNITY','DORMANT_CLIENT','FORMER_CLIENT','ARCHIVED'].map((value) => `<option value="${value}">${titleCase(value)}</option>`).join('')}</select></label>
      <label><span>Follow-up</span><select id="bdops-follow-up-mode"><option value="unchanged">No change</option><option value="set">Set date</option><option value="clear">Clear date</option></select></label>
      <label><span>Date and time</span><input id="bdops-bulk-follow-up" type="datetime-local" /></label>
      <button type="button" class="btn primary small" data-bdops-action="apply-bulk">Apply update</button>
      <button type="button" class="btn small" data-bdops-action="clear-selection">Clear</button>
    </div>`;
  }

  function refreshSavedViewOptions(payload) {
    const select = document.querySelector('#bdops-view-select');
    if (!select) return;
    const current = select.value;
    const views = savedViews(payload);
    select.innerHTML = `<option value="">Choose a saved view</option>${views.map((view, index) => `<option value="${index}">${escapeHtml(view.name)}</option>`).join('')}`;
    if (views[current]) select.value = current;
  }

  function updateSelectionUi() {
    const toolbar = document.querySelector('#bdops-bulk-toolbar');
    const count = document.querySelector('#bdops-selection-count');
    if (toolbar) toolbar.classList.toggle('active', selected.size > 0);
    if (count) count.textContent = `${selected.size} selected`;
    document.querySelectorAll('[data-bdops-lead-select]').forEach((input) => { input.checked = selected.has(input.value); });
    const all = document.querySelector('#bdops-select-all');
    if (all) {
      const visible = [...document.querySelectorAll('[data-bdops-lead-select]')];
      all.checked = Boolean(visible.length) && visible.every((input) => selected.has(input.value));
      all.indeterminate = visible.some((input) => selected.has(input.value)) && !all.checked;
    }
  }

  function ensureLeadSelection() {
    if (heading() !== 'AKARI Leads') return;
    const table = document.querySelector('#view-root .table-shell table');
    if (!table) return;
    const header = table.querySelector('thead tr');
    if (header && !header.querySelector('#bdops-select-all')) {
      const th = document.createElement('th');
      th.className = 'bdops-select-cell';
      th.innerHTML = '<input id="bdops-select-all" type="checkbox" aria-label="Select all visible leads" />';
      header.prepend(th);
    }
    table.querySelectorAll('tbody tr[data-open-lead]').forEach((row) => {
      if (row.querySelector('[data-bdops-lead-select]')) return;
      const id = row.getAttribute('data-open-lead');
      const td = document.createElement('td');
      td.className = 'bdops-select-cell';
      td.innerHTML = `<input type="checkbox" data-bdops-lead-select value="${escapeHtml(id)}" aria-label="Select this lead" />`;
      row.prepend(td);
    });
    const emptyRow = table.querySelector('tbody tr:not([data-open-lead]) td[colspan]');
    if (emptyRow && !emptyRow.dataset.bdopsColspan) {
      emptyRow.dataset.bdopsColspan = 'ready';
      emptyRow.colSpan = Number(emptyRow.colSpan || 8) + 1;
    }
    updateSelectionUi();
  }

  async function enhanceLeads() {
    if (heading() !== 'AKARI Leads') return;
    const root = document.querySelector('#view-root');
    if (!root) return;
    const payload = await loadOverview();
    if (!root.querySelector('[data-bdops-overview]')) {
      const block = document.createElement('section');
      block.className = 'bdops-overview';
      block.dataset.bdopsOverview = 'ready';
      block.innerHTML = `${summaryCards(payload)}${savedViewsHtml(payload)}${payload.canManage ? bulkToolbarHtml(payload) : ''}`;
      root.querySelector('.page-head')?.insertAdjacentElement('afterend', block);
    }
    ensureLeadSelection();
  }

  function memberControls(payload, member) {
    if (!payload.canAdmin) return `<div class="bdops-team-control"><button type="button" class="btn small" data-bdops-view-owner="${escapeHtml(member.id)}">View leads</button></div>`;
    const roles = ['OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER'];
    return `<div class="bdops-team-control" data-bdops-member="${escapeHtml(member.id)}">
      <select data-member-field="role" aria-label="Role for ${escapeHtml(member.fullName || member.email)}">${roles.map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${titleCase(role)}</option>`).join('')}</select>
      <label class="bdops-finance-toggle"><input type="checkbox" data-member-field="financeAccess" ${member.financeAccess ? 'checked' : ''} /> Finance</label>
      <select data-member-field="status" aria-label="Membership status for ${escapeHtml(member.fullName || member.email)}"><option value="ACTIVE" ${member.membershipStatus === 'ACTIVE' ? 'selected' : ''}>Active</option><option value="INACTIVE" ${member.membershipStatus === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select>
      <button type="button" class="btn small" data-bdops-action="save-member" data-user-id="${escapeHtml(member.id)}">Save</button>
      <button type="button" class="btn small" data-bdops-view-owner="${escapeHtml(member.id)}">View leads</button>
    </div>`;
  }

  async function enhanceTeam() {
    if (heading() !== 'Team') return;
    const root = document.querySelector('#view-root');
    if (!root || root.querySelector('[data-bdops-team]')) return;
    const payload = await loadOverview();
    const section = document.createElement('section');
    section.dataset.bdopsTeam = 'ready';
    section.innerHTML = `
      <div class="bdops-team-grid">
        <div class="bdops-team-kpi"><span>Total leads</span><strong>${payload.summary.totalLeads}</strong></div>
        <div class="bdops-team-kpi"><span>Unassigned</span><strong>${payload.summary.unassignedLeads}</strong></div>
        <div class="bdops-team-kpi"><span>Overdue</span><strong>${payload.summary.overdueFollowUp}</strong></div>
        <div class="bdops-team-kpi"><span>Missing next action</span><strong>${payload.summary.missingFollowUp}</strong></div>
      </div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><strong>Team workload and controls</strong><span>Tenant-scoped ownership, open work and manager attention</span></div></div>
        <div class="panel-body" style="padding:0">${(payload.members || []).length ? payload.members.map((member) => `
          <article class="bdops-member">
            <div class="bdops-member__identity"><div class="record-logo">${escapeHtml(initials(member.fullName || member.email))}</div><div class="record-name"><strong>${escapeHtml(member.fullName || 'AKARI member')}</strong><span>${escapeHtml(member.email || '')} · ${escapeHtml(titleCase(member.role))}</span></div></div>
            <div class="bdops-member__metric"><span>Leads</span><strong>${member.assignedLeads}</strong></div>
            <div class="bdops-member__metric"><span>Overdue</span><strong>${member.overdueFollowUp}</strong></div>
            <div class="bdops-member__metric"><span>No next action</span><strong>${member.missingFollowUp}</strong></div>
            <div class="bdops-member__metric"><span>Opportunities</span><strong>${member.activeOpportunities}</strong></div>
            <div class="bdops-member__metric"><span>Tasks</span><strong>${member.openTasks}</strong></div>
            ${memberControls(payload, member)}
          </article>`).join('') : '<div class="empty-state"><div><strong>No workspace members found</strong><span>Active memberships will appear here.</span></div></div>'}</div></div>`;
    root.querySelector('.page-head')?.insertAdjacentElement('afterend', section);
  }

  async function applyBulk() {
    const owner = document.querySelector('#bdops-bulk-owner')?.value || '__UNCHANGED__';
    const priority = document.querySelector('#bdops-bulk-priority')?.value || '';
    const lifecycleStatus = document.querySelector('#bdops-bulk-lifecycle')?.value || '';
    const followUpMode = document.querySelector('#bdops-follow-up-mode')?.value || 'unchanged';
    const followUpValue = document.querySelector('#bdops-bulk-follow-up')?.value || '';
    const body = { action: 'bulk-update', projectIds: [...selected] };
    if (owner !== '__UNCHANGED__') body.ownerUserId = owner === '__UNASSIGNED__' ? null : owner;
    if (priority) body.priority = priority;
    if (lifecycleStatus) body.lifecycleStatus = lifecycleStatus;
    if (followUpMode === 'clear') body.nextFollowUpAt = null;
    if (followUpMode === 'set') {
      if (!followUpValue) throw new Error('Choose a follow-up date and time');
      body.nextFollowUpAt = followUpValue;
    }
    if (Object.keys(body).length === 2) throw new Error('Choose at least one update');

    const toolbar = document.querySelector('#bdops-bulk-toolbar');
    toolbar?.classList.add('bdops-loading');
    try {
      const result = await request('/api/bd-operations', { method: 'POST', body: JSON.stringify(body) });
      notify(`${result.count} lead${result.count === 1 ? '' : 's'} updated`);
      selected.clear();
      overview = null;
      document.querySelector('[data-action="apply-lead-filters"]')?.click();
      setTimeout(() => enhanceLeads().catch(() => {}), 250);
    } finally {
      toolbar?.classList.remove('bdops-loading');
      updateSelectionUi();
    }
  }

  async function saveMember(button) {
    const userId = button.dataset.userId;
    const controls = document.querySelector(`[data-bdops-member="${CSS.escape(userId)}"]`);
    if (!controls) return;
    const body = {
      action: 'update-member', userId,
      role: controls.querySelector('[data-member-field="role"]')?.value,
      financeAccess: Boolean(controls.querySelector('[data-member-field="financeAccess"]')?.checked),
      status: controls.querySelector('[data-member-field="status"]')?.value,
    };
    button.disabled = true;
    try {
      await request('/api/bd-operations', { method: 'POST', body: JSON.stringify(body) });
      notify('Team member updated');
      overview = null;
      document.querySelector('[data-bdops-team]')?.remove();
      await enhanceTeam();
    } finally {
      button.disabled = false;
    }
  }

  function filterFromQueue(key) {
    const filters = currentFilters();
    if (key === 'unassigned') filters.owner = 'unassigned';
    if (key === 'missing-follow-up') filters.followUp = 'missing';
    if (key === 'overdue') filters.followUp = 'overdue';
    if (key === 'missing-contact') filters.identity = 'contact-missing';
    if (key === 'missing-identity') filters.identity = 'lead-missing';
    applyFilters(filters);
  }

  function handleClick(event) {
    const filter = event.target.closest('[data-bdops-filter]');
    if (filter) { event.preventDefault(); filterFromQueue(filter.dataset.bdopsFilter); return; }

    const action = event.target.closest('[data-bdops-action]');
    if (action) {
      event.preventDefault();
      const type = action.dataset.bdopsAction;
      if (type === 'clear-selection') { selected.clear(); updateSelectionUi(); return; }
      if (type === 'apply-bulk') { applyBulk().catch((error) => notify(error.message, 'error')); return; }
      if (type === 'save-member') { saveMember(action).catch((error) => notify(error.message, 'error')); return; }
      loadOverview().then((payload) => {
        const views = savedViews(payload);
        const select = document.querySelector('#bdops-view-select');
        if (type === 'save-view') {
          const name = document.querySelector('#bdops-view-name')?.value?.trim();
          if (!name) return notify('Name this view first', 'error');
          const existing = views.findIndex((view) => view.name.toLowerCase() === name.toLowerCase());
          const record = { name, filters: currentFilters(), updatedAt: new Date().toISOString() };
          if (existing >= 0) views.splice(existing, 1, record); else views.unshift(record);
          writeSavedViews(payload, views); refreshSavedViewOptions(payload); notify('Lead view saved');
        }
        if (type === 'load-view') {
          const index = Number(select?.value);
          if (!Number.isInteger(index) || !views[index]) return notify('Choose a saved view', 'error');
          applyFilters(views[index].filters || {});
        }
        if (type === 'delete-view') {
          const index = Number(select?.value);
          if (!Number.isInteger(index) || !views[index]) return notify('Choose a saved view', 'error');
          views.splice(index, 1); writeSavedViews(payload, views); refreshSavedViewOptions(payload); notify('Saved view deleted');
        }
      }).catch((error) => notify(error.message, 'error'));
      return;
    }

    const owner = event.target.closest('[data-bdops-view-owner]');
    if (owner) {
      event.preventDefault();
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({ owner: owner.dataset.bdopsViewOwner, sort: 'priority', direction: 'asc' }));
      document.querySelector('.sidebar [data-route="leads"]')?.click();
    }
  }

  function handleChange(event) {
    if (event.target.matches('[data-bdops-lead-select]')) {
      event.stopPropagation();
      if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
      updateSelectionUi();
    }
    if (event.target.id === 'bdops-select-all') {
      document.querySelectorAll('[data-bdops-lead-select]').forEach((input) => {
        if (event.target.checked) selected.add(input.value); else selected.delete(input.value);
      });
      updateSelectionUi();
    }
  }

  function blockRowOpen(event) {
    if (event.target.closest('[data-bdops-lead-select],#bdops-select-all')) event.stopPropagation();
  }

  async function enhance() {
    if (enhancing) return;
    enhancing = true;
    try {
      if (heading() === 'AKARI Leads') await enhanceLeads();
      if (heading() === 'Team') await enhanceTeam();
      if (heading() === 'AKARI Leads') ensureLeadSelection();
    } catch (error) {
      const root = document.querySelector('#view-root');
      if (root && !root.querySelector('.bdops-inline-error')) {
        const node = document.createElement('div');
        node.className = 'bdops-inline-error';
        node.textContent = error.message || 'BD operations could not be loaded';
        root.querySelector('.page-head')?.insertAdjacentElement('afterend', node);
      }
    } finally { enhancing = false; }
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('click', blockRowOpen, true);
  document.addEventListener('change', handleChange, true);
  const observer = new MutationObserver(() => setTimeout(() => enhance(), 40));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => setTimeout(enhance, 80));
  setTimeout(enhance, 120);
})();
