(() => {
  'use strict';
  if (window.__akariHouseCreatorDirectoryR61) return;
  window.__akariHouseCreatorDirectoryR61 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const label=(value)=>String(value||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(c)=>c.toUpperCase());
  let payload=null,loading=false,timer=null,query='',platform='ALL',state='ALL';

  function campaignsPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function activeCampaignId(){return document.querySelector('#view-root [data-r56-campaign]')?.value||'';}
  function shell(){
    if(!campaignsPage())return null;
    let panel=document.querySelector('#view-root .akari-house-creator-directory-r61');
    if(!panel){
      panel=document.createElement('section');panel.className='akari-house-creator-directory-r61';
      panel.innerHTML='<div class="akari-house-creator-directory-loading-r61">Loading AKARI Creator Network…</div>';
      const rec=document.querySelector('#view-root .campaign-talent-recommendations-r55');
      const planning=document.querySelector('#view-root .campaign-planning-r56');
      const grid=document.querySelector('#view-root .grid-2');
      if(rec)rec.insertAdjacentElement('afterend',panel);else if(planning)planning.insertAdjacentElement('beforebegin',panel);else if(grid)grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Creator directory request failed');
    return data;
  }
  function statusLabel(item){
    if(item.historyState==='CRM_PERFORMANCE_HISTORY')return `CRM history · ${label(item.performance?.classification||'')}`;
    if(item.historyState==='CRM_PLANNED_NO_PERFORMANCE')return 'Planned · No performance evidence';
    return 'New · No campaign history';
  }
  function sourceLabel(source){
    const map={official_api:'Official API',partner_verified:'Partner verified',member_reported:'Member reported',unavailable:'Unavailable'};
    return map[String(source||'').toLowerCase()]||label(source||'Unavailable');
  }
  function filteredItems(){
    const items=payload?.directory?.items||[];
    const needle=query.trim().toLowerCase();
    return items.filter((item)=>{
      if(platform!=='ALL'&&!(item.platforms||[]).includes(platform))return false;
      if(state!=='ALL'&&item.historyState!==state)return false;
      if(!needle)return true;
      return [item.displayName,item.username,item.headline,item.location,item.expertise,item.openTo,...(item.languages||[]),...(item.platforms||[])].join(' ').toLowerCase().includes(needle);
    });
  }
  function socialChips(item){
    return (item.socials||[]).map((social)=>`<a href="${esc(social.profileUrl)}" target="_blank" rel="noreferrer"><strong>${esc(social.platform)}</strong><span>${social.followerCountAvailable?fmt(social.followerCount):'—'} · ${esc(sourceLabel(social.countSource))}</span></a>`).join('')||'<span class="muted">No public social profile</span>';
  }
  function performance(item){
    if(item.historyState==='CRM_PERFORMANCE_HISTORY')return `<div class="akari-house-creator-performance-r61"><span><b>${fmt(item.performance.portfolioScore,1)}</b> score</span><span><b>${fmt(item.performance.campaignCount)}</b> campaigns</span><span><b>${fmt(item.performance.approvedPosts)}</b> Approved posts</span><span><b>${fmt(item.performance.approvedReach)}</b> Approved reach</span><span><b>${fmt(item.performance.campaignReliability,1)}%</b> reliability</span></div>`;
    if(item.historyState==='CRM_PLANNED_NO_PERFORMANCE')return `<div class="akari-house-creator-nohistory-r61"><strong>Planned in ${fmt(item.crmCampaignCount)} CRM campaign${item.crmCampaignCount===1?'':'s'}</strong><span>No Approved delivery evidence yet. No portfolio score is assigned.</span></div>`;
    return '<div class="akari-house-creator-nohistory-r61"><strong>New to CRM</strong><span>No campaign history or performance score. Use profile fit and campaign requirements for selection.</span></div>';
  }
  function card(item){
    return `<article class="akari-house-creator-card-r61" data-house-creator="${esc(item.akariCreatorId)}">
      <header><div>${item.avatarUrl?`<img src="${esc(item.avatarUrl)}" alt="">`:'<span class="avatar-placeholder">AK</span>'}</div><div><a href="${esc(item.profileUrl)}" target="_blank" rel="noreferrer"><strong>${esc(item.displayName)}</strong></a><span>@${esc(item.username)}${item.location?` · ${esc(item.location)}`:''}</span><small>${esc(item.headline||item.expertise||'AKARI House Creator')}</small></div><em>${esc(statusLabel(item))}</em></header>
      <div class="akari-house-creator-signals-r61"><span>Sorsa <b>${item.sorsaScore===null?'—':fmt(item.sorsaScore)}</b><small>${esc(sourceLabel(item.sorsaSource))}</small></span><span>XScore <b>${item.xScore===null?'—':fmt(item.xScore)}</b><small>${esc(sourceLabel(item.xScoreSource))}</small></span><span>Profile <b>${esc(label(item.creatorVerificationStatus))}</b><small>House role status</small></span></div>
      <div class="akari-house-creator-socials-r61">${socialChips(item)}</div>
      ${performance(item)}
      <footer><span>${esc((item.languages||[]).join(' · ')||item.openTo||'Profile-provided data')}</span><button class="primary" data-add-house="${esc(item.akariCreatorId)}" ${activeCampaignId()?'':'disabled'}>Add to campaign plan</button></footer>
    </article>`;
  }
  function externalRows(){
    const items=payload?.directory?.external||[];
    if(!items.length)return '';
    return `<details class="akari-house-creator-external-r61"><summary>External / unlinked CRM talent · ${fmt(items.length)}</summary><div>${items.slice(0,20).map((item)=>`<article><strong>${esc(item.name||item.handle||'Contributor')}</strong><span>${esc((item.platforms||[]).join(', '))} · ${fmt(item.campaignCount)} campaigns · ${fmt(item.approvedReach)} Approved reach</span><small>${esc(label(item.identityConfidence))} identity confidence · remains manual/external until safely linked</small></article>`).join('')}</div></details>`;
  }
  async function addToPlan(id,button){
    const campaignId=activeCampaignId();if(!campaignId)return alert('Select a campaign in Campaign Planning first.');
    button.disabled=true;const old=button.textContent;button.textContent='Adding…';
    try{
      await api(`/api/campaign-planning/${encodeURIComponent(campaignId)}/house-talent`,{method:'POST',body:JSON.stringify({akariCreatorId:id})});
      button.textContent='Added';
      const selector=document.querySelector('#view-root [data-r56-campaign]');
      if(selector)selector.dispatchEvent(new Event('change',{bubbles:true}));
      await load(true);
    }catch(error){alert(error.message);button.disabled=false;button.textContent=old;}
  }
  function render(){
    const panel=shell();if(!panel)return;
    if(!payload?.directory){panel.innerHTML='<div class="akari-house-creator-directory-loading-r61">Creator directory unavailable.</div>';return;}
    const directory=payload.directory,items=filteredItems();
    const platforms=[...new Set((directory.items||[]).flatMap((item)=>item.platforms||[]))].sort();
    panel.innerHTML=`
      <header class="akari-house-creator-directory-head-r61"><div><span>AKARI CREATOR NETWORK · R8.5K</span><strong>House Creator Directory</strong><small>AKARI House identity/profile data + tenant-private CRM performance evidence. Public House profiles only in this release.</small></div><div>${directory.sourceAvailable?'<b>House sync online</b>':'<b class="warn">House sync unavailable</b>'}<small>${fmt(directory.creatorCount)} House Creators · ${fmt(directory.externalUnlinkedCount)} external CRM talent</small></div></header>
      ${directory.sourceWarning?`<div class="akari-house-creator-alert-r61">${esc(directory.sourceWarning)}</div>`:''}
      <div class="akari-house-creator-kpis-r61"><article><small>House Creators</small><b>${fmt(directory.creatorCount)}</b></article><article><small>With CRM link</small><b>${fmt(directory.withCrmHistory)}</b></article><article><small>Performance evidence</small><b>${fmt(directory.withPerformanceEvidence)}</b></article><article><small>Planned only</small><b>${fmt(directory.plannedWithoutPerformance)}</b></article><article><small>New to CRM</small><b>${fmt(directory.newToCrm)}</b></article></div>
      <div class="akari-house-creator-filters-r61"><input data-r61-search value="${esc(query)}" placeholder="Search name, handle, expertise, region, language…"><select data-r61-platform><option value="ALL">All platforms</option>${platforms.map((value)=>`<option value="${esc(value)}" ${platform===value?'selected':''}>${esc(value)}</option>`).join('')}</select><select data-r61-state><option value="ALL">All history states</option><option value="NEW_NO_CAMPAIGN_HISTORY" ${state==='NEW_NO_CAMPAIGN_HISTORY'?'selected':''}>New / no history</option><option value="CRM_PLANNED_NO_PERFORMANCE" ${state==='CRM_PLANNED_NO_PERFORMANCE'?'selected':''}>Planned / no performance</option><option value="CRM_PERFORMANCE_HISTORY" ${state==='CRM_PERFORMANCE_HISTORY'?'selected':''}>CRM performance history</option></select><button data-r61-refresh>Refresh House sync</button></div>
      <div class="akari-house-creator-note-r61"><strong>Data semantics:</strong> social URLs/profile fields are <b>Profile Provided</b>. Follower, XScore and Sorsa values keep their own source labels. CRM performance uses Approved campaign evidence from this workspace only.</div>
      <div class="akari-house-creator-grid-r61">${items.map(card).join('')||'<div class="akari-house-creator-empty-r61">No Creators match the current filters.</div>'}</div>
      ${externalRows()}`;
    panel.querySelector('[data-r61-search]')?.addEventListener('input',(event)=>{query=event.target.value;render();});
    panel.querySelector('[data-r61-platform]')?.addEventListener('change',(event)=>{platform=event.target.value;render();});
    panel.querySelector('[data-r61-state]')?.addEventListener('change',(event)=>{state=event.target.value;render();});
    panel.querySelector('[data-r61-refresh]')?.addEventListener('click',()=>load(true));
    panel.querySelectorAll('[data-add-house]').forEach((button)=>button.addEventListener('click',()=>addToPlan(button.dataset.addHouse,button)));
  }
  async function load(force=false){
    if(loading||(!force&&payload))return;loading=true;shell();
    try{payload=await api('/api/creator-directory');render();}
    catch(error){const panel=shell();if(panel)panel.innerHTML=`<div class="akari-house-creator-alert-r61"><strong>Creator directory unavailable</strong><span>${esc(error.message)}</span></div>`;}
    finally{loading=false;}
  }
  function watch(){
    if(campaignsPage()){shell();load();const selector=document.querySelector('#view-root [data-r56-campaign]');if(selector&&!selector.dataset.r61Bound){selector.dataset.r61Bound='1';selector.addEventListener('change',render);}}
    else payload=null;
  }
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(watch,80);});observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(watch,120);
})();
