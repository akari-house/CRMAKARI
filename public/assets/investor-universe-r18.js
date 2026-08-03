(() => {
  'use strict';

  const state = { payload:null, tab:'organisations', search:'', selectedOrganisation:null, loading:false, scheduled:false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const money = (value, currency = 'USD') => {
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency, maximumFractionDigits:0 }).format(Number(value || 0)); }
    catch { return `${Number(value || 0).toLocaleString()} ${currency}`; }
  };

  function isFundraisingRoute() {
    const path = String(location.pathname || '').replace(/\/+$/, '');
    return path.endsWith('/fundraising') || path === '/fundraising' || $('#view-root .page-head h1')?.textContent?.trim() === 'Fundraising';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials:'same-origin',
      cache:'no-store',
      ...options,
      headers:{ 'content-type':'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message, tone = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function modalRoot() {
    let root = $('#investor-universe-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'investor-universe-modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function statusChip(value, kind = '') {
    const normalized = String(value || 'UNKNOWN').toUpperCase();
    const tone = ['VERIFIED','NONE','ACTIVE','READY','COMMITTED'].includes(normalized) ? 'positive'
      : ['DISPUTED','CONFIRMED','PROHIBITED','BLOCKED'].includes(normalized) ? 'danger'
      : ['POSSIBLE','STALE','UNKNOWN','ASSERTED'].includes(normalized) ? 'warning' : 'neutral';
    return `<span class="iu18-chip iu18-chip--${tone}" data-kind="${esc(kind)}">${esc(title(normalized))}</span>`;
  }

  function evidenceProgress(item) {
    const total = Number(item.claim_count || 0);
    const verified = Number(item.verified_claim_count || 0);
    const percentage = total ? Math.round(verified / total * 100) : 0;
    return `<div class="iu18-evidence-progress" title="${verified} of ${total} claims verified"><span style="--iu18-progress:${percentage}%"></span><small>${verified}/${total} verified</small></div>`;
  }

  function summaryCards(summary = {}) {
    return `<div class="iu18-summary">
      <article><span>Investor organisations</span><strong>${Number(summary.organisations || 0)}</strong><small>${Number(summary.duplicateCandidates || 0)} duplicate candidates</small></article>
      <article><span>Decision makers</span><strong>${Number(summary.decisionMakers || 0)}</strong><small>${Number(summary.people || 0)} investor people</small></article>
      <article><span>Evidence ledger</span><strong>${Number(summary.verifiedClaims || 0)}</strong><small>${Number(summary.claims || 0)} total claims · ${Number(summary.verifiedSources || 0)} verified sources</small></article>
      <article><span>Review queue</span><strong>${Number(summary.reviewItems || 0)}</strong><small>${Number(summary.possibleConflicts || 0)} possible conflicts</small></article>
    </div>`;
  }

  function compatibilityBanner(payload) {
    if (!payload.migrationRequired) return '';
    return `<div class="iu18-banner iu18-banner--migration">
      <div><strong>Investor Universe is in compatibility mode</strong><p>Existing Capital Room investors are visible, but evidence-backed writes remain read-only until migration 0002 is applied after backup and preview verification.</p></div>
      <span>LEGACY COMPATIBILITY</span>
    </div>`;
  }

  function actions(payload) {
    if (!payload.permissions?.canWrite || payload.readOnly) return '';
    return `<div class="iu18-actions">
      <button type="button" data-iu18-action="new-organisation">+ Investor</button>
      <button type="button" data-iu18-action="new-person">+ Person</button>
      <button type="button" data-iu18-action="new-evidence">+ Evidence</button>
      <button type="button" data-iu18-action="new-portfolio">+ Portfolio</button>
    </div>`;
  }

  function tabButton(tab, label, count) {
    return `<button type="button" class="${state.tab === tab ? 'is-active' : ''}" data-iu18-tab="${tab}"><span>${esc(label)}</span><b>${Number(count || 0)}</b></button>`;
  }

  function filtered(items, fields) {
    const query = state.search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => fields.some((field) => String(item[field] || '').toLowerCase().includes(query)));
  }

  function organisationTargetSummary(organisationId) {
    const targets = (state.payload?.targets || []).filter((item) => item.organisation_id === organisationId);
    if (!targets.length) return '<span class="iu18-muted">Not targeted in a normalized round</span>';
    const best = [...targets].sort((a, b) => Number(b.fit_score || 0) - Number(a.fit_score || 0))[0];
    return `<div class="iu18-target-summary"><strong>Fit ${Math.round(Number(best.fit_score || 0))}</strong><span>${esc(best.project_name || '')} · ${esc(best.round_name || '')} · ${esc(title(best.stage))}</span></div>`;
  }

  function organisationsView(payload) {
    const items = filtered(payload.organisations || [], ['name','investor_type','website','headquarters','current_fund']);
    if (!items.length) return '<div class="iu18-empty"><strong>No investor organisations found</strong><p>Add a fund, angel, corporate VC or other capital provider to begin the evidence ledger.</p></div>';
    return `<div class="iu18-organisation-list">${items.map((item) => `<article data-iu18-organisation="${esc(item.id)}">
      <div class="iu18-org-main">
        <div class="iu18-avatar">${esc(String(item.name || '?').slice(0, 2).toUpperCase())}</div>
        <div><div class="iu18-title-row"><h3>${esc(item.name)}</h3>${statusChip(item.investor_type)}</div><p>${esc(item.headquarters || 'Headquarters unknown')}${item.current_fund ? ` · ${esc(item.current_fund)}` : ''}</p><div class="iu18-meta"><span>${Number(item.people_count || 0)} people</span><span>${Number(item.portfolio_count || 0)} portfolio records</span><span>${Number(item.target_count || 0)} round targets</span></div></div>
      </div>
      <div class="iu18-org-evidence">${evidenceProgress(item)}${statusChip(item.conflict_status, 'conflict')}</div>
      <div class="iu18-org-fit">${organisationTargetSummary(item.id)}</div>
      <div class="iu18-row-actions"><button type="button" data-iu18-action="open-organisation" data-id="${esc(item.id)}">Open profile</button>${payload.permissions?.canWrite && !payload.readOnly ? `<button type="button" data-iu18-action="edit-organisation" data-id="${esc(item.id)}">Edit</button>` : ''}</div>
    </article>`).join('')}</div>`;
  }

  function peopleView(payload) {
    const items = filtered(payload.people || [], ['full_name','title','organisation_name','city']);
    if (!items.length) return '<div class="iu18-empty"><strong>No investor people found</strong><p>Add partners, principals, analysts and other decision-makers.</p></div>';
    return `<div class="iu18-people-grid">${items.map((item) => `<article>
      <header><div class="iu18-avatar iu18-avatar--person">${esc(String(item.full_name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0,2).toUpperCase())}</div><div><h3>${esc(item.full_name)}</h3><p>${esc(item.title || 'Role not recorded')}</p></div>${Number(item.is_decision_maker) === 1 ? '<span class="iu18-decision">Decision maker</span>' : ''}</header>
      <div class="iu18-person-org"><span>Organisation</span><strong>${esc(item.organisation_name || 'Independent / unknown')}</strong></div>
      <div class="iu18-contact-list">${(item.contacts || []).length ? item.contacts.slice(0,4).map((contact) => `<span><b>${esc(title(contact.kind))}</b>${contact.visibility === 'PRIVATE' ? 'Private contact recorded' : esc(contact.value)}</span>`).join('') : '<span class="iu18-muted">No contact method recorded</span>'}</div>
      ${payload.permissions?.canWrite && !payload.readOnly ? `<footer><button type="button" data-iu18-action="edit-person" data-id="${esc(item.id)}">Edit person</button><button type="button" data-iu18-action="new-contact" data-person-id="${esc(item.id)}">Add contact</button></footer>` : ''}
    </article>`).join('')}</div>`;
  }

  function evidenceView(payload) {
    const sources = filtered(payload.sources || [], ['title','publisher','canonical_url','source_type']);
    const claims = filtered(payload.claims || [], ['field','source_title','source_publisher','status']);
    return `<div class="iu18-evidence-layout">
      <section><header><div><span class="iu18-eyebrow">SOURCE REGISTER</span><h3>Evidence sources</h3></div><b>${sources.length}</b></header>${sources.length ? `<div class="iu18-source-list">${sources.map((item) => `<article><div><h4>${esc(item.title || item.publisher || 'Untitled source')}</h4><a href="${esc(item.canonical_url)}" target="_blank" rel="noopener noreferrer">${esc(item.publisher || item.canonical_url)}</a><p>${esc(item.source_type || 'OTHER')} · observed ${esc(String(item.observed_at || '').slice(0,10) || 'date unknown')}</p></div><div>${statusChip(item.confidence_status)}${statusChip(item.redistribution_status)}</div></article>`).join('')}</div>` : '<div class="iu18-empty small"><p>No evidence sources recorded.</p></div>'}</section>
      <section><header><div><span class="iu18-eyebrow">CLAIM LEDGER</span><h3>Investor claims</h3></div><b>${claims.length}</b></header>${claims.length ? `<div class="iu18-claim-list">${claims.map((item) => `<article><div><span>${esc(title(item.field))}</span><strong>${esc(typeof item.value === 'string' ? item.value : JSON.stringify(item.value))}</strong><small>${esc(item.source_title || item.source_publisher || 'No linked source')}</small></div><div>${statusChip(item.status)}<em>${item.confidence === null || item.confidence === undefined ? 'Confidence unset' : `${Math.round(Number(item.confidence) * 100)}% confidence`}</em></div></article>`).join('')}</div>` : '<div class="iu18-empty small"><p>No investor claims recorded.</p></div>'}</section>
    </div>`;
  }

  function reviewView(payload) {
    const queue = filtered(payload.reviewQueue || [], ['label','kind','status']);
    const duplicates = payload.duplicates || [];
    return `<div class="iu18-review-layout">
      <section><header><div><span class="iu18-eyebrow">EVIDENCE & CONFLICTS</span><h3>Review queue</h3></div><b>${queue.length}</b></header>${queue.length ? `<div class="iu18-review-list">${queue.map((item) => `<article><div><span>${esc(title(item.kind))}</span><h4>${esc(item.label)}</h4><p>${(item.reasons || []).map(esc).join(' · ')}</p></div><div>${statusChip(item.status)}${reviewActions(item, payload)}</div></article>`).join('')}</div>` : '<div class="iu18-empty small"><p>No evidence or conflict items require review.</p></div>'}</section>
      <section><header><div><span class="iu18-eyebrow">DUPLICATE CONTROL</span><h3>Merge review candidates</h3></div><b>${duplicates.length}</b></header>${duplicates.length ? `<div class="iu18-duplicate-list">${duplicates.map((item) => `<article><div><strong>${esc(item.left.name)}</strong><span>⇄</span><strong>${esc(item.right.name)}</strong></div><p>${esc(item.reason)} · ${Number(item.score)}% similarity</p><small>Review only. No automated merge is performed.</small></article>`).join('')}</div>` : '<div class="iu18-empty small"><p>No likely duplicate organisations detected.</p></div>'}</section>
    </div>`;
  }

  function reviewActions(item, payload) {
    if (!payload.permissions?.canReview || payload.readOnly) return '';
    if (item.kind === 'SOURCE') return `<button type="button" data-iu18-action="review-source" data-id="${esc(item.entityId)}">Review source</button>`;
    if (item.kind === 'CLAIM') return `<button type="button" data-iu18-action="review-claim" data-id="${esc(item.entityId)}">Review claim</button>`;
    if (item.kind === 'CONFLICT') return `<button type="button" data-iu18-action="review-conflict" data-id="${esc(item.entityId)}">Resolve conflict</button>`;
    return '';
  }

  function view(payload) {
    if (state.tab === 'people') return peopleView(payload);
    if (state.tab === 'evidence') return evidenceView(payload);
    if (state.tab === 'review') return reviewView(payload);
    return organisationsView(payload);
  }

  function render(root) {
    const payload = state.payload;
    if (!payload) return;
    root.innerHTML = `<section class="iu18-shell" aria-labelledby="iu18-title">
      <header class="iu18-header">
        <div><span class="iu18-eyebrow">FUNDRAISING OS 2.0</span><h2 id="iu18-title">Investor Universe</h2><p>Evidence-backed investor organisations, decision-makers, portfolio signals, conflicts and round-specific fit.</p></div>
        <div class="iu18-mode"><span>${esc(payload.storageMode === 'NORMALIZED_D1' ? 'NORMALIZED D1' : 'COMPATIBILITY')}</span><strong>${payload.readOnly ? 'Read only' : 'Operational'}</strong></div>
      </header>
      ${compatibilityBanner(payload)}
      ${summaryCards(payload.summary)}
      <div class="iu18-command">
        <nav aria-label="Investor Universe views">
          ${tabButton('organisations','Organisations',payload.summary?.organisations)}
          ${tabButton('people','People',payload.summary?.people)}
          ${tabButton('evidence','Evidence',payload.summary?.claims)}
          ${tabButton('review','Review queue',payload.summary?.reviewItems)}
        </nav>
        <label class="iu18-search"><span>⌕</span><input type="search" data-iu18-search placeholder="Search this view…" value="${esc(state.search)}"></label>
        ${actions(payload)}
      </div>
      <div class="iu18-view" data-iu18-view>${view(payload)}</div>
    </section>`;
  }

  function loading(root) {
    root.innerHTML = '<section class="iu18-shell iu18-loading"><i></i><strong>Loading Investor Universe…</strong><span>Resolving investor identities and evidence</span></section>';
  }

  function failed(root, message) {
    root.innerHTML = `<section class="iu18-shell iu18-error"><strong>Investor Universe could not be loaded</strong><p>${esc(message)}</p><button type="button" data-iu18-action="refresh">Try again</button></section>`;
  }

  async function load(root, force = false) {
    if (state.loading) return;
    if (state.payload && !force) { render(root); return; }
    state.loading = true;
    loading(root);
    try {
      state.payload = await api('/api/fundraising/universe');
      if (isFundraisingRoute()) render(root);
    } catch (cause) {
      failed(root, cause.message || 'Unknown error');
    } finally {
      state.loading = false;
    }
  }

  function options(items, value, labelKey = 'name') {
    return items.map((item) => `<option value="${esc(item.id)}" ${item.id === value ? 'selected' : ''}>${esc(item[labelKey] || item.name || item.full_name || item.id)}</option>`).join('');
  }

  function formShell(titleText, description, body, submitLabel = 'Save') {
    modalRoot().innerHTML = `<div class="iu18-backdrop" data-iu18-action="close-modal"><section class="iu18-modal" role="dialog" aria-modal="true" aria-label="${esc(titleText)}"><header><div><span class="iu18-eyebrow">INVESTOR UNIVERSE</span><h2>${esc(titleText)}</h2><p>${esc(description)}</p></div><button type="button" data-iu18-action="close-modal" aria-label="Close">×</button></header><form data-iu18-form><div class="iu18-form-grid">${body}</div><footer><button type="button" data-iu18-action="close-modal">Cancel</button><button type="submit">${esc(submitLabel)}</button></footer></form></section></div>`;
    return $('[data-iu18-form]', modalRoot());
  }

  function inputField(label, name, value = '', type = 'text', attributes = '') {
    return `<label><span>${esc(label)}</span><input type="${esc(type)}" name="${esc(name)}" value="${esc(value)}" ${attributes}></label>`;
  }

  function selectField(label, name, values, selected = '') {
    return `<label><span>${esc(label)}</span><select name="${esc(name)}">${values.map((value) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(title(value))}</option>`).join('')}</select></label>`;
  }

  function textareaField(label, name, value = '', full = true) {
    return `<label class="${full ? 'full' : ''}"><span>${esc(label)}</span><textarea name="${esc(name)}">${esc(value)}</textarea></label>`;
  }

  function bindSubmit(form, action, transform = (payload) => payload, success = 'Investor Universe updated') {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      const raw = Object.fromEntries(new FormData(form).entries());
      const body = transform({ action, ...raw }, form);
      try {
        await api('/api/fundraising/universe', { method:'POST', body:JSON.stringify(body) });
        modalRoot().innerHTML = '';
        notify(success);
        const root = $('#investor-universe-root');
        state.payload = null;
        await load(root, true);
      } catch (cause) {
        notify(cause.message || 'Investor Universe could not be updated', 'error');
        button.disabled = false;
      }
    });
  }

  function organisationForm(item = {}) {
    const form = formShell(item.id ? 'Edit investor organisation' : 'Add investor organisation', 'Create one canonical investor identity. Similar names and duplicate domains are reviewed before merge.', `
      ${inputField('Organisation name *','name',item.name || '', 'text', 'required maxlength="500"')}
      ${selectField('Investor type','investorType',['VC','FUND','ANGEL','CORPORATE_VC','FAMILY_OFFICE','ACCELERATOR','DAO','SYNDICATE','OTHER'],item.investor_type || 'OTHER')}
      ${inputField('Website','website',item.website || '', 'url', 'placeholder="https://…"')}
      ${inputField('Headquarters','headquarters',item.headquarters || '')}
      ${inputField('Current fund','currentFund',item.current_fund || '')}
      ${inputField('Minimum cheque','minimumCheck',item.minimum_check ?? '', 'number', 'min="0"')}
      ${inputField('Maximum cheque','maximumCheck',item.maximum_check ?? '', 'number', 'min="0"')}
      ${inputField('Typical cheque','typicalCheck',item.typical_check ?? '', 'number', 'min="0"')}
      ${inputField('Lead behaviour','leadBehavior',item.lead_behavior || '', 'text', 'placeholder="Lead, co-lead, follow"')}
      ${selectField('Conflict status','conflictStatus',['UNKNOWN','NONE','POSSIBLE','CONFIRMED'],item.conflict_status || 'UNKNOWN')}
      ${textareaField('Description','description',item.description || '')}
      <input type="hidden" name="id" value="${esc(item.id || '')}">
    `, 'Save organisation');
    bindSubmit(form, 'upsert-organisation', (body) => ({ ...body, minimumCheck:body.minimumCheck === '' ? '' : Number(body.minimumCheck), maximumCheck:body.maximumCheck === '' ? '' : Number(body.maximumCheck), typicalCheck:body.typicalCheck === '' ? '' : Number(body.typicalCheck) }), item.id ? 'Investor organisation updated' : 'Investor organisation created');
  }

  function personForm(item = {}) {
    const organisations = state.payload?.organisations || [];
    const form = formShell(item.id ? 'Edit investor person' : 'Add investor person', 'Link a partner, principal, analyst or angel to one canonical investor organisation.', `
      <label class="full"><span>Investor organisation</span><select name="organisationId"><option value="">Independent / unknown</option>${options(organisations,item.organisation_id)}</select></label>
      ${inputField('Full name *','fullName',item.full_name || '', 'text', 'required maxlength="500"')}
      ${inputField('Title','title',item.title || '')}
      ${inputField('City','city',item.city || '')}
      <label class="iu18-check full"><input type="checkbox" name="isDecisionMaker" value="1" ${Number(item.is_decision_maker) === 1 ? 'checked' : ''}><span></span><b>Decision-maker for fundraising outreach</b></label>
      ${textareaField('Bio / internal context','bio',item.bio || '')}
      <input type="hidden" name="id" value="${esc(item.id || '')}">
    `, 'Save person');
    bindSubmit(form, 'upsert-person', (body, currentForm) => ({ ...body, isDecisionMaker:Boolean(currentForm.elements.isDecisionMaker.checked) }), item.id ? 'Investor person updated' : 'Investor person created');
  }

  function contactForm(personId) {
    const sources = state.payload?.sources || [];
    const form = formShell('Add contact method', 'Contact identities remain private by default. Emails are canonical inside the tenant.', `
      ${selectField('Contact kind','kind',['WORK_EMAIL','PERSONAL_EMAIL','PHONE','LINKEDIN','X','TELEGRAM','WEBSITE','OTHER'],'WORK_EMAIL')}
      ${inputField('Contact value *','value','', 'text', 'required')}
      ${inputField('Label','label','')}
      <label><span>Evidence source</span><select name="sourceId"><option value="">No source linked</option>${options(sources,'','title')}</select></label>
      ${selectField('Visibility','visibility',['PRIVATE','PUBLIC'],'PRIVATE')}
      <label class="iu18-check"><input type="checkbox" name="isPrimary" value="1"><span></span><b>Primary for this channel</b></label>
      <input type="hidden" name="personId" value="${esc(personId)}">
    `, 'Save contact');
    bindSubmit(form, 'upsert-contact', (body, currentForm) => ({ ...body, isPrimary:Boolean(currentForm.elements.isPrimary.checked) }), 'Investor contact added');
  }

  function evidenceForm() {
    const organisations = state.payload?.organisations || [];
    const form = formShell('Add evidence-backed investor claim', 'Record the source first, then attach one specific claim to an investor organisation.', `
      <div class="iu18-form-section full"><strong>Source</strong><small>Public facts require a canonical HTTPS source and rights review.</small></div>
      ${inputField('Source URL *','canonicalUrl','', 'url', 'required placeholder="https://…"')}
      ${inputField('Source title','sourceTitle','')}
      ${inputField('Publisher','publisher','')}
      ${inputField('Source type','sourceType','OTHER')}
      ${selectField('Source status','confidenceStatus',['ASSERTED','VERIFIED','STALE','DISPUTED'],'ASSERTED')}
      ${selectField('Redistribution','redistributionStatus',['UNKNOWN','ALLOWED','ATTRIBUTION_REQUIRED','PROHIBITED'],'UNKNOWN')}
      <div class="iu18-form-section full"><strong>Claim</strong><small>Missing evidence remains unknown and should not be converted into a negative claim.</small></div>
      <label><span>Investor organisation *</span><select name="entityId" required><option value="">Select investor</option>${options(organisations,'')}</select></label>
      ${inputField('Claim field *','field','', 'text', 'required placeholder="investment_stages, sectors, geographies…"')}
      ${textareaField('Claim value *','claimValue','')}
      ${inputField('Confidence 0–1','confidence','0.5', 'number', 'min="0" max="1" step="0.05"')}
      ${selectField('Claim status','claimStatus',['ASSERTED','VERIFIED','STALE','DISPUTED'],'ASSERTED')}
    `, 'Save evidence');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const source = await api('/api/fundraising/universe', { method:'POST', body:JSON.stringify({ action:'upsert-source', canonicalUrl:data.canonicalUrl, title:data.sourceTitle, publisher:data.publisher, sourceType:data.sourceType, confidenceStatus:data.confidenceStatus, redistributionStatus:data.redistributionStatus }) });
        let parsedValue = data.claimValue;
        try { parsedValue = JSON.parse(data.claimValue); } catch { /* keep plain text */ }
        await api('/api/fundraising/universe', { method:'POST', body:JSON.stringify({ action:'upsert-claim', entityType:'ORGANISATION', entityId:data.entityId, field:data.field, value:parsedValue, sourceId:source.item.id, confidence:Number(data.confidence || 0.5), status:data.claimStatus, visibility:'PRIVATE' }) });
        modalRoot().innerHTML = '';
        notify('Investor evidence added');
        state.payload = null;
        await load($('#investor-universe-root'), true);
      } catch (cause) {
        notify(cause.message || 'Investor evidence could not be saved', 'error');
        button.disabled = false;
      }
    });
  }

  function portfolioForm() {
    const organisations = state.payload?.organisations || [];
    const sources = state.payload?.sources || [];
    const form = formShell('Add portfolio evidence', 'Portfolio examples support relevance and conflict review only when linked to evidence.', `
      <label class="full"><span>Investor organisation *</span><select name="organisationId" required><option value="">Select investor</option>${options(organisations,'')}</select></label>
      ${inputField('Portfolio company *','companyName','', 'text', 'required')}
      ${inputField('Round / relationship','roundName','')}
      ${inputField('Sector','sector','')}
      ${inputField('Announced date','announcedAt','', 'date')}
      <label><span>Evidence source</span><select name="sourceId"><option value="">No source linked</option>${options(sources,'','title')}</select></label>
      ${selectField('Evidence status','confidenceStatus',['ASSERTED','VERIFIED','STALE','DISPUTED'],'ASSERTED')}
      ${textareaField('Internal notes','notes','')}
    `, 'Save portfolio evidence');
    bindSubmit(form, 'upsert-portfolio', (body) => body, 'Portfolio evidence added');
  }

  function organisationProfile(id) {
    const organisation = (state.payload?.organisations || []).find((item) => item.id === id);
    if (!organisation) return;
    state.selectedOrganisation = organisation;
    const people = (state.payload.people || []).filter((item) => item.organisation_id === id);
    const claims = (state.payload.claims || []).filter((item) => item.entity_type === 'ORGANISATION' && item.entity_id === id);
    const portfolio = (state.payload.portfolio || []).filter((item) => item.organisation_id === id);
    const targets = (state.payload.targets || []).filter((item) => item.organisation_id === id);
    modalRoot().innerHTML = `<div class="iu18-backdrop" data-iu18-action="close-modal"><section class="iu18-modal iu18-profile" role="dialog" aria-modal="true" aria-label="Investor profile"><header><div><span class="iu18-eyebrow">INVESTOR PROFILE</span><h2>${esc(organisation.name)}</h2><p>${esc(title(organisation.investor_type))} · ${esc(organisation.headquarters || 'Location unknown')}</p></div><button type="button" data-iu18-action="close-modal">×</button></header><div class="iu18-profile-body">
      <div class="iu18-profile-kpis"><article><span>People</span><strong>${people.length}</strong></article><article><span>Verified claims</span><strong>${claims.filter((item) => item.status === 'VERIFIED').length}/${claims.length}</strong></article><article><span>Portfolio evidence</span><strong>${portfolio.length}</strong></article><article><span>Best fit</span><strong>${targets.length ? Math.max(...targets.map((item) => Number(item.fit_score || 0))) : 0}</strong></article></div>
      <section><h3>Organisation intelligence</h3><dl><div><dt>Website</dt><dd>${organisation.website ? `<a href="${esc(organisation.website)}" target="_blank" rel="noopener noreferrer">${esc(organisation.website)}</a>` : 'Unknown'}</dd></div><div><dt>Current fund</dt><dd>${esc(organisation.current_fund || 'Unknown')}</dd></div><div><dt>Published cheque range</dt><dd>${organisation.minimum_check || organisation.maximum_check ? `${money(organisation.minimum_check || 0)} – ${money(organisation.maximum_check || 0)}` : 'No evidence recorded'}</dd></div><div><dt>Conflict status</dt><dd>${statusChip(organisation.conflict_status)}</dd></div></dl></section>
      <section><h3>People</h3>${people.length ? people.map((item) => `<div class="iu18-profile-line"><strong>${esc(item.full_name)}</strong><span>${esc(item.title || '')}${Number(item.is_decision_maker) === 1 ? ' · Decision maker' : ''}</span></div>`).join('') : '<p class="iu18-muted">No people recorded.</p>'}</section>
      <section><h3>Evidence claims</h3>${claims.length ? claims.map((item) => `<div class="iu18-profile-line"><strong>${esc(title(item.field))}</strong><span>${esc(typeof item.value === 'string' ? item.value : JSON.stringify(item.value))} · ${esc(title(item.status))}</span></div>`).join('') : '<p class="iu18-muted">No evidence claims recorded.</p>'}</section>
      <section><h3>Round-specific fit</h3>${targets.length ? targets.map((item) => `<div class="iu18-fit-card"><header><strong>${esc(item.project_name)} · ${esc(item.round_name)}</strong><b>${Math.round(Number(item.fit_score || 0))}</b></header><p>${(item.fit_reasons || []).map(esc).join(' · ') || 'No positive fit reasons have been evidenced.'}</p><small>${(item.fit_warnings || []).map(esc).join(' · ')}</small></div>`).join('') : '<p class="iu18-muted">Not currently targeted in a normalized round.</p>'}</section>
    </div><footer><button type="button" data-iu18-action="close-modal">Close</button>${state.payload.permissions?.canWrite && !state.payload.readOnly ? `<button type="button" data-iu18-action="edit-organisation" data-id="${esc(id)}">Edit organisation</button>` : ''}</footer></section></div>`;
  }

  function reviewSourceForm(id) {
    const item = (state.payload?.sources || []).find((source) => source.id === id);
    if (!item) return;
    const form = formShell('Review evidence source', 'Confirm confidence and redistribution rights before relying on or exporting source-derived claims.', `
      <div class="iu18-review-context full"><strong>${esc(item.title || item.canonical_url)}</strong><a href="${esc(item.canonical_url)}" target="_blank" rel="noopener noreferrer">Open source</a></div>
      ${selectField('Confidence status','confidenceStatus',['ASSERTED','VERIFIED','STALE','DISPUTED'],item.confidence_status)}
      ${selectField('Redistribution status','redistributionStatus',['UNKNOWN','ALLOWED','ATTRIBUTION_REQUIRED','PROHIBITED'],item.redistribution_status)}
      <input type="hidden" name="id" value="${esc(id)}">
    `, 'Record source review');
    bindSubmit(form, 'review-source', (body) => body, 'Evidence source reviewed');
  }

  function reviewClaimForm(id) {
    const item = (state.payload?.claims || []).find((claim) => claim.id === id);
    if (!item) return;
    const form = formShell('Review investor claim', 'Verify, stale or dispute the claim. Unknown information should remain unknown.', `
      <div class="iu18-review-context full"><strong>${esc(title(item.field))}</strong><span>${esc(typeof item.value === 'string' ? item.value : JSON.stringify(item.value))}</span></div>
      ${selectField('Claim status','status',['ASSERTED','VERIFIED','STALE','DISPUTED'],item.status)}
      ${inputField('Confidence 0–1','confidence',item.confidence ?? '0.5','number','min="0" max="1" step="0.05"')}
      <input type="hidden" name="id" value="${esc(id)}">
    `, 'Record claim review');
    bindSubmit(form, 'review-claim', (body) => ({ ...body, confidence:Number(body.confidence || 0) }), 'Investor claim reviewed');
  }

  function conflictForm(id) {
    const item = (state.payload?.organisations || []).find((organisation) => organisation.id === id);
    if (!item) return;
    const form = formShell('Resolve portfolio conflict', 'A final none/confirmed decision requires an explicit review note and is audit logged.', `
      <div class="iu18-review-context full"><strong>${esc(item.name)}</strong><span>Current status: ${esc(title(item.conflict_status))}</span></div>
      ${selectField('Conflict status','conflictStatus',['UNKNOWN','NONE','POSSIBLE','CONFIRMED'],item.conflict_status)}
      ${textareaField('Review note *','note','')}
      <input type="hidden" name="id" value="${esc(id)}">
    `, 'Save conflict decision');
    bindSubmit(form, 'set-conflict', (body) => body, 'Portfolio conflict reviewed');
  }

  function bindRoot(root) {
    root.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-iu18-tab]');
      if (tab) {
        state.tab = tab.dataset.iu18Tab;
        render(root);
        return;
      }
      const action = event.target.closest('[data-iu18-action]');
      if (!action) return;
      handleAction(action.dataset.iu18Action, action.dataset, root);
    });
    root.addEventListener('input', (event) => {
      if (!event.target.matches('[data-iu18-search]')) return;
      state.search = event.target.value;
      const viewRoot = $('[data-iu18-view]', root);
      if (viewRoot) viewRoot.innerHTML = view(state.payload);
    });
  }

  function handleAction(action, data, root) {
    if (action === 'refresh') { state.payload = null; load(root, true); }
    if (action === 'new-organisation') organisationForm();
    if (action === 'edit-organisation') organisationForm((state.payload.organisations || []).find((item) => item.id === data.id) || {});
    if (action === 'open-organisation') organisationProfile(data.id);
    if (action === 'new-person') personForm();
    if (action === 'edit-person') personForm((state.payload.people || []).find((item) => item.id === data.id) || {});
    if (action === 'new-contact') contactForm(data.personId);
    if (action === 'new-evidence') evidenceForm();
    if (action === 'new-portfolio') portfolioForm();
    if (action === 'review-source') reviewSourceForm(data.id);
    if (action === 'review-claim') reviewClaimForm(data.id);
    if (action === 'review-conflict') conflictForm(data.id);
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('#investor-universe-modal-root [data-iu18-action]');
    if (!action) return;
    if (action.dataset.iu18Action === 'close-modal') {
      if (event.target === action || action.tagName === 'BUTTON') modalRoot().innerHTML = '';
      return;
    }
    handleAction(action.dataset.iu18Action, action.dataset, $('#investor-universe-root'));
  }, true);

  function mount() {
    state.scheduled = false;
    if (!isFundraisingRoute()) return;
    const viewRoot = $('#view-root');
    if (!viewRoot) return;
    let root = $('#investor-universe-root', viewRoot);
    if (!root) {
      root = document.createElement('div');
      root.id = 'investor-universe-root';
      root.dataset.investorUniverse = 'r18';
      const capital = $('#capital-room-command-centre', viewRoot);
      if (capital) capital.insertAdjacentElement('beforebegin', root);
      else $('.page-head', viewRoot)?.insertAdjacentElement('afterend', root);
      bindRoot(root);
    }
    if (root.dataset.iu18Loaded === 'true') return;
    root.dataset.iu18Loaded = 'true';
    load(root);
  }

  function scheduleMount() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(mount);
  }

  new MutationObserver(scheduleMount).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', scheduleMount);
  document.addEventListener('akari:route-rendered', scheduleMount);
  window.addEventListener('popstate', scheduleMount);
  scheduleMount();
})();
