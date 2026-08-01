(() => {
  const FILTER_KEY = 'akari-crm-lead-filters-m1';
  const PAGE_SIZE = 50;
  const drawerCache = new Map();
  let currentLeadId = sessionStorage.getItem('akari-current-lead-id') || '';
  let loadingLeads = false;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const titleCase = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  const initials = (value) => String(value || 'AK').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const dateLabel = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  };
  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
  const handleFromX = (value) => value ? `@${String(value).replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0]}` : '';
  const xUrl = (value) => value ? (/^https?:\/\//i.test(value) ? value : `https://x.com/${String(value).replace(/^@/, '')}`) : '';
  const telegramUrl = (value) => value ? `https://t.me/${String(value).replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0]}` : '';
  const hasHeading = (name) => document.querySelector('#view-root .page-head h1')?.textContent?.trim() === name;

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

  function savedFilters() {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
  }

  function select(id, label, options, value = '') {
    return `<label class="ak-filter-field"><span>${escapeHtml(label)}</span><select class="select" id="${id}">${options.map(([key, text]) => `<option value="${escapeHtml(key)}" ${String(value) === String(key) ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
  }

  async function enhanceLeadToolbar() {
    if (!hasHeading('AKARI Leads')) return;
    const toolbar = document.querySelector('#view-root .toolbar');
    if (!toolbar || toolbar.dataset.stabilizationM1 === 'ready') return;
    toolbar.dataset.stabilizationM1 = 'ready';
    toolbar.classList.add('ak-lead-filter-toolbar');
    const state = savedFilters();
    const apply = toolbar.querySelector('[data-action="apply-lead-filters"]');
    if (!apply) return;

    const extra = document.createElement('div');
    extra.className = 'ak-advanced-filter-row';
    extra.innerHTML = `
      ${select('m1-lead-lifecycle', 'Lifecycle', [['','All lifecycle stages'],['LEAD','Lead'],['PROSPECT','Prospect'],['ACTIVE_OPPORTUNITY','Active opportunity'],['CLIENT','Client'],['PARTNER','Partner'],['DORMANT_CLIENT','Dormant client'],['FORMER_CLIENT','Former client'],['ARCHIVED','Archived']], state.lifecycle || '')}
      ${select('m1-lead-follow-up', 'Follow-up', [['','Any follow-up'],['overdue','Overdue'],['today','Due today'],['scheduled','Scheduled'],['missing','No next action']], state.followUp || '')}
      ${select('m1-lead-identity', 'Identity', [['','Any identity state'],['complete','Lead + contact complete'],['missing','Update needed'],['lead-missing','Lead X/TG missing'],['contact-missing','Contact X/TG missing']], state.identity || '')}
      ${select('m1-lead-owner', 'Owner', [['','All owners'],['unassigned','Unassigned']], state.owner || '')}
      ${select('m1-lead-sort', 'Sort', [['priority','Priority'],['follow_up','Next follow-up'],['updated','Recently updated'],['name','Name'],['created','Created'],['pipeline','Pipeline value']], state.sort || 'priority')}
      ${select('m1-lead-direction', 'Direction', [['asc','Ascending'],['desc','Descending']], state.direction || 'asc')}
    `;
    toolbar.insertAdjacentElement('afterend', extra);

    try {
      const meta = await request('/api/akari-leads?limit=1&offset=0');
      const ownerSelect = document.querySelector('#m1-lead-owner');
      if (ownerSelect && Array.isArray(meta.owners)) {
        meta.owners.forEach((owner) => {
          const option = document.createElement('option');
          option.value = owner.id;
          option.textContent = owner.full_name;
          option.selected = state.owner === owner.id;
          ownerSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.warn('AKARI lead filter metadata could not be loaded', error);
    }
  }

  function readFilters() {
    const values = {
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
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(values));
    return values;
  }

  function priorityPill(value) {
    const key = String(value || 'MEDIUM').toUpperCase();
    const tone = key === 'URGENT' ? 'red' : key === 'HIGH' ? 'yellow' : key === 'LOW' ? 'blue' : '';
    return `<span class="pill ${tone}">${escapeHtml(titleCase(key))}</span>`;
  }

  function leadRow(lead) {
    const website = lead.website ? `<a href="${escapeHtml(/^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Web</a>` : '';
    const x = lead.x_url ? `<a href="${escapeHtml(xUrl(lead.x_url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(handleFromX(lead.x_url))}</a>` : '';
    const tg = lead.telegram ? `<a href="${escapeHtml(telegramUrl(lead.telegram))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(lead.telegram)}</a>` : '';
    const channels = [website, x, tg].filter(Boolean).join('<span>·</span>') || '<span class="ak-missing">Update needed</span>';
    const identityTone = lead.identity_complete && lead.contact_identity_complete ? 'green' : 'yellow';
    return `<tr data-open-lead="${escapeHtml(lead.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(lead.name)}">
      <td><div class="record-cell"><div class="record-logo">${escapeHtml(initials(lead.name))}</div><div class="record-name"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.region || lead.original_status || titleCase(lead.lifecycle_status || 'LEAD'))}</span></div></div></td>
      <td>${escapeHtml(lead.category || 'Uncategorized')}</td>
      <td>${priorityPill(lead.priority)}</td>
      <td><strong>${escapeHtml(lead.primary_contact || '—')}</strong><span class="ak-cell-meta">${escapeHtml(lead.primary_contact_telegram || lead.primary_contact_email || '')}</span></td>
      <td><div class="ak-channel-links">${channels}</div><span class="pill ${identityTone}">${lead.identity_complete && lead.contact_identity_complete ? 'Complete' : 'Update needed'}</span></td>
      <td>${escapeHtml(lead.owner || 'Unassigned')}</td>
      <td>${escapeHtml(dateLabel(lead.next_follow_up_at))}</td>
      <td><span>${escapeHtml(lead.source_name || 'AKARI Leads')}</span>${lead.referral_partner_name ? `<span class="ak-cell-meta">Introduced by ${escapeHtml(lead.referral_partner_name)}</span>` : ''}</td>
    </tr>`;
  }

  async function loadLeads(page = 0) {
    if (loadingLeads || !hasHeading('AKARI Leads')) return;
    loadingLeads = true;
    const table = document.querySelector('#view-root .table-shell table');
    const tbody = table?.querySelector('tbody');
    const pagination = document.querySelector('#view-root .pagination');
    try {
      const filters = readFilters();
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      document.querySelector('#view-root')?.classList.add('ak-loading-data');
      const payload = await request(`/api/akari-leads?${params.toString()}`);
      const items = payload.items || [];
      if (tbody) tbody.innerHTML = items.length ? items.map(leadRow).join('') : `<tr><td colspan="8"><div class="empty-state"><div><strong>No leads match this view</strong><span>Clear filters or choose a different relationship state.</span></div></div></td></tr>`;
      if (pagination) {
        const total = Number(payload.total || 0);
        const start = items.length ? page * PAGE_SIZE + 1 : 0;
        const end = Math.min((page + 1) * PAGE_SIZE, total);
        pagination.innerHTML = `<span>Showing ${start}–${end} of ${total}</span><div class="pagination-actions"><button class="btn small" data-action="m1-lead-prev" ${page === 0 ? 'disabled' : ''}>Previous</button><button class="btn small" data-action="m1-lead-next" ${end >= total ? 'disabled' : ''}>Next</button></div>`;
        pagination.dataset.page = String(page);
      }
    } catch (error) {
      notify(error.message || 'Leads could not be loaded', 'error');
    } finally {
      loadingLeads = false;
      document.querySelector('#view-root')?.classList.remove('ak-loading-data');
    }
  }

  async function projectDetail(id, force = false) {
    if (!id) return null;
    if (!force && drawerCache.has(id)) return drawerCache.get(id);
    const item = await request(`/api/projects/${encodeURIComponent(id)}`);
    drawerCache.set(id, item);
    return item;
  }

  function appendContactActions(card, contact) {
    if (!card || card.dataset.contactEnhanced === contact.id) return;
    card.dataset.contactEnhanced = contact.id;
    const row = card.querySelector('.task-row') || card;
    const actions = document.createElement('div');
    actions.className = 'ak-contact-actions';
    actions.innerHTML = `
      ${contact.x_handle ? `<a class="btn small ghost" href="${escapeHtml(xUrl(contact.x_handle))}" target="_blank" rel="noopener">X</a>` : ''}
      ${contact.telegram ? `<a class="btn small ghost" href="${escapeHtml(telegramUrl(contact.telegram))}" target="_blank" rel="noopener">TG</a>` : ''}
      <button type="button" class="btn small" data-action="edit-contact-m1" data-contact-id="${escapeHtml(contact.id)}">Edit</button>
    `;
    row.appendChild(actions);
  }

  async function enhanceDrawer() {
    const drawer = document.querySelector('#drawer-root .drawer.open');
    if (!drawer || !currentLeadId) return;
    const activeTab = drawer.querySelector('.drawer-tab.active')?.textContent?.trim()?.toLowerCase();
    if (activeTab === 'contacts') {
      try {
        const project = await projectDetail(currentLeadId);
        const cards = [...drawer.querySelectorAll('.drawer-body .task-card')];
        (project?.contacts || []).forEach((contact, index) => appendContactActions(cards[index], contact));
      } catch (error) { console.warn('Contact actions could not be enhanced', error); }
    }
    if (activeTab === 'activity') enhanceTimeline(drawer);
  }

  function changedFields(item) {
    const before = item.before || {};
    const after = item.after || {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .slice(0, 6)
      .map(titleCase)
      .join(', ');
  }

  async function enhanceTimeline(drawer) {
    if (drawer.querySelector('[data-m1-timeline]')) return;
    const section = document.createElement('div');
    section.className = 'drawer-section ak-timeline-section';
    section.dataset.m1Timeline = 'loading';
    section.innerHTML = '<h3>Operational timeline</h3><div class="ak-timeline-loading">Loading activities and audit history…</div>';
    drawer.querySelector('.drawer-body')?.appendChild(section);
    try {
      const payload = await request(`/api/projects/${encodeURIComponent(currentLeadId)}/timeline`);
      const items = payload.items || [];
      section.dataset.m1Timeline = 'ready';
      section.innerHTML = `<h3>Operational timeline</h3>${items.length ? `<div class="ak-timeline">${items.map((item) => `
        <article class="ak-timeline-item ${item.kind === 'AUDIT' ? 'audit' : 'activity'}">
          <div class="ak-timeline-marker"></div>
          <div><div class="ak-timeline-top"><strong>${escapeHtml(item.title || titleCase(item.type))}</strong><span class="pill ${item.kind === 'AUDIT' ? 'blue' : 'green'}">${escapeHtml(titleCase(item.kind))}</span></div>
          <span>${escapeHtml(dateLabel(item.occurredAt))}${item.actor ? ` · ${escapeHtml(item.actor)}` : ''}</span>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
          ${item.outcome ? `<p><b>Outcome:</b> ${escapeHtml(item.outcome)}</p>` : ''}
          ${item.kind === 'AUDIT' && changedFields(item) ? `<p><b>Changed:</b> ${escapeHtml(changedFields(item))}</p>` : ''}</div>
        </article>`).join('')}</div>` : '<div class="empty-state"><div><strong>No timeline entries</strong><span>Activities and audited changes will appear here.</span></div></div>'}`;
    } catch (error) {
      section.innerHTML = `<h3>Operational timeline</h3><div class="ak-inline-error">${escapeHtml(error.message || 'Timeline could not be loaded')} <button type="button" class="btn small" data-action="retry-timeline-m1">Retry</button></div>`;
    }
  }

  function modalField(name, label, value = '', type = 'text', full = false) {
    return `<label class="ak-modal-field ${full ? 'full' : ''}"><span>${escapeHtml(label)}</span>${type === 'textarea' ? `<textarea name="${name}" rows="4">${escapeHtml(value)}</textarea>` : `<input name="${name}" type="${type}" value="${escapeHtml(value)}" />`}</label>`;
  }

  async function openContactModal(contactId) {
    const project = await projectDetail(currentLeadId);
    const contact = (project?.contacts || []).find((item) => item.id === contactId);
    if (!contact) return notify('Contact could not be found', 'error');
    document.querySelector('#m1-contact-modal')?.remove();
    const root = document.createElement('div');
    root.id = 'm1-contact-modal';
    root.className = 'ak-modal-layer open';
    root.innerHTML = `<div class="ak-modal-backdrop" data-action="close-contact-modal-m1"></div><section class="ak-modal-card" role="dialog" aria-modal="true" aria-labelledby="m1-contact-title">
      <header><div><span class="eyebrow">CONTACT</span><h2 id="m1-contact-title">Edit ${escapeHtml(contact.full_name)}</h2><p>${escapeHtml(project.name)}</p></div><button type="button" class="close" data-action="close-contact-modal-m1">×</button></header>
      <form id="m1-contact-form"><div class="ak-modal-grid">
        ${modalField('fullName', 'Full name', contact.full_name)}
        ${modalField('jobTitle', 'Job title', contact.job_title || '')}
        ${modalField('email', 'Email', contact.email || '', 'email')}
        ${modalField('telegram', 'Telegram handle', contact.telegram || '')}
        ${modalField('xHandle', 'X account', handleFromX(contact.x_handle || ''))}
        ${modalField('preferredChannel', 'Preferred channel', contact.preferred_channel || '')}
        <label class="ak-check"><input name="isPrimaryContact" type="checkbox" ${contact.is_primary_contact ? 'checked' : ''}/><span>Primary contact</span></label>
        <label class="ak-check"><input name="isDecisionMaker" type="checkbox" ${contact.is_decision_maker ? 'checked' : ''}/><span>Decision maker</span></label>
        ${modalField('notes', 'Internal notes', contact.notes || '', 'textarea', true)}
      </div><div class="ak-modal-error" hidden></div><footer><button type="button" class="btn" data-action="close-contact-modal-m1">Cancel</button><button type="submit" class="btn primary">Save contact</button></footer></form>
    </section>`;
    document.body.appendChild(root);
    root.querySelector('input[name="fullName"]')?.focus();
    root.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      const message = form.querySelector('.ak-modal-error');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      message.hidden = true;
      const data = Object.fromEntries(new FormData(form).entries());
      data.isPrimaryContact = form.elements.isPrimaryContact.checked;
      data.isDecisionMaker = form.elements.isDecisionMaker.checked;
      try {
        await request(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'PATCH', body: JSON.stringify(data) });
        drawerCache.delete(currentLeadId);
        root.remove();
        notify('Contact updated');
        const close = document.querySelector('#drawer-root [data-action="close-drawer"]');
        close?.click();
        setTimeout(() => {
          const row = [...document.querySelectorAll('[data-open-lead]')].find((node) => node.dataset.openLead === currentLeadId);
          if (row) row.click();
          else location.reload();
        }, 120);
      } catch (error) {
        message.textContent = error.message || 'Contact could not be saved';
        message.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Save contact';
      }
    });
  }

  document.addEventListener('click', (event) => {
    const lead = event.target.closest('[data-open-lead]');
    if (lead?.dataset.openLead) {
      currentLeadId = lead.dataset.openLead;
      sessionStorage.setItem('akari-current-lead-id', currentLeadId);
      drawerCache.delete(currentLeadId);
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'apply-lead-filters' && document.querySelector('.ak-lead-filter-toolbar')) {
      event.preventDefault(); event.stopImmediatePropagation(); loadLeads(0); return;
    }
    if (action === 'clear-lead-filters' && document.querySelector('.ak-lead-filter-toolbar')) {
      event.preventDefault(); event.stopImmediatePropagation();
      ['lead-search','lead-category','lead-priority','m1-lead-lifecycle','m1-lead-follow-up','m1-lead-identity','m1-lead-owner'].forEach((id) => { const node = document.getElementById(id); if (node) node.value = ''; });
      const sort = document.querySelector('#m1-lead-sort'); if (sort) sort.value = 'priority';
      const direction = document.querySelector('#m1-lead-direction'); if (direction) direction.value = 'asc';
      sessionStorage.removeItem(FILTER_KEY); loadLeads(0); return;
    }
    if (action === 'm1-lead-prev' || action === 'm1-lead-next') {
      event.preventDefault(); event.stopImmediatePropagation();
      const page = Number(document.querySelector('#view-root .pagination')?.dataset.page || 0);
      loadLeads(action === 'm1-lead-prev' ? Math.max(0, page - 1) : page + 1); return;
    }
    if (action === 'edit-contact-m1') {
      event.preventDefault(); event.stopImmediatePropagation(); openContactModal(event.target.closest('[data-contact-id]').dataset.contactId); return;
    }
    if (action === 'close-contact-modal-m1') {
      event.preventDefault(); document.querySelector('#m1-contact-modal')?.remove(); return;
    }
    if (action === 'retry-timeline-m1') {
      event.preventDefault(); document.querySelector('[data-m1-timeline]')?.remove(); enhanceDrawer();
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-drawer-tab]')) setTimeout(enhanceDrawer, 0);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target?.id === 'lead-search' && document.querySelector('.ak-lead-filter-toolbar')) {
      event.preventDefault(); loadLeads(0);
    }
    if (event.key === 'Escape') document.querySelector('#m1-contact-modal')?.remove();
  });

  const observer = new MutationObserver(() => {
    enhanceLeadToolbar();
    enhanceDrawer();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceLeadToolbar();
  enhanceDrawer();
})();
