(() => {
  'use strict';
  if (window.__akariCampaignCreatorTrackingR43) return;
  window.__akariCampaignCreatorTrackingR43 = true;

  const cache = new Map();
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const label = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  const platforms = ['X','FACEBOOK','INSTAGRAM','TIKTOK','TELEGRAM_CHANNEL','TELEGRAM_GROUP','DISCORD','YOUTUBE','LINKEDIN','REDDIT'];
  const postStatuses = ['APPROVED','HOLDING','REJECTED'];

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

  function partnerOptions(deliveryPartners, current) {
    const selected = current.agencyPartnerId || '';
    const options = [`<option value="">Direct / unassigned</option>`];
    if (!selected && current.agencyName) options.push(`<option value="" selected>Legacy: ${esc(current.agencyName)} · map to a Partner</option>`);
    (deliveryPartners || []).forEach((partner) => options.push(`<option value="${esc(partner.id)}" ${partner.id===selected?'selected':''}>${esc(partner.name)} · ${label(partner.partner_type || 'OTHER')}</option>`));
    return options.join('');
  }

  function assignmentModal(id, item, current = {}, deliveryPartners = []) {
    const overview = item.overview || {};
    modal(current.id ? 'Edit tracked creator' : 'Add tracked creator / KOL',`
      <input type="hidden" name="id" value="${esc(current.id || '')}">
      <label>Type<select name="creatorType"><option value="CREATOR" ${current.creatorType==='CREATOR'?'selected':''}>Creator</option><option value="KOL" ${current.creatorType==='KOL'?'selected':''}>KOL</option></select></label>
      <label>Name<input name="name" value="${esc(current.name || '')}"></label>
      <label>Handle<input name="handle" value="${esc(current.handle || '')}" placeholder="@handle"></label>
      <label>Platform<select name="platform">${platforms.map((p)=>`<option value="${p}" ${p===(current.platform||'X')?'selected':''}>${label(p)}</option>`).join('')}</select></label>
      <label>Profile URL<input name="profileUrl" value="${esc(current.profileUrl || '')}"></label>
      <label>Agency / delivery partner<select name="agencyPartnerId">${partnerOptions(deliveryPartners,current)}</select><small>Select a reusable Partner record. Create new agencies in Partners once, then reuse them here.</small></label>
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

  function postModal(id, item, assignment, current = {}) {
    const today = new Date().toISOString().slice(0,10);
    const status = current.status || 'APPROVED';
    modal(current.id ? `Edit tracked post · ${assignment.name || assignment.handle}` : `Track published post · ${assignment.name || assignment.handle}`,`
      <input type="hidden" name="id" value="${esc(current.id || '')}">
      <input type="hidden" name="assignmentId" value="${esc(assignment.id)}">
      <label>Status<select name="status">${postStatuses.map((s)=>`<option value="${s}" ${s===status?'selected':''}>${label(s)}</option>`).join('')}</select></label>
      <label>Platform<select name="platform">${platforms.map((p)=>`<option value="${p}" ${p===(current.platform||assignment.platform)?'selected':''}>${label(p)}</option>`).join('')}</select></label>
      <label>Post date<input type="date" name="dataDate" value="${esc(current.dataDate || today)}" required></label>
      <label>Post type<input name="postType" value="${esc(current.postType || '')}" placeholder="Post, thread, video, Space..."></label>
      <label class="full">Published URL<input name="url" value="${esc(current.url || '')}" required placeholder="https://..."></label>
      <label>Reach<input type="number" min="0" name="reach" value="${esc(current.reportedReach ?? current.reach ?? '')}"></label><label>Impressions<input type="number" min="0" name="impressions" value="${esc(current.impressions || '')}"></label>
      <label>Likes<input type="number" min="0" name="likes" value="${esc(current.likes || '')}"></label><label>Comments<input type="number" min="0" name="comments" value="${esc(current.comments || '')}"></label>
      <label>Shares / reposts<input type="number" min="0" name="shares" value="${esc(current.shares || '')}"></label><label>Video views<input type="number" min="0" name="videoViews" value="${esc(current.videoViews || '')}"></label>
      <label>Link clicks<input type="number" min="0" name="linkClicks" value="${esc(current.linkClicks || '')}"></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(current.notes || '')}</textarea></label>`, current.id ? 'Save post' : 'Track post', async(form)=>{
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
    const deliveryPartners = payload.deliveryPartners || [];
    const panel = document.createElement('section');
    panel.className = 'campaign-creator-tracking-r43';
    panel.innerHTML = `
      <header><div><span>CAMPAIGN MONITORING</span><strong>Creator, KOL & delivery-partner tracking</strong><small>Agencies come from the reusable Partners directory. Only Approved posts count toward campaign reach, engagement, completion and ROI.</small></div>${payload.permissions?.canWrite?'<button class="primary" data-add-creator>Add tracked creator</button>':''}</header>
      <div class="creator-tracking-kpis-r43">
        <article><small>Tracked creators</small><b>${fmt(summary.creatorCount)}</b><span>${fmt(summary.kolCount)} KOLs</span></article>
        <article><small>Approved posts</small><b>${fmt(summary.publishedPosts)} / ${fmt(summary.plannedPosts)}</b><span>${fmt(summary.submittedPosts)} submitted · ${fmt(summary.holdingPosts)} holding</span></article>
        <article><small>Approved reach</small><b>${fmt(summary.creatorReach)}</b><span>${fmt(summary.averageReachPerPost)} avg / approved post</span></article>
        <article><small>Approved engagements</small><b>${fmt(summary.creatorEngagements)}</b><span>${fmt(summary.rejectedPosts)} rejected posts excluded</span></article>
        <article><small>Delivery partners</small><b>${fmt(summary.agencyCount)}</b><span>${fmt(deliveryPartners.length)} reusable records available</span></article>
      </div>
      <div class="creator-tracking-layout-r43">
        <section><div class="section-head-r43"><strong>Creator / KOL tracker</strong><span>Target vs approved delivery</span></div>
          ${creators.length?`<div class="creator-table-wrap-r43"><table><thead><tr><th>Creator</th><th>Delivery partner</th><th>Approved</th><th>Reach</th><th>Sorsa / XScore</th><th>Allocation</th><th></th></tr></thead><tbody>${creators.map((c)=>`<tr data-creator="${esc(c.id)}"><td><strong>${esc(c.name || c.handle || 'Creator')}</strong><span>${esc(c.handle || '')} · ${label(c.creatorType)} · ${label(c.platform)}</span></td><td>${esc(c.agencyName || 'Direct')}<span>${c.agencyPartnerId ? 'Partner-linked' : c.agencyName ? 'Legacy · needs mapping' : 'Direct / unassigned'}</span></td><td>${fmt(c.publishedPosts)} / ${fmt(c.expectedPosts)}<span>${fmt(c.submittedPosts)} submitted · ${fmt(c.holdingPosts)} holding</span><div class="creator-progress-r43"><i style="width:${Math.min(100,c.deliveryProgress||0)}%"></i></div></td><td>${fmt(c.totalReach)}<span>${fmt(c.totalEngagements)} eng.</span></td><td>${fmt(c.sorsaScore)} / ${fmt(c.xScore)}</td><td>$${fmt(c.allocatedUsd,2)}<span>${fmt(c.allocatedTokens)} tokens</span></td><td>${payload.permissions?.canWrite?'<button data-track-post>+ Post</button><button data-edit-creator>Edit</button>':''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="creator-empty-r43">No creators or KOLs are being tracked yet.</p>'}
        </section>
        <section><div class="section-head-r43"><strong>Delivery-partner roll-up</strong><span>Automatically derived from contributors</span></div>
          <div class="agency-list-r43">${agencies.length?agencies.map((a)=>`<article><div><strong>${esc(a.agencyName)}</strong><span>${fmt(a.creators)} contributors · ${fmt(a.publishedPosts)}/${fmt(a.expectedPosts)} approved</span></div><div><b>${fmt(a.reach)} reach</b><span>${fmt(a.holdingPosts)} holding · $${fmt(a.allocatedUsd,2)}</span></div></article>`).join(''):'<p class="creator-empty-r43">Partner totals will appear automatically from creator assignments.</p>'}</div>
        </section>
      </div>
      <section class="recent-posts-r43"><div class="section-head-r43"><strong>Recent creator posts</strong><span>Each published URL is recorded once</span></div><div>${item.creatorPosts?.length?item.creatorPosts.slice(0,10).map((post)=>{const creator=creators.find((c)=>c.id===post.assignmentId);const status=post.status||'APPROVED';const rawReach=post.reportedReach??post.reach??0;return `<article data-post="${esc(post.id)}" class="post-status-${esc(status.toLowerCase())}"><div><strong>${esc(creator?.name || creator?.handle || 'Creator')}</strong><span>${label(post.platform)} · ${esc(post.dataDate)} · ${esc(post.postType || 'Published post')}</span></div><span class="post-status-pill-r43 ${esc(status.toLowerCase())}">${label(status)}</span><a href="${esc(post.url)}" target="_blank" rel="noopener">Open post</a><b>${fmt(rawReach)} reach · ${fmt(post.reportedEngagements??post.totalEngagements)} eng.</b>${payload.permissions?.canWrite?'<button data-edit-post>Edit</button>':''}</article>`;}).join(''):'<p class="creator-empty-r43">No creator posts are tracked yet.</p>'}</div></section>`;

    panel.querySelector('[data-add-creator]')?.addEventListener('click',()=>assignmentModal(id,item,{},deliveryPartners));
    panel.querySelectorAll('[data-creator]').forEach((row)=>{
      const creator = creators.find((c)=>c.id===row.dataset.creator);
      row.querySelector('[data-track-post]')?.addEventListener('click',()=>postModal(id,item,creator));
      row.querySelector('[data-edit-creator]')?.addEventListener('click',()=>assignmentModal(id,item,creator,deliveryPartners));
    });
    panel.querySelectorAll('[data-post]').forEach((row)=>{
      const post = item.creatorPosts.find((p)=>p.id===row.dataset.post);
      const creator = creators.find((c)=>c.id===post?.assignmentId);
      row.querySelector('[data-edit-post]')?.addEventListener('click',()=>postModal(id,item,creator,post));
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