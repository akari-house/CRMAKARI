(() => {
  'use strict';
  if (window.__akariCampaignTalentOutreachR60) return;
  window.__akariCampaignTalentOutreachR60 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const label=(value)=>String(value||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,(c)=>c.toUpperCase());
  const day=(value)=>value?String(value).slice(0,10):'—';
  let activeId='';
  let loadedId='';
  let loading=false;
  let payload=null;
  let timer=null;

  function campaignsPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function shell(){
    if(!campaignsPage())return null;
    let panel=document.querySelector('#view-root .campaign-talent-outreach-r60');
    if(!panel){
      panel=document.createElement('section');
      panel.className='campaign-talent-outreach-r60';
      panel.innerHTML='<div class="campaign-talent-outreach-loading-r60">Loading Creator/KOL outreach workspace…</div>';
      const compensation=document.querySelector('#view-root .campaign-compensation-r57');
      const planning=document.querySelector('#view-root .campaign-planning-r56');
      const grid=document.querySelector('#view-root .grid-2');
      if(compensation)compensation.insertAdjacentElement('afterend',panel);
      else if(planning)planning.insertAdjacentElement('afterend',panel);
      else if(grid)grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }

  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Creator/KOL outreach request failed');
    return data;
  }

  function closeModal(){document.querySelector('.campaign-talent-outreach-modal-r60')?.remove();}
  function modal(title,body,submitLabel,onSubmit){
    closeModal();
    const layer=document.createElement('div');
    layer.className='campaign-talent-outreach-modal-r60';
    layer.innerHTML=`<form><header><strong>${esc(title)}</strong><button type="button" data-close>×</button></header><div class="campaign-talent-outreach-modal-body-r60">${body}</div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></footer></form>`;
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
    payload=await api(`/api/campaign-talent-outreach/${encodeURIComponent(activeId)}`,{method:'PATCH',body:JSON.stringify(body)});
    loadedId=activeId;
    render();
    window.dispatchEvent(new CustomEvent('akari:campaign-outreach-updated',{detail:{campaignId:activeId}}));
  }

  function badge(status){return `<span class="campaign-talent-outreach-badge-r60 ${String(status||'').toLowerCase()}">${esc(label(status))}</span>`;}
  function memberOptions(selected){
    return (payload?.members||[]).map((member)=>`<option value="${esc(member.id)}" ${member.id===selected?'selected':''}>${esc(member.full_name||member.email||member.id)} · ${esc(label(member.role))}</option>`).join('');
  }

  function contact(item){
    const row=item.outreach||{};
    modal(`Record outreach — ${item.name||item.handle||'Creator/KOL'}`,`
      <label>Outreach channel<select name="channel" required><option value="">Select channel</option>${['X DM','Telegram','Email','WhatsApp','Agency','Other'].map((value)=>`<option value="${value}" ${row.channel===value?'selected':''}>${value}</option>`).join('')}</select></label>
      <label>Outreach owner<select name="owner" required>${memberOptions(row.outreachOwnerId)}</select></label>
      <label>Contact / thread reference<input name="reference" value="${esc(row.contactReference||'')}" placeholder="Message URL, handle, email thread ID or internal reference"></label>
      <label>Next follow-up<input name="followup" type="datetime-local" value="${esc((row.nextFollowUpAt||'').slice(0,16))}"></label>
      <label>Notes<textarea name="notes" rows="3">${esc(row.notes||'')}</textarea></label>
      <small>This records manual outreach evidence only. CRM by AKARI does not send the message automatically.</small>`,
      'Record contact',async(form)=>patch({action:'mark-contacted',assignmentId:item.assignmentId,channel:form.get('channel'),outreachOwnerId:form.get('owner'),contactReference:form.get('reference'),nextFollowUpAt:form.get('followup'),notes:form.get('notes')}));
  }

  function terms(item,action='update-terms'){
    const row=item.outreach||{};
    const isAccept=action==='accept';
    modal(`${isAccept?'Record acceptance':'Negotiated terms'} — ${item.name||item.handle||'Creator/KOL'}`,`
      <div class="campaign-talent-outreach-plan-r60"><strong>Approved campaign allocation</strong><span>${fmt(item.allocatedUsd,2)} USDT + ${fmt(item.allocatedTokens,4)} tokens</span></div>
      <div class="campaign-talent-outreach-form-grid-r60">
        <label>Creator quote · USDT<input name="quotedUsd" type="number" min="0" step="0.01" value="${esc(row.quotedUsd||0)}"></label>
        <label>Creator quote · tokens<input name="quotedTokens" type="number" min="0" step="0.00000001" value="${esc(row.quotedTokens||0)}"></label>
        <label>Agreed USDT<input name="agreedUsd" type="number" min="0" step="0.01" value="${esc(row.agreedUsd||0)}"></label>
        <label>Agreed tokens<input name="agreedTokens" type="number" min="0" step="0.00000001" value="${esc(row.agreedTokens||0)}"></label>
      </div>
      <fieldset><legend>Confirmation checklist</legend>
        <label><input name="deliverables" type="checkbox" ${row.deliverablesConfirmed?'checked':''}> Deliverables confirmed</label>
        <label><input name="schedule" type="checkbox" ${row.scheduleConfirmed?'checked':''}> Campaign dates / schedule confirmed</label>
        <label><input name="compensation" type="checkbox" ${row.compensationConfirmed?'checked':''}> Compensation confirmed</label>
        ${item.agencyRequired?`<label><input name="agency" type="checkbox" ${row.agencyConfirmed?'checked':''}> Agency confirmation recorded</label>`:''}
        <label><input name="terms" type="checkbox" ${row.termsConfirmed?'checked':''}> Campaign terms confirmed</label>
        <label><input name="consent" type="checkbox" ${row.consentConfirmed?'checked':''}> Participation / outreach consent confirmed</label>
      </fieldset>
      <label>Acceptance evidence reference<input name="evidence" value="${esc(row.evidenceReference||'')}" placeholder="Message, email, agreement or evidence reference"></label>
      <label>Next follow-up<input name="followup" type="datetime-local" value="${esc((row.nextFollowUpAt||'').slice(0,16))}"></label>
      <label>Negotiation notes<textarea name="notes" rows="4">${esc(row.notes||'')}</textarea></label>
      <small>Final confirmation is allowed only when the agreed USDT/token amounts match the approved campaign basket exactly.</small>`,
      isAccept?'Record acceptance':'Save terms',async(form)=>patch({
        action,assignmentId:item.assignmentId,
        quotedUsd:form.get('quotedUsd'),quotedTokens:form.get('quotedTokens'),agreedUsd:form.get('agreedUsd'),agreedTokens:form.get('agreedTokens'),
        deliverablesConfirmed:form.has('deliverables'),scheduleConfirmed:form.has('schedule'),compensationConfirmed:form.has('compensation'),agencyConfirmed:form.has('agency'),termsConfirmed:form.has('terms'),consentConfirmed:form.has('consent'),
        evidenceReference:form.get('evidence'),nextFollowUpAt:form.get('followup'),notes:form.get('notes'),
      }));
  }

  function decline(item){
    const replacements=(payload?.item?.talent||[]).filter((row)=>row.assignmentId!==item.assignmentId).map((row)=>`<option value="${esc(row.assignmentId)}">${esc(row.name||row.handle||row.assignmentId)}</option>`).join('');
    modal(`Record decline — ${item.name||item.handle||'Creator/KOL'}`,`
      <label>Decline reason<textarea name="reason" rows="4" required minlength="3"></textarea></label>
      <label>Replacement candidate<select name="replacement"><option value="">No replacement selected</option>${replacements}</select></label>
      <small>Selecting a replacement only records the operational reference. It does not silently change the approved campaign basket.</small>`,
      'Record decline',async(form)=>patch({action:'decline',assignmentId:item.assignmentId,reason:form.get('reason'),replacementAssignmentId:form.get('replacement')}));
  }

  function reopen(item){
    modal(`Reopen negotiation — ${item.name||item.handle||'Creator/KOL'}`,'<label>Reopen reason<textarea name="reason" rows="4" required minlength="3"></textarea></label><small>Prior audit history remains intact. Confirmation checklist evidence is cleared for the new negotiation.</small>',
      'Reopen negotiation',async(form)=>patch({action:'reopen',assignmentId:item.assignmentId,reason:form.get('reason')}));
  }

  function actions(item){
    const status=item.outreach?.status||'NOT_CONTACTED';
    const canWrite=payload?.permissions?.canWrite;
    const canConfirm=payload?.permissions?.canConfirm;
    if(!canWrite)return '';
    if(status==='NOT_CONTACTED')return `<button data-contact="${esc(item.assignmentId)}">Record contact</button>`;
    if(status==='CONTACTED')return `<button data-negotiate="${esc(item.assignmentId)}">Start negotiation</button><button data-accept="${esc(item.assignmentId)}">Record acceptance</button><button data-decline="${esc(item.assignmentId)}">Decline</button>`;
    if(status==='NEGOTIATING')return `<button data-terms="${esc(item.assignmentId)}">Edit terms</button><button data-accept="${esc(item.assignmentId)}">Record acceptance</button><button data-decline="${esc(item.assignmentId)}">Decline</button>`;
    if(status==='ACCEPTED')return `<button data-terms="${esc(item.assignmentId)}">Edit terms</button>${canConfirm?`<button class="primary" data-confirm="${esc(item.assignmentId)}">Confirm participation</button>`:''}<button data-decline="${esc(item.assignmentId)}">Decline</button>`;
    if((status==='DECLINED'||status==='CONFIRMED')&&canConfirm)return `<button data-reopen="${esc(item.assignmentId)}">Reopen</button>`;
    return '';
  }

  function talentRows(items){
    if(!items.length)return '<div class="campaign-talent-outreach-empty-r60">Add Creator/KOL talent to the campaign plan before starting outreach.</div>';
    return `<div class="campaign-talent-outreach-table-r60">${items.map((item)=>{
      const row=item.outreach||{};
      const commercial=item.commercialMatch?'<span class="ok">Matches plan</span>':'<span class="warn">Plan mismatch</span>';
      return `<article class="campaign-talent-outreach-row-r60" data-outreach-assignment="${esc(item.assignmentId)}">
        <div><strong>${esc(item.name||item.handle||'Creator/KOL')}</strong><span>${esc(label(item.creatorType))} · ${esc(item.platform)}${item.agencyName?` · ${esc(item.agencyName)}`:''}</span></div>
        <div>${badge(row.status)}<small>${row.channel?`${esc(row.channel)} · `:''}${row.firstContactedAt?`Contacted ${esc(day(row.firstContactedAt))}`:'Not contacted'}</small></div>
        <div><strong>${fmt(item.allocatedUsd,2)} USDT + ${fmt(item.allocatedTokens,4)} tokens</strong><span>Plan allocation</span><small>Agreed ${fmt(row.agreedUsd,2)} USDT + ${fmt(row.agreedTokens,4)} tokens · ${commercial}</small></div>
        <div><strong>${esc(item.outreachOwnerName||'Unassigned')}</strong><span>Outreach owner</span><small>Follow-up ${esc(day(row.nextFollowUpAt))}</small></div>
        <div><strong>${row.evidenceReference?'Evidence recorded':'Evidence missing'}</strong><span>${item.confirmed?'Execution ready':'Not execution ready'}</span><small>${row.declinedReason?esc(row.declinedReason):row.replacementAssignmentId?`Replacement ${esc(row.replacementAssignmentId)}`:''}</small></div>
        <div class="campaign-talent-outreach-actions-r60">${actions(item)}</div>
      </article>`;
    }).join('')}</div>`;
  }

  function render(){
    const panel=shell();if(!panel)return;
    if(!payload?.item){panel.innerHTML='<div class="campaign-talent-outreach-loading-r60">Select a campaign in the planning workspace to load outreach.</div>';return;}
    const item=payload.item;
    const summary=item.summary||{};
    const locked=item.planningStatus!=='APPROVED'||item.planSummary?.approvalDrift||!item.planSummary?.budgetReconciled||!item.planSummary?.compensationCalculationCurrent;
    panel.innerHTML=`
      <header class="campaign-talent-outreach-head-r60"><div><span>CREATOR / KOL OUTREACH · R8.5J</span><strong>Acceptance & Consent Workspace</strong><small>Selected talent → manual outreach → negotiation → acceptance/decline → evidence → confirmed participation.</small></div><div>${summary.readyForActivation?badge('CONFIRMED'):badge('OUTREACH_IN_PROGRESS')}</div></header>
      <div class="campaign-talent-outreach-toolbar-r60"><div><strong>${esc(item.name)}</strong><span>${esc(item.projectName||'')} · ${esc(label(item.planningStatus||''))} plan</span></div><button data-refresh>Refresh</button></div>
      <div class="campaign-talent-outreach-kpis-r60">
        <article><small>Confirmed</small><b>${fmt(summary.confirmedCount)} / ${fmt(summary.talentCount)}</b><span>Execution-ready talent</span></article>
        <article><small>Contacted</small><b>${fmt(summary.contactedCount)}</b><span>${fmt(summary.negotiatingCount)} negotiating</span></article>
        <article><small>Accepted</small><b>${fmt(summary.acceptedCount)}</b><span>Includes confirmed</span></article>
        <article><small>Declined</small><b>${fmt(summary.declinedCount)}</b><span>${fmt(summary.pendingCount)} pending</span></article>
        <article><small>Commercial mismatch</small><b>${fmt(summary.commercialMismatchCount)}</b><span>Must reconcile before confirmation</span></article>
      </div>
      ${summary.readyForActivation?'<div class="campaign-talent-outreach-alert-r60 success"><strong>Talent confirmed</strong><span>All active Creator/KOL participation evidence matches the approved campaign basket. New campaign activation is unlocked.</span></div>':`<div class="campaign-talent-outreach-alert-r60"><strong>${locked?'Plan governance needs attention':'Talent confirmation incomplete'}</strong><span>${locked?'Keep the campaign plan approved, budget-reconciled and compensation-current before final talent confirmation. ':''}${fmt(summary.confirmedCount)} of ${fmt(summary.talentCount)} active talent confirmed.</span></div>`}
      <section class="campaign-talent-outreach-section-r60"><header><div><span>MANUAL OUTREACH LEDGER</span><strong>Campaign-specific Creator/KOL evidence</strong></div><small>No message is sent automatically. Quote and negotiated terms remain distinct from actual payment and settlement.</small></header>${talentRows(item.talent||[])}</section>
      <footer class="campaign-talent-outreach-foot-r60">Final confirmation is campaign-specific. It records that the selected Creator/KOL accepted the current deliverables and economics; it is not proof that they were paid and does not alter public AKARI House profile data.</footer>`;
    const byId=new Map((item.talent||[]).map((row)=>[row.assignmentId,row]));
    panel.querySelector('[data-refresh]')?.addEventListener('click',()=>load(activeId,true));
    panel.querySelectorAll('[data-contact]').forEach((button)=>button.addEventListener('click',()=>contact(byId.get(button.dataset.contact))));
    panel.querySelectorAll('[data-negotiate]').forEach((button)=>button.addEventListener('click',()=>patch({action:'start-negotiation',assignmentId:button.dataset.negotiate})));
    panel.querySelectorAll('[data-terms]').forEach((button)=>button.addEventListener('click',()=>terms(byId.get(button.dataset.terms))));
    panel.querySelectorAll('[data-accept]').forEach((button)=>button.addEventListener('click',()=>terms(byId.get(button.dataset.accept),'accept')));
    panel.querySelectorAll('[data-decline]').forEach((button)=>button.addEventListener('click',()=>decline(byId.get(button.dataset.decline))));
    panel.querySelectorAll('[data-confirm]').forEach((button)=>button.addEventListener('click',()=>patch({action:'confirm',assignmentId:button.dataset.confirm})));
    panel.querySelectorAll('[data-reopen]').forEach((button)=>button.addEventListener('click',()=>reopen(byId.get(button.dataset.reopen))));
  }

  async function load(id,force=false){
    if(!id||loading||(!force&&loadedId===id))return;
    loading=true;activeId=id;shell();
    try{payload=await api(`/api/campaign-talent-outreach/${encodeURIComponent(id)}`);loadedId=id;render();}
    catch(error){const panel=shell();if(panel)panel.innerHTML=`<div class="campaign-talent-outreach-alert-r60"><strong>Outreach unavailable</strong><span>${esc(error.message)}</span></div>`;}
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
    if(selector&&!selector.dataset.r60Bound){selector.dataset.r60Bound='1';selector.addEventListener('change',()=>{loadedId='';resolveCampaign();});}
    if(campaignsPage())resolveCampaign();
    else{loadedId='';activeId='';payload=null;}
  }
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(watch,80);});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>{loadedId='';setTimeout(watch,50);});
  setTimeout(watch,120);
})();
