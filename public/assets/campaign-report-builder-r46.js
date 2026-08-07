(() => {
  'use strict';
  if (window.__akariCampaignReportBuilderR46) return;
  window.__akariCampaignReportBuilderR46 = true;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function campaignId() {
    const workspace = document.querySelector('.delivery-workspace');
    return workspace?.dataset.executiveR45 || workspace?.dataset.creatorTrackingR43 || workspace?.dataset.gtmTrackingR44 || null;
  }

  function closeModal() { document.querySelector('.campaign-report-modal-r46')?.remove(); }

  function openBuilder(id) {
    closeModal();
    const layer = document.createElement('div');
    layer.className = 'campaign-report-modal-r46';
    const sections = [
      ['summary','Executive KPI summary',true],
      ['reach','Rolling 4-week reach mix',true],
      ['social','Owned-social growth',true],
      ['creators','Creator/KOL and agency performance',true],
      ['gtm','GTM activity and outcomes',true],
      ['risks','Management attention',true],
      ['recommendations','Recommendations',true],
      ['finance','Commercial summary (finance-authorized users only)',false],
    ];
    layer.innerHTML = `<form><header><div><span>CLIENT REPORT</span><strong>Campaign report builder</strong><small>Select the sections to include. The report opens as an authenticated print/PDF-ready page.</small></div><button type="button" data-close aria-label="Close">×</button></header><div class="report-section-list-r46">${sections.map(([value,label,checked]) => `<label><input type="checkbox" name="section" value="${esc(value)}" ${checked ? 'checked' : ''}><span><strong>${esc(label)}</strong>${value === 'reach' ? '<small>Reach is labelled tracked/non-deduplicated across channels.</small>' : ''}</span></label>`).join('')}</div><div class="report-actions-r46"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Open report</button></div></form>`;
    layer.addEventListener('click', (event) => { if (event.target === layer || event.target.closest('[data-close]')) closeModal(); });
    layer.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const selected = [...event.currentTarget.querySelectorAll('input[name="section"]:checked')].map((input) => input.value);
      if (!selected.length) return;
      const url = `/api/campaign-tracking/${encodeURIComponent(id)}/report?sections=${encodeURIComponent(selected.join(','))}`;
      window.open(url, '_blank', 'noopener');
      closeModal();
    });
    document.body.appendChild(layer);
  }

  function enhance() {
    const panel = document.querySelector('.campaign-executive-r45:not([data-report-builder-r46])');
    if (!panel) return;
    const id = campaignId();
    if (!id) return;
    const header = panel.querySelector(':scope > header');
    if (!header) return;
    const health = header.querySelector('.exec-health-r45');
    const actions = document.createElement('div');
    actions.className = 'campaign-report-actions-r46';
    actions.innerHTML = '<button type="button" class="campaign-report-button-r46">Client report</button>';
    actions.querySelector('button').addEventListener('click', () => openBuilder(id));
    if (health) health.insertAdjacentElement('beforebegin', actions); else header.appendChild(actions);
    panel.dataset.reportBuilderR46 = 'ready';
  }

  new MutationObserver(enhance).observe(document.body, { childList:true, subtree:true });
  enhance();
})();
