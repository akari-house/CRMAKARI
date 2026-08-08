(() => {
  'use strict';
  if (window.__akariCampaignSummaryIntelligenceR48) return;
  window.__akariCampaignSummaryIntelligenceR48 = true;

  const cache = new Map();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits:digits });
  const signed = (value) => `${Number(value || 0) > 0 ? '+' : ''}${fmt(value,1)}`;
  const pct = (value) => value === null || value === undefined ? 'n/a' : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)}%`;

  async function loadApi(id, type) {
    const response = await fetch(`/api/campaign-summary-intelligence/${encodeURIComponent(id)}?type=${encodeURIComponent(type)}`, { headers:{ 'content-type':'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Campaign summary intelligence request failed');
    return payload;
  }

  function metricCard(metric) {
    const cls = metric.direction === 'UP' ? 'up' : metric.direction === 'DOWN' ? 'down' : '';
    return `<article><small>${esc(metric.label)}</small><b>${fmt(metric.current, metric.label.includes('progress') ? 1 : 0)}</b><span class="${cls}">${signed(metric.delta)} · ${pct(metric.percent)}</span></article>`;
  }

  function list(items, empty) {
    return items?.length ? `<div class="summary-list-r48">${items.map((item) => `<article><i></i><span>${esc(item)}</span></article>`).join('')}</div>` : `<p class="summary-empty-r48">${esc(empty)}</p>`;
  }

  function render(id, type, payload) {
    const workspace = document.querySelector('.delivery-workspace');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!workspace || !body) return;
    workspace.querySelector('.campaign-summary-intelligence-r48')?.remove();
    const summary = payload.item?.summary || {};
    const panel = document.createElement('section');
    panel.className = 'campaign-summary-intelligence-r48';

    const comparable = summary.status === 'COMPARABLE';
    const metrics = comparable ? (summary.metrics || []).filter((item) => ['4-week tracked reach','Owned audience','Creator published posts','GTM leads'].includes(item.label)) : [];
    panel.innerHTML = `<header><div><span>PERIOD INTELLIGENCE</span><strong>Weekly & monthly summary</strong><small>Deterministic comparison from saved campaign snapshots.</small></div><div class="summary-switch-r48"><button data-type="WEEKLY" class="${type === 'WEEKLY' ? 'active' : ''}">Weekly</button><button data-type="MONTHLY" class="${type === 'MONTHLY' ? 'active' : ''}">Monthly</button></div></header>
      ${comparable ? `<div class="summary-hero-r48"><section class="summary-copy-r48"><strong>${esc(summary.current?.label || 'Current period')} vs ${esc(summary.previous?.label || 'previous period')}</strong><p>${esc(summary.executiveSummary)}</p></section><aside class="summary-momentum-r48 ${String(summary.momentum || '').toLowerCase()}"><small>Momentum</small><b>${fmt(summary.momentumScore)}</b><span>${esc(String(summary.momentum || '').replaceAll('_',' '))}</span></aside></div><div class="summary-metrics-r48">${metrics.map(metricCard).join('')}</div><div class="summary-grid-r48"><section class="summary-block-r48 strengths"><strong>What improved</strong>${list(summary.strengths,'No material positive movement was detected.')}</section><section class="summary-block-r48 risks"><strong>Management attention</strong>${list(summary.risks,'No material period-over-period risk was detected.')}</section><section class="summary-block-r48 actions"><strong>Recommended next actions</strong>${list(summary.recommendations,'Maintain the current reporting cadence.')}</section></div><div class="summary-client-r48"><strong>CLIENT-FACING SUMMARY</strong><p>${esc(summary.clientSummary)}</p></div>` : `<div class="summary-copy-r48"><strong>${summary.status === 'BASELINE_ONLY' ? 'Baseline captured' : 'Comparison not available yet'}</strong><p>${esc(summary.executiveSummary || 'Capture comparable snapshots to generate period intelligence.')}</p><p class="summary-note-r48">${esc(summary.recommendations?.[0] || '')}</p></div>`}`;

    panel.querySelectorAll('[data-type]').forEach((button) => button.addEventListener('click', () => load(id, button.dataset.type, true)));
    const history = body.querySelector('.campaign-reporting-history-r47');
    if (history) history.insertAdjacentElement('afterend', panel); else {
      const executive = body.querySelector('.campaign-executive-r45');
      if (executive) executive.insertAdjacentElement('afterend', panel); else body.insertAdjacentElement('afterbegin', panel);
    }
    workspace.dataset.summaryIntelligenceR48 = id;
  }

  async function load(id, type = 'WEEKLY', force = false) {
    if (!id) return;
    const key = `${id}:${type}`;
    if (!force && cache.has(key)) return render(id, type, cache.get(key));
    try {
      const payload = await loadApi(id, type);
      cache.set(key, payload);
      render(id, type, payload);
    } catch (cause) {
      console.warn('[AKARI campaign summary intelligence]', cause);
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const match = url.match(/\/api\/(?:service-delivery|campaign-(?:gtm-)?tracking|campaign-reporting-history)\/([^/?#]+)$/);
      if (match && response.ok) queueMicrotask(() => load(decodeURIComponent(match[1]), 'WEEKLY', true));
    } catch {}
    return response;
  };

  new MutationObserver(() => {
    const workspace = document.querySelector('.delivery-workspace');
    if (!workspace || workspace.querySelector('.campaign-summary-intelligence-r48')) return;
    const id = workspace.dataset.reportingHistoryR47 || workspace.dataset.executiveR45 || [...cache.keys()].at(-1)?.split(':')[0];
    if (id) load(id);
  }).observe(document.body, { childList:true, subtree:true });
})();
