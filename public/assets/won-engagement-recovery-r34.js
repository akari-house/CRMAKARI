(() => {
  'use strict';

  let opportunityId = '';
  let checking = false;
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

  async function inspectWorkspace() {
    const workspace = $('#modal-root .revenue-workspace');
    if (!workspace || !opportunityId || checking || workspace.dataset.engagementRecoveryChecked === opportunityId) return;
    checking = true;
    try {
      const payload = await request(`/api/opportunities/${encodeURIComponent(opportunityId)}/workspace`);
      workspace.dataset.engagementRecoveryChecked = opportunityId;
      const stage = String(payload.opportunity?.stage || '').toUpperCase();
      const engagements = payload.engagements || [];
      const role = String(payload.permissions?.role || '').toUpperCase();
      if (stage !== 'WON' || engagements.length || !['OWNER','ADMIN'].includes(role)) return;
      const head = workspace.querySelector('.revenue-workspace-head, .modal-head');
      if (!head || head.querySelector('[data-recover-engagement]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small primary';
      button.dataset.recoverEngagement = 'true';
      button.textContent = 'Recover engagement';
      button.title = 'Create the missing engagement for this legacy won opportunity';
      head.appendChild(button);
    } catch (error) {
      console.warn('AKARI engagement recovery check failed', error);
    } finally {
      checking = false;
    }
  }

  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-revenue-action="open"][data-id]');
    if (open) opportunityId = open.dataset.id || '';
  }, true);

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recover-engagement]');
    if (!button || !opportunityId) return;
    event.preventDefault();
    button.disabled = true;
    button.textContent = 'Recovering…';
    try {
      const payload = await request(`/api/opportunities/${encodeURIComponent(opportunityId)}/recover-engagement`, { method:'POST', body:'{}' });
      notify(payload.alreadyExists ? 'Engagement already exists.' : 'Engagement recovered. You can now create the invoice.');
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      notify(error.message || 'Engagement recovery failed', 'error');
      button.disabled = false;
      button.textContent = 'Recover engagement';
    }
  }, true);

  new MutationObserver(inspectWorkspace).observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', inspectWorkspace);
})();
