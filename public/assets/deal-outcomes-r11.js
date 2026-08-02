(() => {
  'use strict';

  const state = { members: null, membersPromise: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function loadMembers() {
    if (state.members) return state.members;
    if (state.membersPromise) return state.membersPromise;
    state.membersPromise = fetch('/api/work-os?scope=team', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load team members');
        const payload = await response.json();
        state.members = payload.members || [];
        state.membersPromise = null;
        return state.members;
      })
      .catch(() => {
        state.membersPromise = null;
        return [];
      });
    return state.membersPromise;
  }

  function fieldWrapper(form, name) {
    return form.querySelector(`[name="${CSS.escape(name)}"]`)?.closest('.revenue-field, .revenue-check, .deal-outcome-field') || null;
  }

  function remember(input) {
    if (!input || input.dataset.dealOriginalReady) return;
    input.dataset.dealOriginalReady = 'true';
    input.dataset.dealOriginalValue = input.value || '';
    input.dataset.dealOriginalRequired = input.required ? 'true' : 'false';
  }

  function restore(input) {
    if (!input) return;
    if (input.dataset.dealOriginalReady === 'true') {
      input.value = input.dataset.dealOriginalValue || '';
      input.required = input.dataset.dealOriginalRequired === 'true';
    }
  }

  function setVisible(form, name, visible) {
    const wrapper = fieldWrapper(form, name);
    if (wrapper) wrapper.hidden = !visible;
  }

  function setLabel(form, name, copy) {
    const wrapper = fieldWrapper(form, name);
    const label = wrapper?.querySelector(':scope > span');
    if (label) label.textContent = copy;
  }

  function ensureNonBillableOption(select) {
    if (!select || select.querySelector('option[value="NON_BILLABLE"]')) return;
    const option = document.createElement('option');
    option.value = 'NON_BILLABLE';
    option.textContent = 'Non-billable partnership';
    select.appendChild(option);
  }

  function ownerOptions(members) {
    return [
      '<option value="">Use relationship owner</option>',
      ...members.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.fullName || member.email || 'Team member')}</option>`),
    ].join('');
  }

  async function populateAnnouncementOwners(form) {
    const members = await loadMembers();
    if (!form.isConnected) return;
    const options = ownerOptions(members);
    for (const name of ['relationshipOwnerId', 'marketingOwnerId', 'designOwnerId']) {
      const select = form.elements.namedItem(name);
      if (select && !select.dataset.membersReady) {
        select.innerHTML = options;
        select.dataset.membersReady = 'true';
      }
    }
  }

  function outcomeIntroHtml() {
    return `
      <section class="deal-outcome-intro">
        <div>
          <span>WON RELATIONSHIP TYPE</span>
          <strong>Choose what AKARI actually closed</strong>
          <p>A partnership can create strategic value without revenue. A service engagement can be invoiced. A hybrid relationship supports both.</p>
        </div>
        <label class="deal-outcome-field deal-outcome-field--full">
          <span>Outcome model *</span>
          <select name="dealModel" required>
            <option value="PARTNERSHIP">Strategic partnership · no invoice</option>
            <option value="SERVICE" selected>Paid service / campaign · invoice eligible</option>
            <option value="HYBRID">Partnership + paid service</option>
          </select>
        </label>
        <div class="deal-outcome-note" data-deal-outcome-note></div>
      </section>`;
  }

  function partnershipFieldsHtml() {
    return `
      <label class="revenue-field full deal-outcome-added">
        <span>Value contribution</span>
        <textarea name="valueContribution" rows="4" placeholder="Describe the audience, distribution, technology, introductions, credibility, data, ecosystem access or other value this relationship brings."></textarea>
        <small>Use this for non-cash value so partnership impact is visible without treating it as revenue.</small>
      </label>
      <label class="revenue-field deal-outcome-added" data-strategic-value>
        <span>Estimated strategic value</span>
        <input name="strategicValue" type="number" min="0" step="0.01" value="0" />
        <small>Optional internal estimate. This is never invoiced or counted as booked revenue.</small>
      </label>
      <label class="revenue-check full deal-outcome-added deal-announcement-toggle">
        <input type="checkbox" name="createAnnouncementPlan" value="true" />
        <span>
          <strong>Create an optional social announcement plan</strong>
          <small>Generate connected BD, copy, design, approval, social publishing and follow-up tasks.</small>
        </span>
      </label>
      <section class="deal-announcement-fields full deal-outcome-added" data-announcement-fields hidden>
        <div class="deal-announcement-heading">
          <div><span>OPTIONAL ACTIVATION</span><strong>Announcement ownership and target date</strong></div>
          <p>Owners default to the relationship owner when left blank. Tasks remain connected to this project, opportunity and engagement.</p>
        </div>
        <label class="revenue-field">
          <span>Announcement date *</span>
          <input name="announcementDate" type="date" />
        </label>
        <label class="revenue-field">
          <span>Relationship owner</span>
          <select name="relationshipOwnerId"><option value="">Use relationship owner</option></select>
        </label>
        <label class="revenue-field">
          <span>Marketing / content owner</span>
          <select name="marketingOwnerId"><option value="">Use relationship owner</option></select>
        </label>
        <label class="revenue-field">
          <span>Design owner</span>
          <select name="designOwnerId"><option value="">Use marketing owner</option></select>
        </label>
      </section>`;
  }

  function updateAnnouncementFields(form) {
    const toggle = form.elements.namedItem('createAnnouncementPlan');
    const fields = form.querySelector('[data-announcement-fields]');
    const date = form.elements.namedItem('announcementDate');
    const enabled = Boolean(toggle?.checked);
    if (fields) fields.hidden = !enabled;
    if (date) date.required = enabled;
  }

  function updateOutcomeForm(form) {
    const model = String(form.elements.namedItem('dealModel')?.value || 'SERVICE').toUpperCase();
    const partnershipOnly = model === 'PARTNERSHIP';
    const hybrid = model === 'HYBRID';
    const billable = !partnershipOnly;
    const finalValue = form.elements.namedItem('finalValue');
    const serviceType = form.elements.namedItem('serviceType');
    const commercialModel = form.elements.namedItem('commercialModel');
    const deliverables = form.elements.namedItem('deliverables');
    const startDate = form.elements.namedItem('startDate');
    const submit = form.querySelector('[type="submit"]');
    const note = form.querySelector('[data-deal-outcome-note]');

    for (const name of ['finalValue', 'currency', 'serviceType', 'commercialModel', 'paymentTerms', 'billingSchedule', 'campaignCost', 'creatorCost', 'otherCost', 'referralPartnerId', 'referralPercentage']) {
      setVisible(form, name, billable);
    }

    if (finalValue) {
      if (partnershipOnly) {
        finalValue.required = false;
        finalValue.min = '0';
        finalValue.value = '0';
      } else {
        restore(finalValue);
        finalValue.required = true;
        finalValue.min = '0.01';
      }
    }

    if (serviceType) {
      if (partnershipOnly) {
        serviceType.required = false;
        serviceType.value = 'STRATEGIC_PARTNERSHIP';
      } else {
        restore(serviceType);
        serviceType.required = true;
      }
    }

    if (commercialModel) {
      ensureNonBillableOption(commercialModel);
      if (partnershipOnly) commercialModel.value = 'NON_BILLABLE';
      else restore(commercialModel);
    }

    if (startDate) startDate.required = true;
    if (deliverables) deliverables.required = true;

    setLabel(form, 'engagementName', partnershipOnly ? 'Partnership name *' : hybrid ? 'Partnership / service engagement name *' : 'Service engagement name *');
    setLabel(form, 'startDate', partnershipOnly ? 'Partnership start *' : 'Service start *');
    setLabel(form, 'endDate', partnershipOnly ? 'Review / target date' : 'Expected end');
    setLabel(form, 'deliverables', partnershipOnly ? 'Partnership scope and agreed value exchange *' : hybrid ? 'Service deliverables and partnership scope *' : 'Confirmed service deliverables *');
    setVisible(form, 'strategicValue', partnershipOnly || hybrid);

    if (note) {
      if (partnershipOnly) {
        note.innerHTML = '<strong>No invoice will be created.</strong><span>The organisation becomes a Partner. Strategic value and any optional announcement work are tracked without entering revenue.</span>';
      } else if (hybrid) {
        note.innerHTML = '<strong>Partnership and service are tracked together.</strong><span>The service portion remains invoice eligible, while partnership value and announcement tasks stay connected to the same relationship.</span>';
      } else {
        note.innerHTML = '<strong>This is a billable client engagement.</strong><span>After closing, Finance can generate an invoice for the marketing, KOL, advisory or campaign service.</span>';
      }
    }

    if (submit) submit.textContent = partnershipOnly ? 'Close partnership' : hybrid ? 'Create hybrid engagement' : 'Create client engagement';
    updateAnnouncementFields(form);
  }

  function enhanceWonForm(form) {
    if (!form || form.dataset.dealOutcomeReady === 'true') return;
    const heading = form.querySelector('h3')?.textContent?.trim();
    if (heading !== 'Close as won') return;
    const grid = form.querySelector('.revenue-field-grid');
    if (!grid) return;

    form.dataset.dealOutcomeReady = 'true';
    form.classList.add('deal-outcome-form');
    form.querySelector('header p')?.replaceChildren(document.createTextNode('Classify the won relationship, track strategic value, and only enable invoicing when AKARI is delivering a paid service.'));

    for (const name of ['finalValue', 'serviceType', 'commercialModel']) remember(form.elements.namedItem(name));

    grid.insertAdjacentHTML('afterbegin', outcomeIntroHtml());
    grid.insertAdjacentHTML('beforeend', partnershipFieldsHtml());

    const model = form.elements.namedItem('dealModel');
    const announcement = form.elements.namedItem('createAnnouncementPlan');
    model?.addEventListener('change', () => updateOutcomeForm(form));
    announcement?.addEventListener('change', () => updateAnnouncementFields(form));

    populateAnnouncementOwners(form);
    updateOutcomeForm(form);
  }

  function markNonBillableWorkspace(root = document) {
    const workspace = root.matches?.('.revenue-workspace') ? root : root.querySelector?.('.revenue-workspace');
    if (!workspace) return;

    const nonBillablePanels = $$('.revenue-panel', workspace).filter((panel) => {
      const subtitle = panel.querySelector('.revenue-panel-head span')?.textContent || '';
      return /Non Billable/i.test(subtitle);
    });
    if (!nonBillablePanels.length) return;

    workspace.classList.add('deal-workspace--non-billable');
    for (const panel of nonBillablePanels) {
      if (panel.dataset.nonBillableReady === 'true') continue;
      panel.dataset.nonBillableReady = 'true';
      panel.querySelectorAll('[data-revenue-action="invoice"]').forEach((button) => button.remove());
      const head = panel.querySelector('.revenue-panel-head > div:last-child') || panel.querySelector('.revenue-panel-head');
      head?.insertAdjacentHTML('beforeend', '<span class="revenue-pill deal-no-invoice">No invoice required</span>');
      const properties = $$('.revenue-property', panel);
      for (const property of properties) {
        const label = property.querySelector('span')?.textContent?.trim();
        if (['Contract value', 'Direct costs', 'AKARI net', 'Referral reward'].includes(label)) property.hidden = true;
      }
      panel.insertAdjacentHTML('beforeend', '<div class="deal-partnership-callout"><strong>Strategic partnership</strong><span>Value is tracked through relationship scope, activations and connected tasks rather than booked revenue.</span></div>');
    }

    $$('.revenue-step', workspace).forEach((step) => {
      const label = step.querySelector('strong')?.textContent?.trim();
      if (!['Invoice', 'Payment', 'Referral reward'].includes(label)) return;
      step.classList.remove('current', 'pending', 'complete');
      step.classList.add('na');
      const marker = step.querySelector('span');
      if (marker) marker.textContent = '-';
    });

    $$('.revenue-panel', workspace).forEach((panel) => {
      const title = panel.querySelector('.revenue-panel-head strong')?.textContent?.trim();
      if (title !== 'Invoices and payments') return;
      panel.querySelectorAll('[data-revenue-action="payment"]').forEach((button) => button.remove());
      const empty = panel.querySelector('.revenue-empty');
      if (empty) empty.textContent = 'No invoice is required for this non-billable partnership.';
    });
  }

  function scan(root = document) {
    if (root instanceof Element) {
      if (root.matches('#revenue-active-form')) enhanceWonForm(root);
      root.querySelectorAll?.('#revenue-active-form').forEach(enhanceWonForm);
      markNonBillableWorkspace(root);
    } else {
      document.querySelectorAll('#revenue-active-form').forEach(enhanceWonForm);
      markNonBillableWorkspace(document);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document));
  document.addEventListener('akari:route-rendered', () => scan(document));
  window.addEventListener('pageshow', () => scan(document));
  scan(document);
})();