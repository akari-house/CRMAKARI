(() => {
  'use strict';

  const OUTCOME_STAGES = new Set(['WON', 'LOST', 'ON_HOLD']);
  const state = { opportunityId: '', workspace: null, loading: false, scheduled: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[character]));
  const today = () => new Date().toISOString().slice(0, 10);
  const localDateTime = () => {
    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  };

  function root() {
    let node = $('#commercial-governance-root');
    if (!node) {
      node = document.createElement('div');
      node.id = 'commercial-governance-root';
      document.body.appendChild(node);
    }
    return node;
  }

  function notify(message, type = 'success') {
    const host = $('#toast-root');
    if (!host) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    host.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

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

  async function workspace(force = false) {
    if (!state.opportunityId) throw new Error('Open an opportunity first');
    if (state.workspace && !force) return state.workspace;
    state.workspace = await request(`/api/opportunities/${encodeURIComponent(state.opportunityId)}/workspace`);
    return state.workspace;
  }

  function field(name, label, value = '', type = 'text', options = {}) {
    return `<label class="governance-field ${options.full ? 'full' : ''}"><span>${esc(label)}${options.required ? ' *' : ''}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value ?? '')}" ${options.required ? 'required' : ''} ${options.min !== undefined ? `min="${esc(options.min)}"` : ''} ${options.step !== undefined ? `step="${esc(options.step)}"` : ''} placeholder="${esc(options.placeholder || '')}"></label>`;
  }

  function textarea(name, label, value = '', options = {}) {
    return `<label class="governance-field full"><span>${esc(label)}${options.required ? ' *' : ''}</span><textarea name="${esc(name)}" rows="${options.rows || 3}" ${options.required ? 'required' : ''} placeholder="${esc(options.placeholder || '')}">${esc(value || '')}</textarea></label>`;
  }

  function select(name, label, values, selected = '', options = {}) {
    return `<label class="governance-field ${options.full ? 'full' : ''}"><span>${esc(label)}${options.required ? ' *' : ''}</span><select name="${esc(name)}" ${options.required ? 'required' : ''}>${values.map(([value, copy]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(copy)}</option>`).join('')}</select></label>`;
  }

  function checkbox(name, label, detail = '') {
    return `<label class="governance-check full"><input name="${esc(name)}" type="checkbox" value="true"><span><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span></label>`;
  }

  function modal(title, subtitle, body, submitText, onSubmit) {
    const host = root();
    host.innerHTML = `<div class="governance-backdrop" data-governance-action="close"><section class="governance-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><div><div class="eyebrow">BD COMMERCIAL CONTROL</div><h2>${esc(title)}</h2><p>${esc(subtitle || '')}</p></div><button type="button" class="close" data-governance-action="close" aria-label="Close ${esc(title)}">×</button></header><form id="governance-active-form"><div class="governance-body">${body}</div><footer><button type="button" class="btn" data-governance-action="close">Cancel</button><button type="submit" class="btn primary">${esc(submitText)}</button></footer></form></section></div>`;
    const form = $('#governance-active-form', host);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Saving…';
      try { await onSubmit(form); }
      catch (cause) { notify(cause.message || 'Action failed', 'error'); button.disabled = false; button.textContent = original; }
    });
    requestAnimationFrame(() => form.querySelector('input,select,textarea')?.focus());
  }

  function data(form) {
    const output = Object.fromEntries(new FormData(form));
    for (const checkboxControl of form.querySelectorAll('input[type="checkbox"]')) output[checkboxControl.name] = checkboxControl.checked;
    return output;
  }

  function closeModal() { root().innerHTML = ''; }

  async function refreshWorkspace() {
    state.workspace = null;
    const refresh = $('[data-revenue-action="refresh"]');
    if (refresh) refresh.click();
    else location.reload();
  }

  function acceptedProposal(payload) {
    return (payload.proposals || []).find((item) => String(item.metadata?.status || item.outcome || '').toUpperCase() === 'ACCEPTED') || null;
  }

  async function sendProposal(id) {
    modal('Record proposal delivery', 'An approved proposal becomes Sent only after its delivery evidence is preserved.', `<div class="governance-grid">
      ${select('deliveryMethod', 'Delivery method', [['EMAIL','Email'],['SIGNED_DOCUMENT','Document platform'],['MEETING','Meeting'],['TELEGRAM','Telegram'],['OTHER','Other']], 'EMAIL', { required:true })}
      ${field('sentAt', 'Sent at', localDateTime(), 'datetime-local', { required:true })}
      ${field('sentReference', 'Message / document reference', '', 'text', { required:true, full:true, placeholder:'Email subject, signed-document URL, Telegram link or meeting reference' })}
      ${textarea('sentNotes', 'Delivery notes')}
      ${field('nextAction', 'Next action', 'Follow up on proposal', 'text', { required:true, full:true })}
      ${field('followUpAt', 'Follow-up date', '', 'date', { required:true })}
    </div>`, 'Mark proposal sent', async (form) => {
      await request(`/api/proposals/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ status:'SENT', ...data(form) }) });
      closeModal(); notify('Proposal delivery evidence saved'); await refreshWorkspace();
    });
  }

  async function proposalDecision(id) {
    modal('Record proposal decision', 'Preserve the client decision, evidence and next relationship action.', `<div class="governance-grid">
      ${select('status', 'Decision', [['ACCEPTED','Accepted'],['REJECTED','Rejected'],['EXPIRED','Expired']], 'ACCEPTED', { required:true })}
      <div class="governance-acceptance full" data-governance-acceptance>
        <div class="governance-grid">
          ${field('acceptedBy', 'Accepted by', '', 'text', { required:true })}
          ${field('acceptedAt', 'Accepted at', localDateTime(), 'datetime-local', { required:true })}
          ${select('acceptanceMethod', 'Acceptance method', [['EMAIL','Email'],['SIGNED_DOCUMENT','Signed document'],['MEETING','Meeting'],['TELEGRAM','Telegram'],['OTHER','Other']], 'EMAIL', { required:true })}
          ${field('acceptanceReference', 'Acceptance reference', '', 'text', { required:true, placeholder:'Email, signed document, message or meeting reference' })}
          ${checkbox('termsConfirmed', 'Accepted terms match this proposal version', 'Confirm amount, currency, scope, deliverables and payment terms.')}
          ${textarea('acceptanceNotes', 'Acceptance notes')}
        </div>
      </div>
      <div class="governance-rejection full" data-governance-rejection hidden>${textarea('reason', 'Rejection / expiry reason', '', { required:true })}</div>
      ${field('nextAction', 'Next action', 'Confirm contract and close as won', 'text', { required:true, full:true })}
      ${field('followUpAt', 'Follow-up date', '', 'date', { full:true })}
    </div>`, 'Save proposal decision', async (form) => {
      await request(`/api/proposals/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(data(form)) });
      closeModal(); notify('Proposal decision evidence saved'); await refreshWorkspace();
    });
    const form = $('#governance-active-form');
    const status = form.elements.status;
    const update = () => {
      const accepted = status.value === 'ACCEPTED';
      $('[data-governance-acceptance]', form).hidden = !accepted;
      $('[data-governance-rejection]', form).hidden = accepted;
      for (const control of form.querySelectorAll('[data-governance-acceptance] input,[data-governance-acceptance] select')) control.required = accepted && control.name !== 'termsConfirmed';
      const reason = form.elements.reason; if (reason) reason.required = !accepted;
      form.elements.nextAction.value = accepted ? 'Confirm contract and close as won' : 'Review the relationship and commercial approach';
    };
    status.addEventListener('change', update); update();
  }

  async function holdOpportunity(action = 'HOLD', resumeStage = 'QUALIFIED') {
    const payload = await workspace(true);
    const opportunity = payload.opportunity;
    const hold = action === 'HOLD';
    modal(hold ? 'Place opportunity on hold' : 'Resume opportunity', hold ? 'Preserve why the deal is paused, when it will be reviewed and what relationship action remains.' : 'Resume the deal only with a clear working stage, next action and follow-up.', `<div class="governance-grid">
      ${hold ? select('category', 'Hold category', [['CLIENT_TIMING','Client timing'],['BUDGET','Budget'],['INTERNAL_DEPENDENCY','Internal dependency'],['LEGAL_COMPLIANCE','Legal / compliance'],['NO_RESPONSE','No response'],['DELIVERY_CAPACITY','Delivery capacity'],['OTHER','Other']], 'CLIENT_TIMING', { required:true }) : select('resumeStage', 'Resume stage', [['RESEARCH','Research'],['CONTACTED','Contacted'],['REPLIED','Replied'],['DISCOVERY','Discovery'],['QUALIFIED','Qualified'],['PROPOSAL','Proposal'],['NEGOTIATION','Negotiation'],['VERBAL_CONFIRMATION','Verbal confirmation']], resumeStage, { required:true })}
      ${textarea('reason', hold ? 'Why is this deal on hold?' : 'Why is this deal ready to resume?', '', { required:true })}
      ${field('nextAction', 'Next relationship action', hold ? 'Review hold status with client' : 'Progress resumed opportunity', 'text', { required:true, full:true })}
      ${field(hold ? 'reviewAt' : 'nextFollowUpAt', hold ? 'Review date' : 'Follow-up date', '', 'date', { required:true, full:true })}
    </div>`, hold ? 'Place on hold' : 'Resume opportunity', async (form) => {
      await request(`/api/opportunities/${encodeURIComponent(opportunity.id)}/hold`, { method:'POST', body:JSON.stringify({ action, ...data(form) }) });
      closeModal(); notify(hold ? 'Opportunity placed on hold' : 'Opportunity resumed'); location.reload();
    });
  }

  async function closeWon() {
    const payload = await workspace(true);
    const o = payload.opportunity;
    const proposal = acceptedProposal(payload);
    const p = proposal?.metadata || {};
    const evidence = proposal
      ? `<div class="governance-evidence full"><strong>Accepted proposal v${esc(p.version || 1)}</strong><span>${esc(p.acceptedBy || 'Acceptance evidence')} · ${esc(p.acceptanceMethod || '')} · ${esc(p.acceptanceReference || '')}</span></div>${field('sourceProposalId', 'Accepted proposal ID', proposal.id, 'hidden')}`
      : `<div class="governance-warning full"><strong>No accepted proposal with evidence</strong><span>Record manual confirmation evidence for a partnership or exceptional close.</span></div>
        ${field('acceptedBy', 'Confirmed by', '', 'text', { required:true })}${field('acceptedAt', 'Confirmed at', localDateTime(), 'datetime-local', { required:true })}
        ${select('acceptanceMethod', 'Confirmation method', [['EMAIL','Email'],['SIGNED_DOCUMENT','Signed document'],['MEETING','Meeting'],['TELEGRAM','Telegram'],['OTHER','Other']], 'MEETING', { required:true })}
        ${field('acceptanceReference', 'Confirmation reference', '', 'text', { required:true })}${checkbox('termsConfirmed', 'Final terms are confirmed')}${textarea('manualCloseReason', 'Why is this being closed without an accepted proposal?', '', { required:true })}`;
    modal('Close opportunity as won', 'Create the client engagement from accepted commercial evidence—without re-entering or silently changing the deal.', `<div class="governance-grid">
      ${evidence}
      ${select('dealModel', 'Deal model', [['SERVICE','Paid service'],['PARTNERSHIP','Partnership'],['HYBRID','Hybrid']], Number(p.amount || o.estimated_value || 0) > 0 ? 'SERVICE' : 'PARTNERSHIP', { required:true })}
      ${field('finalValue', 'Final contract value', p.amount ?? o.estimated_value ?? 0, 'number', { required:true, min:0, step:'0.01' })}
      ${select('currency', 'Currency', [['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']], p.currency || o.currency || 'USD', { required:true })}
      ${field('serviceType', 'Service type', p.serviceType || o.service_type || '', 'text', { required:true })}
      ${select('commercialModel', 'Commercial model', [['FIXED_FEE','Fixed fee'],['RETAINER','Retainer'],['PERFORMANCE','Performance'],['HYBRID','Hybrid'],['PARTNERSHIP','Partnership']], p.commercialModel || 'FIXED_FEE', { required:true })}
      ${field('engagementName', 'Engagement name', `${o.project_name} · ${o.name}`, 'text', { required:true, full:true })}
      ${field('startDate', 'Start date', today(), 'date', { required:true })}${field('endDate', 'Target completion', '', 'date')}
      ${textarea('deliverables', 'Contracted deliverables', p.deliverables || '', { required:true })}
      ${textarea('paymentTerms', 'Payment terms', p.paymentTerms || '')}
      ${select('billingSchedule', 'Billing schedule', [['UPFRONT','Upfront'],['MILESTONE','Milestone'],['MONTHLY','Monthly'],['ON_COMPLETION','On completion'],['CUSTOM','Custom']], 'UPFRONT')}
      ${field('directCosts', 'Direct costs', 0, 'number', { min:0, step:'0.01' })}${field('variableCosts', 'Variable costs', 0, 'number', { min:0, step:'0.01' })}
      ${textarea('commercialOverrideReason', 'Commercial override reason', '', { placeholder:'Required only when final value, currency or commercial model differs from the accepted proposal.' })}
      ${field('nextAction', 'First onboarding / activation action', 'Complete client onboarding and issue the first invoice', 'text', { required:true, full:true })}
      ${textarea('closeNotes', 'Close notes')}
    </div>`, 'Close as won', async (form) => {
      const values = data(form);
      values.outcome = 'WON';
      await request(`/api/opportunities/${encodeURIComponent(o.id)}/close`, { method:'POST', body:JSON.stringify(values) });
      closeModal(); notify('Opportunity closed as won with evidence'); location.reload();
    });
  }

  async function closeLost() {
    const payload = await workspace(true);
    const o = payload.opportunity;
    modal('Close opportunity as lost', 'Preserve the loss reason, category and future relationship action.', `<div class="governance-grid">
      ${select('lostCategory', 'Loss category', [['BUDGET','Budget'],['TIMING','Timing'],['NO_RESPONSE','No response'],['COMPETITOR','Competitor'],['PRODUCT_FIT','Product / service fit'],['LEGAL_COMPLIANCE','Legal / compliance'],['INTERNAL_DECISION','Internal decision'],['OTHER','Other']], 'BUDGET', { required:true })}
      ${field('competitor', 'Competitor / alternative')}
      ${textarea('lostReason', 'Why was the opportunity lost?', '', { required:true })}
      ${field('nextAction', 'Future relationship action', 'Review relationship in 90 days', 'text', { required:true, full:true })}
      ${field('followUpAt', 'Future follow-up date', '', 'date', { full:true })}
      ${textarea('closeNotes', 'Close notes')}
    </div>`, 'Close as lost', async (form) => {
      await request(`/api/opportunities/${encodeURIComponent(o.id)}/close`, { method:'POST', body:JSON.stringify({ outcome:'LOST', ...data(form) }) });
      closeModal(); notify('Opportunity closed as lost with learning preserved'); location.reload();
    });
  }

  function governProposalForm() {
    const form = $('#revenue-active-form');
    if (!form || form.dataset.commercialGovernanceR33) return;
    if (form.querySelector('header h3')?.textContent?.trim() !== 'Record proposal') return;
    form.dataset.commercialGovernanceR33 = 'ready';
    const status = form.elements.status;
    if (status) {
      status.innerHTML = '<option value="DRAFT">Draft</option><option value="INTERNAL_REVIEW">Submit for internal review</option>';
      status.value = 'INTERNAL_REVIEW';
    }
    const copy = form.querySelector('header p');
    if (copy) copy.textContent = 'Create a proposal version first. Approval, delivery and client decision are recorded separately with evidence.';
  }

  async function enhanceWorkspace() {
    governProposalForm();
    const workspaceNode = $('#modal-root .revenue-workspace');
    if (!workspaceNode || !state.opportunityId || workspaceNode.querySelector('[data-governance-hold]') || state.loading) return;
    state.loading = true;
    try {
      const payload = await workspace(true);
      if (!workspaceNode.isConnected) return;
      const stage = String(payload.opportunity?.stage || '').toUpperCase();
      if (!['WON','LOST'].includes(stage)) {
        const toolbar = $('.revenue-toolbar', workspaceNode);
        if (toolbar) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn small';
          button.dataset.governanceHold = stage === 'ON_HOLD' ? 'RESUME' : 'HOLD';
          button.textContent = stage === 'ON_HOLD' ? 'Resume deal' : 'Place on hold';
          toolbar.insertBefore(button, toolbar.firstChild);
        }
      }
    } catch (cause) { console.warn('Commercial governance workspace enhancement failed', cause); }
    finally { state.loading = false; }
  }

  function governStageSelectors() {
    for (const selectControl of document.querySelectorAll('.stage-select')) {
      const card = selectControl.closest('[data-akari-opportunity-id]');
      const stage = selectControl.value;
      if (!selectControl.dataset.previousStage) selectControl.dataset.previousStage = stage;
      if (['WON','LOST'].includes(stage)) {
        selectControl.disabled = true;
        selectControl.setAttribute('aria-label', `${stage === 'WON' ? 'Won' : 'Lost'} opportunity status is locked`);
      }
      card?.setAttribute('data-governed-stage', stage);
    }
  }

  document.addEventListener('pointerdown', (event) => {
    const open = event.target.closest('[data-revenue-action="open"][data-id]');
    if (open) { state.opportunityId = open.dataset.id; state.workspace = null; }
    const selectControl = event.target.closest('.stage-select');
    if (selectControl) selectControl.dataset.previousStage = selectControl.value;
  }, true);

  document.addEventListener('change', (event) => {
    const selectControl = event.target.closest('.stage-select');
    if (!selectControl) return;
    const next = selectControl.value;
    const previous = selectControl.dataset.previousStage || '';
    if (!OUTCOME_STAGES.has(next) && previous !== 'ON_HOLD') return;
    event.preventDefault(); event.stopImmediatePropagation();
    selectControl.value = previous;
    const card = selectControl.closest('[data-akari-opportunity-id]');
    state.opportunityId = selectControl.dataset.id || card?.dataset.akariOpportunityId || '';
    state.workspace = null;
    if (next === 'ON_HOLD') holdOpportunity('HOLD').catch((cause) => notify(cause.message, 'error'));
    else if (previous === 'ON_HOLD') holdOpportunity('RESUME', next).catch((cause) => notify(cause.message, 'error'));
    else {
      card?.querySelector('[data-revenue-action="open"]')?.click();
      notify(`Use the controlled Mark ${next.toLowerCase()} action to preserve the decision evidence`, 'error');
    }
  }, true);

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-governance-action]');
    if (action?.dataset.governanceAction === 'close') {
      if (event.target !== action && action.classList.contains('governance-backdrop')) return;
      event.preventDefault(); event.stopImmediatePropagation(); closeModal(); return;
    }
    const hold = event.target.closest('[data-governance-hold]');
    if (hold) {
      event.preventDefault(); event.stopImmediatePropagation();
      holdOpportunity(hold.dataset.governanceHold).catch((cause) => notify(cause.message, 'error')); return;
    }
    const revenue = event.target.closest('[data-revenue-action]');
    if (revenue?.dataset.revenueAction === 'close-won') {
      event.preventDefault(); event.stopImmediatePropagation(); closeWon().catch((cause) => notify(cause.message, 'error')); return;
    }
    if (revenue?.dataset.revenueAction === 'close-lost') {
      event.preventDefault(); event.stopImmediatePropagation(); closeLost().catch((cause) => notify(cause.message, 'error')); return;
    }
    const commercial = event.target.closest('[data-commercial-action]');
    if (commercial?.dataset.commercialAction === 'proposal-status' && commercial.dataset.status === 'SENT') {
      event.preventDefault(); event.stopImmediatePropagation(); sendProposal(commercial.dataset.id).catch((cause) => notify(cause.message, 'error')); return;
    }
    if (commercial?.dataset.commercialAction === 'proposal-decision') {
      event.preventDefault(); event.stopImmediatePropagation(); proposalDecision(commercial.dataset.id).catch((cause) => notify(cause.message, 'error'));
    }
  }, true);

  function maintain() {
    state.scheduled = false;
    governStageSelectors();
    governProposalForm();
    enhanceWorkspace();
  }
  function schedule() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(maintain);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('akari:route-rendered', schedule);
  schedule();
})();
