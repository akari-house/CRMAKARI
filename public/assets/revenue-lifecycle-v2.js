(() => {
  'use strict';

  const state = { workspace: null, partners: null, opening: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  const money = (value, currency = 'USD') => value === null || value === undefined ? 'Restricted' : new Intl.NumberFormat('en-US', { style:'currency', currency: currency || 'USD', maximumFractionDigits:2 }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';
  const dateInput = (value) => value ? String(value).slice(0, 10) : '';
  const dateTimeInput = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value).slice(0,16) : new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  };

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials:'same-origin',
      ...options,
      headers:{ 'content-type':'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const cause = new Error(payload.error || `Request failed (${response.status})`);
      cause.status = response.status;
      throw cause;
    }
    return payload;
  }

  function notify(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function closeWorkspace() {
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
    state.workspace = null;
  }

  function field(name, label, { value = '', type = 'text', required = false, placeholder = '', min = '', max = '', step = '', full = false, help = '' } = {}) {
    return `<label class="revenue-field ${full ? 'full' : ''}"><span>${esc(label)}${required ? ' *' : ''}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value ?? '')}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${min !== '' ? `min="${esc(min)}"` : ''} ${max !== '' ? `max="${esc(max)}"` : ''} ${step !== '' ? `step="${esc(step)}"` : ''}/>${help ? `<small>${esc(help)}</small>` : ''}</label>`;
  }

  function textarea(name, label, { value = '', required = false, placeholder = '', full = true, rows = 4 } = {}) {
    return `<label class="revenue-field ${full ? 'full' : ''}"><span>${esc(label)}${required ? ' *' : ''}</span><textarea name="${esc(name)}" rows="${rows}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}">${esc(value ?? '')}</textarea></label>`;
  }

  function select(name, label, items, selected = '', { required = false, full = false } = {}) {
    return `<label class="revenue-field ${full ? 'full' : ''}"><span>${esc(label)}${required ? ' *' : ''}</span><select name="${esc(name)}" ${required ? 'required' : ''}>${items.map(([value, labelText]) => `<option value="${esc(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(labelText)}</option>`).join('')}</select></label>`;
  }

  function check(name, label, copy, checked = false) {
    return `<label class="revenue-check"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}/><span><strong>${esc(label)}</strong><small>${esc(copy)}</small></span></label>`;
  }

  function stageTone(stage) {
    if (stage === 'WON') return 'green';
    if (stage === 'LOST') return 'red';
    if (['NEGOTIATION','VERBAL_CONFIRMATION'].includes(stage)) return 'yellow';
    if (['PROPOSAL','QUALIFIED'].includes(stage)) return 'pink';
    return '';
  }

  function pill(value, tone = '') {
    return `<span class="revenue-pill ${tone}">${esc(title(value || '—'))}</span>`;
  }

  function lifecycleSteps(payload) {
    const opportunity = payload.opportunity;
    const invoices = payload.finance?.invoices || [];
    const referrals = payload.finance?.referrals || [];
    const hasPayment = invoices.some((item) => Number(item.received || 0) > 0 || item.status === 'PAID');
    const hasReferral = referrals.length > 0;
    const referralPaid = referrals.some((item) => item.status === 'PAID');
    const raw = [
      ['Qualified lead', Boolean(opportunity.qualificationComplete), false],
      ['Opportunity', true, false],
      ['Proposal', payload.proposals.length > 0, false],
      ['Negotiation', payload.negotiations.length > 0, false],
      ['Won / Lost', ['WON','LOST'].includes(opportunity.stage), false],
      ['Client', opportunity.project_lifecycle_status === 'CLIENT', opportunity.stage === 'LOST'],
      ['Engagement', payload.engagements.length > 0, opportunity.stage === 'LOST'],
      ['Invoice', invoices.length > 0, !payload.permissions.canFinance || opportunity.stage === 'LOST'],
      ['Payment', hasPayment, !payload.permissions.canFinance || opportunity.stage === 'LOST'],
      ['Referral reward', referralPaid, !payload.permissions.canFinance || !hasReferral],
    ];
    const firstOpen = raw.findIndex(([, complete, na]) => !complete && !na);
    return raw.map(([label, complete, na], index) => ({ label, state: na ? 'na' : complete ? 'complete' : index === firstOpen ? 'current' : 'pending' }));
  }

  function property(label, value, className = '') {
    return `<div class="revenue-property"><span>${esc(label)}</span><strong class="${className}">${value}</strong></div>`;
  }

  function timelineItem(item, typeLabel) {
    const metadata = item.metadata || {};
    const amount = metadata.amount ?? metadata.currentOffer;
    return `<article class="revenue-history-item"><div><strong>${esc(metadata.title || item.subject || typeLabel)}</strong><span>${esc(typeLabel)} · ${esc(date(item.occurredAt))}${metadata.version ? ` · v${esc(metadata.version)}` : ''}${metadata.round ? ` · Round ${esc(metadata.round)}` : ''}</span></div><div class="revenue-history-meta">${amount !== undefined ? `<strong>${money(amount, metadata.currency || 'USD')}</strong>` : ''}${pill(item.outcome || metadata.status || metadata.outcome, stageTone(item.outcome))}</div></article>`;
  }

  function actionButtons(payload) {
    const opportunity = payload.opportunity;
    if (!payload.permissions.canWrite) return '';
    if (['WON','LOST'].includes(opportunity.stage)) {
      const engagement = payload.engagements[0];
      return `<button class="btn" data-revenue-action="refresh">Refresh</button>${engagement ? `<button class="btn primary" data-revenue-action="edit-engagement" data-id="${esc(engagement.id)}">Manage engagement</button>` : ''}`;
    }
    return `
      <button class="btn" data-revenue-action="qualification">Qualification</button>
      <button class="btn" data-revenue-action="proposal">Proposal</button>
      <button class="btn" data-revenue-action="negotiation">Negotiation</button>
      <button class="btn green" data-revenue-action="close-won">Mark won</button>
      <button class="btn" data-revenue-action="close-lost">Mark lost</button>`;
  }

  function engagementSection(payload) {
    if (!payload.engagements.length) return `<section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Service engagement</strong><span>Created automatically when the opportunity is won.</span></div></div><div class="revenue-empty">No service engagement yet.</div></section>`;
    return payload.engagements.map((item) => `<section class="revenue-panel"><div class="revenue-panel-head"><div><strong>${esc(item.name)}</strong><span>${esc(title(item.serviceType))} · ${esc(title(item.commercialModel))}</span></div><div>${pill(item.status, item.status === 'COMPLETED' ? 'green' : item.status === 'CANCELLED' ? 'red' : 'pink')} ${payload.permissions.canWrite ? `<button class="btn small" data-revenue-action="edit-engagement" data-id="${esc(item.id)}">Edit</button>` : ''}</div></div><div class="revenue-property-grid">
      ${property('Start', date(item.startDate))}${property('End', date(item.endDate))}${property('Next action', esc(item.nextAction || '—'))}${property('Deliverables', esc(item.deliverables || '—'))}
      ${payload.permissions.canFinance ? `${property('Contract value', money(item.grossRevenue, item.currency), 'finance-value')}${property('Direct costs', money(item.directCosts, item.currency), 'finance-value')}${property('AKARI net', money(item.akariNetRevenue, item.currency), 'finance-value')}${property('Referral reward', money(item.referralReward, item.currency), 'finance-value')}` : ''}
    </div>${payload.permissions.canFinance ? `<div class="revenue-panel-actions"><button class="btn primary" data-revenue-action="invoice" data-id="${esc(item.id)}">Create invoice</button></div>` : ''}</section>`).join('');
  }

  function financeSection(payload) {
    if (!payload.permissions.canFinance) return `<section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Invoice, payment and referral</strong><span>Financial details are restricted to authorised users.</span></div></div><div class="revenue-empty">Finance access is required.</div></section>`;
    const invoices = payload.finance?.invoices || [];
    const referrals = payload.finance?.referrals || [];
    return `<section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Invoices and payments</strong><span>Payments are allocated against the invoice and connected engagement.</span></div>${invoices.some((item) => item.outstanding > 0) ? `<button class="btn primary small" data-revenue-action="payment">Record payment</button>` : ''}</div>
      ${invoices.length ? `<div class="revenue-table-wrap"><table class="revenue-table"><thead><tr><th>Invoice</th><th>Total</th><th>Received</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>${invoices.map((item) => `<tr><td><strong>${esc(item.invoiceNumber)}</strong><span>${esc(date(item.invoiceDate))}</span></td><td>${money(item.total,item.currency)}</td><td>${money(item.received,item.currency)}</td><td>${money(item.outstanding,item.currency)}</td><td>${pill(item.status,item.status === 'PAID' ? 'green' : item.status === 'OVERDUE' ? 'red' : 'yellow')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="revenue-empty">No invoice has been created for this engagement.</div>`}
    </section>
    <section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Referral reward</strong><span>Calculated from engagement margin and released after client payment.</span></div></div>
      ${referrals.length ? `<div class="revenue-table-wrap"><table class="revenue-table"><thead><tr><th>Partner</th><th>Basis</th><th>Rate</th><th>Reward</th><th>Status</th><th></th></tr></thead><tbody>${referrals.map((item) => `<tr><td><strong>${esc(item.partnerName)}</strong></td><td>${money(item.revenueBasis,item.currency)}</td><td>${esc(item.percentage)}%</td><td>${money(item.amount,item.currency)}</td><td>${pill(item.status,item.status === 'PAID' ? 'green' : item.status === 'DUE' ? 'yellow' : '')}</td><td>${item.status === 'DUE' ? `<button class="btn small" data-revenue-action="pay-referral" data-id="${esc(item.id)}">Record payout</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="revenue-empty">This deal has no referral reward.</div>`}
    </section>`;
  }

  function workspaceHtml(payload) {
    const opportunity = payload.opportunity;
    const steps = lifecycleSteps(payload);
    return `<div class="revenue-backdrop" data-revenue-action="backdrop"><section class="revenue-workspace" role="dialog" aria-modal="true" aria-label="Revenue lifecycle workspace">
      <header class="revenue-workspace-head"><div><div class="eyebrow">REVENUE LIFECYCLE</div><h2>${esc(opportunity.name)}</h2><p>${esc(opportunity.project_name)} · ${esc(title(opportunity.service_type || 'Commercial opportunity'))}</p></div><button class="close" data-revenue-action="close">×</button></header>
      <div class="revenue-stepper">${steps.map((step, index) => `<div class="revenue-step ${step.state}"><span>${step.state === 'complete' ? '✓' : step.state === 'na' ? '—' : index + 1}</span><strong>${esc(step.label)}</strong></div>`).join('')}</div>
      <div class="revenue-workspace-body">
        <div class="revenue-toolbar"><div>${pill(opportunity.stage,stageTone(opportunity.stage))}</div><div>${actionButtons(payload)}</div></div>
        <div class="revenue-summary-grid">
          ${property('Deal value',money(opportunity.estimated_value,opportunity.currency),'finance-value')}
          ${property('Probability',`${Number(opportunity.probability_percentage || 0)}%`)}
          ${property('Expected close',date(opportunity.expected_close_date))}
          ${property('Owner',esc(opportunity.owner_name || 'Unassigned'))}
          ${property('Primary contact',esc(opportunity.primary_contact_name || 'Not selected'))}
          ${property('Next action',esc(opportunity.next_action || 'No next action'))}
        </div>
        <section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Qualification</strong><span>Need, decision-maker, timeline and budget must be confirmed before a proposal is sent.</span></div>${pill(opportunity.qualificationComplete ? 'Qualified' : 'Incomplete',opportunity.qualificationComplete ? 'green' : 'yellow')}</div><div class="revenue-check-grid">
          ${check('viewNeed','Need confirmed','The client has a clear business need.',Boolean(opportunity.need_confirmed)).replace('<input','<input disabled')}
          ${check('viewDecision','Decision-maker confirmed','The approval path is understood.',Boolean(opportunity.decision_maker_confirmed)).replace('<input','<input disabled')}
          ${check('viewTimeline','Timeline confirmed','A realistic decision or start date exists.',Boolean(opportunity.timeline_confirmed)).replace('<input','<input disabled')}
          ${check('viewBudget','Budget qualified',title(opportunity.budget_status || 'Unknown'),!['UNKNOWN','NOT_QUALIFIED',''].includes(String(opportunity.budget_status || '').toUpperCase())).replace('<input','<input disabled')}
        </div></section>
        <div class="revenue-two-col">
          <section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Proposal history</strong><span>Every commercial version remains preserved.</span></div>${payload.permissions.canWrite && !['WON','LOST'].includes(opportunity.stage) ? `<button class="btn small" data-revenue-action="proposal">New proposal</button>` : ''}</div>${payload.proposals.length ? `<div class="revenue-history">${payload.proposals.map((item) => timelineItem(item,'Proposal')).join('')}</div>` : `<div class="revenue-empty">No proposal recorded.</div>`}</section>
          <section class="revenue-panel"><div class="revenue-panel-head"><div><strong>Negotiation history</strong><span>Counteroffers, agreed terms and risks.</span></div>${payload.permissions.canWrite && !['WON','LOST'].includes(opportunity.stage) ? `<button class="btn small" data-revenue-action="negotiation">Add round</button>` : ''}</div>${payload.negotiations.length ? `<div class="revenue-history">${payload.negotiations.map((item) => timelineItem(item,'Negotiation')).join('')}</div>` : `<div class="revenue-empty">No negotiation round recorded.</div>`}</section>
        </div>
        ${engagementSection(payload)}
        ${financeSection(payload)}
      </div><div id="revenue-form-layer"></div>
    </section></div>`;
  }

  async function openWorkspace(opportunityId) {
    if (!opportunityId || state.opening) return;
    state.opening = true;
    const root = $('#modal-root');
    if (!root) return;
    root.innerHTML = `<div class="revenue-backdrop"><div class="revenue-loading"><strong>Opening revenue lifecycle…</strong><span>Loading qualification, proposals, engagement and revenue records.</span></div></div>`;
    try {
      state.workspace = await request(`/api/opportunities/${encodeURIComponent(opportunityId)}/workspace`);
      root.innerHTML = workspaceHtml(state.workspace);
    } catch (cause) {
      root.innerHTML = '';
      notify(cause.message || 'Revenue lifecycle could not be opened','error');
    } finally {
      state.opening = false;
    }
  }

  async function refreshWorkspace() {
    const id = state.workspace?.opportunity?.id;
    if (!id) return;
    state.workspace = await request(`/api/opportunities/${encodeURIComponent(id)}/workspace`);
    $('#modal-root').innerHTML = workspaceHtml(state.workspace);
  }

  function subForm(titleText, subtitle, body, submitText = 'Save') {
    const layer = $('#revenue-form-layer');
    if (!layer) return;
    layer.innerHTML = `<div class="revenue-form-backdrop"><form class="revenue-form-card" id="revenue-active-form"><header><div><div class="eyebrow">AKARI CRM</div><h3>${esc(titleText)}</h3><p>${esc(subtitle)}</p></div><button type="button" class="close" data-revenue-action="cancel-form">×</button></header><div class="revenue-form-body"><div class="revenue-field-grid">${body}</div></div><footer><button type="button" class="btn" data-revenue-action="cancel-form">Cancel</button><button type="submit" class="btn primary">${esc(submitText)}</button></footer></form></div>`;
  }

  function closeSubForm() {
    const layer = $('#revenue-form-layer');
    if (layer) layer.innerHTML = '';
  }

  function bindSubmit(handler) {
    const form = $('#revenue-active-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const original = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        await handler(Object.fromEntries(new FormData(form)));
        closeSubForm();
        await refreshWorkspace();
      } catch (cause) {
        notify(cause.message || 'Unable to save','error');
        submit.disabled = false;
        submit.textContent = original;
      }
    });
  }

  function openQualificationForm() {
    const o = state.workspace.opportunity;
    subForm('Qualification checklist','Confirm the commercial conditions before moving this opportunity to qualified.',`
      ${select('budgetStatus','Budget status',[['UNKNOWN','Unknown'],['NOT_DISCLOSED','Not disclosed'],['ESTIMATED','Estimated'],['CONFIRMED','Confirmed'],['NOT_QUALIFIED','Not qualified']],o.budget_status || 'UNKNOWN',{required:true})}
      ${field('nextFollowUpAt','Next follow-up',{type:'datetime-local',value:dateTimeInput(o.next_follow_up_at)})}
      ${check('needConfirmed','Need confirmed','The client has a material and understood need.',Boolean(o.need_confirmed))}
      ${check('decisionMakerConfirmed','Decision-maker confirmed','The approver or approval path is known.',Boolean(o.decision_maker_confirmed))}
      ${check('timelineConfirmed','Timeline confirmed','There is a realistic buying or start timeline.',Boolean(o.timeline_confirmed))}
      ${check('markQualified','Mark as qualified','Move the opportunity to Qualified when every condition is complete.',Boolean(o.qualificationComplete))}
      ${textarea('nextAction','Next action',{value:o.next_action || '',required:true,placeholder:'Prepare proposal, confirm budget owner…'})}
    `,'Update qualification');
    bindSubmit(async (data) => request(`/api/opportunities/${encodeURIComponent(o.id)}/qualification`, { method:'PATCH', body:JSON.stringify({ ...data, needConfirmed:Boolean(data.needConfirmed), decisionMakerConfirmed:Boolean(data.decisionMakerConfirmed), timelineConfirmed:Boolean(data.timelineConfirmed), markQualified:Boolean(data.markQualified) }) }));
  }

  function openProposalForm() {
    const o = state.workspace.opportunity;
    subForm('Record proposal','Create a versioned commercial proposal linked to this opportunity.',`
      ${field('title','Proposal title',{value:`${o.name} proposal`,required:true})}
      ${select('status','Status',[['SENT','Sent'],['DRAFT','Draft'],['ACCEPTED','Accepted'],['REJECTED','Rejected'],['EXPIRED','Expired']], 'SENT',{required:true})}
      ${field('serviceType','Service type',{value:o.service_type || '',required:true,placeholder:'GTM strategy, creator campaign, advisory…'})}
      ${select('commercialModel','Commercial model',[['FIXED_FEE','Fixed fee'],['RETAINER','Retainer'],['SUCCESS_FEE','Success fee'],['HYBRID','Hybrid'],['OTHER','Other']],'FIXED_FEE')}
      ${field('amount','Proposal amount',{type:'number',value:o.estimated_value || 0,min:0,step:'0.01',required:true})}
      ${select('currency','Currency',[['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']],o.currency || 'USD')}
      ${textarea('scope','Scope',{required:true,placeholder:'What AKARI will solve and the boundaries of the work.'})}
      ${textarea('deliverables','Deliverables',{required:true,placeholder:'Concrete outputs, quantities and responsibilities.'})}
      ${textarea('timeline','Timeline',{placeholder:'Phases, start assumptions and delivery dates.'})}
      ${textarea('paymentTerms','Payment terms',{placeholder:'Deposit, milestone or monthly payment terms.'})}
      ${field('validityDate','Valid until',{type:'date'})}
      ${field('documentUrl','Proposal document URL',{type:'url',placeholder:'https://'})}
      ${field('followUpAt','Proposal follow-up',{type:'datetime-local'})}
      ${textarea('nextAction','Next action',{value:'Follow up on proposal',required:true})}
    `,'Save proposal');
    bindSubmit(async (data) => request(`/api/opportunities/${encodeURIComponent(o.id)}/proposal`, { method:'POST', body:JSON.stringify(data) }));
  }

  function openNegotiationForm() {
    const o = state.workspace.opportunity;
    subForm('Record negotiation round','Preserve the offer, requested changes, agreed terms and next decision.',`
      ${select('outcome','Round outcome',[['OPEN','Open'],['COUNTERED','Countered'],['AGREED_IN_PRINCIPLE','Agreed in principle'],['STALLED','Stalled'],['REJECTED','Rejected']],'OPEN',{required:true})}
      ${field('currentOffer','Current offer',{type:'number',value:o.estimated_value || 0,min:0,step:'0.01',required:true})}
      ${select('currency','Currency',[['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']],o.currency || 'USD')}
      ${field('decisionDate','Expected decision date',{type:'date'})}
      ${textarea('summary','Negotiation summary',{required:true,placeholder:'What happened and where the parties currently stand.'})}
      ${textarea('requestedChanges','Requested changes',{placeholder:'Scope, price, timing or legal/commercial changes.'})}
      ${textarea('agreedTerms','Terms agreed so far',{placeholder:'Items already accepted by both sides.'})}
      ${textarea('commercialRisk','Commercial risk',{placeholder:'Discount pressure, dependency, payment or delivery risk.'})}
      ${field('followUpAt','Next follow-up',{type:'datetime-local'})}
      ${textarea('nextAction','Next action',{value:'Progress negotiation',required:true})}
    `,'Save negotiation round');
    bindSubmit(async (data) => request(`/api/opportunities/${encodeURIComponent(o.id)}/negotiation`, { method:'POST', body:JSON.stringify(data) }));
  }

  async function partnerItems(selected = '') {
    state.partners ||= await request('/api/partners').catch(() => ({ items:[] }));
    return [['','No referral / direct'],...(state.partners.items || []).map((item) => [item.id, `${item.name}${item.default_referral_percentage ? ` · ${item.default_referral_percentage}%` : ''}`])];
  }

  async function openWonForm() {
    const o = state.workspace.opportunity;
    const partners = await partnerItems();
    subForm('Close as won','Convert the relationship to a client and create the first service engagement.',`
      ${field('finalValue','Final contract value',{type:'number',value:o.estimated_value || 0,min:0.01,step:'0.01',required:true})}
      ${select('currency','Currency',[['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']],o.currency || 'USD')}
      ${field('engagementName','Engagement name',{value:`${o.project_name} · ${o.name}`,required:true})}
      ${field('serviceType','Service type',{value:o.service_type || '',required:true})}
      ${select('commercialModel','Commercial model',[['FIXED_FEE','Fixed fee'],['RETAINER','Retainer'],['SUCCESS_FEE','Success fee'],['HYBRID','Hybrid'],['OTHER','Other']],'FIXED_FEE')}
      ${field('startDate','Service start',{type:'date',required:true})}
      ${field('endDate','Expected end',{type:'date'})}
      ${textarea('deliverables','Confirmed deliverables',{required:true,placeholder:'The services and outputs the client has agreed to.'})}
      ${textarea('paymentTerms','Payment terms',{placeholder:'Deposit, milestone, monthly or success-fee terms.'})}
      ${textarea('billingSchedule','Billing schedule',{placeholder:'When invoices should be issued.'})}
      ${field('campaignCost','Campaign / delivery cost',{type:'number',value:0,min:0,step:'0.01'})}
      ${field('creatorCost','Creator cost',{type:'number',value:0,min:0,step:'0.01'})}
      ${field('otherCost','Other direct cost',{type:'number',value:0,min:0,step:'0.01'})}
      ${select('referralPartnerId','Referral partner',partners,o.referral_partner_id || o.project_referral_partner_id || '')}
      ${field('referralPercentage','Referral %',{type:'number',value:o.default_referral_percentage || 0,min:0,max:100,step:'0.01'})}
      ${textarea('closeNotes','Closing notes',{placeholder:'Final commercial context and onboarding notes.'})}
    `,'Create client engagement');
    bindSubmit(async (data) => request(`/api/opportunities/${encodeURIComponent(o.id)}/close`, { method:'POST', body:JSON.stringify({ ...data, outcome:'WON' }) }));
  }

  function openLostForm() {
    const o = state.workspace.opportunity;
    subForm('Close as lost','Capture why the opportunity did not progress so AKARI keeps the learning.',`
      ${textarea('lostReason','Lost reason',{required:true,placeholder:'Budget, timing, fit, no response, competitor, internal decision…'})}
      ${field('competitor','Competitor / alternative',{placeholder:'Who or what they chose instead'})}
      ${textarea('closeNotes','Additional learning',{placeholder:'Signals, objections and what should change next time.'})}
      ${textarea('nextAction','Future action',{value:'Closed lost',placeholder:'Revisit in six months, keep relationship warm…'})}
    `,'Close opportunity');
    bindSubmit(async (data) => request(`/api/opportunities/${encodeURIComponent(o.id)}/close`, { method:'POST', body:JSON.stringify({ ...data, outcome:'LOST' }) }));
  }

  async function openEngagementForm(id) {
    const item = state.workspace.engagements.find((entry) => entry.id === id);
    if (!item) return;
    const partners = await partnerItems();
    subForm('Manage service engagement','Control onboarding, delivery, commercial costs and the referral calculation.',`
      ${field('name','Engagement name',{value:item.name,required:true})}
      ${select('status','Status',[['CONFIRMED','Confirmed'],['ONBOARDING','Onboarding'],['PLANNING','Planning'],['CREATOR_SELECTION','Creator selection'],['LIVE','Live'],['REPORTING','Reporting'],['COMPLETED','Completed'],['PAUSED','Paused'],['CANCELLED','Cancelled']],item.status,{required:true})}
      ${field('serviceType','Service type',{value:item.serviceType || '',required:true})}
      ${select('commercialModel','Commercial model',[['FIXED_FEE','Fixed fee'],['RETAINER','Retainer'],['SUCCESS_FEE','Success fee'],['HYBRID','Hybrid'],['OTHER','Other']],item.commercialModel || 'FIXED_FEE')}
      ${field('startDate','Start date',{type:'date',value:dateInput(item.startDate)})}
      ${field('endDate','End date',{type:'date',value:dateInput(item.endDate)})}
      ${textarea('deliverables','Deliverables',{value:item.deliverables || '',required:true})}
      ${textarea('nextAction','Next action',{value:item.nextAction || '',required:true})}
      ${state.workspace.permissions.canFinance ? `
        ${field('grossRevenue','Contract value',{type:'number',value:item.grossRevenue,min:0,step:'0.01'})}
        ${field('campaignCost','Campaign / delivery cost',{type:'number',value:item.metadata?.campaignCost || 0,min:0,step:'0.01'})}
        ${field('creatorCost','Creator cost',{type:'number',value:item.metadata?.creatorCost || 0,min:0,step:'0.01'})}
        ${field('otherCost','Other direct cost',{type:'number',value:item.directCosts || 0,min:0,step:'0.01',help:'Enter the non-campaign and non-creator portion only.'})}
        ${select('referralPartnerId','Referral partner',partners,item.referralPartnerId || '')}
        ${field('referralPercentage','Referral %',{type:'number',value:item.referralPercentage,min:0,max:100,step:'0.01'})}
      ` : ''}
      ${textarea('ownerNotes','Internal engagement notes',{value:item.metadata?.ownerNotes || ''})}
    `,'Update engagement');
    bindSubmit(async (data) => request(`/api/engagements/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(data) }));
  }

  async function openInvoiceForm(engagementId) {
    const o = state.workspace.opportunity;
    const engagement = state.workspace.engagements.find((item) => item.id === engagementId);
    if (!engagement) return;
    const billing = await request('/api/billing-profile');
    const profile = billing.billingProfile || {};
    if (!profile.legalName || !profile.addressLine1 || !profile.country) {
      notify('Complete Organisation billing in Settings before issuing an invoice.','error');
      return;
    }
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + Number(profile.defaultPaymentTermsDays || 14));
    subForm('Create engagement invoice','Issue an invoice directly from the won opportunity and service engagement.',`
      ${field('recipientName','Client billing name',{value:o.project_name,required:true})}
      ${field('recipientEmail','Billing email',{type:'email',value:o.primary_contact_email || ''})}
      ${field('recipientContactName','Contact person',{value:o.primary_contact_name || ''})}
      ${field('recipientAddressLine1','Client address',{required:true})}
      ${field('recipientCity','City')}
      ${field('recipientPostalCode','Postal code')}
      ${field('recipientCountry','Country',{required:true})}
      ${field('invoiceDate','Invoice date',{type:'date',value:today.toISOString().slice(0,10),required:true})}
      ${field('dueDate','Due date',{type:'date',value:due.toISOString().slice(0,10)})}
      ${select('currency','Currency',[['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']],engagement.currency || 'USD')}
      ${field('description','Invoice item',{value:engagement.name,required:true})}
      ${field('amount','Invoice amount',{type:'number',value:engagement.grossRevenue,min:0,step:'0.01',required:true})}
      ${field('taxRate','Tax rate %',{type:'number',value:profile.defaultTaxRate || 0,min:0,max:100,step:'0.01'})}
      ${field('taxLabel','Tax note',{placeholder:'Reverse charge, outside EU, VAT…'})}
      ${textarea('notes','Invoice notes',{placeholder:'Service period, scope or milestone.'})}
    `,'Create invoice');
    bindSubmit(async (data) => request('/api/invoices', { method:'POST', body:JSON.stringify({
      projectId:o.project_id,
      campaignId:engagement.id,
      opportunityId:o.id,
      invoiceDate:data.invoiceDate,
      dueDate:data.dueDate,
      currency:data.currency,
      status:'INVOICED',
      taxRate:Number(data.taxRate || 0),
      taxLabel:data.taxLabel,
      notes:data.notes,
      recipient:{ name:data.recipientName, email:data.recipientEmail, contactName:data.recipientContactName, addressLine1:data.recipientAddressLine1, city:data.recipientCity, postalCode:data.recipientPostalCode, country:data.recipientCountry },
      lineItems:[{ description:data.description, quantity:1, unitPrice:Number(data.amount || 0) }],
    }) }));
  }

  function openPaymentForm() {
    const invoices = (state.workspace.finance?.invoices || []).filter((item) => Number(item.outstanding || 0) > 0);
    if (!invoices.length) return notify('There is no outstanding invoice to pay.','error');
    const firstInvoice = invoices[0];
    subForm('Record client payment','Allocate a payment against an outstanding invoice. Full payment releases the referral reward as due.',`
      ${select('invoiceId','Invoice',invoices.map((item) => [item.id,`${item.invoiceNumber} · ${money(item.outstanding,item.currency)} outstanding`]),firstInvoice.id,{required:true})}
      ${field('amount','Payment amount',{type:'number',value:firstInvoice.outstanding,min:0.01,step:'0.01',required:true})}
      ${field('receivedDate','Received date',{type:'date',value:new Date().toISOString().slice(0,10),required:true})}
      ${select('paymentMethod','Payment method',[['BANK_TRANSFER','Bank transfer'],['USDT','USDT'],['CRYPTO','Crypto'],['CARD','Card'],['OTHER','Other']],'BANK_TRANSFER')}
      ${field('reference','Transaction / bank reference',{required:true})}
      ${field('referralDueInDays','Referral due in days',{type:'number',value:7,min:0,max:365})}
      ${textarea('notes','Payment notes')}
    `,'Record payment');
    const form = $('#revenue-active-form');
    const invoiceSelect = form.elements.invoiceId;
    invoiceSelect.addEventListener('change', () => {
      const invoice = invoices.find((item) => item.id === invoiceSelect.value);
      if (invoice) form.elements.amount.value = invoice.outstanding;
    });
    bindSubmit(async (data) => request(`/api/invoices/${encodeURIComponent(data.invoiceId)}/receipts`, { method:'POST', body:JSON.stringify(data) }));
  }

  function openReferralForm(id) {
    const referral = state.workspace.finance?.referrals?.find((item) => item.id === id);
    if (!referral) return;
    subForm('Record referral payout',`${referral.partnerName} · ${money(referral.amount,referral.currency)}`,`
      ${field('paidDate','Paid date',{type:'date',value:new Date().toISOString().slice(0,10),required:true})}
      ${field('transactionReference','Transaction / payment reference',{required:true,placeholder:'TX hash or bank reference'})}
      ${textarea('notes','Payout notes')}
    `,'Mark referral paid');
    bindSubmit(async (data) => request(`/api/referrals/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify({ ...data, status:'PAID' }) }));
  }

  function enhanceOpportunityCards() {
    $$('.deal-card').forEach((card) => {
      if (card.dataset.revenueEnhanced === 'ready') return;
      const stageSelect = card.querySelector('.stage-select[data-id]');
      if (!stageSelect) return;
      card.dataset.revenueEnhanced = 'ready';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small revenue-manage-button';
      button.dataset.revenueAction = 'open';
      button.dataset.id = stageSelect.dataset.id;
      button.textContent = 'Manage lifecycle';
      stageSelect.insertAdjacentElement('afterend', button);
    });
  }

  async function enhanceRelationshipDrawer() {
    const drawer = $('#drawer-root .drawer.open');
    const id = sessionStorage.getItem('akari-current-lead-id');
    if (!drawer || !id || drawer.dataset.revenueEnhanced === 'loading') return;
    const active = drawer.querySelector('.drawer-tab.active')?.textContent?.trim()?.toLowerCase();
    if (active !== 'overview' || drawer.querySelector('[data-revenue-relationships]')) return;
    drawer.dataset.revenueEnhanced = 'loading';
    try {
      const project = await request(`/api/projects/${encodeURIComponent(id)}`);
      if (!document.body.contains(drawer) || drawer.querySelector('[data-revenue-relationships]')) return;
      const opportunities = project.opportunities || [];
      const section = document.createElement('section');
      section.className = 'drawer-section revenue-relationship-section';
      section.dataset.revenueRelationships = 'ready';
      section.innerHTML = `<h3>Revenue lifecycle</h3>${opportunities.length ? `<div class="revenue-drawer-deals">${opportunities.map((item) => `<article><div><strong>${esc(item.name)}</strong><span>${esc(title(item.stage))} · ${money(item.estimated_value,item.currency || 'USD')}</span></div><button class="btn small" data-revenue-action="open" data-id="${esc(item.id)}">Manage</button></article>`).join('')}</div>` : `<div class="revenue-empty">Create an opportunity to begin the qualified lead → revenue workflow.</div>`}`;
      drawer.querySelector('.drawer-body')?.prepend(section);
    } catch {
      // The canonical drawer remains fully usable when this optional enhancer cannot load.
    } finally {
      drawer.dataset.revenueEnhanced = 'ready';
    }
  }

  async function action(name, element) {
    if (name === 'open') return openWorkspace(element.dataset.id);
    if (name === 'close' || name === 'backdrop') return closeWorkspace();
    if (name === 'cancel-form') return closeSubForm();
    if (name === 'refresh') return refreshWorkspace();
    if (name === 'qualification') return openQualificationForm();
    if (name === 'proposal') return openProposalForm();
    if (name === 'negotiation') return openNegotiationForm();
    if (name === 'close-won') return openWonForm();
    if (name === 'close-lost') return openLostForm();
    if (name === 'edit-engagement') return openEngagementForm(element.dataset.id);
    if (name === 'invoice') return openInvoiceForm(element.dataset.id);
    if (name === 'payment') return openPaymentForm();
    if (name === 'pay-referral') return openReferralForm(element.dataset.id);
  }

  document.addEventListener('click', async (event) => {
    const element = event.target.closest('[data-revenue-action]');
    if (!element) return;
    const name = element.dataset.revenueAction;
    if (name === 'backdrop' && event.target !== element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { await action(name, element); } catch (cause) { notify(cause.message || 'Action failed','error'); }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('#revenue-form-layer .revenue-form-backdrop')) closeSubForm();
    else if ($('#modal-root .revenue-workspace')) closeWorkspace();
  });

  const observer = new MutationObserver(() => {
    enhanceOpportunityCards();
    enhanceRelationshipDrawer();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', () => {
    enhanceOpportunityCards();
    enhanceRelationshipDrawer();
  });
})();
