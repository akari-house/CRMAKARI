(() => {
  'use strict';
  if (window.__akariCampaignCreatorTrackingR43) return;
  window.__akariCampaignCreatorTrackingR43 = true;

  const cache = new Map();
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const label = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  const platforms = ['X','FACEBOOK','INSTAGRAM','TIKTOK','TELEGRAM_CHANNEL','TELEGRAM_GROUP','DISCORD','YOUTUBE','LINKEDIN','REDDIT'];

  async function api(id, options = {}) {
    const response = await fetch(`/api/campaign-tracking/${encodeURIComponent(id)}`, {
      ...options,
      headers:{'content-type':'application/json',...(options.headers || {})},
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || payload.message || 'Campaign creator tracking request failed');
    return payload;
  }

  function closeModal() { document.querySelector('.creator-tracking-modal-r43')?.remove(); }
  function modal(title, fields, submitLabel, onSubmit) {
    closeModal();
    const layer = document.createElement('div');
    layer.className = 'creator-tracking-modal-r43';
    layer.innerHTML = `<form><h3>${esc(title)}</h3><div class="creator-tracking-form-r43">${fields}</div><div class="creator-tracking-modal-actions-r43"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${esc(submitLabel)}</button></div></form>`;
    layer.addEventListener('click',(event)=>{ if(event.target===layer || event.target.closest('[data-close]')) closeModal(); });
    layer.querySelector('form').addEventListener('submit',async(event)=>{
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try { await onSubmit(new FormData(event.currentTarget)); closeModal(); }
      catch (cause) { alert(cause.message); button.disabled = false; }
    });
    document.body.appendChild(layer);
  }

  function assignmentModal(id, item, current = {}) {
    const overview = item.overview || {};
    modal(current.id ? 'Edit tracked creator' : 'Add tracked creator / KOL',`
      <input type="hidden" name="id" value="${esc(current.id || '')}">
      <label>Type<select name="creatorType"><option value="CREATOR" ${current.creatorType==='CREATOR'?'selected':''}>Creator</option><option value="KOL" ${current.creatorType==='KOL'?'selected':''}>KOL</option></select></label>
      <label>Name<input name="name" value="${esc(current.name || '')}"></label>
      <label>Handle<input name="handle" value="${esc(current.handle || '')}" placeholder="@handle"></label>
      <label>Platform<select name="platform">${platforms.map((p)=>`<option value="${p}" ${p===(current.platform||'X')?'selected':''}>${label(p)}</option>`).join('')}</select></label>
      <label>Profile URL<input name="profileUrl" value="${esc(current.profileUrl || '')}"></label>
      <label>Agency<input name="agencyName" value="${esc(current.agencyName || '')}" placeholder="Direct if empty"></label>
      <label>Category<input name="category" value="${esc(current.category || '')}"></label>
      <label>Region<input name="region" value="${esc(current.region || '')}"></label>
      <label>Sorsa Score<input type="number" min="0" name="sorsaScore" value="${esc(current.sorsaScore || '')}"></label>
      <label>XScore<input type="number" min="0" name="xScore" value="${esc(current.xScore || '')}"></label>
      <label>Expected posts<input type="number" min="0" name="expectedPosts" value="${esc(current.expectedPosts || '')}"></label>
      <label>Expected reach<input type="number" min="0" name="expectedReach" value="${esc(current.expectedReach || '')}"></label>
      <label>Allocated USD<input type="number" min="0" step="any" name="allocatedUsd" value="${esc(current.allocatedUsd || '')}"></label>
      <label>Allocated tokens<input type="number" min="0" step="any" name="allocatedTokens" value="${esc(current.allocatedTokens || '')}"></label>
      <label>TGE unlock %<input type="number" min="0" max="100" name="tgeUnlockPercent" value="${esc(current.tgeUnlockPercent ?? overview.defaultTgeUnlock ?? '')}"></label>
      <label>Cliff months<input type="number" min="0" name="cliffMonths" value="${esc(current.cliffMonths ?? overview.defaultCliffMonths ?? '')}"></label>
      <label>Vesting months<input type="number" min="0" name="vestingMonths" value="${esc(current.vestingMonths ?? overview.defaultVestingMonths ?? '')}"></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(current.notes || '')}</textarea></label>`, current.id ? 'Save changes' : 'Add creator', async(form)=>{
        const assignment = Object.fromEntries(form.entries());
        await api(id,{method:'PATCH',body:JSON.stringify({action:'upsert-creator-assignment',assignment})});
        await load(id,true);
      });
  }

  function postModal(id, item, assignment) {
    const today = new Date().toISOString().slice(0,10);
    modal(`Track published post · ${assignment.name || assignment.handle}`,`
      <input type="hidden" name="assignmentId" value="${esc(assignment.id)}">
      <label>Platform<select name="platform">${platforms.map((p)=>`<option value="${p}" ${p===assignment.platform?'selected':''}>${label(p)}</option>`).join('')}</select></label>
      <label>Post date<input type="date" name="dataDate" value="${today}" required></label>
      <label>Post type<input name="postType" placeholder="Post, thread, video, Space..."></label>
      <label class="full">Published URL<input name="url" required placeholder="https://..."></label>
      <label>Reach<input type="number" min="0" name="reach"></label><label>Impressions<input type="number" min="0" name="impressions"></label>
      <label>Likes<input type="number" min="0" name="likes"></label><label>Comments<input type="number" min="0" name="comments"></label>
      <label>Shares / reposts<input type="number" min="0" name="shares"></label><label>Video views<input type="number" min="0" name="videoViews"></label>
      <label>Link clicks<input type="number" min="0" name="linkClicks"></label>
      <label class="full">Notes<textarea name="notes" rows="3"></textarea></label>`, 'Track post', async(form)=>{
        const post = Object.fromEntries(form.entries());
        await api(id,{method:'PATCH',body:JSON.stringify({action:'upsert-creator-post',post})});
        await load(id,true);
      });
  }

  function render(id, payload) {
    const workspace = document.querySelector('.delivery-workspace');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!workspace || !body) return;
    workspace.querySelector('.campaign-creator-tracking-r43')?.remove();
    const item = payload.item;
    const summary = item.summary?.creatorTracking || {};
    const creators = summary.creators || [];
    const agencies = summary.agencies || [];
    const panel = document.createElement('section');
    panel.className = 'campaign-creator-tracking-r43';
    panel.innerHTML = `
      <header><div><span>CAMPAIGN MONITORING</span><strong>Creator, KOL & agency tracking</strong><small>Track commitments, published work, reach and allocation. Execution stays outside the CRM.</small></div>${payload.permissions?.canWrite?'<button class="primary" data-add-creator>Add tracked creator</button>':''}</header>
      <div class="creator-tracking-kpis-r43">
        <article><small>Tracked creators</small><b>${fmt(summary.creatorCount)}</b><span>${fmt(summary.kolCount)} KOLs</span></article>
        <article><small>Posts</small><b>${fmt(summary.publishedPosts)} / ${fmt(summary.plannedPosts)}</b><span>${fmt(summary.postCompletionPercent,1)}% tracked</span></article>
        <article><small>Creator reach</small><b>${fmt(summary.creatorReach)}</b><span>${fmt(summary.averageReachPerPost)} avg / post</span></article>
        <article><small>Engagements</small><b>${fmt(summary.creatorEngagements)}</b><span>Published content</span></article>
        <article><small>Allocation</small><b>$${fmt(summary.allocatedUsd,2)}</b><span>${fmt(summary.allocatedTokens)} tokens</span></article>
      </div>
      <div class="creator-tracking-layout-r43">
        <section><div class="section-head-r43"><strong>Creator / KOL tracker</strong><span>Expected vs published</span></div>
          ${creators.length?`<div class="creator-table-wrap-r43"><table><thead><tr><th>Creator</th><th>Agency</th><th>Posts</th><th>Reach</th><th>Sorsa / XScore</th><th>Allocation</th><th></th></tr></thead><tbody>${creators.map((c)=>`<tr data-creator="${esc(c.id)}"><td><strong>${esc(c.name || c.handle || 'Creator')}</strong><span>${esc(c.handle || '')} · ${label(c.creatorType)} · ${label(c.platform)}</span></td><td>${esc(c.agencyName || 'Direct')}</td><td>${fmt(c.publishedPosts)} / ${fmt(c.expectedPosts)}<div class="creator-progress-r43"><i style="width:${Math.min(100,c.deliveryProgress||0)}%"></i></div></td><td>${fmt(c.totalReach)}<span>${fmt(c.totalEngagements)} eng.</span></td><td>${fmt(c.sorsaScore)} / ${fmt(c.xScore)}</td><td>$${fmt(c.allocatedUsd,2)}<span>${fmt(c.allocatedTokens)} tokens</span></td><td>${payload.permissions?.canWrite?'<button data-track-post>+ Post</button><button data-edit-creator>Edit</button>':''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="creator-empty-r43">No creators or KOLs are being tracked yet.</p>'}
        </section>
        <section><div class="section-head-r43"><strong>Agency roll-up</strong><span>Automatically derived</span></div>
          <div class="agency-list-r43">${agencies.length?agencies.map((a)=>`<article><div><strong>${esc(a.agencyName)}</strong><span>${fmt(a.creators)} creators · ${fmt(a.publishedPosts)}/${fmt(a.expectedPosts)} posts</span></div><div><b>${fmt(a.reach)} reach</b><span>$${fmt(a.allocatedUsd,2)} · ${fmt(a.allocatedTokens)} tokens</span></div></article>`).join(''):'<p class="creator-empty-r43">Agency totals will appear automatically from creator assignments.</p>'}</div>
        </section>
      </div>
      <section class="recent-posts-r43"><div class="section-head-r43"><strong>Recent creator posts</strong><span>Each published URL is recorded once</span></div><div>${item.creatorPosts?.length?item.creatorPosts.slice(0,8).map((post)=>{const creator=creators.find((c)=>c.id===post.assignmentId);return `<article><div><strong>${esc(creator?.name || creator?.handle || 'Creator')}</strong><span>${label(post.platform)} · ${esc(post.dataDate)} · ${esc(post.postType || 'Published post')}</span></div><a href="${esc(post.url)}" target="_blank" rel="noopener">Open post</a><b>${fmt(post.reach)} reach · ${fmt(post.totalEngagements)} eng.</b></article>`;}).join(''):'<p class="creator-empty-r43">No creator posts are tracked yet.</p>'}</div></section>`;

    panel.querySelector('[data-add-creator]')?.addEventListener('click',()=>assignmentModal(id,item));
    panel.querySelectorAll('[data-creator]').forEach((row)=>{
      const creator = creators.find((c)=>c.id===row.dataset.creator);
      row.querySelector('[data-track-post]')?.addEventListener('click',()=>postModal(id,item,creator));
      row.querySelector('[data-edit-creator]')?.addEventListener('click',()=>assignmentModal(id,item,creator));
    });
    const tracking = body.querySelector('.campaign-tracking-r42');
    if (tracking) tracking.insertAdjacentElement('afterend',panel); else body.appendChild(panel);
    workspace.dataset.creatorTrackingR43 = id;
  }

  async function load(id, force = false) {
    if (!id) return;
    if (!force && cache.has(id)) return render(id,cache.get(id));
    try { const payload=await api(id); cache.set(id,payload); render(id,payload); }
    catch(cause) { console.warn('[AKARI creator tracking]',cause); }
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

  new MutationObserver(()=>{
    const workspace=document.querySelector('.delivery-workspace');
    if(!workspace || workspace.querySelector('.campaign-creator-tracking-r43')) return;
    const id=[...cache.keys()].at(-1);
    if(id) load(id);
  }).observe(document.body,{childList:true,subtree:true});
})();