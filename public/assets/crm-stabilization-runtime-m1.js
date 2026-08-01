(() => {
  const PAGE_SIZE = 50;
  const FILTER_KEY = 'akari-runtime-lead-filters-m1';
  let currentProjectId = '';
  let currentProject = null;
  let currentTab = 'overview';
  let leadPage = 0;
  let leadLoading = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  const initials = (value) => String(value || 'AK').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style:'currency', currency, maximumFractionDigits:0 }).format(Number(value || 0));
  const date = (value, withTime = false) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', withTime ? { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' } : { day:'numeric', month:'short', year:'numeric' }).format(parsed);
  };
  const handleFromX = (value) => value ? `@${String(value).replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0]}` : '';
  const xHref = (value) => value ? (/^https?:\/\//i.test(value) ? value : `https://x.com/${String(value).replace(/^@/, '')}`) : '';
  const telegramHref = (value) => value ? `https://t.me/${String(value).replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0]}` : '';

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'content-type':'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function toast(message, tone = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3400);
  }

  function filters() {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
  }

  function select(id, label, values, selected = '') {
    return `<label class="ak-filter-field"><span>${esc(label)}</span><select class="select" id="${id}">${values.map(([value, copy]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(copy)}</option>`).join('')}</select></label>`;
  }

  function readFilterValues() {
    const value = {
      search: $('#v8-lead-search')?.value?.trim() || '',
      lifecycle: $('#m1-lead-lifecycle')?.value || '',
      priority: $('#m1-lead-priority')?.value || '',
      followUp: $('#m1-lead-follow-up')?.value || '',
      identity: $('#m1-lead-identity')?.value || '',
      owner: $('#m1-lead-owner')?.value || '',
      sort: $('#m1-lead-sort')?.value || 'priority',
      direction: $('#m1-lead-direction')?.value || 'asc',
    };
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(value));
    return value;
  }

  function pill(value, tone = '') {
    return `<span class="pill ${tone}">${esc(title(value || '—'))}</span>`;
  }

  function leadRow(lead) {
    const identityComplete = lead.identity_complete && lead.contact_identity_complete;
    const contactChannels = [
      lead.primary_contact_x ? `<a href="${esc(xHref(lead.primary_contact_x))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(handleFromX(lead.primary_contact_x))}</a>` : '',
      lead.primary_contact_telegram ? `<a href="${esc(telegramHref(lead.primary_contact_telegram))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(lead.primary_contact_telegram)}</a>` : '',
    ].filter(Boolean).join(' · ');
    const priorityTone = lead.priority === 'URGENT' ? 'red' : lead.priority === 'HIGH' ? 'yellow' : lead.priority === 'LOW' ? 'blue' : '';
    return `<tr data-v8-project="${esc(lead.id)}" tabindex="0" role="button" aria-label="Open ${esc(lead.name)}">
      <td><div class="project-cell"><span class="project-logo">${esc(initials(lead.name))}</span><span class="project-name"><strong>${esc(lead.name)}</strong><small>${esc(lead.category || 'Uncategorised')}</small></span></div></td>
      <td>${pill(lead.lifecycle_status, lead.lifecycle_status === 'CLIENT' ? 'green' : 'pink')}</td>
      <td>${pill(lead.priority, priorityTone)}</td>
      <td>${esc(lead.owner || 'Unassigned')}</td>
      <td><strong>${esc(lead.primary_contact || '—')}</strong><small class="ak-cell-meta">${contactChannels || 'No complete contact identity'}</small>${pill(identityComplete ? 'Complete' : 'Update needed', identityComplete ? 'green' : 'yellow')}</td>
      <td class="finance-value">${money(lead.pipeline_value || 0)}</td>
      <td>${esc(date(lead.next_follow_up_at))}</td>
      <td>${esc(lead.source_name || '—')}${lead.referral_partner_name ? `<small class="ak-cell-meta">Introduced by ${esc(lead.referral_partner_name)}</small>` : ''}</td>
    </tr>`;
  }

  async function loadLeadPage(page = 0) {
    if (leadLoading || !$('#view-root .ak-runtime-lead-tools')) return;
    leadLoading = true;
    leadPage = Math.max(0, page);
    const root = $('#view-root');
    root?.classList.add('ak-loading-data');
    try {
      const params = new URLSearchParams({ limit:String(PAGE_SIZE), offset:String(leadPage * PAGE_SIZE) });
      Object.entries(readFilterValues()).forEach(([key, value]) => { if (value) params.set(key, value); });
      const payload = await api(`/api/akari-leads?${params.toString()}`);
      const items = payload.items || [];
      const tbody = $('#view-root .table-wrap tbody');
      if (tbody) tbody.innerHTML = items.length ? items.map(leadRow).join('') : `<tr><td colspan="8"><div class="empty-state"><div><strong>No leads match this view</strong><span>Clear filters or choose a different relationship state.</span></div></div></td></tr>`;
      const total = Number(payload.total || 0);
      const start = items.length ? leadPage * PAGE_SIZE + 1 : 0;
      const end = Math.min((leadPage + 1) * PAGE_SIZE, total);
      let pagination = $('#view-root .ak-runtime-pagination');
      if (!pagination) {
        pagination = document.createElement('div');
        pagination.className = 'pagination ak-runtime-pagination';
        $('#view-root .table-wrap')?.insertAdjacentElement('afterend', pagination);
      }
      pagination.innerHTML = `<span>Showing ${start}–${end} of ${total}</span><div class="pagination-actions"><button class="btn small" data-m1-action="lead-prev" ${leadPage === 0 ? 'disabled' : ''}>Previous</button><button class="btn small" data-m1-action="lead-next" ${end >= total ? 'disabled' : ''}>Next</button></div>`;
      const eyebrow = $('#view-root .page-head .eyebrow');
      if (eyebrow) eyebrow.textContent = `${total} TENANT RECORDS`;
      const ownerSelect = $('#m1-lead-owner');
      if (ownerSelect && ownerSelect.options.length <= 2) {
        (payload.owners || []).forEach((owner) => ownerSelect.add(new Option(owner.full_name, owner.id, false, filters().owner === owner.id)));
      }
    } catch (error) {
      toast(error.message || 'Leads could not be loaded', 'error');
    } finally {
      root?.classList.remove('ak-loading-data');
      leadLoading = false;
    }
  }

  function enhanceRuntimeLeads() {
    const heading = $('#view-root .page-head h1');
    const tools = $('#view-root .table-tools');
    if (!heading || heading.textContent.trim() !== 'AKARI Leads' || !tools || tools.dataset.stabilizedM1 === 'ready') return;
    tools.dataset.stabilizedM1 = 'ready';
    tools.classList.add('ak-runtime-lead-tools');
    const searchButton = tools.querySelector('[data-v8-action="search-leads"]');
    if (searchButton) {
      searchButton.removeAttribute('data-v8-action');
      searchButton.dataset.m1Action = 'apply-leads';
      searchButton.textContent = 'Apply';
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn ghost';
    clear.dataset.m1Action = 'clear-leads';
    clear.textContent = 'Clear';
    tools.appendChild(clear);

    const state = filters();
    const extra = document.createElement('div');
    extra.className = 'ak-advanced-filter-row';
    extra.innerHTML = `
      ${select('m1-lead-lifecycle','Lifecycle',[['','All lifecycle stages'],['LEAD','Lead'],['PROSPECT','Prospect'],['ACTIVE_OPPORTUNITY','Active opportunity'],['CLIENT','Client'],['PARTNER','Partner'],['DORMANT_CLIENT','Dormant client'],['FORMER_CLIENT','Former client'],['ARCHIVED','Archived']],state.lifecycle || '')}
      ${select('m1-lead-priority','Priority',[['','All priorities'],['URGENT','Urgent'],['HIGH','High'],['MEDIUM','Medium'],['LOW','Low']],state.priority || '')}
      ${select('m1-lead-follow-up','Follow-up',[['','Any follow-up'],['overdue','Overdue'],['today','Due today'],['scheduled','Scheduled'],['missing','No next action']],state.followUp || '')}
      ${select('m1-lead-identity','Identity',[['','Any identity state'],['complete','Lead + contact complete'],['missing','Update needed'],['lead-missing','Lead X/TG missing'],['contact-missing','Contact X/TG missing']],state.identity || '')}
      ${select('m1-lead-owner','Owner',[['','All owners'],['unassigned','Unassigned']],state.owner || '')}
      ${select('m1-lead-sort','Sort',[['priority','Priority'],['follow_up','Next follow-up'],['updated','Recently updated'],['name','Name'],['created','Created'],['pipeline','Pipeline value']],state.sort || 'priority')}
      ${select('m1-lead-direction','Direction',[['asc','Ascending'],['desc','Descending']],state.direction || 'asc')}
    `;
    tools.insertAdjacentElement('afterend', extra);
    if ($('#v8-lead-search')) $('#v8-lead-search').value = state.search || '';
    loadLeadPage(0);
  }

  function property(label, value) {
    return `<div class="property"><span>${esc(label)}</span><strong>${value}</strong></div>`;
  }

  function overview(project) {
    const open = (project.opportunities || []).filter((item) => !['WON','LOST'].includes(item.stage));
    const pipeline = open.reduce((sum, item) => sum + Number(item.estimated_value || 0), 0);
    const leadX = project.x_url ? `<a class="link" href="${esc(xHref(project.x_url))}" target="_blank" rel="noopener">${esc(handleFromX(project.x_url))}</a>` : 'Update needed';
    const leadTg = project.telegram ? `<a class="link" href="${esc(telegramHref(project.telegram))}" target="_blank" rel="noopener">${esc(project.telegram)}</a>` : 'Update needed';
    return `<div class="ak-project-grid">
      <section class="ak-project-panel"><h3>Relationship</h3><div class="property-grid">${property('Lifecycle',esc(title(project.lifecycle_status || 'LEAD')))}${property('Priority',esc(title(project.priority || 'MEDIUM')))}${property('Owner',esc(project.owner || 'Unassigned'))}${property('Next follow-up',esc(date(project.next_follow_up_at,true)))}</div></section>
      <section class="ak-project-panel"><h3>Channels</h3><div class="property-grid">${property('Website',project.website ? `<a class="link" href="${esc(/^https?:\/\//i.test(project.website) ? project.website : `https://${project.website}`)}" target="_blank" rel="noopener">${esc(project.website)}</a>` : '—')}${property('X account',leadX)}${property('Telegram',leadTg)}${property('Source',esc(project.source_name || '—'))}</div></section>
      <section class="ak-project-panel"><h3>Commercial</h3><div class="property-grid">${property('Open opportunities',String(open.length))}${property('Pipeline value',`<span class="finance-value">${money(pipeline)}</span>`)}${property('Contacts',String((project.contacts || []).length))}${property('Introducer',esc(project.referral_partner_name || '—'))}</div></section>
      <section class="ak-project-panel full"><h3>Scope and notes</h3><div class="notes">${esc(project.description || project.original_notes || 'No notes recorded.')}</div></section>
    </div>`;
  }

  function contacts(project) {
    const items = project.contacts || [];
    if (!items.length) return `<div class="empty-state"><div><strong>No contacts</strong><span>Add the primary decision-maker and their X and Telegram handles.</span></div></div>`;
    return `<div class="ak-project-list">${items.map((contact) => `<article class="ak-project-list-item"><div class="record-avatar">${esc(initials(contact.full_name))}</div><div class="record-main"><strong>${esc(contact.full_name)}</strong><small>${esc(contact.job_title || contact.contact_role || 'Contact')}</small><div class="ak-contact-links">${contact.x_handle ? `<a href="${esc(xHref(contact.x_handle))}" target="_blank" rel="noopener">${esc(handleFromX(contact.x_handle))}</a>` : '<span>X missing</span>'}${contact.telegram ? `<a href="${esc(telegramHref(contact.telegram))}" target="_blank" rel="noopener">${esc(contact.telegram)}</a>` : '<span>Telegram missing</span>'}${contact.email ? `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>` : ''}</div></div><div class="ak-contact-actions">${contact.is_primary_contact ? pill('Primary','green') : ''}<button class="btn small" data-m1-action="edit-contact" data-contact-id="${esc(contact.id)}">Edit</button></div></article>`).join('')}</div>`;
  }

  function opportunities(project) {
    const items = project.opportunities || [];
    if (!items.length) return `<div class="empty-state"><div><strong>No opportunities</strong><span>Create a commercial or fundraising opportunity for this relationship.</span></div></div>`;
    return `<div class="ak-project-list">${items.map((item) => `<article class="ak-project-list-item"><div class="record-main"><strong>${esc(item.name)}</strong><small>${esc(title(item.stage))} · ${esc(item.next_action || 'No next action')}</small></div><div><strong class="finance-value">${money(item.estimated_value || 0,item.currency || 'USD')}</strong><span class="ak-cell-meta">${Number(item.probability_percentage || 0)}%</span></div></article>`).join('')}</div>`;
  }

  function changedFields(item) {
    const before = item.before || {};
    const after = item.after || {};
    return [...new Set([...Object.keys(before),...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).slice(0,6).map(title).join(', ');
  }

  async function timeline(projectId) {
    const payload = await api(`/api/projects/${encodeURIComponent(projectId)}/timeline`);
    const items = payload.items || [];
    if (!items.length) return `<div class="empty-state"><div><strong>No timeline entries</strong><span>Activities and audited changes will appear here.</span></div></div>`;
    return `<div class="ak-timeline">${items.map((item) => `<article class="ak-timeline-item ${item.kind === 'AUDIT' ? 'audit' : 'activity'}"><div class="ak-timeline-marker"></div><div><div class="ak-timeline-top"><strong>${esc(item.title || title(item.type))}</strong>${pill(item.kind,item.kind === 'AUDIT' ? 'blue' : 'green')}</div><span>${esc(date(item.occurredAt,true))}${item.actor ? ` · ${esc(item.actor)}` : ''}</span>${item.description ? `<p>${esc(item.description)}</p>` : ''}${item.outcome ? `<p><b>Outcome:</b> ${esc(item.outcome)}</p>` : ''}${item.kind === 'AUDIT' && changedFields(item) ? `<p><b>Changed:</b> ${esc(changedFields(item))}</p>` : ''}</div></article>`).join('')}</div>`;
  }

  async function tabContent(tab) {
    if (!currentProject) return '<div class="ak-timeline-loading">Loading relationship…</div>';
    if (tab === 'contacts') return contacts(currentProject);
    if (tab === 'opportunities') return opportunities(currentProject);
    if (tab === 'activity') return timeline(currentProject.id);
    return overview(currentProject);
  }

  async function showProjectTab(tab) {
    currentTab = tab;
    document.querySelectorAll('[data-m1-project-tab]').forEach((button) => button.classList.toggle('active',button.dataset.m1ProjectTab === tab));
    const body = $('#m1-project-body');
    if (!body) return;
    body.innerHTML = '<div class="ak-timeline-loading">Loading…</div>';
    try { body.innerHTML = await tabContent(tab); }
    catch (error) { body.innerHTML = `<div class="ak-inline-error">${esc(error.message || 'This section could not be loaded')}</div>`; }
  }

  async function upgradeProjectModal() {
    const modal = $('#modal-root .modal');
    if (!modal || !currentProjectId || modal.dataset.stabilizedProject === currentProjectId) return;
    modal.dataset.stabilizedProject = currentProjectId;
    modal.classList.add('ak-project-modal');
    modal.innerHTML = `<div class="modal-head"><div><div class="eyebrow">RELATIONSHIP WORKSPACE</div><h2>Loading…</h2><p>Opening tenant-scoped project data</p></div><button class="icon-btn" data-v8-close>×</button></div><div class="modal-body"><div class="ak-timeline-loading">Loading relationship…</div></div>`;
    try {
      currentProject = await api(`/api/projects/${encodeURIComponent(currentProjectId)}`);
      modal.innerHTML = `<div class="modal-head"><div><div class="eyebrow">RELATIONSHIP WORKSPACE</div><h2>${esc(currentProject.name)}</h2><p>${esc(title(currentProject.lifecycle_status || 'LEAD'))} · ${esc(currentProject.category || 'Uncategorised')}</p></div><button class="icon-btn" data-v8-close>×</button></div>
        <div class="ak-project-actions"><button class="btn primary" data-v8-action="new-activity" data-project="${esc(currentProject.id)}">Record activity</button><button class="btn" data-v8-action="new-task" data-project="${esc(currentProject.id)}">Add task</button><button class="btn" data-v8-action="new-opportunity" data-project="${esc(currentProject.id)}">Create opportunity</button></div>
        <div class="ak-project-tabs">${['overview','contacts','opportunities','activity'].map((tab) => `<button type="button" class="${currentTab === tab ? 'active' : ''}" data-m1-project-tab="${tab}">${esc(title(tab))}</button>`).join('')}</div>
        <div class="modal-body" id="m1-project-body"></div>`;
      await showProjectTab(currentTab);
    } catch (error) {
      modal.querySelector('.modal-body').innerHTML = `<div class="ak-inline-error">${esc(error.message || 'Relationship could not be loaded')}</div>`;
    }
  }

  function field(name,label,value = '',type = 'text',full = false) {
    return `<label class="ak-modal-field ${full ? 'full' : ''}"><span>${esc(label)}</span>${type === 'textarea' ? `<textarea name="${name}" rows="4">${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}" />`}</label>`;
  }

  function closeContactEditor() { $('#m1-contact-editor')?.remove(); }

  function openContactEditor(contactId) {
    const contact = (currentProject?.contacts || []).find((item) => item.id === contactId);
    if (!contact) return toast('Contact could not be found','error');
    closeContactEditor();
    const layer = document.createElement('div');
    layer.id = 'm1-contact-editor';
    layer.className = 'ak-modal-layer open';
    layer.innerHTML = `<div class="ak-modal-backdrop" data-m1-action="close-contact"></div><section class="ak-modal-card" role="dialog" aria-modal="true" aria-labelledby="m1-contact-heading"><header><div><span class="eyebrow">CONTACT</span><h2 id="m1-contact-heading">Edit ${esc(contact.full_name)}</h2><p>${esc(currentProject.name)}</p></div><button type="button" class="close" data-m1-action="close-contact">×</button></header><form id="m1-contact-form"><div class="ak-modal-grid">${field('fullName','Full name',contact.full_name)}${field('jobTitle','Job title',contact.job_title || '')}${field('email','Email',contact.email || '','email')}${field('telegram','Telegram handle',contact.telegram || '')}${field('xHandle','X account',handleFromX(contact.x_handle || ''))}${field('preferredChannel','Preferred channel',contact.preferred_channel || '')}<label class="ak-check"><input name="isPrimaryContact" type="checkbox" ${contact.is_primary_contact ? 'checked' : ''}/><span>Primary contact</span></label><label class="ak-check"><input name="isDecisionMaker" type="checkbox" ${contact.is_decision_maker ? 'checked' : ''}/><span>Decision maker</span></label>${field('notes','Internal notes',contact.notes || '','textarea',true)}</div><div class="ak-modal-error" hidden></div><footer><button type="button" class="btn" data-m1-action="close-contact">Cancel</button><button type="submit" class="btn primary">Save contact</button></footer></form></section>`;
    document.body.appendChild(layer);
    $('input[name="fullName"]',layer)?.focus();
    $('form',layer)?.addEventListener('submit',async(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = $('button[type="submit"]',form);
      const errorBox = $('.ak-modal-error',form);
      submit.disabled = true; submit.textContent = 'Saving…'; errorBox.hidden = true;
      const data = Object.fromEntries(new FormData(form).entries());
      data.isPrimaryContact = form.elements.isPrimaryContact.checked;
      data.isDecisionMaker = form.elements.isDecisionMaker.checked;
      try {
        await api(`/api/contacts/${encodeURIComponent(contactId)}`,{ method:'PATCH', body:JSON.stringify(data) });
        currentProject = await api(`/api/projects/${encodeURIComponent(currentProjectId)}`);
        closeContactEditor();
        toast('Contact updated');
        await showProjectTab('contacts');
      } catch (error) {
        errorBox.textContent = error.message || 'Contact could not be saved';
        errorBox.hidden = false;
      } finally {
        submit.disabled = false; submit.textContent = 'Save contact';
      }
    });
  }

  document.addEventListener('click',(event) => {
    const project = event.target.closest('[data-v8-project]');
    if (project) {
      currentProjectId = project.dataset.v8Project;
      currentProject = null;
      currentTab = 'overview';
      sessionStorage.setItem('akari-current-lead-id',currentProjectId);
      setTimeout(upgradeProjectModal,0);
    }
  });

  document.addEventListener('click',(event) => {
    const control = event.target.closest('[data-m1-action]');
    if (!control) return;
    const action = control.dataset.m1Action;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'apply-leads') loadLeadPage(0);
    if (action === 'clear-leads') {
      sessionStorage.removeItem(FILTER_KEY);
      ['v8-lead-search','m1-lead-lifecycle','m1-lead-priority','m1-lead-follow-up','m1-lead-identity','m1-lead-owner'].forEach((id) => { const node = document.getElementById(id); if (node) node.value = ''; });
      const sort = $('#m1-lead-sort'); if (sort) sort.value = 'priority';
      const direction = $('#m1-lead-direction'); if (direction) direction.value = 'asc';
      loadLeadPage(0);
    }
    if (action === 'lead-prev') loadLeadPage(Math.max(0,leadPage - 1));
    if (action === 'lead-next') loadLeadPage(leadPage + 1);
    if (action === 'edit-contact') openContactEditor(control.dataset.contactId);
    if (action === 'close-contact') closeContactEditor();
  },true);

  document.addEventListener('click',(event) => {
    const tab = event.target.closest('[data-m1-project-tab]');
    if (!tab) return;
    event.preventDefault();
    showProjectTab(tab.dataset.m1ProjectTab);
  });

  document.addEventListener('keydown',(event) => {
    if (event.key === 'Enter' && event.target?.id === 'v8-lead-search' && $('#view-root .ak-runtime-lead-tools')) {
      event.preventDefault(); loadLeadPage(0);
    }
    if (event.key === 'Escape' && $('#m1-contact-editor')) closeContactEditor();
  });

  const observer = new MutationObserver(() => {
    enhanceRuntimeLeads();
    upgradeProjectModal();
  });
  observer.observe(document.documentElement,{ childList:true, subtree:true });
  window.addEventListener('load',() => setTimeout(() => { enhanceRuntimeLeads(); upgradeProjectModal(); },0));
  enhanceRuntimeLeads();
})();
