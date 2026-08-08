(() => {
  'use strict';
  if (window.__akariCampaignTrackingR42) return;
  window.__akariCampaignTrackingR42 = true;

  const state = new Map();
  const platforms = ['X','FACEBOOK','INSTAGRAM','TIKTOK','TELEGRAM_CHANNEL','TELEGRAM_GROUP','DISCORD','YOUTUBE','LINKEDIN','REDDIT'];
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const label = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());

  async function api(id, options = {}) {
    const response = await fetch(`/api/campaign-tracking/${encodeURIComponent(id)}`, {
      ...options,
      headers:{'content-type':'application/json',...(options.headers || {})},
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Campaign tracking request failed');
    return payload;
  }

  function closeModal() { document.querySelector('.tracking-modal-r42')?.remove(); }
  function modal(title, fields, submitLabel, onSubmit) {
    closeModal();
    const layer = document.createElement('div');
    layer.className = 'tracking-modal-r42';
    layer.innerHTML = `<form><h3>${esc(title)}</h3><div class="tracking-form-grid-r42">${fields}</div><div class="tracking-modal-actions-r42"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></div></form>`;
    layer.addEventListener('click',(event)=>{ if(event.target === layer || event.target.closest('[data-close]')) closeModal(); });
    layer.querySelector('form').addEventListener('submit',async(event)=>{
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try { await onSubmit(new FormData(event.currentTarget)); closeModal(); }
      catch (cause) { alert(cause.message); button.disabled = false; }
    });
    document.body.appendChild(layer);
  }

  function setupModal(id, item) {
    const overview = item.overview || {};
    modal('Campaign tracking setup',`
      <label>Reporting currency<input name="reportingCurrency" value="${esc(overview.reportingCurrency || 'USD')}"></label>
      <label>Main X profile<input name="mainXProfile" value="${esc(overview.mainXProfile || '')}" placeholder="https://x.com/..."></label>
      <label>Project website<input name="projectWebsite" value="${esc(overview.projectWebsite || '')}"></label>
      <label>Token listing price<input type="number" step="any" min="0" name="tokenListingPrice" value="${esc(overview.tokenListingPrice || '')}"></label>
      <label>Current token price<input type="number" step="any" min="0" name="currentTokenPrice" value="${esc(overview.currentTokenPrice || '')}"></label>
      <label>Default TGE unlock %<input type="number" min="0" max="100" name="defaultTgeUnlock" value="${esc(overview.defaultTgeUnlock || '')}"></label>
      <label>Default cliff months<input type="number" min="0" name="defaultCliffMonths" value="${esc(overview.defaultCliffMonths || '')}"></label>
      <label>Default vesting months<input type="number" min="0" name="defaultVestingMonths" value="${esc(overview.defaultVestingMonths || '')}"></label>
      <label>Baseline Sorsa Score<input type="number" min="0" name="baselineSorsaScore" value="${esc(overview.baselineSorsaScore || '')}"></label>
      <label>Target Sorsa Score<input type="number" min="0" name="targetSorsaScore" value="${esc(overview.targetSorsaScore || '')}"></label>
      <label>Baseline XScore<input type="number" min="0" name="baselineXScore" value="${esc(overview.baselineXScore || '')}"></label>
      <label>Target XScore<input type="number" min="0" name="targetXScore" value="${esc(overview.targetXScore || '')}"></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(overview.notes || '')}</textarea></label>`, 'Save setup', async(form)=>{
        const overview = Object.fromEntries(form.entries());
        await api(id,{method:'PATCH',body:JSON.stringify({action:'update-overview',overview})});
        await load(id,true);
      });
  }

  function targetModal(id, current = {}) {
    modal('Baseline and target',`
      <label>Platform<select name="platform">${platforms.map((item)=>`<option value="${item}" ${item===current.platform?'selected':''}>${label(item)}</option>`).join('')}</select></label>
      <label>Profile URL<input name="profileUrl" value="${esc(current.profileUrl || '')}"></label>
      <label>Baseline audience<input type="number" min="0" name="baselineAudience" value="${esc(current.baselineAudience || '')}" required></label>
      <label>Target audience<input type="number" min="0" name="targetAudience" value="${esc(current.targetAudience || '')}" required></label>`, 'Save target', async(form)=>{
        await api(id,{method:'PATCH',body:JSON.stringify({action:'upsert-target',target:Object.fromEntries(form.entries())})});
        await load(id,true);
      });
  }

  function updateModal(id, item) {
    const today = new Date().toISOString().slice(0,10);
    modal('Add owned-social update',`
      <label>Platform<select name="platform">${platforms.map((value)=>`<option value="${value}">${label(value)}</option>`).join('')}</select></label>
      <label>Data date<input type="date" name="dataDate" value="${today}" required></label>
      <label>Profile URL<input name="profileUrl"></label><label>Audience / followers<input type="number" min="0" name="audience" required></label>
      <label>Reach<input type="number" min="0" name="reach"></label><label>Impressions<input type="number" min="0" name="impressions"></label>
      <label>Likes<input type="number" min="0" name="likes"></label><label>Comments<input type="number" min="0" name="comments"></label>
      <label>Shares / reposts<input type="number" min="0" name="shares"></label><label>Video views<input type="number" min="0" name="videoViews"></label>
      <label>Link clicks<input type="number" min="0" name="linkClicks"></label><label>Profile visits<input type="number" min="0" name="profileVisits"></label>
      <label>Sorsa Score (X only)<input type="number" min="0" name="sorsaScore"></label><label>XScore (X only)<input type="number" min="0" name="xScore"></label>
      <label class="full">Notes<textarea name="notes" rows="3"></textarea></label>`, 'Add update', async(form)=>{
        await api(id,{method:'PATCH',body:JSON.stringify({action:'upsert-social-update',update:Object.fromEntries(form.entries())})});
        await load(id,true);
      });
  }

  function render(id, payload) {
    if (!payload?.item) return;
    const workspace = document.querySelector('.delivery-workspace');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!body || workspace.dataset.trackingR42 === id) return;
    workspace.querySelector('.campaign-tracking-r42')?.remove();
    const item = payload.item;
    const summary = item.summary || {};
    const activeRows = (summary.scorecard || []).filter((row)=>row.baselineAudience || row.targetAudience || row.currentAudience);
    const panel = document.createElement('section');
    panel.className = 'campaign-tracking-r42';
    panel.innerHTML = `
      <header><div><span>CAMPAIGN OPERATIONS & INTELLIGENCE</span><strong>GTM campaign tracking</strong></div><div class="tracking-actions-r42">${payload.permissions?.canWrite ? '<button data-setup>Setup</button><button data-target>Baseline & target</button><button class="primary" data-update>Add social update</button>' : ''}</div></header>
      <div class="tracking-kpis-r42">
        <article><small>Campaign period</small><b>W${fmt(summary.currentWeek)}</b><small>Month ${fmt(summary.currentMonth)} · ${fmt(summary.daysRunning)} days</small></article>
        <article><small>Owned audience</small><b>${fmt(summary.totalOwnedAudience)}</b><small>Latest current values</small></article>
        <article><small>Owned reach</small><b>${fmt(summary.totalOwnedReach)}</b><small>Campaign lifetime</small></article>
        <article><small>Engagements</small><b>${fmt(summary.totalOwnedEngagements)}</b><small>Campaign lifetime</small></article>
        <article><small>Last update</small><b>${esc(summary.lastDataUpdate || '—')}</b><small>Next report ${esc(summary.nextReportingDate || '—')}</small></article>
      </div>
      <div class="tracking-grid-r42">
        <section class="tracking-section-r42"><div><strong>Owned-social scorecard</strong><span>Baseline → target → latest current value</span></div>
          ${activeRows.length ? `<table class="tracking-scorecard-r42"><thead><tr><th>Platform</th><th>Baseline</th><th>Target</th><th>Current</th><th>Net growth</th><th>Progress</th></tr></thead><tbody>${activeRows.map((row)=>`<tr data-platform="${row.platform}"><td>${label(row.platform)}</td><td>${fmt(row.baselineAudience)}</td><td>${fmt(row.targetAudience)}</td><td>${fmt(row.currentAudience)}</td><td>${row.netGrowth >= 0 ? '+' : ''}${fmt(row.netGrowth)}</td><td><div class="tracking-progress-r42"><i style="width:${Math.max(0,Math.min(100,row.targetProgress || 0))}%"></i></div> ${fmt(row.targetProgress,1)}%</td></tr>`).join('')}</tbody></table>` : '<p class="tracking-empty-r42">Add baseline and target values to activate the scorecard.</p>'}
        </section>
        <section class="tracking-section-r42"><div><strong>Recent owned-social updates</strong><span>One platform + one reporting date</span></div><div class="tracking-update-list-r42">${item.socialUpdates?.length ? item.socialUpdates.slice(0,6).map((update)=>`<article><div><strong>${label(update.platform)} · ${esc(update.dataDate)}</strong><span>${fmt(update.audience)} audience · ${fmt(update.reach)} reach · ${fmt(update.totalEngagements)} engagements</span></div><b>W${fmt(update.campaignWeek)}</b></article>`).join('') : '<p class="tracking-empty-r42">No owned-social updates have been recorded.</p>'}</div></section>
      </div>`;
    panel.querySelector('[data-setup]')?.addEventListener('click',()=>setupModal(id,item));
    panel.querySelector('[data-target]')?.addEventListener('click',()=>targetModal(id));
    panel.querySelector('[data-update]')?.addEventListener('click',()=>updateModal(id,item));
    panel.querySelectorAll('[data-platform]').forEach((row)=>row.addEventListener('dblclick',()=>{
      const current = item.targets?.find((target)=>target.platform===row.dataset.platform) || {platform:row.dataset.platform};
      targetModal(id,current);
    }));
    const closeout = body.querySelector('.delivery-closeout-r41');
    if (closeout) closeout.insertAdjacentElement('afterend',panel); else body.insertAdjacentElement('afterbegin',panel);
    workspace.dataset.trackingR42 = id;
  }

  async function load(id, force = false) {
    if (!id) return;
    if (!force && state.has(id)) return render(id,state.get(id));
    try {
      const payload = await api(id);
      if (!payload?.item) return;
      state.set(id,payload);
      render(id,payload);
    }
    catch (cause) { console.warn('[AKARI campaign tracking]',cause); }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const match = url.match(/\/api\/service-delivery\/([^/?#]+)$/);
      if (match && response.ok) queueMicrotask(()=>load(decodeURIComponent(match[1]),true));
    } catch {}
    return response;
  };

  const observer = new MutationObserver(()=>{
    const workspace = document.querySelector('.delivery-workspace');
    if (!workspace || workspace.querySelector('.campaign-tracking-r42')) return;
    const candidate = [...state.keys()].at(-1);
    if (candidate) load(candidate);
  });
  observer.observe(document.body,{childList:true,subtree:true});
})();