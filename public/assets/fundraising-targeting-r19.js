(() => {
  'use strict';

  const state = { payload:null, roundId:'', list:'overdueFollowUps', loading:false, scheduled:false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const money = (value, currency = 'USD') => {
    try { return new Intl.NumberFormat('en-US', { style:'currency', currency, maximumFractionDigits:0 }).format(Number(value || 0)); }
    catch { return `${Number(value || 0).toLocaleString()} ${currency}`; }
  };
  const dateLabel = (value) => {
    if (!value) return 'Not scheduled';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', year:'numeric' }).format(date);
  };

  function isFundraisingRoute() {
    const path = String(location.pathname || '').replace(/\/+$/, '');
    return path.endsWith('/fundraising') || path === '/fundraising';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials:'same-origin', cache:'no-store', ...options,
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
    let root = $('#fundraising-targeting-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'fundraising-targeting-modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function currentRound() {
    const rounds = state.payload?.rounds || [];
    if (!state.roundId && rounds.length) state.roundId = rounds[0].id;
    return rounds.find((round) => round.id === state.roundId) || rounds[0] || null;
  }

  function chip(value, tone) {
    const normalized = String(value || 'UNKNOWN').toUpperCase();
    const resolved = tone || (['VERIFIED','GRANTED','COMPLETED','COMMITTED'].includes(normalized) ? 'positive'
      : ['DECLINED','REVOKED','REJECTED','PASSED'].includes(normalized) ? 'danger'
      : ['REQUESTED','RESEARCHING','POSSIBLE','STALE','NOT_NOW'].includes(normalized) ? 'warning' : 'neutral');
    return `<span class="ft19-chip ft19-chip--${resolved}">${esc(title(normalized))}</span>`;
  }

  function compatibilityBanner(payload) {
    if (!payload.migrationRequired) return '';
    return `<div class="ft19-banner"><div><strong>Targeting is visible in compatibility mode</strong><p>Existing Capital Room targets are preserved. Warm-path verification, consent and normalized writes remain disabled until migration 0002 is applied after backup and preview validation.</p></div><span>READ ONLY</span></div>`;
  }

  function summary(payload) {
    const data = payload.summary || {};
    return `<div class="ft19-summary">
      <article><span>Investor targets</span><strong>${Number(data.targets || 0)}</strong><small>${Number(data.rounds || 0)} active round records</small></article>
      <article><span>Expected pipeline</span><strong>${money(data.expectedPipeline || 0)}</strong><small>Private expected cheques, not published investor claims</small></article>
      <article><span>Warm paths</span><strong>${Number(data.verifiedPaths || 0)}/${Number(data.warmPaths || 0)}</strong><small>${Number(data.consentGranted || 0)} paths with granted consent</small></article>
      <article><span>Overdue follow-ups</span><strong>${Number(data.overdueFollowUps || 0)}</strong><small>${money(data.softCircle || 0)} soft-circled or committed</small></article>
    </div>`;
  }

  function roundControls(payload) {
    const rounds = payload.rounds || [];
    return `<div class="ft19-controls">
      <label><span>Fundraising round</span><select data-ft19-round>${rounds.map((round) => `<option value="${esc(round.id)}" ${round.id === state.roundId ? 'selected' : ''}>${esc(round.project_name)} · ${esc(round.round_name)}</option>`).join('')}</select></label>
      ${currentRound() ? `<div class="ft19-round-economics"><span>Target <b>${money(currentRound().target_amount,currentRound().currency)}</b></span><span>Expected <b>${money(currentRound().expectedChecks?.researched,currentRound().currency)}</b></span><span>Soft circle <b>${money(currentRound().expectedChecks?.softCircle,currentRound().currency)}</b></span></div>` : ''}
    </div>`;
  }

  const BOARD_STAGES = ['RESEARCHING','READY','INTRO_REQUESTED','CONTACTED','MEETING','DILIGENCE','PARTNER_MEETING','SOFT_CIRCLE','COMMITTED','PASSED','NOT_NOW'];

  function pathSummary(target) {
    const paths = target.introduction_paths || [];
    if (!paths.length) return '<span class="ft19-path-none">No warm path verified</span>';
    const best = [...paths].sort((a,b) => {
      const score = (item) => (item.verification_status === 'VERIFIED' ? 20 : 0) + (item.consent_status === 'GRANTED' ? 10 : 0) + (item.relationship_strength === 'STRONG' ? 5 : item.relationship_strength === 'MEDIUM' ? 3 : 0);
      return score(b) - score(a);
    })[0];
    return `<div class="ft19-path"><strong>${esc(best.connector_contact_name || best.connector_name || 'Connector')}</strong><span>${chip(best.verification_status)}${chip(best.consent_status)}${chip(best.request_status)}</span></div>`;
  }

  function targetCard(target, round, payload) {
    const overdue = target.next_follow_up_at && new Date(target.next_follow_up_at) < new Date() && !['COMMITTED','PASSED'].includes(target.stage);
    return `<article class="ft19-card ${overdue ? 'is-overdue' : ''}" data-ft19-target="${esc(target.id)}">
      <header><div><h4>${esc(target.organisation_name)}</h4><span>${esc(target.primary_person_name || 'Decision-maker not selected')}</span></div><b>${Math.round(Number(target.fit_score || 0))}</b></header>
      <div class="ft19-card-metrics"><span>Expected <strong>${target.expected_check === null || target.expected_check === undefined ? 'Unset' : money(target.expected_check,round.currency)}</strong></span><span>Probability <strong>${Math.round(Number(target.probability_percentage || 0))}%</strong></span></div>
      ${pathSummary(target)}
      <div class="ft19-next"><span>Next action</span><strong>${esc(target.next_action || 'Action required')}</strong><small class="${overdue ? 'is-overdue' : ''}">${dateLabel(target.next_follow_up_at)} · ${Number(target.open_task_count || 0)} open tasks</small></div>
      <footer><button type="button" data-ft19-action="open-target" data-id="${esc(target.id)}">Open</button>${payload.permissions?.canWrite && !payload.readOnly ? `<button type="button" data-ft19-action="move-target" data-id="${esc(target.id)}">Move</button>` : ''}</footer>
    </article>`;
  }

  function board(round, payload) {
    if (!round) return '<div class="ft19-empty"><strong>No fundraising round available</strong><p>Create or convert a Capital Room before building an investor targeting plan.</p></div>';
    return `<div class="ft19-board" aria-label="Investor targeting pipeline">${BOARD_STAGES.map((stage) => {
      const items = (round.targets || []).filter((target) => target.stage === stage);
      const summary = round.stageSummary?.find((item) => item.stage === stage);
      return `<section class="ft19-column" data-ft19-stage="${stage}"><header><div><strong>${esc(title(stage))}</strong><span>${items.length}</span></div><small>${money(summary?.expectedCheck || 0,round.currency)}</small></header><div>${items.length ? items.map((target) => targetCard(target,round,payload)).join('') : '<p class="ft19-column-empty">No targets</p>'}</div></section>`;
    }).join('')}</div>`;
  }

  const LIST_LABELS = {
    overdueFollowUps:'Overdue follow-ups',
    followUpsThisWeek:'Due this week',
    readyForIntroduction:'Ready for introduction',
    consentRequired:'Consent required',
    researchNeeded:'Research needed',
    highFitNoAction:'High fit · no action',
    softCircle:'Soft circle & committed',
  };

  function focusedQueues(payload) {
    const lists = payload.focusedLists || {};
    const items = lists[state.list] || [];
    return `<aside class="ft19-focus"><header><span class="ft19-eyebrow">FOCUSED WORK</span><h3>Execution queues</h3></header><nav>${Object.entries(LIST_LABELS).map(([key,label]) => `<button type="button" data-ft19-list="${key}" class="${state.list === key ? 'is-active' : ''}"><span>${esc(label)}</span><b>${Number((lists[key] || []).length)}</b></button>`).join('')}</nav><div class="ft19-focus-list">${items.length ? items.map((target) => `<article><div><strong>${esc(target.organisation_name)}</strong><span>${esc(title(target.stage))} · Fit ${Math.round(Number(target.fit_score || 0))}</span></div><button type="button" data-ft19-action="open-target" data-id="${esc(target.id)}">Open</button></article>`).join('') : '<p>No items in this queue.</p>'}</div></aside>`;
  }

  function render(root) {
    const payload = state.payload;
    if (!payload) return;
    if (!state.roundId && payload.rounds?.length) state.roundId = payload.rounds[0].id;
    const round = currentRound();
    root.innerHTML = `<section class="ft19-shell" aria-labelledby="ft19-title">
      <header class="ft19-header"><div><span class="ft19-eyebrow">FUNDRAISING OS 2.0</span><h2 id="ft19-title">Investor Targeting & Introductions</h2><p>Prioritise investors, separate expected cheques from published evidence, verify warm paths, capture consent and turn each next step into accountable work.</p></div><div>${chip(payload.storageMode === 'NORMALIZED_D1' ? 'Operational' : 'Compatibility')}</div></header>
      ${compatibilityBanner(payload)}
      ${summary(payload)}
      ${roundControls(payload)}
      <div class="ft19-layout"><main>${board(round,payload)}</main>${focusedQueues(payload)}</div>
    </section>`;
  }

  function loading(root) {
    root.innerHTML = '<section class="ft19-shell ft19-loading"><i></i><strong>Loading investor targeting…</strong><span>Resolving rounds, follow-ups and consented introduction paths</span></section>';
  }

  function failed(root, message) {
    root.innerHTML = `<section class="ft19-shell ft19-error"><strong>Investor targeting could not be loaded</strong><p>${esc(message)}</p><button type="button" data-ft19-action="refresh">Try again</button></section>`;
  }

  async function load(root, force = false) {
    if (state.loading) return;
    if (state.payload && !force) { render(root); return; }
    state.loading = true;
    loading(root);
    try {
      state.payload = await api('/api/fundraising/targeting');
      if (!state.roundId && state.payload.rounds?.length) state.roundId = state.payload.rounds[0].id;
      if (isFundraisingRoute()) render(root);
    } catch (cause) {
      failed(root, cause.message || 'Unknown error');
    } finally {
      state.loading = false;
    }
  }

  function allTargets() {
    return (state.payload?.rounds || []).flatMap((round) => round.targets || []);
  }

  function targetById(id) {
    for (const round of state.payload?.rounds || []) {
      const target = (round.targets || []).find((item) => item.id === id);
      if (target) return { target, round };
    }
    return { target:null, round:null };
  }

  function optionList(items, selected, labelFn) {
    return items.map((item) => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(labelFn(item))}</option>`).join('');
  }

  function formShell(titleText, description, body, submitLabel = 'Save') {
    modalRoot().innerHTML = `<div class="ft19-backdrop" data-ft19-action="close-modal"><section class="ft19-modal" role="dialog" aria-modal="true" aria-label="${esc(titleText)}"><header><div><span class="ft19-eyebrow">FUNDRAISING EXECUTION</span><h2>${esc(titleText)}</h2><p>${esc(description)}</p></div><button type="button" data-ft19-action="close-modal" aria-label="Close">×</button></header><form data-ft19-form><div class="ft19-form-grid">${body}</div><footer><button type="button" data-ft19-action="close-modal">Cancel</button><button type="submit">${esc(submitLabel)}</button></footer></form></section></div>`;
    return $('[data-ft19-form]', modalRoot());
  }

  function input(label,name,value = '',type = 'text',attributes = '') {
    return `<label><span>${esc(label)}</span><input type="${type}" name="${esc(name)}" value="${esc(value)}" ${attributes}></label>`;
  }

  function select(label,name,values,selected = '') {
    return `<label><span>${esc(label)}</span><select name="${esc(name)}">${values.map((value) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(title(value))}</option>`).join('')}</select></label>`;
  }

  function textarea(label,name,value = '',full = true) {
    return `<label class="${full ? 'full' : ''}"><span>${esc(label)}</span><textarea name="${esc(name)}">${esc(value)}</textarea></label>`;
  }

  async function submit(form, body, success) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/fundraising/targeting', { method:'POST', body:JSON.stringify(body) });
      modalRoot().innerHTML = '';
      notify(success);
      state.payload = null;
      await load($('#fundraising-targeting-root'), true);
    } catch (cause) {
      notify(cause.message || 'Fundraising targeting could not be updated', 'error');
      button.disabled = false;
    }
  }

  function targetWorkspace(id) {
    const { target, round } = targetById(id);
    if (!target) return;
    const paths = target.introduction_paths || [];
    const people = (state.payload.people || []).filter((person) => person.organisation_id === target.organisation_id);
    modalRoot().innerHTML = `<div class="ft19-backdrop" data-ft19-action="close-modal"><section class="ft19-modal ft19-workspace" role="dialog" aria-modal="true" aria-label="Investor target workspace"><header><div><span class="ft19-eyebrow">INVESTOR TARGET</span><h2>${esc(target.organisation_name)}</h2><p>${esc(round.project_name)} · ${esc(round.round_name)} · Fit ${Math.round(Number(target.fit_score || 0))}</p></div><button type="button" data-ft19-action="close-modal">×</button></header><div class="ft19-workspace-body">
      <section class="ft19-workspace-summary"><article><span>Stage</span><strong>${esc(title(target.stage))}</strong></article><article><span>Expected cheque</span><strong>${target.expected_check === null || target.expected_check === undefined ? 'Unset' : money(target.expected_check,round.currency)}</strong></article><article><span>Published range</span><strong>${target.minimum_check || target.maximum_check ? `${money(target.minimum_check || 0,round.currency)} – ${money(target.maximum_check || 0,round.currency)}` : 'Unknown'}</strong></article><article><span>Evidence</span><strong>${Number(target.evidence_verified || 0)}/${Number(target.evidence_count || 0)}</strong></article></section>
      <section><header><div><h3>Target plan</h3><p>Expected cheque is AKARI's private planning value and remains separate from published investor cheque evidence.</p></div>${state.payload.permissions?.canWrite && !state.payload.readOnly ? `<button type="button" data-ft19-action="edit-target" data-id="${esc(id)}">Edit target</button>` : ''}</header><dl><div><dt>Primary person</dt><dd>${esc(target.primary_person_name || 'Not selected')}</dd></div><div><dt>Next action</dt><dd>${esc(target.next_action || 'Action required')}</dd></div><div><dt>Follow-up</dt><dd>${dateLabel(target.next_follow_up_at)}</dd></div><div><dt>Open tasks</dt><dd>${Number(target.open_task_count || 0)}</dd></div></dl></section>
      <section><header><div><h3>Warm introduction paths</h3><p>Verification and explicit consent are required before an introduction request can be marked requested.</p></div>${state.payload.permissions?.canWrite && !state.payload.readOnly ? `<button type="button" data-ft19-action="new-introduction" data-target-id="${esc(id)}">Add path</button>` : ''}</header>${paths.length ? `<div class="ft19-path-list">${paths.map((path) => `<article><div><strong>${esc(path.connector_contact_name || path.connector_name || 'Connector')}</strong><span>${esc(path.connector_project_name || '')}${path.relationship_owner_name ? ` · Owner ${esc(path.relationship_owner_name)}` : ''}</span></div><div>${chip(path.verification_status)}${chip(path.consent_status)}${chip(path.request_status)}</div>${state.payload.permissions?.canWrite && !state.payload.readOnly ? `<footer><button type="button" data-ft19-action="edit-introduction" data-id="${esc(path.id)}" data-target-id="${esc(id)}">Edit</button><button type="button" data-ft19-action="consent" data-id="${esc(path.id)}">Consent</button><button type="button" data-ft19-action="request-status" data-id="${esc(path.id)}">Request status</button></footer>` : ''}</article>`).join('')}</div>` : '<p class="ft19-muted">No introduction path recorded.</p>'}</section>
      ${state.payload.permissions?.canWrite && !state.payload.readOnly ? `<section><header><div><h3>Execution</h3><p>Create one accountable follow-up task linked to the founder project.</p></div><button type="button" data-ft19-action="create-task" data-id="${esc(id)}">Create follow-up task</button></header></section>` : ''}
    </div><footer><button type="button" data-ft19-action="close-modal">Close</button></footer></section></div>`;
  }

  function editTarget(id) {
    const { target, round } = targetById(id);
    if (!target) return;
    const people = (state.payload.people || []).filter((person) => person.organisation_id === target.organisation_id);
    const form = formShell('Edit investor target', 'Maintain private expected cheque, priority, probability, decision-maker and the next accountable action.', `
      <label><span>Primary investor person</span><select name="primaryPersonId"><option value="">Not selected</option>${optionList(people,target.primary_person_id,(item) => `${item.full_name}${item.title ? ` · ${item.title}` : ''}`)}</select></label>
      ${input('Expected cheque','expectedCheck',target.expected_check ?? '','number','min="0"')}
      ${input('Priority 0–100','priority',target.priority ?? 50,'number','min="0" max="100"')}
      ${input('Probability %','probabilityPercentage',target.probability_percentage ?? 0,'number','min="0" max="100"')}
      ${input('Next follow-up','nextFollowUpAt',target.next_follow_up_at ? String(target.next_follow_up_at).slice(0,16) : '','datetime-local')}
      ${input('Next action','nextAction',target.next_action || '')}
      ${textarea('Internal notes','notes',target.notes || '')}
      <input type="hidden" name="id" value="${esc(id)}">
      <div class="ft19-form-note full"><strong>Published cheque evidence</strong><span>${target.minimum_check || target.maximum_check ? `${money(target.minimum_check || 0,round.currency)} – ${money(target.maximum_check || 0,round.currency)}` : 'No published cheque evidence recorded.'}</span></div>
    `, 'Save target');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      submit(form, { action:'update-target', ...data, expectedCheck:data.expectedCheck === '' ? '' : Number(data.expectedCheck), priority:Number(data.priority), probabilityPercentage:Number(data.probabilityPercentage) }, 'Investor target updated');
    });
  }

  function moveTarget(id) {
    const { target } = targetById(id);
    if (!target) return;
    const form = formShell('Move investor target', `Current stage: ${title(target.stage)}. Controlled transitions preserve the pipeline event history.`, `
      ${select('New stage','stage',state.payload.stages || BOARD_STAGES,target.stage)}
      ${textarea('Reason / outcome','reason','')}
      <input type="hidden" name="id" value="${esc(id)}">
    `, 'Move target');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      submit(form, { action:'move-target', ...data }, 'Investor stage updated');
    });
  }

  function introductionForm(targetId, path = {}) {
    const { target } = targetById(targetId);
    if (!target) return;
    const people = (state.payload.people || []).filter((person) => person.organisation_id === target.organisation_id);
    const form = formShell(path.id ? 'Edit introduction path' : 'Add introduction path', 'Record one proposed connector. Verification is evidence-based; consent and request status remain separate controls.', `
      <label><span>Target investor person</span><select name="targetPersonId"><option value="">Not selected</option>${optionList(people,path.target_person_id,(item) => `${item.full_name}${item.title ? ` · ${item.title}` : ''}`)}</select></label>
      <label><span>Known CRM connector</span><select name="connectorContactId"><option value="">Use manual connector name</option>${optionList(state.payload.connectors || [],path.connector_contact_id,(item) => `${item.full_name} · ${item.project_name}`)}</select></label>
      ${input('Manual connector name','connectorName',path.connector_name || '')}
      <label><span>Relationship owner</span><select name="relationshipOwnerUserId">${optionList(state.payload.members || [],path.relationship_owner_user_id || '',(item) => `${item.full_name} · ${title(item.role)}`)}</select></label>
      ${select('Relationship strength','relationshipStrength',['UNKNOWN','WEAK','MEDIUM','STRONG'],path.relationship_strength || 'UNKNOWN')}
      <label><span>Evidence source</span><select name="evidenceSourceId"><option value="">No source linked</option>${optionList(state.payload.sources || [],path.evidence_source_id,(item) => item.title || item.canonical_url)}</select></label>
      ${select('Verification status','verificationStatus',['UNVERIFIED','RESEARCHING','VERIFIED','STALE','REJECTED'],path.verification_status || 'UNVERIFIED')}
      ${textarea('Verification notes','notes',path.notes || '')}
      <input type="hidden" name="targetId" value="${esc(targetId)}"><input type="hidden" name="id" value="${esc(path.id || '')}">
    `, 'Save introduction path');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      submit(form, { action:'upsert-introduction', ...data }, path.id ? 'Introduction path updated' : 'Introduction path created');
    });
  }

  function consentForm(pathId) {
    const { target } = targetById(allTargets().find((item) => (item.introduction_paths || []).some((path) => path.id === pathId))?.id);
    const path = allTargets().flatMap((item) => item.introduction_paths || []).find((item) => item.id === pathId);
    if (!path) return;
    const allowed = state.payload.permissions?.canApprove ? ['NOT_REQUESTED','REQUESTED','GRANTED','DECLINED','REVOKED'] : ['NOT_REQUESTED','REQUESTED'];
    const form = formShell('Introduction consent', 'Consent is explicit. Granted, declined and revoked decisions require Owner/Admin authority and a written note.', `
      ${select('Consent status','consentStatus',allowed,path.consent_status)}
      ${textarea('Decision note','note','')}
      <input type="hidden" name="id" value="${esc(pathId)}">
    `, 'Save consent status');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      submit(form, { action:'set-consent', ...data }, 'Introduction consent updated');
    });
  }

  function requestStatusForm(pathId) {
    const path = allTargets().flatMap((item) => item.introduction_paths || []).find((item) => item.id === pathId);
    if (!path) return;
    const form = formShell('Introduction request status', 'A request cannot be sent or completed until the path is verified and consent is granted.', `
      ${select('Request status','requestStatus',['PLANNED','REQUESTED','ACCEPTED','COMPLETED','DECLINED','CANCELLED'],path.request_status)}
      ${textarea('Outcome / notes','outcome',path.outcome || '')}
      <input type="hidden" name="id" value="${esc(pathId)}">
    `, 'Save request status');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      submit(form, { action:'set-request-status', ...data }, 'Introduction request updated');
    });
  }

  function taskForm(targetId) {
    const { target } = targetById(targetId);
    if (!target) return;
    const form = formShell('Create investor follow-up task', 'Create one linked task for the relationship owner or another active workspace member.', `
      ${input('Task title','title',`Investor follow-up · ${target.organisation_name}`)}
      <label><span>Task owner</span><select name="ownerUserId">${optionList(state.payload.members || [],'',(item) => `${item.full_name} · ${title(item.role)}`)}</select></label>
      ${input('Due date *','dueAt',target.next_follow_up_at ? String(target.next_follow_up_at).slice(0,16) : '','datetime-local','required')}
      ${textarea('Task description','description',target.next_action || 'Complete the next fundraising action.')}
      <input type="hidden" name="targetId" value="${esc(targetId)}">
    `, 'Create task');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      submit(form, { action:'create-follow-up-task', ...data }, 'Investor follow-up task created');
    });
  }

  function handleAction(action, dataset, root) {
    if (action === 'refresh') { state.payload = null; load(root,true); }
    if (action === 'open-target') targetWorkspace(dataset.id);
    if (action === 'edit-target') editTarget(dataset.id);
    if (action === 'move-target') moveTarget(dataset.id);
    if (action === 'new-introduction') introductionForm(dataset.targetId);
    if (action === 'edit-introduction') {
      const path = allTargets().flatMap((item) => item.introduction_paths || []).find((item) => item.id === dataset.id) || {};
      introductionForm(dataset.targetId,path);
    }
    if (action === 'consent') consentForm(dataset.id);
    if (action === 'request-status') requestStatusForm(dataset.id);
    if (action === 'create-task') taskForm(dataset.id);
  }

  function bindRoot(root) {
    root.addEventListener('change', (event) => {
      if (event.target.matches('[data-ft19-round]')) {
        state.roundId = event.target.value;
        render(root);
      }
    });
    root.addEventListener('click', (event) => {
      const list = event.target.closest('[data-ft19-list]');
      if (list) { state.list = list.dataset.ft19List; render(root); return; }
      const action = event.target.closest('[data-ft19-action]');
      if (action) handleAction(action.dataset.ft19Action,action.dataset,root);
    });
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('#fundraising-targeting-modal-root [data-ft19-action]');
    if (!action) return;
    if (action.dataset.ft19Action === 'close-modal') {
      if (event.target === action || action.tagName === 'BUTTON') modalRoot().innerHTML = '';
      return;
    }
    handleAction(action.dataset.ft19Action,action.dataset,$('#fundraising-targeting-root'));
  }, true);

  function mount() {
    state.scheduled = false;
    if (!isFundraisingRoute()) return;
    const view = $('#view-root');
    if (!view) return;
    let root = $('#fundraising-targeting-root',view);
    if (!root) {
      root = document.createElement('div');
      root.id = 'fundraising-targeting-root';
      root.dataset.fundraisingTargeting = 'r19';
      const capital = $('#capital-room-command-centre',view);
      if (capital) capital.insertAdjacentElement('beforebegin',root);
      else view.appendChild(root);
      bindRoot(root);
    }
    if (root.dataset.ft19Loaded === 'true') return;
    root.dataset.ft19Loaded = 'true';
    load(root);
  }

  function scheduleMount() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(mount);
  }

  new MutationObserver(scheduleMount).observe(document.documentElement,{ childList:true,subtree:true });
  document.addEventListener('DOMContentLoaded',scheduleMount);
  document.addEventListener('akari:route-rendered',scheduleMount);
  window.addEventListener('popstate',scheduleMount);
  scheduleMount();
})();
