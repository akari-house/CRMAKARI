(() => {
  'use strict';
  if (window.__akariCampaignExecutiveIntelligenceR45) return;
  window.__akariCampaignExecutiveIntelligenceR45 = true;

  const cache = new Map();
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const asDate = (value) => { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? new Date(parsed) : null; };
  const daysBetween = (from, to = new Date()) => from ? Math.floor((to.getTime() - from.getTime()) / 86400000) : null;

  async function getJson(url) {
    const response = await fetch(url, { headers:{ 'content-type':'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Campaign intelligence request failed');
    return payload;
  }

  function rollingReach(tracking, gtm, days = 28) {
    const cutoff = Date.now() - (days * 86400000);
    const within = (date) => { const d = asDate(date); return d && d.getTime() >= cutoff; };
    const social = (tracking.socialUpdates || []).filter((item) => within(item.dataDate)).reduce((sum, item) => sum + Number(item.reach || 0), 0);
    const creators = (tracking.creatorPosts || []).filter((item) => within(item.dataDate)).reduce((sum, item) => sum + Number(item.reach || 0), 0);
    const activities = (gtm.activities || []).filter((item) => item.status !== 'CANCELLED' && within(item.dataDate)).reduce((sum, item) => sum + Number(item.reach || 0), 0);
    return { social, creators, activities, total:social + creators + activities };
  }

  function averageSocialProgress(summary) {
    const rows = (summary.scorecard || []).filter((row) => Number(row.targetAudience || 0) > Number(row.baselineAudience || 0));
    return rows.length ? rows.reduce((sum, row) => sum + Number(row.targetProgress || 0), 0) / rows.length : 0;
  }

  function executiveModel(trackingPayload, gtmPayload) {
    const tracking = trackingPayload.item || {};
    const summary = tracking.summary || {};
    const creator = summary.creatorTracking || {};
    const gtm = gtmPayload.item || {};
    const gtmSummary = gtm.summary || {};
    const reach28 = rollingReach(tracking, gtm, 28);
    const socialProgress = averageSocialProgress(summary);
    const creatorProgress = Number(creator.postCompletionPercent || 0);
    const activityProgress = Number(gtmSummary.activityCount || 0) > 0 ? (Number(gtmSummary.completedCount || 0) / Number(gtmSummary.activityCount || 1)) * 100 : 0;
    const timeProgress = tracking.startDate && tracking.targetCompletionDate
      ? Math.max(0, Math.min(100, ((Date.now() - new Date(`${tracking.startDate}T00:00:00Z`).getTime()) / Math.max(1, new Date(`${tracking.targetCompletionDate}T00:00:00Z`).getTime() - new Date(`${tracking.startDate}T00:00:00Z`).getTime())) * 100))
      : Math.min(100, Math.max(0, Number(summary.currentWeek || 1) / 4 * 100));

    const risks = [];
    const lastUpdate = asDate(summary.lastDataUpdate);
    const freshnessDays = daysBetween(lastUpdate);
    if (!lastUpdate) risks.push({ tone:'high', title:'Owned-social data missing', detail:'No dated owned-social update has been recorded.' });
    else if (freshnessDays > 7) risks.push({ tone:'medium', title:'Reporting data is stale', detail:`Last owned-social update was ${freshnessDays} days ago.` });
    if (socialProgress + 15 < timeProgress) risks.push({ tone:'high', title:'Owned-social growth behind pace', detail:`Target progress ${socialProgress.toFixed(1)}% vs campaign time ${timeProgress.toFixed(1)}%.` });
    if (Number(creator.plannedPosts || 0) > 0 && creatorProgress + 15 < timeProgress) risks.push({ tone:'high', title:'Creator publishing behind pace', detail:`Published-post progress ${creatorProgress.toFixed(1)}% vs campaign time ${timeProgress.toFixed(1)}%.` });
    const overdueActivities = (gtm.activities || []).filter((item) => item.status === 'PLANNED' && asDate(item.dataDate)?.getTime() < Date.now()).length;
    if (overdueActivities) risks.push({ tone:'medium', title:'Planned GTM activity overdue', detail:`${overdueActivities} planned activit${overdueActivities === 1 ? 'y is' : 'ies are'} past the tracked date.` });
    if (Number(creator.creatorCount || 0) > 0 && Number(creator.creatorReach || 0) === 0) risks.push({ tone:'medium', title:'Creator reach not recorded', detail:'Creators are assigned but published reach is still zero.' });
    if (!risks.length) risks.push({ tone:'low', title:'No material campaign tracking risk', detail:'Tracked execution is currently within the configured monitoring thresholds.' });

    let health = 100;
    risks.forEach((risk) => { health -= risk.tone === 'high' ? 18 : risk.tone === 'medium' ? 9 : 0; });
    if (!Number(reach28.total || 0)) health -= 8;
    health = Math.max(0, Math.min(100, health));
    const healthTone = health >= 80 ? 'low' : health >= 60 ? 'medium' : 'high';

    const topCreators = [...(creator.creators || [])].sort((a, b) => Number(b.totalReach || 0) - Number(a.totalReach || 0)).slice(0, 5);
    const topAgencies = [...(creator.agencies || [])].sort((a, b) => Number(b.reach || 0) - Number(a.reach || 0)).slice(0, 5);
    return { tracking, summary, creator, gtm, gtmSummary, reach28, socialProgress, creatorProgress, activityProgress, timeProgress, risks, health, healthTone, topCreators, topAgencies };
  }

  function render(id, model) {
    const workspace = document.querySelector('.delivery-workspace');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!workspace || !body) return;
    workspace.querySelector('.campaign-executive-r45')?.remove();

    const panel = document.createElement('section');
    panel.className = 'campaign-executive-r45';
    panel.innerHTML = `
      <header>
        <div><span>EXECUTIVE INTELLIGENCE</span><strong>Campaign command center</strong><small>One view across owned social, creators/KOLs, agencies and GTM activity.</small></div>
        <div class="exec-health-r45 ${model.healthTone}"><small>Campaign health</small><b>${fmt(model.health)}</b><span>/ 100</span></div>
      </header>
      <div class="exec-kpis-r45">
        <article><small>4-week tracked reach</small><b>${fmt(model.reach28.total)}</b><span>Non-deduplicated across channels</span></article>
        <article><small>Owned social progress</small><b>${fmt(model.socialProgress,1)}%</b><span>${fmt(model.summary.totalOwnedAudience)} current audience</span></article>
        <article><small>Creator delivery</small><b>${fmt(model.creator.publishedPosts)} / ${fmt(model.creator.plannedPosts)}</b><span>${fmt(model.creator.creatorReach)} tracked reach</span></article>
        <article><small>GTM outcomes</small><b>${fmt(model.gtmSummary.totalLeads)} leads</b><span>${fmt(model.gtmSummary.totalMeetings)} meetings · ${fmt(model.gtmSummary.totalApplications)} applications</span></article>
        <article><small>Campaign pace</small><b>${fmt(model.timeProgress,1)}%</b><span>Time elapsed against tracked duration</span></article>
      </div>
      <div class="exec-reach-r45">
        <div><strong>Rolling 4-week reach mix</strong><span>Tracked reach, not unique users</span></div>
        <div class="exec-reach-bars-r45">
          ${[['Owned social',model.reach28.social],['Creators / KOLs',model.reach28.creators],['GTM activities',model.reach28.activities]].map(([name,value])=>{
            const width = model.reach28.total > 0 ? Math.max(2, Math.min(100, Number(value || 0) / model.reach28.total * 100)) : 0;
            return `<article><div><strong>${name}</strong><span>${fmt(value)}</span></div><div class="exec-bar-r45"><i style="width:${width}%"></i></div></article>`;
          }).join('')}
        </div>
      </div>
      <div class="exec-grid-r45">
        <section><div class="exec-section-head-r45"><strong>Management attention</strong><span>${model.risks.length} signal${model.risks.length === 1 ? '' : 's'}</span></div><div class="exec-risk-list-r45">${model.risks.map((risk)=>`<article class="${risk.tone}"><i></i><div><strong>${esc(risk.title)}</strong><span>${esc(risk.detail)}</span></div></article>`).join('')}</div></section>
        <section><div class="exec-section-head-r45"><strong>Performance leaders</strong><span>By tracked reach</span></div><div class="exec-leaders-r45"><div><small>Creators / KOLs</small>${model.topCreators.length ? model.topCreators.map((creator,index)=>`<article><b>${index+1}</b><div><strong>${esc(creator.name || creator.handle || 'Creator')}</strong><span>${esc(creator.agencyName || 'Direct')} · ${fmt(creator.publishedPosts)}/${fmt(creator.expectedPosts)} posts</span></div><em>${fmt(creator.totalReach)}</em></article>`).join('') : '<p>No creator reach recorded yet.</p>'}</div><div><small>Agencies</small>${model.topAgencies.length ? model.topAgencies.map((agency,index)=>`<article><b>${index+1}</b><div><strong>${esc(agency.agencyName)}</strong><span>${fmt(agency.creators)} creators · ${fmt(agency.publishedPosts)}/${fmt(agency.expectedPosts)} posts</span></div><em>${fmt(agency.reach)}</em></article>`).join('') : '<p>No agency reach recorded yet.</p>'}</div></div></section>
      </div>
      <div class="exec-funnel-r45">
        <div class="exec-section-head-r45"><strong>GTM outcome funnel</strong><span>Tracked campaign outcomes</span></div>
        <div>${[['Activities',model.gtmSummary.activityCount],['Completed',model.gtmSummary.completedCount],['Clicks',model.gtmSummary.totalClicks],['Leads',model.gtmSummary.totalLeads],['Applications',model.gtmSummary.totalApplications],['Meetings',model.gtmSummary.totalMeetings]].map(([name,value])=>`<article><small>${name}</small><b>${fmt(value)}</b></article>`).join('')}</div>
      </div>`;

    const trackingPanel = body.querySelector('.campaign-tracking-r42');
    if (trackingPanel) trackingPanel.insertAdjacentElement('beforebegin', panel); else body.insertAdjacentElement('afterbegin', panel);
    workspace.dataset.executiveR45 = id;
  }

  async function load(id, force = false) {
    if (!id) return;
    if (!force && cache.has(id)) return render(id, cache.get(id));
    try {
      const [trackingPayload, gtmPayload] = await Promise.all([
        getJson(`/api/campaign-tracking/${encodeURIComponent(id)}`),
        getJson(`/api/campaign-gtm-tracking/${encodeURIComponent(id)}`),
      ]);
      const model = executiveModel(trackingPayload, gtmPayload);
      cache.set(id, model);
      render(id, model);
    } catch (cause) {
      console.warn('[AKARI campaign executive intelligence]', cause);
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const method = String(args[1]?.method || (typeof args[0] === 'object' ? args[0]?.method : '') || 'GET').toUpperCase();
      const serviceMatch = url.match(/\/api\/service-delivery\/([^/?#]+)$/);
      const trackingMatch = url.match(/\/api\/campaign-(?:gtm-)?tracking\/([^/?#]+)$/);
      const match = serviceMatch || (method !== 'GET' ? trackingMatch : null);
      if (match && response.ok) queueMicrotask(() => load(decodeURIComponent(match[1]), true));
    } catch {}
    return response;
  };

  new MutationObserver(() => {
    const workspace = document.querySelector('.delivery-workspace');
    if (!workspace || workspace.querySelector('.campaign-executive-r45')) return;
    const id = [...cache.keys()].at(-1);
    if (id) load(id);
  }).observe(document.body, { childList:true, subtree:true });
})();