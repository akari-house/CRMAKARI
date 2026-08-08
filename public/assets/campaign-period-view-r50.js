(() => {
  'use strict';
  if (window.__akariCampaignPeriodViewR50) return;
  window.__akariCampaignPeriodViewR50 = true;

  const cache=new Map();
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const label=(value)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  const choices=[['THIS_WEEK','This week'],['PREVIOUS_WEEK','Previous week'],['THIS_MONTH','This month'],['PREVIOUS_MONTH','Previous month'],['LIFETIME','Campaign lifetime'],['CUSTOM','Custom range']];

  async function getJson(id,view,start='',end=''){
    const params=new URLSearchParams({view}); if(start)params.set('start',start); if(end)params.set('end',end);
    const response=await fetch(`/api/campaign-period-view/${encodeURIComponent(id)}?${params.toString()}`,{headers:{'content-type':'application/json'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||payload.message||'Campaign period view failed');
    return payload;
  }

  function render(id,payload,view){
    const workspace=document.querySelector('.delivery-workspace'); const body=workspace?.querySelector('.delivery-workspace-body'); if(!workspace||!body)return;
    workspace.querySelector('.campaign-period-view-r50')?.remove();
    const period=payload.item?.period||{}; const range=period.range||{};
    const panel=document.createElement('section'); panel.className='campaign-period-view-r50';
    panel.innerHTML=`<header><div><span>REPORTING VIEW</span><strong>Period performance</strong><small>All values below are calculated only from records inside the selected campaign period.</small></div><div class="period-controls-r50"><select data-period>${choices.map(([value,text])=>`<option value="${value}" ${value===view?'selected':''}>${text}</option>`).join('')}</select><button data-custom ${view==='CUSTOM'?'':'hidden'}>Set dates</button></div></header><div class="period-range-r50"><strong>${esc(range.label||label(view))}</strong><span>${esc(range.start||'-')} → ${esc(range.end||'-')}</span></div><div class="period-kpis-r50"><article><small>Total tracked reach</small><b>${fmt(period.totals?.trackedReach)}</b><span>Non-deduplicated</span></article><article><small>Owned social</small><b>${fmt(period.ownedSocial?.reach)}</b><span>${fmt(period.ownedSocial?.audienceGrowth)} audience growth</span></article><article><small>Approved creator/KOL</small><b>${fmt(period.creators?.reach)}</b><span>${fmt(period.creators?.approvedPosts)} approved posts</span></article><article><small>GTM activity</small><b>${fmt(period.gtm?.reach)}</b><span>${fmt(period.gtm?.leads)} leads · ${fmt(period.gtm?.meetings)} meetings</span></article><article><small>Engagements</small><b>${fmt(period.totals?.trackedEngagements)}</b><span>Tracked sources</span></article></div><div class="period-split-r50"><section><strong>Creator / KOL delivery</strong><div><span>Creator posts</span><b>${fmt(period.creators?.creatorPosts)}</b></div><div><span>KOL posts</span><b>${fmt(period.creators?.kolPosts)}</b></div><div><span>Approved reach</span><b>${fmt(period.creators?.reach)}</b></div><div><span>Approved engagements</span><b>${fmt(period.creators?.engagements)}</b></div></section><section><strong>GTM outcomes</strong><div><span>Activities</span><b>${fmt(period.gtm?.activities)}</b></div><div><span>Completed</span><b>${fmt(period.gtm?.completed)}</b></div><div><span>Applications</span><b>${fmt(period.gtm?.applications)}</b></div><div><span>Meetings</span><b>${fmt(period.gtm?.meetings)}</b></div></section><section><strong>Owned-channel signals</strong><div><span>Updates</span><b>${fmt(period.ownedSocial?.updates)}</b></div><div><span>Audience growth</span><b>${fmt(period.ownedSocial?.audienceGrowth)}</b></div><div><span>Sorsa Score</span><b>${fmt(period.ownedSocial?.sorsaScore)}</b></div><div><span>XScore</span><b>${fmt(period.ownedSocial?.xScore)}</b></div></section></div>`;
    panel.querySelector('[data-period]')?.addEventListener('change',(event)=>{const next=event.target.value;if(next==='CUSTOM')openCustom(id);else load(id,next,true);});
    panel.querySelector('[data-custom]')?.addEventListener('click',()=>openCustom(id));
    const executive=body.querySelector('.campaign-executive-r45'); if(executive)executive.insertAdjacentElement('afterend',panel);else body.insertAdjacentElement('afterbegin',panel);
    workspace.dataset.periodViewR50=id;
  }

  function openCustom(id){
    document.querySelector('.period-modal-r50')?.remove(); const layer=document.createElement('div'); layer.className='period-modal-r50'; const today=new Date().toISOString().slice(0,10);
    layer.innerHTML=`<form><header><div><span>CUSTOM REPORTING RANGE</span><strong>Select dates</strong></div><button type="button" data-close>×</button></header><label>Start date<input type="date" name="start" required></label><label>End date<input type="date" name="end" value="${today}" max="${today}" required></label><div><button type="button" data-close>Cancel</button><button type="submit" class="primary">Apply range</button></div></form>`;
    layer.addEventListener('click',(event)=>{if(event.target===layer||event.target.closest('[data-close]'))layer.remove();});
    layer.querySelector('form').addEventListener('submit',async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget).entries());try{const payload=await getJson(id,'CUSTOM',data.start,data.end);cache.set(`${id}:CUSTOM`,payload);layer.remove();render(id,payload,'CUSTOM');}catch(cause){alert(cause.message);}});
    document.body.appendChild(layer);
  }

  async function load(id,view='THIS_WEEK',force=false){if(!id)return;const key=`${id}:${view}`;if(!force&&cache.has(key))return render(id,cache.get(key),view);try{const payload=await getJson(id,view);cache.set(key,payload);render(id,payload,view);}catch(cause){console.warn('[AKARI campaign period view]',cause);}}

  const originalFetch=window.fetch.bind(window); window.fetch=async(...args)=>{const response=await originalFetch(...args);try{const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';const match=url.match(/\/api\/(?:service-delivery|campaign-(?:gtm-)?tracking)\/([^/?#]+)$/);if(match&&response.ok)queueMicrotask(()=>load(decodeURIComponent(match[1]),'THIS_WEEK',true));}catch{}return response;};
  new MutationObserver(()=>{const workspace=document.querySelector('.delivery-workspace');if(!workspace||workspace.querySelector('.campaign-period-view-r50'))return;const id=workspace.dataset.executiveR45||workspace.dataset.creatorTrackingR43||[...cache.keys()].at(-1)?.split(':')[0];if(id)load(id);}).observe(document.body,{childList:true,subtree:true});
})();