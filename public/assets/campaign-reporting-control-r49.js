(() => {
  'use strict';
  if (window.__akariCampaignReportingControlR49) return;
  window.__akariCampaignReportingControlR49 = true;

  const cache = new Map();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fmt = (value) => Number(value || 0).toLocaleString();
  const label = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());

  async function getJson(url) {
    const response = await fetch(url,{ headers:{'content-type':'application/json'} });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Reporting control request failed');
    return payload;
  }

  function dueCopy(item) {
    if (!item?.enabled) return 'Disabled';
    if (item.status === 'OVERDUE') return `${item.overdueDays}d overdue`;
    if (item.status === 'DUE_TODAY') return 'Due today';
    if (item.status === 'DUE_SOON') return `Due in ${item.daysUntilDue}d`;
    return item.nextDue ? `Due ${item.nextDue}` : 'No due date';
  }

  function freshnessCard(name,item) {
    return `<article class="${esc(item?.status || 'MISSING')}"><small>${esc(name)}</small><b>${esc(label(item?.status || 'MISSING'))}</b><span>${item?.lastUpdate ? `${item.ageDays}d old · ${esc(item.lastUpdate)}` : 'No data recorded'}</span></article>`;
  }

  function render(id,payload,portfolio) {
    const workspace = document.querySelector('.delivery-workspace');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!workspace || !body) return;
    workspace.querySelector('.campaign-reporting-control-r49')?.remove();
    const item = payload.item || {};
    const panel = document.createElement('section');
    panel.className = 'campaign-reporting-control-r49';
    panel.innerHTML = `<header><div><span>REPORTING CONTROL</span><strong>Calendar & data freshness</strong><small>Reporting deadlines, SLA status and source freshness derived from campaign records.</small></div><div class="report-health-r49 ${esc(item.health)}"><small>Health</small><b>${fmt(item.healthScore)}</b><span>/100</span></div></header>
      <div class="report-control-grid-r49">
        <article class="report-control-card-r49"><div><b>Weekly reporting</b><em>${esc(label(item.weekly?.sla))}</em></div><small>${esc(dueCopy(item.weekly))}</small><small>Last submitted: ${esc(item.weekly?.lastSubmitted || 'None')}</small></article>
        <article class="report-control-card-r49"><div><b>Monthly reporting</b><em>${esc(label(item.monthly?.sla))}</em></div><small>${esc(dueCopy(item.monthly))}</small><small>Last submitted: ${esc(item.monthly?.lastSubmitted || 'None')}</small></article>
      </div>
      <div class="freshness-grid-r49">${freshnessCard('Owned social',item.freshness?.ownedSocial)}${freshnessCard('Creator / KOL',item.freshness?.creators)}${freshnessCard('GTM activity',item.freshness?.gtm)}</div>
      ${item.priorities?.length ? `<div class="report-priority-r49">${item.priorities.map((text)=>`<div>${esc(text)}</div>`).join('')}</div>` : ''}
      ${portfolio?.items?.length ? `<section class="report-queue-r49"><header><strong>Portfolio reporting queue</strong><span>${fmt(portfolio.summary?.overdueReports)} overdue · ${fmt(portfolio.summary?.dueSoon)} due soon</span></header><div>${portfolio.items.slice(0,6).map((row)=>`<article><div><strong>${esc(row.projectName || row.name)}</strong><span>${esc(row.name)}</span></div><b>${esc(row.health)}</b><span>${esc(dueCopy(row.weekly))} · ${esc(dueCopy(row.monthly))}</span></article>`).join('')}</div></section>` : ''}`;
    const summary = body.querySelector('.campaign-summary-intelligence-r48');
    if (summary) summary.insertAdjacentElement('afterend',panel); else body.insertAdjacentElement('afterbegin',panel);
    workspace.dataset.reportingControlR49 = id;
  }

  async function load(id,force=false) {
    if (!id) return;
    if (!force && cache.has(id)) return render(id,cache.get(id).campaign,cache.get(id).portfolio);
    try {
      const [campaign,portfolio] = await Promise.all([getJson(`/api/campaign-reporting-control/${encodeURIComponent(id)}`),getJson('/api/campaign-reporting-control')]);
      cache.set(id,{campaign,portfolio});
      render(id,campaign,portfolio);
    } catch (cause) { console.warn('[AKARI reporting control]',cause); }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const match = url.match(/\/api\/(?:service-delivery|campaign-(?:gtm-)?tracking|campaign-reporting-history|campaign-summary-intelligence)\/([^/?#]+)$/);
      if (match && response.ok) queueMicrotask(()=>load(decodeURIComponent(match[1]),true));
    } catch {}
    return response;
  };

  new MutationObserver(()=>{
    const workspace = document.querySelector('.delivery-workspace');
    if (!workspace || workspace.querySelector('.campaign-reporting-control-r49')) return;
    const id = workspace.dataset.summaryIntelligenceR48 || workspace.dataset.reportingHistoryR47 || workspace.dataset.executiveR45 || [...cache.keys()].at(-1);
    if (id) load(id);
  }).observe(document.body,{childList:true,subtree:true});
})();
