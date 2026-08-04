(() => {
  'use strict';

  const state = {
    opportunityId: null,
    workspace: null,
    clientProfile: null,
    loadingWorkspace: false,
    loadingProfile: false,
    scheduled: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
  const title = (value) => String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^./, (char) => char.toUpperCase());

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
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function captureOpportunity(element) {
    const trigger = element?.closest?.('[data-revenue-action="open"][data-id]');
    if (!trigger) return;
    state.opportunityId = trigger.dataset.id || null;
    state.workspace = null;
    state.clientProfile = null;
  }

  document.addEventListener('pointerdown', (event) => captureOpportunity(event.target), true);
  document.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    captureOpportunity(event.target);
  }, true);

  function readinessItem(label, complete, detail) {
    return `<div class="bd-readiness-item ${complete ? 'is-complete' : 'is-open'}">
      <span aria-hidden="true">${complete ? '✓' : '•'}</span>
      <div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div>
    </div>`;
  }

  function readinessPanel(payload) {
    const readiness = payload.commercialReadiness || {};
    const profile = payload.clientBilling?.profile || {};
    const missing = readiness.clientBillingMissing || [];
    const engagement = (payload.engagements || []).find((item) => item.invoiceEligible && item.status !== 'CANCELLED');
    const canEdit = Boolean(payload.permissions?.canEditClientBilling);
    const canFinance = Boolean(payload.permissions?.canFinance);
    const clientDetail = readiness.clientBillingReady
      ? `${profile.legalName || payload.opportunity?.project_name || 'Client'} · ${profile.billingEmail || 'Billing identity saved'}`
      : `Missing: ${missing.length ? missing.map(title).join(', ') : 'client billing details'}`;

    return `<section class="revenue-panel bd-commercial-readiness" data-bd-commercial-readiness="ready">
      <div class="revenue-panel-head bd-commercial-readiness__head">
        <div><strong>Commercial readiness</strong><span>One controlled path from qualified opportunity to collected revenue.</span></div>
        <span class="revenue-pill ${readiness.invoiceReady ? 'green' : 'yellow'}">${readiness.invoiceReady ? 'Invoice ready' : 'Action required'}</span>
      </div>
      <div class="bd-next-action">
        <span>Next safe action</span>
        <strong>${esc(readiness.nextAction || 'Keep the deal moving with one clear next action.')}</strong>
      </div>
      <div class="bd-readiness-grid">
        ${readinessItem('Qualification', readiness.qualified, readiness.qualified ? 'Commercial need, authority, timeline and budget are confirmed.' : 'Complete the qualification checklist.')}
        ${readinessItem('Proposal', readiness.proposalRecorded, readiness.proposalAccepted ? 'Accepted proposal recorded.' : readiness.proposalRecorded ? 'Proposal exists; record the response and decision.' : 'No proposal has been recorded.')}
        ${readinessItem('Deal outcome', readiness.won || readiness.lost, readiness.won ? 'Won and converted into a client.' : readiness.lost ? 'Lost with learning preserved.' : 'The commercial decision is still open.')}
        ${readinessItem('Client billing profile', readiness.clientBillingReady, clientDetail)}
        ${readinessItem('Service engagement', readiness.engagementReady, readiness.engagementReady ? 'Delivery and commercial economics are connected.' : 'No active engagement is connected to the won deal.')}
        ${readinessItem('Invoice and collection', readiness.invoiceCount > 0, readiness.invoiceCount > 0 ? `${readiness.invoiceCount} invoice(s) · ${Number(readiness.outstanding || 0) > 0 ? 'outstanding balance remains' : 'no outstanding balance'}.` : 'No invoice has been issued.')}
      </div>
      <div class="revenue-panel-actions bd-commercial-readiness__actions">
        ${canEdit ? '<button type="button" class="btn" data-client-billing-action="edit">Edit client billing</button>' : ''}
        ${readiness.invoiceReady && canFinance && engagement ? `<button type="button" class="btn primary" data-revenue-action="invoice" data-id="${esc(engagement.id)}">Create invoice</button>` : ''}
      </div>
    </section>`;
  }

  async function loadWorkspace() {
    if (!state.opportunityId || state.loadingWorkspace) return null;
    state.loadingWorkspace = true;
    try {
      state.workspace = await request(`/api/opportunities/${encodeURIComponent(state.opportunityId)}/workspace`);
      state.clientProfile = state.workspace.clientBilling || null;
      return state.workspace;
    } finally {
      state.loadingWorkspace = false;
    }
  }

  async function enhanceWorkspace() {
    const workspace = $('#modal-root .revenue-workspace');
    if (!workspace || workspace.querySelector('[data-bd-commercial-readiness]')) return;
    if (!state.opportunityId) return;
    try {
      const payload = state.workspace || await loadWorkspace();
      if (!payload || !workspace.isConnected || workspace.querySelector('[data-bd-commercial-readiness]')) return;
      const summary = workspace.querySelector('.revenue-summary-grid');
      if (!summary) return;
      summary.insertAdjacentHTML('afterend', readinessPanel(payload));
    } catch (cause) {
      console.warn('AKARI commercial readiness could not be loaded', cause);
    }
  }

  function field(name, label, value = '', options = {}) {
    const { type = 'text', required = false, full = false, placeholder = '', min = '', max = '', step = '' } = options;
    return `<label class="revenue-field ${full ? 'full' : ''}"><span>${esc(label)}${required ? ' *' : ''}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value || '')}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" ${min !== '' ? `min="${esc(min)}"` : ''} ${max !== '' ? `max="${esc(max)}"` : ''} ${step !== '' ? `step="${esc(step)}"` : ''}></label>`;
  }

  function selectField(name, label, options, selected, full = false) {
    return `<label class="revenue-field ${full ? 'full' : ''}"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([value, copy]) => `<option value="${esc(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${esc(copy)}</option>`).join('')}</select></label>`;
  }

  function textarea(name, label, value = '', placeholder = '') {
    return `<label class="revenue-field full"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="3" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea></label>`;
  }

  async function loadClientProfile(force = false) {
    const projectId = state.workspace?.opportunity?.project_id;
    if (!projectId) return null;
    if (state.clientProfile && !force) return state.clientProfile;
    if (state.loadingProfile) return null;
    state.loadingProfile = true;
    try {
      state.clientProfile = await request(`/api/projects/${encodeURIComponent(projectId)}/billing-profile`);
      return state.clientProfile;
    } finally {
      state.loadingProfile = false;
    }
  }

  async function openClientBillingForm() {
    const payload = await loadClientProfile(true);
    const layer = $('#revenue-form-layer');
    if (!payload || !layer) return;
    const profile = payload.profile || {};
    const missing = payload.readiness?.missing || [];
    layer.innerHTML = `<div class="revenue-form-backdrop" data-client-billing-action="backdrop">
      <form class="revenue-form-card bd-client-billing-form" id="bd-client-billing-form">
        <header><div><div class="eyebrow">BD + REVENUE OPERATIONS</div><h3>Client billing profile</h3><p>Save the client identity once and reuse it across engagement invoices.</p></div><button type="button" class="close" data-client-billing-action="close" aria-label="Close client billing profile">×</button></header>
        <div class="revenue-form-body">
          ${missing.length ? `<div class="bd-profile-warning"><strong>Invoice readiness is incomplete</strong><span>Missing: ${esc(missing.map(title).join(', '))}</span></div>` : '<div class="bd-profile-ready"><strong>Invoice-ready profile</strong><span>The required client identity is complete.</span></div>'}
          <div class="revenue-field-grid bd-client-billing-grid">
            ${field('legalName', 'Client legal / billing name', profile.legalName, { required: true })}
            ${field('billingEmail', 'Billing email', profile.billingEmail, { type: 'email', required: true })}
            ${field('contactName', 'Billing contact', profile.contactName)}
            ${field('vatId', 'VAT / tax ID', profile.vatId)}
            ${field('addressLine1', 'Address line 1', profile.addressLine1, { required: true, full: true })}
            ${field('addressLine2', 'Address line 2', profile.addressLine2, { full: true })}
            ${field('city', 'City', profile.city, { required: true })}
            ${field('postalCode', 'Postal code', profile.postalCode)}
            ${field('country', 'Country', profile.country, { required: true })}
            ${field('registrationNumber', 'Registration number', profile.registrationNumber)}
            ${selectField('preferredCurrency', 'Preferred currency', [['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']], profile.preferredCurrency || 'USD')}
            ${field('paymentTermsDays', 'Payment terms (days)', profile.paymentTermsDays ?? 14, { type: 'number', min: 0, max: 365, step: 1 })}
            ${selectField('defaultTaxMode', 'Default tax treatment', [['NONE','No tax'],['EXCLUSIVE','Tax excluded · add tax'],['INCLUSIVE','Tax included · extract tax']], profile.defaultTaxMode || 'NONE')}
            ${field('defaultTaxRate', 'Default tax rate %', profile.defaultTaxRate ?? 0, { type: 'number', min: 0, max: 100, step: '0.01' })}
            ${textarea('paymentInstructions', 'Client-specific payment note', profile.paymentInstructions, 'Optional note carried into the invoice workflow.')}
            ${textarea('internalNotes', 'Internal billing notes', profile.internalNotes, 'Private finance or contract context.')}
          </div>
        </div>
        <footer><button type="button" class="btn" data-client-billing-action="close">Cancel</button><button type="submit" class="btn primary">Save client billing</button></footer>
      </form>
    </div>`;

    const form = $('#bd-client-billing-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const data = Object.fromEntries(new FormData(form));
        state.clientProfile = await request(`/api/projects/${encodeURIComponent(payload.project.id)}/billing-profile`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        state.workspace = await request(`/api/opportunities/${encodeURIComponent(state.opportunityId)}/workspace`);
        layer.innerHTML = '';
        const existing = $('[data-bd-commercial-readiness]');
        existing?.remove();
        await enhanceWorkspace();
        notify('Client billing profile saved');
      } catch (cause) {
        notify(cause.message || 'Client billing profile could not be saved', 'error');
        submit.disabled = false;
        submit.textContent = 'Save client billing';
      }
    });
  }

  function closeClientBillingForm() {
    const layer = $('#revenue-form-layer');
    if (layer?.querySelector('#bd-client-billing-form')) layer.innerHTML = '';
  }

  function addDays(dateValue, days) {
    const date = new Date(`${dateValue || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return '';
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function ensureInvoiceField(grid, name, label, value = '', afterName = '') {
    let control = grid.querySelector(`[name="${name}"]`);
    if (control) return control;
    const wrapper = document.createElement('label');
    wrapper.className = 'revenue-field';
    wrapper.innerHTML = `<span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value || '')}">`;
    const after = afterName ? grid.querySelector(`[name="${afterName}"]`)?.closest('.revenue-field') : null;
    if (after) after.insertAdjacentElement('afterend', wrapper);
    else grid.appendChild(wrapper);
    return wrapper.querySelector('input');
  }

  async function enhanceRevenueInvoiceForm() {
    const form = $('#revenue-active-form');
    if (!form || form.dataset.bdInvoiceReadinessR31 === 'ready') return;
    const heading = form.querySelector('header h3')?.textContent?.trim();
    if (heading !== 'Create engagement invoice') return;
    const profilePayload = await loadClientProfile();
    if (!profilePayload || !form.isConnected) return;
    const profile = profilePayload.profile || {};
    const grid = form.querySelector('.revenue-field-grid');
    if (!grid) return;

    form.dataset.bdInvoiceReadinessR31 = 'ready';
    form.dataset.projectId = state.workspace?.opportunity?.project_id || '';

    const intro = document.createElement('div');
    intro.className = 'bd-invoice-profile-note full';
    intro.innerHTML = `<div><strong>${profilePayload.saved ? 'Client billing profile applied' : 'Client billing defaults applied'}</strong><span>${profilePayload.readiness?.complete ? 'Required recipient details are complete.' : `Still missing: ${(profilePayload.readiness?.missing || []).map(title).join(', ') || 'billing identity'}.`}</span></div><button type="button" class="btn small" data-client-billing-action="edit">Edit profile</button>`;
    grid.prepend(intro);

    const values = {
      recipientName: profile.legalName,
      recipientEmail: profile.billingEmail,
      recipientContactName: profile.contactName,
      recipientAddressLine1: profile.addressLine1,
      recipientCity: profile.city,
      recipientPostalCode: profile.postalCode,
      recipientCountry: profile.country,
    };
    for (const [name, value] of Object.entries(values)) {
      const control = form.elements[name];
      if (control && value) control.value = value;
    }

    ensureInvoiceField(grid, 'recipientAddressLine2', 'Address line 2', profile.addressLine2, 'recipientAddressLine1');
    ensureInvoiceField(grid, 'recipientVatId', 'VAT / tax ID', profile.vatId, 'recipientCountry');
    ensureInvoiceField(grid, 'recipientRegistrationNumber', 'Registration number', profile.registrationNumber, 'recipientVatId');

    if (!form.elements.taxMode) {
      const taxRateField = form.elements.taxRate?.closest('.revenue-field');
      const wrapper = document.createElement('label');
      wrapper.className = 'revenue-field';
      wrapper.innerHTML = `<span>Tax treatment *</span><select name="taxMode" required>
        <option value="NONE">No tax</option>
        <option value="EXCLUSIVE">Tax excluded · add tax</option>
        <option value="INCLUSIVE">Tax included · extract tax</option>
      </select>`;
      taxRateField?.insertAdjacentElement('beforebegin', wrapper);
    }
    if (form.elements.taxMode) form.elements.taxMode.value = profile.defaultTaxMode || 'NONE';
    if (form.elements.taxRate) form.elements.taxRate.value = profile.defaultTaxRate ?? 0;
    if (form.elements.currency && profile.preferredCurrency && [...form.elements.currency.options].some((option) => option.value === profile.preferredCurrency)) {
      form.elements.currency.value = profile.preferredCurrency;
    }
    if (form.elements.invoiceDate && form.elements.dueDate) {
      form.elements.dueDate.value = addDays(form.elements.invoiceDate.value, profile.paymentTermsDays ?? 14);
      form.elements.invoiceDate.addEventListener('change', () => {
        form.elements.dueDate.value = addDays(form.elements.invoiceDate.value, profile.paymentTermsDays ?? 14);
      });
    }

    const save = document.createElement('label');
    save.className = 'revenue-check full bd-save-profile-check';
    save.innerHTML = '<input type="checkbox" name="saveClientBillingProfile" checked><span><strong>Keep client billing profile updated</strong><small>Save recipient changes before the invoice is created.</small></span>';
    grid.appendChild(save);
  }

  function profileFromInvoiceForm(form) {
    return {
      legalName: form.elements.recipientName?.value,
      billingEmail: form.elements.recipientEmail?.value,
      contactName: form.elements.recipientContactName?.value,
      addressLine1: form.elements.recipientAddressLine1?.value,
      addressLine2: form.elements.recipientAddressLine2?.value,
      city: form.elements.recipientCity?.value,
      postalCode: form.elements.recipientPostalCode?.value,
      country: form.elements.recipientCountry?.value,
      vatId: form.elements.recipientVatId?.value,
      registrationNumber: form.elements.recipientRegistrationNumber?.value,
      preferredCurrency: form.elements.currency?.value,
      defaultTaxMode: form.elements.taxMode?.value,
      defaultTaxRate: form.elements.taxRate?.value,
      paymentTermsDays: state.clientProfile?.profile?.paymentTermsDays ?? 14,
      paymentInstructions: state.clientProfile?.profile?.paymentInstructions || '',
      internalNotes: state.clientProfile?.profile?.internalNotes || '',
    };
  }

  function patchInvoiceRequest() {
    if (window.fetch?.bdInvoicingR31 === 'ready') return;
    const nativeFetch = window.fetch.bind(window);

    async function bdAwareFetch(input, init = {}) {
      try {
        const method = String(init.method || input?.method || 'GET').toUpperCase();
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        const form = $('#revenue-active-form[data-bd-invoice-readiness-r31="ready"]');
        if (method === 'POST' && url.pathname === '/api/invoices' && form && typeof init.body === 'string') {
          const payload = JSON.parse(init.body);
          payload.recipient ||= {};
          payload.recipient.addressLine2 = form.elements.recipientAddressLine2?.value || null;
          payload.recipient.vatId = form.elements.recipientVatId?.value || null;
          payload.recipient.registrationNumber = form.elements.recipientRegistrationNumber?.value || null;
          payload.taxMode = form.elements.taxMode?.value || 'NONE';
          if (payload.taxMode === 'NONE') payload.taxRate = 0;

          const projectId = form.dataset.projectId;
          if (projectId && form.elements.saveClientBillingProfile?.checked) {
            const saved = await nativeFetch(`/api/projects/${encodeURIComponent(projectId)}/billing-profile`, {
              method: 'PATCH',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(profileFromInvoiceForm(form)),
            });
            if (!saved.ok) return saved;
            state.clientProfile = await saved.clone().json().catch(() => state.clientProfile);
          }
          return nativeFetch(input, { ...init, body: JSON.stringify(payload) });
        }
      } catch (cause) {
        console.warn('AKARI BD invoice readiness patch could not be applied', cause);
      }
      return nativeFetch(input, init);
    }

    bdAwareFetch.bdInvoicingR31 = 'ready';
    bdAwareFetch.nativeFetch = nativeFetch;
    window.fetch = bdAwareFetch;
  }

  async function maintain() {
    state.scheduled = false;
    patchInvoiceRequest();
    await enhanceWorkspace();
    await enhanceRevenueInvoiceForm();
  }

  function scheduleMaintain() {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(maintain);
  }

  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-client-billing-action]');
    if (!action) return;
    const name = action.dataset.clientBillingAction;
    if (name === 'backdrop' && event.target !== action) return;
    event.preventDefault();
    event.stopPropagation();
    if (name === 'edit') {
      try { await openClientBillingForm(); } catch (cause) { notify(cause.message || 'Client billing profile could not be opened', 'error'); }
    } else if (name === 'close' || name === 'backdrop') {
      closeClientBillingForm();
    }
  }, true);

  new MutationObserver(scheduleMaintain).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scheduleMaintain);
  document.addEventListener('akari:route-rendered', scheduleMaintain);
  scheduleMaintain();
})();
