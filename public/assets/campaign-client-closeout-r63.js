(() => {
  'use strict';
  if(window.__akariCampaignClientCloseoutR63)return;
  window.__akariCampaignClientCloseoutR63=true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const label=(value)=>String(value||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(c)=>c.toUpperCase());
  let activeId='',loadedId='',payload=null,loading=false,timer=null;

  function campaignsPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function shell(){
    if(!campaignsPage())return null;
    let panel=document.querySelector('#view-root .campaign-client-closeout-r63');
    if(!panel){
      panel=document.createElement('section');panel.className='campaign-client-closeout-r63';
      panel.innerHTML='<div class="campaign-client-closeout-loading-r63">Loading client report closeout…</div>';
      const activation=document.querySelector('#view-root .campaign-activation-r59');
      const settlement=document.querySelector('#view-root .campaign-settlement-r58');
      const planning=document.querySelector('#view-root .campaign-planning-r56');
      if(activation)activation.insertAdjacentElement('afterend',panel);else if(settlement)settlement.insertAdjacentElement('afterend',panel);else if(planning)planning.insertAdjacentElement('afterend',panel);
    }
    return panel;
  }
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||data.message||'Campaign closeout request failed');return data;
  }
  function closeModal(){document.querySelector('.campaign-client-closeout-modal-r63')?.remove();}
  function modal(title,body,submitLabel,onSubmit){
    closeModal();const layer=document.createElement('div');layer.className='campaign-client-closeout-modal-r63';
    layer.innerHTML=`<form><header><strong>${esc(title)}</strong><button type="button" data-close>×</button></header><div class="campaign-client-closeout-modal-body-r63">${body}</div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></footer></form>`;
    layer.addEventListener('click',(event)=>{if(event.target===layer||event.target.closest('[data-close]'))closeModal();});
    layer.querySelector('form').addEventListener('submit',async(event)=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await onSubmit(new FormData(event.currentTarget));closeModal();}catch(error){alert(error.message);button.disabled=false;}});
    document.body.appendChild(layer);
  }
  async function patch(body){
    if(!activeId)return;payload=await api(`/api/campaign-client-closeout/${encodeURIComponent(activeId)}`,{method:'PATCH',body:JSON.stringify(body)});loadedId=activeId;render();window.dispatchEvent(new CustomEvent('akari:campaign-closeout-updated',{detail:{campaignId:activeId}}));
  }
  function badge(status){return `<span class="campaign-client-closeout-badge-r63 ${String(status||'').toLowerCase()}">${esc(label(status))}</span>`;}
  function alertBox(summary,closeout){
    if(summary.reportDrift)return '<div class="campaign-client-closeout-alert-r63 danger"><strong>Final report evidence changed</strong><span>Campaign evidence changed after the report snapshot. Reopen/refresh the final report and route it through approval again before client delivery or completion.</span></div>';
    if(!summary.activationCompleted)return '<div class="campaign-client-closeout-alert-r63"><strong>Execution not complete</strong><span>Campaign activation/execution must be completed before a final client closeout report can be prepared.</span></div>';
    if(closeout.status==='SENT_TO_CLIENT'&&!summary.settlementClear)return `<div class="campaign-client-closeout-alert-r63"><strong>Settlement blocks closeout</strong><span>${fmt(summary.settlementOutstandingUsdt,2)} USDT outstanding · ${fmt(summary.settlementDisputedCount)} disputed settlement records.</span></div>`;
    if(closeout.status==='SENT_TO_CLIENT'&&!summary.renewalReady)return '<div class="campaign-client-closeout-alert-r63"><strong>Renewal handoff required</strong><span>Choose the commercial next step before completing campaign closeout.</span></div>';
    return '';
  }
  function editCloseout(){
    const closeout=payload.item.closeout||{};
    const options=['UNSET','RENEW','RETAINER','UPSELL','NEW_CAMPAIGN','HOLD','NO_RENEWAL'].map((value)=>`<option value="${value}" ${closeout.renewalRecommendation===value?'selected':''}>${esc(label(value))}</option>`).join('');
    modal('Closeout notes & renewal handoff',`
      <label>Lessons learned<textarea name="lessons" rows="5" placeholder="What worked, what failed, what should change next campaign?">${esc(closeout.lessonsLearned||'')}</textarea></label>
      <label>Renewal recommendation<select name="renewal">${options}</select></label>
      <label>Renewal / next-step reason<textarea name="reason" rows="3" placeholder="Why this next commercial action?">${esc(closeout.renewalReason||'')}</textarea></label>
      <label>Renewal target date<input name="targetDate" type="date" value="${esc(closeout.renewalTargetDate||'')}"></label>`,
      'Save closeout',async(form)=>patch({action:'update-closeout',lessonsLearned:form.get('lessons'),renewalRecommendation:form.get('renewal'),renewalReason:form.get('reason'),renewalTargetDate:form.get('targetDate')}));
  }
  function rejectReport(){modal('Reject final report','<label>Rejection reason<textarea name="reason" rows="4" minlength="5" required placeholder="What must be corrected before approval?"></textarea></label>','Reject report',async(form)=>patch({action:'reject-report',reason:form.get('reason')}));}
  function markSent(){modal('Record client report delivery','<label>Delivery channel<select name="channel"><option>Email</option><option>Meeting</option><option>Telegram</option><option>Shared Drive</option><option>Client Portal</option><option>Other</option></select></label><label>Delivery evidence reference<input name="reference" required placeholder="Email thread, meeting note, Drive link, ticket or message reference"></label><small>This records evidence that AKARI delivered the approved report. It does not send a message automatically.</small>','Record client delivery',async(form)=>patch({action:'mark-client-sent',channel:form.get('channel'),reference:form.get('reference')}));}
  function complete(){modal('Complete campaign closeout','<label>Completion sign-off note<textarea name="note" rows="4" minlength="5" required placeholder="Final client/operations sign-off and renewal handoff context"></textarea></label><small>Completion requires client-send evidence, no report drift, clear Creator/KOL settlement, and an explicit renewal recommendation.</small>','Complete closeout',async(form)=>patch({action:'complete-closeout',note:form.get('note')}));}

  function render(){
    const panel=shell();if(!panel)return;
    if(!payload?.item){panel.innerHTML='<div class="campaign-client-closeout-loading-r63">Select a campaign to load final client closeout.</div>';return;}
    const item=payload.item,closeout=item.closeout||{},s=item.summary||{},p=payload.permissions||{};
    const status=s.effectiveStatus||closeout.status||'NOT_STARTED';
    const canPrepare=p.canWrite&&s.activationCompleted&&['NOT_STARTED','REPORT_READY','REJECTED'].includes(closeout.status);
    const canEdit=p.canWrite&&['REPORT_READY','REJECTED'].includes(closeout.status);
    const canSubmit=p.canWrite&&['REPORT_READY','REJECTED'].includes(closeout.status)&&!s.reportDrift&&Boolean(closeout.reportFingerprint);
    const canApprove=p.canManage&&closeout.status==='READY_FOR_APPROVAL'&&!s.reportDrift;
    const canReject=p.canManage&&closeout.status==='READY_FOR_APPROVAL';
    const canSend=p.canManage&&closeout.status==='APPROVED'&&!s.reportDrift;
    const canComplete=p.canManage&&closeout.status==='SENT_TO_CLIENT'&&s.completionReady;
    const canReopen=p.canManage&&closeout.status!=='NOT_STARTED'&&(closeout.status!=='COMPLETED'||p.canReopenCompleted);
    panel.innerHTML=`
      <header class="campaign-client-closeout-head-r63"><div><span>CLIENT DELIVERY · R8.5M</span><strong>Final Client Report & Closeout</strong><small>Execution complete → evidence snapshot → approval → client delivery → sign-off → renewal handoff.</small></div><div>${badge(status)}</div></header>
      <div class="campaign-client-closeout-toolbar-r63"><div><strong>${esc(item.name)}</strong><span>${esc(item.projectName||'')} · ${esc(label(item.campaignStatus||''))}</span></div><div class="campaign-client-closeout-actions-r63">${canPrepare?`<button data-prepare>${closeout.reportFingerprint?'Refresh report snapshot':'Prepare final report'}</button>`:''}${canEdit?'<button data-edit>Edit closeout</button>':''}${canSubmit?'<button class="primary" data-submit>Submit for approval</button>':''}${canApprove?'<button class="primary" data-approve>Approve report</button>':''}${canReject?'<button data-reject>Reject</button>':''}${canSend?'<button class="primary" data-sent>Mark sent to client</button>':''}${canComplete?'<button class="primary" data-complete>Complete closeout</button>':''}${canReopen?'<button data-reopen>Reopen</button>':''}</div></div>
      <div class="campaign-client-closeout-kpis-r63">
        <article><small>Approved delivery</small><b>${fmt(s.approvedPosts)} / ${fmt(s.plannedPosts)}</b><span>${fmt(s.holdingPosts)} Holding · ${fmt(s.rejectedPosts)} Rejected</span></article>
        <article><small>Approved reach</small><b>${fmt(s.approvedReach)}</b><span>${fmt(s.approvedEngagements)} Approved engagements</span></article>
        <article><small>Planned economics</small><b>${fmt(s.estimatedPlanCost,2)}</b><span>${fmt(s.plannedCashAllocation,2)} cash + ${fmt(s.plannedTokenUnits)} tokens · estimated token value ${fmt(s.estimatedTokenValue,2)}</span></article>
        <article><small>Creator/KOL settlement</small><b>${s.settlementClear?'Clear':'Open'}</b><span>${fmt(s.settlementPaidUsdt,2)} USDT paid · ${fmt(s.settlementOutstandingUsdt,2)} outstanding</span></article>
        <article><small>Renewal handoff</small><b>${esc(label(closeout.renewalRecommendation||'UNSET'))}</b><span>${closeout.renewalTargetDate?`Target ${esc(closeout.renewalTargetDate)}`:'No target date'}</span></article>
      </div>
      ${alertBox(s,closeout)}
      <div class="campaign-client-closeout-evidence-r63"><article><small>Report fingerprint</small><strong>${esc(closeout.reportFingerprint||'Not prepared')}</strong><span>${s.reportDrift?'Changed':'Current canonical evidence'}</span></article><article><small>Client delivery</small><strong>${closeout.clientSentAt?esc(closeout.clientSentChannel||'Recorded'):'Not recorded'}</strong><span>${esc(closeout.clientSentReference||'No evidence reference')}</span></article><article><small>Lessons learned</small><strong>${closeout.lessonsLearned?'Recorded':'Pending'}</strong><span>${esc(closeout.lessonsLearned||'Add operational learnings before closeout.')}</span></article></div>
      <footer class="campaign-client-closeout-foot-r63">Performance is Approved-only. Holding/Rejected posts remain visible as quality evidence but do not count toward performance. Token value is estimated; payment status comes only from governed settlement records.</footer>`;
    panel.querySelector('[data-prepare]')?.addEventListener('click',()=>patch({action:'prepare-report'}));
    panel.querySelector('[data-edit]')?.addEventListener('click',editCloseout);
    panel.querySelector('[data-submit]')?.addEventListener('click',()=>patch({action:'submit-report'}));
    panel.querySelector('[data-approve]')?.addEventListener('click',()=>patch({action:'approve-report'}));
    panel.querySelector('[data-reject]')?.addEventListener('click',rejectReport);
    panel.querySelector('[data-sent]')?.addEventListener('click',markSent);
    panel.querySelector('[data-complete]')?.addEventListener('click',complete);
    panel.querySelector('[data-reopen]')?.addEventListener('click',()=>patch({action:'reopen-closeout'}));
  }
  async function load(id,force=false){
    if(!id||loading||(!force&&loadedId===id))return;loading=true;activeId=id;shell();
    try{payload=await api(`/api/campaign-client-closeout/${encodeURIComponent(id)}`);loadedId=id;render();}
    catch(error){const panel=shell();if(panel)panel.innerHTML=`<div class="campaign-client-closeout-alert-r63"><strong>Closeout unavailable</strong><span>${esc(error.message)}</span></div>`;}
    finally{loading=false;}
  }
  function watch(){
    const selector=document.querySelector('#view-root [data-r56-campaign]');
    if(selector&&!selector.dataset.r63Bound){selector.dataset.r63Bound='1';selector.addEventListener('change',()=>{loadedId='';load(selector.value,true);});}
    if(campaignsPage()&&selector?.value)load(selector.value);else if(!campaignsPage()){activeId='';loadedId='';payload=null;}
  }
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(watch,80);});observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('akari:campaign-closeout-refresh',()=>activeId&&load(activeId,true));
  setTimeout(watch,140);
})();
