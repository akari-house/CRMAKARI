(() => {
  'use strict';
  if (window.__akariCampaignReportingHistoryR47) return;
  window.__akariCampaignReportingHistoryR47 = true;

  const cache = new Map();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits:digits });
  const signed = (value) => `${Number(value || 0) > 0 ? '+' : ''}${fmt(value)}`;
  const label = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g, (c) => c.toUpperCase());

  async function api(id, options = {}) {
    const response = await fetch(`/api/campaign-reporting-history/${encodeURIComponent(id)}`, {
      ...options,
      headers:{ 'content-type':'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Campaign reporting-history request failed');
    return payload;
  }

  function closeModal() { document.querySelector('.reporting-snapshot-modal-r47')?.remove(); }

  function openCapture(id) {
    closeModal();
    const layer = document.createElement('div');
    layer.className = 'reporting-snapshot-modal-r47';
    const today = new Date().toISOString().slice(0,10);
    layer.innerHTML = `<form><header><div><span>REPORTING HISTORY</span><strong>Capture campaign snapshot</strong><small>Freeze the tracked campaign KPIs for a reporting period. Existing snapshots remain unchanged when live metrics are updated later.</small></div><button type="button" data-close>×</button></header><div class="snapshot-form-r47"><label>Snapshot type<select name="type"><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="AD_HOC">Ad hoc</option></select></label><label>Reporting date<input type="date" name="periodDate" value="${today}" max="${today}" required></label><label class="full">Label <input name="label" placeholder="e.g. Week 2 client update"></label></div><div class="snapshot-actions-r47"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Capture snapshot</button></div></form>`;
    layer.addEventListener('click', (event) => { if (event.target === layer || event.target.closest('[data-close]')) closeModal(); });
    layer.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      const snapshot = Object.fromEntries(new FormData(event.currentTarget).entries());
      try {
        const payload = await api(id, { method:'PATCH', body:JSON.stringify({ action:'capture-snapshot', snapshot }) });
        cache.set(id, { item:payload.item, permissions:cache.get(id)?.permissions || { canManage:true } });
        closeModal();
        render(id, cache.get(id));
      } catch (cause) {
        alert(cause.message);
        button.disabled = false;
      }
    });
    document.body.appendChild(layer);
  }

  function trendBars(trend) {
    if (!trend?.length) return '<p class="snapshot-empty-r47">Capture the first snapshot to start the trend history.</p>';
    const max = Math.max(1, ...trend.map((item) => Number(item.rollingReach28?.total || 0)));
    return `<div class="snapshot-trend-r47">${trend.map((item) => `<article title="${esc(item.label)} · ${fmt(item.rollingReach28?.total)} tracked reach"><div><i style="height:${Math.max(5, Math.min(100, Number(item.rollingReach28?.total || 0) / max * 100))}%"></i></div><small>${esc(item.type === 'WEEKLY' ? `W${item.campaignWeek}` : item.type === 'MONTHLY' ? `M${item.campaignMonth}` : item.periodDate.slice(5))}</small></article>`).join('')}</div>`;
  }

  function render(id, payload) {
    const workspace = document.querySelector('.delivery-workspace');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!workspace || !body) return;
    workspace.querySelector('.campaign-reporting-history-r47')?.remove();
    const item = payload.item || {};
    const snapshots = item.snapshots || [];
    const latest = item.latest;
    const panel = document.createElement('section');
    panel.className = 'campaign-reporting-history-r47';
    panel.innerHTML = `<header><div><span>REPORTING HISTORY</span><strong>Period snapshots & trend</strong><small>Compare how the campaign changed across weekly, monthly or ad-hoc reporting periods.</small></div>${payload.permissions?.canManage ? '<button class="primary" data-capture>Capture snapshot</button>' : ''}</header><div class="snapshot-kpis-r47"><article><small>Snapshots</small><b>${fmt(item.snapshotCount)}</b><span>${fmt(item.weeklyCount)} weekly · ${fmt(item.monthlyCount)} monthly</span></article><article><small>Latest 4-week reach</small><b>${fmt(latest?.rollingReach28?.total)}</b><span>Tracked / non-deduplicated</span></article><article><small>Latest owned audience</small><b>${fmt(latest?.ownedAudience)}</b><span>${latest?.delta ? `${signed(latest.delta.ownedAudience)} vs previous ${label(latest.type).toLowerCase()}` : 'First comparable period'}</span></article><article><small>Creator posts</small><b>${fmt(latest?.creatorPublishedPosts)} / ${fmt(latest?.creatorPlannedPosts)}</b><span>${latest?.delta ? `${signed(latest.delta.creatorPublishedPosts)} published vs previous` : 'Snapshot value'}</span></article><article><small>GTM outcomes</small><b>${fmt(latest?.gtmLeads)} leads</b><span>${fmt(latest?.gtmMeetings)} meetings</span></article></div><div class="snapshot-layout-r47"><section><div class="snapshot-section-head-r47"><strong>Tracked reach trend</strong><span>Rolling 4-week reach by snapshot</span></div>${trendBars(item.trend)}</section><section><div class="snapshot-section-head-r47"><strong>Snapshot history</strong><span>Newest first</span></div><div class="snapshot-list-r47">${snapshots.length ? snapshots.slice(0,12).map((snapshot) => `<article><div><strong>${esc(snapshot.label)}</strong><span>${esc(snapshot.periodDate)} · ${label(snapshot.type)} · Week ${fmt(snapshot.campaignWeek)}</span></div><div><b>${fmt(snapshot.rollingReach28?.total)}</b><span>4-week reach</span></div><div><b>${fmt(snapshot.ownedAudience)}</b><span>owned audience${snapshot.delta ? ` · ${signed(snapshot.delta.ownedAudience)}` : ''}</span></div><div><b>${fmt(snapshot.creatorPublishedPosts)}/${fmt(snapshot.creatorPlannedPosts)}</b><span>creator posts</span></div><div><b>${fmt(snapshot.gtmLeads)}</b><span>leads · ${fmt(snapshot.gtmMeetings)} meetings</span></div></article>`).join('') : '<p class="snapshot-empty-r47">No campaign snapshots captured yet.</p>'}</div></section></div>`;
    panel.querySelector('[data-capture]')?.addEventListener('click', () => openCapture(id));
    const executive = body.querySelector('.campaign-executive-r45');
    if (executive) executive.insertAdjacentElement('afterend', panel); else body.insertAdjacentElement('afterbegin', panel);
    workspace.dataset.reportingHistoryR47 = id;
  }

  async function load(id, force = false) {
    if (!id) return;
    if (!force && cache.has(id)) return render(id, cache.get(id));
    try {
      const payload = await api(id);
      cache.set(id, payload);
      render(id, payload);
    } catch (cause) {
      console.warn('[AKARI campaign reporting history]', cause);
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const match = url.match(/\/api\/(?:service-delivery|campaign-(?:gtm-)?tracking)\/([^/?#]+)$/);
      if (match && response.ok) queueMicrotask(() => load(decodeURIComponent(match[1]), true));
    } catch {}
    return response;
  };

  new MutationObserver(() => {
    const workspace = document.querySelector('.delivery-workspace');
    if (!workspace || workspace.querySelector('.campaign-reporting-history-r47')) return;
    const id = workspace.dataset.executiveR45 || workspace.dataset.creatorTrackingR43 || [...cache.keys()].at(-1);
    if (id) load(id);
  }).observe(document.body, { childList:true, subtree:true });
})();
