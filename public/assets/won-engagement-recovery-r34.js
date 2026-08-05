(() => {
  'use strict';

  if (window.fetch?.akariWonEngagementGuard === 'ready') return;

  const nativeFetch = window.fetch.bind(window);
  const recoveryInFlight = new Set();
  const completed = new Set();

  function notify(message, type = 'success') {
    const root = document.querySelector('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function opportunityIdFromWorkspacePath(pathname) {
    const match = pathname.match(/^\/api\/opportunities\/([^/]+)\/workspace$/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function postWinNextAction(payload) {
    const readiness = payload.commercialReadiness || {};
    if (!readiness.clientBillingReady) return ['Complete the client billing profile before issuing an invoice.', 'COMPLETE_CLIENT_BILLING'];
    if (!readiness.engagementReady) return ['Preparing the client engagement…', 'CREATE_ENGAGEMENT'];
    if (!readiness.issuerBillingReady) return ['Complete AKARI organisation billing details in Settings.', 'COMPLETE_ISSUER_BILLING'];
    if (!readiness.invoiceCount) return ['Issue the first invoice from the won engagement.', 'CREATE_INVOICE'];
    if (Number(readiness.outstanding || 0) > 0) return ['Collect or reconcile the outstanding invoice balance.', 'COLLECT_PAYMENT'];
    return ['Confirm delivery, referral obligations and renewal follow-up.', 'COMPLETE_COMMERCIAL_CYCLE'];
  }

  function normalizeWonReadiness(payload) {
    if (String(payload?.opportunity?.stage || '').toUpperCase() !== 'WON') return payload;
    payload.commercialReadiness ||= {};
    const [nextAction, nextActionCode] = postWinNextAction(payload);
    payload.commercialReadiness.nextAction = nextAction;
    payload.commercialReadiness.nextActionCode = nextActionCode;
    return payload;
  }

  function refreshWorkspaceInPlace() {
    const workspace = document.querySelector('#modal-root .revenue-workspace');
    if (!workspace) return;
    const refresh = [...workspace.querySelectorAll('button')].find((button) => String(button.textContent || '').trim().toLowerCase() === 'refresh');
    if (refresh && !refresh.disabled) return refresh.click();
    document.dispatchEvent(new CustomEvent('akari:revenue-workspace-refresh'));
  }

  async function ensureEngagement(opportunityId, payload) {
    const stage = String(payload?.opportunity?.stage || '').toUpperCase();
    const engagements = Array.isArray(payload?.engagements) ? payload.engagements : [];
    if (stage !== 'WON' || engagements.length || recoveryInFlight.has(opportunityId) || completed.has(opportunityId)) return;
    recoveryInFlight.add(opportunityId);
    try {
      const response = await nativeFetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/recover-engagement`, {
        method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body:'{}',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Engagement preparation failed (${response.status})`);
      completed.add(opportunityId);
      notify(result.alreadyExists ? 'Engagement connected.' : 'Client engagement created automatically.');
      setTimeout(refreshWorkspaceInPlace, 300);
    } catch (error) {
      console.error('AKARI automatic engagement creation failed', error);
      notify(error.message || 'The client engagement could not be prepared automatically.', 'error');
    } finally {
      recoveryInFlight.delete(opportunityId);
    }
  }

  async function guardedFetch(input, init = {}) {
    const response = await nativeFetch(input, init);
    try {
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const opportunityId = method === 'GET' ? opportunityIdFromWorkspacePath(url.pathname) : '';
      if (!opportunityId || !response.ok) return response;
      const payload = await response.clone().json();
      normalizeWonReadiness(payload);
      queueMicrotask(() => ensureEngagement(opportunityId, payload));
      return new Response(JSON.stringify(payload), { status:response.status, statusText:response.statusText, headers:response.headers });
    } catch (error) {
      console.warn('AKARI won engagement guard could not inspect the workspace response', error);
      return response;
    }
  }

  guardedFetch.akariWonEngagementGuard = 'ready';
  guardedFetch.nativeFetch = nativeFetch;
  window.fetch = guardedFetch;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/assets/revenue-lifecycle-ux-r37.css?v=1';
  document.head.appendChild(css);

  ['/assets/revenue-lifecycle-ux-r37.js?v=1', '/assets/invoice-date-stability-r37.js?v=1'].forEach((src) => {
    const script = document.createElement('script');
    script.defer = true;
    script.src = src;
    document.head.appendChild(script);
  });
})();
