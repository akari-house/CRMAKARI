(() => {
  'use strict';
  if(window.__akariCampaignExecutionCommandR62)return;
  window.__akariCampaignExecutionCommandR62=true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const pct=(value)=>`${fmt(value,1)}%`;
  const label=(value)=>String(value||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(c)=>c.toUpperCase());
  let scope='team',payload=null,loading=false,timer=null;

  function campaignsPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function shell(){
    if(!campaignsPage())return null;
    let panel=document.querySelector('#view-root .campaign-execution-command-r62');
    if(!panel){
      panel=document.createElement('section');panel.className='campaign-execution-command-r62';
      panel.innerHTML='<div class="campaign-execution-command-loading-r62">Loading Campaign Execution Command Centre…</div>';
      const first=document.querySelector('#view-root .campaign-planning-r56, #view-root .campaign-talent-recommendations-r55, #view-root .grid-2');
      if(first)first.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }
  async function api(url){
    const response=await fetch(url,{credentials:'same-origin'});const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Campaign command centre request failed');return data;
  }
  function riskBadge(row){return `<span class="campaign-execution-risk-r62 ${String(row.risk?.level||'').toLowerCase()}">${esc(label(row.risk?.level||'Healthy'))}<b>${fmt(row.risk?.score)}</b></span>`;}
  function campaignStatus(row){const status=row.activation?.effectiveStatus&&row.activation.effectiveStatus!=='NOT_ACTIVATED'?row.activation.effectiveStatus:row.campaignStatus;return label(status||'Planned');}
  function progress(value){return `<span class="campaign-execution-progress-r62"><i style="width:${Math.max(0,Math.min(100,Number(value)||0))}%"></i></span>`;}
  function actionButton(row){return `<button class="primary" data-r62-campaign="${esc(row.id)}" data-r62-route="${esc(row.nextAction?.route||'CAMPAIGNS')}">${esc(row.nextAction?.label||'Open campaign')}</button>`;}
  function riskReasons(row){return (row.risk?.reasons||[]).slice(0,3).map((reason)=>`<span>${esc(reason.label)}</span>`).join('')||'<span>No major operational risk detected</span>';}
  function attentionRows(items){
    if(!items.length)return '<div class="campaign-execution-empty-r62">No critical or medium-risk campaigns in this scope.</div>';
    return `<div class="campaign-execution-attention-list-r62">${items.map((row)=>`<article data-command-campaign="${esc(row.id)}"><div>${riskBadge(row)}<strong>${esc(row.name)}</strong><span>${esc(row.projectName||'')} · ${esc(campaignStatus(row))}${row.ownerName?` · ${esc(row.ownerName)}`:''}</span></div><div><strong>${esc(row.nextAction?.label||'Monitor execution')}</strong><span>${esc(row.nextAction?.detail||'')}</span></div><div class="campaign-execution-reasons-r62">${riskReasons(row)}</div>${actionButton(row)}</article>`).join('')}</div>`;
  }
  function campaignRows(items){
    if(!items.length)return '<div class="campaign-execution-empty-r62">No campaigns in this scope.</div>';
    return `<div class="campaign-execution-table-r62">${items.map((row)=>`<article data-command-row="${esc(row.id)}">
      <div><strong>${esc(row.name)}</strong><span>${esc(row.projectName||'')} · ${esc(campaignStatus(row))}</span><small>${row.endDate?`Ends ${esc(row.endDate)}`:'No end date'}${row.region?` · ${esc(row.region)}`:''}</small></div>
      <div>${riskBadge(row)}<small>${esc(row.risk?.reasons?.[0]?.label||'Healthy')}</small></div>
      <div><strong>${fmt(row.delivery?.approvedPosts)} / ${fmt(row.delivery?.plannedPosts)}</strong><span>Approved posts</span>${progress(row.delivery?.postCompletionPercent)}<small>${fmt(row.delivery?.holdingPosts)} Holding · ${fmt(row.delivery?.rejectedPosts)} Rejected</small></div>
      <div><strong>${fmt(row.delivery?.approvedReach)}</strong><span>Approved reach</span>${progress(row.delivery?.reachAchievement)}<small>${pct(row.delivery?.reachAchievement)} of planned reach</small></div>
      <div><strong>${fmt(row.tasks?.overdue)} overdue</strong><span>${fmt(row.tasks?.dueToday)} due today · ${fmt(row.tasks?.blocked)} blocked</span><small>${fmt(row.tasks?.open)} open Work OS tasks</small></div>
      <div><strong>${fmt(row.outreach?.confirmedCount)} / ${fmt(row.outreach?.talentCount)}</strong><span>Talent confirmed</span><small>${fmt(row.outreach?.declinedCount)} declined · ${fmt(row.outreach?.pendingCount)} pending</small></div>
      <div><strong>${esc(row.nextAction?.label||'Monitor execution')}</strong><span>${esc(row.nextAction?.detail||'')}</span></div>
      <div>${actionButton(row)}</div>
    </article>`).join('')}</div>`;
  }
  function openAction(campaignId,route){
    if(route==='TASKS'){
      const nav=document.querySelector('.sidebar [data-route="day"],.sidebar [data-route="tasks"]');if(nav){nav.click();return;}
    }
    const selector=document.querySelector('#view-root [data-r56-campaign]');
    if(selector){selector.value=campaignId;selector.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.campaign-planning-r56')?.scrollIntoView({behavior:'smooth',block:'start'});}
  }
  function render(){
    const panel=shell();if(!panel)return;
    const command=payload?.command;if(!command){panel.innerHTML='<div class="campaign-execution-command-loading-r62">Campaign Execution Command Centre unavailable.</div>';return;}
    const m=command.metrics||{};
    panel.innerHTML=`
      <header class="campaign-execution-command-head-r62"><div><span>CAMPAIGN OPERATIONS · R8.5L</span><strong>Execution Command Centre</strong><small>What needs action today across activation, Work OS, Creator/KOL delivery, performance and settlement.</small></div><div class="campaign-execution-scope-r62"><button data-r62-scope="mine" class="${scope==='mine'?'active':''}">My campaigns</button><button data-r62-scope="team" class="${scope==='team'?'active':''}">Team campaigns</button><button data-r62-refresh>Refresh</button></div></header>
      <div class="campaign-execution-kpis-r62"><article><small>Active campaigns</small><b>${fmt(m.activeCampaigns)}</b><span>${fmt(m.critical)} critical · ${fmt(m.highRisk)} high risk</span></article><article><small>Work due</small><b>${fmt(m.dueTodayTasks)}</b><span>${fmt(m.overdueTasks)} overdue · ${fmt(m.blockedTasks)} blocked</span></article><article><small>Talent attention</small><b>${fmt(m.pendingTalent)}</b><span>${fmt(m.declinedTalent)} declined</span></article><article><small>Delivery review</small><b>${fmt(m.holdingPosts+m.rejectedPosts)}</b><span>${fmt(m.holdingPosts)} Holding · ${fmt(m.rejectedPosts)} Rejected</span></article><article><small>Approved delivery</small><b>${fmt(m.approvedPosts)} / ${fmt(m.plannedPosts)}</b><span>${fmt(m.approvedReach)} Approved reach</span></article></div>
      <section class="campaign-execution-attention-r62"><header><div><span>PRIORITY QUEUE</span><strong>Campaigns needing attention</strong></div><small>Governance drift and blocked/overdue work rank above secondary pacing signals.</small></header>${attentionRows(command.attention||[])}</section>
      <section class="campaign-execution-all-r62"><header><div><span>DAILY EXECUTION</span><strong>All campaigns in scope</strong></div><small>Approved-only Creator/KOL performance. Holding/Rejected posts never count toward reach or delivery completion.</small></header>${campaignRows(command.items||[])}</section>
      <footer class="campaign-execution-foot-r62">The command centre is read-only intelligence over canonical campaign, Work OS, outreach, activation and settlement evidence. Planned allocations are not proof of Creator/KOL payment.</footer>`;
    panel.querySelectorAll('[data-r62-scope]').forEach((button)=>button.addEventListener('click',()=>{scope=button.dataset.r62Scope;load(true);}));
    panel.querySelector('[data-r62-refresh]')?.addEventListener('click',()=>load(true));
    panel.querySelectorAll('[data-r62-campaign]').forEach((button)=>button.addEventListener('click',()=>openAction(button.dataset.r62Campaign,button.dataset.r62Route)));
  }
  async function load(force=false){
    if(loading||(!force&&payload))return;loading=true;shell();
    try{payload=await api(`/api/campaign-execution-command-center?scope=${encodeURIComponent(scope)}`);render();}
    catch(error){const panel=shell();if(panel)panel.innerHTML=`<div class="campaign-execution-alert-r62"><strong>Command centre unavailable</strong><span>${esc(error.message)}</span></div>`;}
    finally{loading=false;}
  }
  function watch(){if(campaignsPage()){shell();load();}else payload=null;}
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(watch,80);});observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('akari:campaign-outreach-updated',()=>load(true));
  setTimeout(watch,120);
})();
