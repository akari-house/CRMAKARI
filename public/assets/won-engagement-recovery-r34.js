(() => {
  'use strict';

  let opportunityId = '';
  let checking = false;
  let recoveredThisSession = false;
  const $ = (selector, root = document) => root.querySelector(selector);

  function notify(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials:'same-origin',
      ...options,
      headers:{ 'content-type':'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function correctWonReadiness(workspace, payload) {
    if (String(payload.opportunity?.stage || '').toUpperCase() !== 'WON') return;
    const readiness = payload.commercialReadiness || {};
    const next = readiness.engagementReady
      ? (readiness.invoiceCount ? 'Continue delivery and collection.' : 'Complete billing details and issue the first invoice.')
      : 'Preparing the client engagement…';
    workspace.querySelectorAll('*').forEach((node) => {
      if (node.children.length) return;
      const copy = String(node.textContent || '').trim();
      if (copy === 'Complete qualification: need, decision-maker, timeline and budget.') node.textContent = next;
    });
  }

  async function inspectWorkspace() {
    const workspace = $('#modal-root .revenue-workspace');
    if (!workspace || !opportunityId || checking || recoveredThisSession) return;
    if (workspace.dataset.engagementAutoChecked === opportunityId) return;
    checking = true;
    try {
      const payload = await request(`/api/opportunities/${encodeURIComponent(opportunityId)}/workspace`);
      workspace.dataset.engagementAutoChecked = opportunityId;
      correctWonReadiness(workspace, payload);
      const stage = String(payload.opportunity?.stage || '').toUpperCase();
      const engagements = payload.engagements || [];
      if (stage !== 'WON' || engagements.length) return;

      const head = workspace.querySelector('.revenue-workspace-head, .modal-head');
      const status = document.createElement('span');
      status.dataset.engagementAutoStatus = 'true';
      status.className = 'commercial-pill yellow';
      status.textContent = 'Preparing engagement…';
      head?.appendChild(status);

      const result = await request(`/api/opportunities/${encodeURIComponent(opportunityId)}/recover-engagement`, {
        method:'POST',
        body:'{}',
      });
      recoveredThisSession = true;
      notify(result.alreadyExists ? 'Engagement connected.' : 'Client engagement created automatically.');
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      console.warn('AKARI automatic engagement creation failed', error);
      notify(error.message || 'The client engagement could not be prepared automatically.', 'error');
    } finally {
      checking = false;
    }
  }

  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-revenue-action="open"][data-id]');
    if (open) {
      opportunityId = open.dataset.id || '';
      recoveredThisSession = false;
    }
  }, true);

  new MutationObserver(inspectWorkspace).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', inspectWorkspace);
  document.addEventListener('akari:route-rendered', inspectWorkspace);
})();
