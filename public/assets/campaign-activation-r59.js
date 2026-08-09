(() => {
  'use strict';
  if (window.__akariCampaignActivationR59) return;
  window.__akariCampaignActivationR59 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const pct=(value)=>`${fmt(value,1)}%`;
  const label=(value)=>String(value||'').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  const day=(value)=>value?String(value).slice(0,10):'—';
  let activeId='';
  let loadedId='';
  let loading=false;
  let payload=null;
  let timer=null;

  function campaignsPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function shell(){
    if(!campaignsPage())return null;
    let panel=document.querySelector('#view-root .campaign-activation-r59');
    if(!panel){
      panel=document.createElement('section');
      panel.className='campaign-activation-r59';
      panel.innerHTML='<div class="campaign-activation-loading-r59">Loading campaign activation workspace…</div>';
      const settlement=document.querySelector('#view-root .campaign-settlement-r58');
      const compensation=document.querySelector('#view-root .campaign-compensation-r57');
      const planning=document.querySelector('#view-root .campaign-planning-r56');
      const grid=document.querySelector('#view-root .grid-2');
      if(settlement)settlement.insertAdjacentElement('afterend',panel);
      else if(compensation)compensation.insertAdjacentElement('afterend',panel);
      else if(planning)planning.insertAdjacentElement('afterend',panel);
      else if(grid)grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Campaign activation request failed');
    return data;
  }
  function closeModal(){document.querySelector('.campaign-activation-modal-r59')?.remove();}
  function modal(title,body,submitLabel,onSubmit){
    closeModal();
    const layer=document.createElement('div');
    layer.className='campaign-activation-modal-r59';
    layer.innerHTML=`<form><header><strong>${esc(title)}</strong><button type="button" data-close>×</button></header><div class="campaign-activation-modal-body-r59">${body}</div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></footer></form>`;
    layer.addEventListener('click',(event)=>{if(event.target===layer||event.target.closest('[data-close]'))closeModal();});
    layer.querySelector('form').addEventListener('submit',async(event)=>{
      event.preventDefault();
      const button=event.submitter;button.disabled=true;
      try{await onSubmit(new FormData(event.currentTarget));closeModal();}
      catch(error){alert(error.message);button.disabled=false;}
    });
    document.body.appendChild(layer);
  }
  async function patch(body){
    if(!activeId)return;
    payload=await api(`/api/campaign-activation/${encodeURIComponent(activeId)}`,{method:'PATCH',body:JSON.stringify(body)});
    loadedId=activeId;
    render();
  }
  function badge(status){return `<span class="campaign-activation-badge-r59 ${String(status||'').toLowerCase()}">${esc(label(status))}</span>`;}

  function activate(){
    const members=payload?.members||[];
    const options=members.map((member)=>`<option value="${esc(member.id)}">${esc(member.full_name||member.email||member.id)} · ${esc(label(member.role))}</option>`).join('');
    modal('Activate campaign execution',`
      <label>Execution owner<select name="owner" required>${options}</select></label>
      <label>Activation note<textarea name="note" rows="4" placeholder="Internal kickoff note, key dependencies, or launch context"></textarea></label>
      <small>This creates linked Work OS tasks from the approved campaign and confirmed talent snapshots. It does not send outreach, publish content, or record payment.</small>`,
      'Activate campaign',async(form)=>patch({action:'activate',executionOwnerId:form.get('owner'),note:form.get('note')}));
  }
  function pause(){
    modal('Pause campaign execution','<label>Pause reason<textarea name="reason" rows="4" minlength="5" required placeholder="Explain the operational blocker or reason for pausing"></textarea></label><small>Existing Work OS tasks are preserved. Pausing does not delete or rewrite execution history.</small>',
      'Pause execution',async(form)=>patch({action:'pause',reason:form.get('reason')}));
  }
  function complete(){
    modal('Complete campaign execution','<label>Completion note<textarea name="note" rows="4" placeholder="Final delivery note or settlement handoff context"></textarea></label><small>Completion is allowed only after all generated execution tasks are closed and all planned Creator/KOL posts are Approved.</small>',
      'Complete execution',async(form)=>patch({action:'complete',note:form.get('note')}));
  }
  function openWorkOS(){
    const nav=document.querySelector('.sidebar [data-route="day"],.sidebar [data-route="tasks"]');
    if(nav){nav.click();return;}
    const parts=location.pathname.split('/').filter(Boolean);
    if(parts[0]==='app'&&parts[1]) location.assign(`/app/${encodeURIComponent(parts[1])}/tasks`);
  }

  function taskRows(tasks){
    if(!tasks.length)return '<div class="campaign-activation-empty-r59">Execution tasks will appear here after activation.</div>';
    return `<div class="campaign-activation-tasks-r59">${tasks.map((task)=>`<article class="campaign-activation-task-r59" data-activation-task="${esc(task.id)}"><div><strong>${esc(task.title)}</strong><span>${esc(label(task.phase))}${task.assignmentId?' · Creator/KOL deliverable':''}</span></div><div><strong>${esc(task.ownerName||'Unassigned')}</strong><small>Owner</small></div><div>${badge(task.status)}<small>${esc(label(task.priority))} priority</small></div><div><strong>${esc(day(task.dueAt))}</strong><small>Due</small></div></article>`).join('')}</div>`;
  }

  function warning(summary,activation){
    if(summary.activationDrift)return `<div class="campaign-activation-alert-r59"><strong>Approved plan changed after activation</strong><span>Execution is locked for resume/completion until the campaign plan is reconciled and reapproved. Existing tasks and evidence are preserved.</span></div>`;
    if(summary.outreachDrift)return `<div class="campaign-activation-alert-r59"><strong>Confirmed talent evidence changed after activation</strong><span>Execution is locked for resume/completion until Creator/KOL participation evidence is reconciled. Existing tasks and execution history are preserved.</span></div>`;
    if(!summary.governanceReady&&activation.status==='NOT_ACTIVATED')return `<div class="campaign-activation-alert-r59"><strong>Activation locked</strong><span>${!summary.planApproved?'Approve the campaign plan first. ':''}${summary.planApprovalDrift?'The approved basket changed. ':''}${!summary.compensationCalculationCurrent?'Recalculate AKARI USDT allocations. ':''}${!summary.budgetReconciled?'Reconcile the campaign budget. ':''}${!summary.talentCount||!summary.plannedPosts?'Add planned Creator/KOL deliverables. ':''}${summary.talentConfirmationRequired&&!summary.talentConfirmationReady?`Confirm participation evidence for all active talent (${fmt(summary.confirmedTalentCount)} of ${fmt(summary.talentCount)} confirmed).`:''}</span></div>`;
    if(activation.status==='PAUSED')return `<div class="campaign-activation-alert-r59"><strong>Execution paused</strong><span>${esc(activation.pauseReason||'No pause reason recorded.')}</span></div>`;
    if(activation.status==='ACTIVE'&&!summary.completionReady)return `<div class="campaign-activation-alert-r59"><strong>Execution in progress</strong><span>${summary.taskOpenCount?`${fmt(summary.taskOpenCount)} generated task${summary.taskOpenCount===1?' remains':'s remain'}. `:''}${!summary.approvedDeliveryComplete?`${fmt(summary.approvedPosts)} of ${fmt(summary.plannedPosts)} planned Approved posts delivered.`:''}</span></div>`;
    return '';
  }

  function render(){
    const panel=shell();if(!panel)return;
    if(!payload?.item){panel.innerHTML='<div class="campaign-activation-loading-r59">Select a campaign in the planning workspace to load activation.</div>';return;}
    const item=payload.item;
    const summary=item.summary||{};
    const activation=item.activation||{};
    const permissions=payload.permissions||{};
    const status=summary.effectiveStatus||activation.status||'NOT_ACTIVATED';
    const canActivate=permissions.canManage&&activation.status==='NOT_ACTIVATED'&&summary.governanceReady;
    const canPause=permissions.canManage&&activation.status==='ACTIVE';
    const canResume=permissions.canManage&&activation.status==='PAUSED'&&!summary.activationDrift&&!summary.outreachDrift&&summary.governanceReady;
    const canComplete=permissions.canManage&&summary.completionReady;
    panel.innerHTML=`
      <header class="campaign-activation-head-r59"><div><span>CAMPAIGN EXECUTION · R8.5I</span><strong>Activation & Work OS Handoff</strong><small>Approved plan + confirmed talent → controlled activation → linked execution tasks → Approved delivery → closeout.</small></div><div>${badge(status)}</div></header>
      <div class="campaign-activation-toolbar-r59"><div><strong>${esc(item.name)}</strong><span>${esc(item.projectName||'')} · ${esc(label(item.planningStatus||''))} plan${activation.executionOwnerName?` · Owner ${esc(activation.executionOwnerName)}`:''}</span></div><div class="campaign-activation-actions-r59">${canActivate?'<button class="primary" data-activate>Activate campaign</button>':''}${canPause?'<button data-pause>Pause</button>':''}${canResume?'<button class="primary" data-resume>Resume</button>':''}${canComplete?'<button class="primary" data-complete>Complete execution</button>':''}${(item.tasks||[]).length?'<button data-work-os>Open Work OS</button>':''}</div></div>
      <div class="campaign-activation-kpis-r59">
        <article><small>Plan integrity</small><b>${summary.activationDrift?'Changed':summary.planApprovalDrift?'Drift':'Locked'===status?'Locked':'Approved'}</b><span>${esc(summary.currentPlanFingerprint||'No fingerprint')}</span></article>
        <article><small>Talent confirmation</small><b>${fmt(summary.confirmedTalentCount)} / ${fmt(summary.talentCount)}</b><span>${summary.talentConfirmationReady?'Confirmed':'Pending evidence'}</span></article>
        <article><small>Execution work</small><b>${fmt(summary.taskDoneCount)} / ${fmt(summary.taskCount)}</b><span>${pct(summary.taskCompletionPercent)} tasks closed</span></article>
        <article><small>Creator/KOL delivery</small><b>${fmt(summary.approvedPosts)} / ${fmt(summary.plannedPosts)}</b><span>${pct(summary.deliveryCompletionPercent)} Approved-post completion</span></article>
        <article><small>Launch control</small><b>${summary.governanceReady?'Ready':'Locked'}</b><span>${summary.compensationCalculationCurrent?'Comp current':'Comp changed'} · ${summary.budgetReconciled?'Budget reconciled':'Budget over plan'}</span></article>
      </div>
      ${warning(summary,activation)}
      <section class="campaign-activation-section-r59"><header><div><span>CANONICAL WORK OS</span><strong>Generated execution plan</strong></div><small>Tasks are normal tenant-scoped Work OS records linked to this campaign. Reassign or update them in Work OS.</small></header>${taskRows(item.tasks||[])}</section>
      <footer class="campaign-activation-foot-r59">For new activations, AKARI requires confirmed Creator/KOL participation evidence that matches the approved basket. Activation itself does not send outreach, publish content, or prove payment; those remain separately governed records.</footer>`;
    panel.querySelector('[data-activate]')?.addEventListener('click',activate);
    panel.querySelector('[data-pause]')?.addEventListener('click',pause);
    panel.querySelector('[data-resume]')?.addEventListener('click',()=>patch({action:'resume'}));
    panel.querySelector('[data-complete]')?.addEventListener('click',complete);
    panel.querySelector('[data-work-os]')?.addEventListener('click',openWorkOS);
  }

  async function load(id,force=false){
    if(!id||loading||(!force&&loadedId===id))return;
    loading=true;activeId=id;shell();
    try{payload=await api(`/api/campaign-activation/${encodeURIComponent(id)}`);loadedId=id;render();}
    catch(error){const panel=shell();if(panel)panel.innerHTML=`<div class="campaign-activation-alert-r59"><strong>Activation unavailable</strong><span>${esc(error.message)}</span></div>`;}
    finally{loading=false;}
  }
  async function resolveCampaign(){
    const selector=document.querySelector('#view-root [data-r56-campaign]');
    const selected=selector?.value;
    if(selected){await load(selected);return;}
    if(!campaignsPage())return;
    try{const data=await api('/api/campaigns');const id=data.items?.[0]?.id;if(id)await load(id);}catch{}
  }
  function watch(){
    const selector=document.querySelector('#view-root [data-r56-campaign]');
    if(selector&&!selector.dataset.r59Bound){selector.dataset.r59Bound='1';selector.addEventListener('change',()=>{loadedId='';resolveCampaign();});}
    if(campaignsPage())resolveCampaign();
    else{loadedId='';activeId='';payload=null;}
  }
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(watch,80);});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>{loadedId='';setTimeout(watch,50);});
  window.addEventListener('akari:campaign-outreach-updated',(event)=>{
    const campaignId=event?.detail?.campaignId;
    if(campaignId&&campaignId===activeId){loadedId='';load(activeId,true);}
  });
  setTimeout(watch,120);
})();
