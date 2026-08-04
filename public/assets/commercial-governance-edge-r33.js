(() => {
  'use strict';
  let opportunityId = '';
  let scheduled = false;
  const $ = (selector, root = document) => root.querySelector(selector);

  document.addEventListener('pointerdown', (event) => {
    const open = event.target.closest('[data-revenue-action="open"][data-id]');
    if (open) opportunityId = open.dataset.id || '';
  }, true);

  async function fetchWorkspace() {
    if (!opportunityId) return null;
    const response = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/workspace`, { credentials:'same-origin', headers:{accept:'application/json'}, cache:'no-store' });
    if (!response.ok) return null;
    return response.json();
  }

  function acceptanceComplete(metadata = {}) {
    return Boolean(metadata.acceptedBy && metadata.acceptedAt && metadata.acceptanceMethod && metadata.acceptanceReference && metadata.termsConfirmed === true);
  }

  async function addLegacyEvidenceAction() {
    const toolbar = $('.revenue-workspace .revenue-toolbar');
    if (!toolbar || toolbar.querySelector('[data-governance-legacy-acceptance]') || !opportunityId) return;
    const payload = await fetchWorkspace();
    if (!payload || !toolbar.isConnected) return;
    const proposal = (payload.proposals || []).find((item) => String(item.metadata?.status || item.outcome || '').toUpperCase() === 'ACCEPTED' && !acceptanceComplete(item.metadata));
    if (!proposal) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small';
    button.dataset.governanceLegacyAcceptance = proposal.id;
    button.textContent = 'Complete acceptance evidence';
    toolbar.insertBefore(button, toolbar.firstChild);
  }

  function enhanceGovernanceForm() {
    const form = $('#governance-active-form');
    if (!form || form.dataset.governanceEdgeR33) return;
    const heading = form.closest('.governance-modal')?.querySelector('h2')?.textContent?.trim();
    if (!heading) return;
    form.dataset.governanceEdgeR33 = 'ready';

    if (heading === 'Close opportunity as lost' && form.elements.followUpAt) {
      form.elements.followUpAt.required = true;
      const label = form.elements.followUpAt.closest('.governance-field')?.querySelector('span');
      if (label && !label.textContent.includes('*')) label.textContent = 'Future follow-up date *';
    }

    if (heading === 'Close opportunity as won' && form.elements.dealModel) {
      const grid = form.querySelector('.governance-grid');
      const wrapper = document.createElement('div');
      wrapper.className = 'governance-partnership-fields full';
      wrapper.hidden = true;
      wrapper.innerHTML = `<div class="governance-grid"><label class="governance-field"><span>Partnership type *</span><select name="partnershipType"><option value="STRATEGIC">Strategic</option><option value="TECHNOLOGY">Technology</option><option value="ECOSYSTEM">Ecosystem</option><option value="REFERRAL">Referral</option><option value="CHANNEL">Channel</option><option value="OTHER">Other</option></select></label><label class="governance-field full"><span>Partnership scope *</span><textarea name="partnershipScope" rows="3" placeholder="Shared responsibilities, value exchange and activation scope"></textarea></label></div>`;
      const engagementName = form.elements.engagementName?.closest('.governance-field');
      if (engagementName) engagementName.insertAdjacentElement('beforebegin', wrapper); else grid.appendChild(wrapper);
      const update = () => {
        const required = ['PARTNERSHIP','HYBRID'].includes(form.elements.dealModel.value);
        wrapper.hidden = !required;
        wrapper.querySelector('[name="partnershipType"]').required = required;
        wrapper.querySelector('[name="partnershipScope"]').required = required;
      };
      form.elements.dealModel.addEventListener('change', update);
      update();
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-governance-legacy-acceptance]');
    if (!button) return;
    event.preventDefault();
    const proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.dataset.commercialAction = 'proposal-decision';
    proxy.dataset.id = button.dataset.governanceLegacyAcceptance;
    proxy.hidden = true;
    document.body.appendChild(proxy);
    proxy.click();
    proxy.remove();
  }, true);

  function maintain() {
    scheduled = false;
    enhanceGovernanceForm();
    addLegacyEvidenceAction().catch(() => {});
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(maintain);
  }
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule);
  schedule();
})();