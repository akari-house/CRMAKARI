(() => {
  'use strict';
  if (window.__akariCampaignPlanningR56) return;
  window.__akariCampaignPlanningR56 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const money=(value)=>`$${fmt(value,2)}`;
  const pct=(value)=>`${fmt(value,1)}%`;
  const label=(value)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  let campaigns=[];
  let activeId='';
  let payload=null;
  let loading=false;
  let loadedCampaigns=false;

  function campaignPage(){ return Boolean(document.querySelector('#view-root [data-action="new-campaign"]')); }
  function shell(){
    const grid=document.querySelector('#view-root .grid-2');
    if(!campaignPage()||!grid)return null;
    let panel=document.querySelector('#view-root .campaign-planning-r56');
    if(!panel){
      panel=document.createElement('section');
      panel.className='campaign-planning-r56';
      panel.innerHTML='<div class="campaign-plan-loading-r56">Loading Campaign Planning Workspace…</div>';
      const anchor=document.querySelector('#view-root .campaign-talent-r55');
      if(anchor) anchor.insertAdjacentElement('afterend',panel); else grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }

  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Campaign planning request failed');
    return data;
  }

  function option(value,current,display=null){return `<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(display||label(value))}</option>`;}
  function statusTone(status){
    if(status==='APPROVED')return 'approved';
    if(status==='READY_FOR_APPROVAL')return 'ready';
    if(status==='REJECTED')return 'rejected';
    if(status==='CHANGES_AFTER_APPROVAL')return 'drift';
    return 'draft';
  }

  function closeModal(){document.querySelector('.campaign-plan-modal-r56')?.remove();}
  function modal(title,body,submitLabel,onSubmit){
    closeModal();
    const layer=document.createElement('div');
    layer.className='campaign-plan-modal-r56';
    layer.innerHTML=`<form><header><strong>${esc(title)}</strong><button type="button" data-close>×</button></header><div class="campaign-plan-modal-body-r56">${body}</div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></footer></form>`;
    layer.addEventListener('click',(event)=>{if(event.target===layer||event.target.closest('[data-close]'))closeModal();});
    layer.querySelector('form').addEventListener('submit',async(event)=>{
      event.preventDefault();
      const button=event.submitter; button.disabled=true;
      try{await onSubmit(new FormData(event.currentTarget));closeModal();}
      catch(error){alert(error.message);button.disabled=false;}
    });
    document.body.appendChild(layer);
  }

  function partnerOptions(partners,current){
    const selected=current.agencyPartnerId||'';
    return [`<option value="">Direct / unassigned</option>`,...(partners||[]).map((partner)=>`<option value="${esc(partner.id)}" ${partner.id===selected?'selected':''}>${esc(partner.name)} · ${esc(label(partner.partner_type||'Partner'))}</option>`)].join('');
  }

  function editItem(item){
    const partners=payload?.deliveryPartners||[];
    modal(`Edit plan item · ${item.name||item.handle||'Talent'}`,`
      <input type="hidden" name="id" value="${esc(item.id)}">
      <label>Delivery partner<select name="agencyPartnerId">${partnerOptions(partners,item)}</select></label>
      <label>Content type<input name="category" value="${esc(item.category||'')}" placeholder="Thread, video, Space..."></label>
      <label>Region<input name="region" value="${esc(item.region||'')}"></label>
      <label>Expected posts<input name="expectedPosts" type="number" min="0" value="${esc(item.expectedPosts||0)}"></label>
      <label>Expected reach<input name="expectedReach" type="number" min="0" value="${esc(item.expectedReach||0)}"></label>
      <label>Cash allocation USD<input name="allocatedUsd" type="number" min="0" step="any" value="${esc(item.allocatedUsd||0)}"></label>
      <label>Token allocation<input name="allocatedTokens" type="number" min="0" step="any" value="${esc(item.allocatedTokens||0)}"></label>
      <label>TGE unlock %<input name="tgeUnlockPercent" type="number" min="0" max="100" value="${esc(item.tgeUnlockPercent||0)}"></label>
      <label>Cliff months<input name="cliffMonths" type="number" min="0" value="${esc(item.cliffMonths||0)}"></label>
      <label>Vesting months<input name="vestingMonths" type="number" min="0" value="${esc(item.vestingMonths||0)}"></label>
      <label class="full">Planning notes<textarea name="notes" rows="3">${esc(item.notes||'')}</textarea></label>`, 'Save plan item', async(form)=>{
        await patch({action:'upsert-plan-item',assignment:Object.fromEntries(form.entries())});
      });
  }

  function rejectPlan(){
    modal('Reject campaign plan','<label class="full">Reason<textarea name="reason" rows="4" required placeholder="What must change before approval?"></textarea></label>','Reject plan',async(form)=>patch({action:'reject-plan',reason:form.get('reason')}));
  }

  async function patch(body){
    if(!activeId)return;
    const result=await api(`/api/campaign-planning/${encodeURIComponent(activeId)}`,{method:'PATCH',body:JSON.stringify(body)});
    payload=result;
    render();
  }

  function itemRows(items,permissions,planning){
    if(!items.length)return '<tr><td colspan="8"><div class="campaign-plan-empty-r56">No Creator or KOL is in this plan yet. Add one from the recommendation shortlist below.</div></td></tr>';
    const editable=permissions.canWrite&&['DRAFT','REJECTED'].includes(planning.status);
    return items.map((item)=>`<tr data-plan-item="${esc(item.id)}">
      <td><strong>${esc(item.name||item.handle||'Talent')}</strong><span>${esc(item.handle||'')} · ${esc(label(item.creatorType))} · ${esc(label(item.platform))}</span>${item.recommendation?`<small>Recommended ${fmt(item.recommendation.recommendationScore,1)} · ${esc(item.recommendation.recommendationVersion)}</small>`:''}</td>
      <td><strong>${esc(item.agencyName||'Direct / unassigned')}</strong><span>${item.agencyPartnerId?'Partner-linked':'Direct / legacy'}</span></td>
      <td><strong>${fmt(item.expectedPosts)} posts</strong><span>${fmt(item.expectedReach)} reach target</span></td>
      <td><strong>${money(item.allocatedUsd)}</strong><span>${fmt(item.allocatedTokens)} tokens</span></td>
      <td><strong>${esc(item.category||'Unspecified')}</strong><span>${esc(item.region||'Unspecified')}</span></td>
      <td><strong>${pct(item.tgeUnlockPercent)}</strong><span>${fmt(item.cliffMonths)}m cliff · ${fmt(item.vestingMonths)}m vesting</span></td>
      <td><span>${esc(item.notes||'')}</span></td>
      <td>${editable?'<button data-edit>Edit</button><button class="danger" data-remove>Remove</button>':'<span class="muted">Locked</span>'}</td>
    </tr>`).join('');
  }

  function recommendationCards(intelligence,permissions,planning){
    const recs=(intelligence?.recommendations||[]).slice(0,8);
    const editable=permissions.canWrite&&['DRAFT','REJECTED'].includes(planning.status);
    if(!recs.length)return '<div class="campaign-plan-empty-r56">No additional contributor matches the current plan criteria.</div>';
    return `<div class="campaign-plan-recs-r56">${recs.map((item)=>`<article data-rec="${esc(item.identityKey)}"><header><div><strong>${esc(item.name)}</strong><span>${esc(item.handle||'')} · ${esc(label(item.creatorType))}</span></div><b>${fmt(item.recommendationScore,1)}</b></header><p>${(item.recommendationReasons||[]).slice(0,2).map(esc).join(' · ')||'Historical campaign evidence available.'}</p><div><span>${fmt(item.approvedPosts)} Approved posts</span><span>${fmt(item.approvedReach)} Approved reach</span><span>${pct(item.averageDeliveryCompletion)} delivery</span><span>${money(item.historicalAverageAllocation)} historical avg allocation</span></div>${item.riskSignals?.length?`<small class="risk">${item.riskSignals.slice(0,2).map(esc).join(' · ')}</small>`:'<small>No material risk signal in tracked history.</small>'}${editable?'<button class="primary" data-add>Add to campaign plan</button>':''}</article>`).join('')}</div>`;
  }

  function actionButtons(item,permissions){
    const planning=item.planning||{};
    const effective=item.summary?.effectiveStatus||planning.status;
    const buttons=[];
    if(permissions.canWrite&&['DRAFT','REJECTED'].includes(planning.status))buttons.push('<button class="primary" data-submit-plan>Submit for approval</button>');
    if(permissions.canManage&&planning.status==='READY_FOR_APPROVAL')buttons.push('<button class="primary" data-approve-plan>Approve plan</button><button class="danger" data-reject-plan>Reject</button>');
    if(permissions.canManage&&(planning.status!=='DRAFT'||effective==='CHANGES_AFTER_APPROVAL'))buttons.push('<button data-reopen-plan>Reopen as Draft</button>');
    return buttons.join('');
  }

  function render(){
    const panel=shell(); if(!panel)return;
    if(!payload?.item){panel.innerHTML='<div class="campaign-plan-loading-r56">Select a campaign to open the planning workspace.</div>';return;}
    const item=payload.item;
    const planning=item.planning||{};
    const summary=item.summary||{};
    const permissions=payload.permissions||{};
    const effective=summary.effectiveStatus||planning.status||'DRAFT';
    const editable=permissions.canWrite&&['DRAFT','REJECTED'].includes(planning.status);
    const selectedCampaign=campaigns.find((campaign)=>campaign.id===activeId);
    panel.innerHTML=`
      <header class="campaign-plan-head-r56"><div><span>CAMPAIGN PLANNING · R8.5F</span><strong>Talent Basket & Approval Workspace</strong><small>Turn recommendation intelligence into a governed execution plan without duplicating campaign data.</small></div><div class="campaign-plan-status-r56 ${statusTone(effective)}"><b>${esc(label(effective))}</b><span>${summary.approvalDrift?'Approved basket changed — reapproval required':'Current plan state'}</span></div></header>
      <div class="campaign-plan-selector-r56"><label>Campaign<select data-r56-campaign>${campaigns.map((campaign)=>option(campaign.id,activeId,`${campaign.name}${campaign.project_name?` · ${campaign.project_name}`:''}`)).join('')}</select></label><div><strong>${esc(selectedCampaign?.name||item.name)}</strong><span>${esc(item.projectName||'')} · ${esc(label(item.status||''))}</span></div>${actionButtons(item,permissions)}</div>
      ${summary.approvalDrift?'<div class="campaign-plan-drift-r56"><strong>Approval drift detected.</strong><span>The live campaign assignment basket no longer matches the approved fingerprint. The previous approval is not treated as approval of these changes.</span></div>':''}
      <div class="campaign-plan-controls-r56">
        <label>Objective<select data-plan-field="objective" ${editable?'':'disabled'}>${['BALANCED','REACH','ENGAGEMENT','RELIABILITY'].map((v)=>option(v,planning.objective)).join('')}</select></label>
        <label>Platform<input data-plan-field="platform" value="${esc(planning.platform||'ALL')}" ${editable?'':'disabled'}></label>
        <label>Talent type<select data-plan-field="creatorType" ${editable?'':'disabled'}>${['ALL','CREATOR','KOL'].map((v)=>option(v,planning.creatorType)).join('')}</select></label>
        <label>Content type<input data-plan-field="contentType" value="${esc(planning.contentType||'ALL')}" ${editable?'':'disabled'}></label>
        <label>Region<input data-plan-field="region" value="${esc(planning.region||'ALL')}" ${editable?'':'disabled'}></label>
        <label>Planning budget USD<input data-plan-field="budgetUsd" type="number" min="0" step="100" value="${esc(planning.budgetUsd||'')}" ${editable?'':'disabled'}></label>
        <label class="wide">Plan notes<input data-plan-field="notes" value="${esc(planning.notes||'')}" ${editable?'':'disabled'}></label>
        ${editable?'<button data-save-plan>Save planning criteria</button>':''}
      </div>
      <div class="campaign-plan-kpis-r56">
        <article><small>Talent</small><b>${fmt(summary.talentCount)}</b><span>${fmt(summary.creatorCount)} creators · ${fmt(summary.kolCount)} KOLs</span></article>
        <article><small>Deliverables</small><b>${fmt(summary.plannedPosts)}</b><span>${fmt(summary.plannedReach)} planned reach</span></article>
        <article><small>Cash allocation</small><b>${money(summary.cashAllocation)}</b><span>${fmt(summary.partnerCount)} delivery partners</span></article>
        <article><small>Token value estimate</small><b>${money(summary.estimatedTokenValue)}</b><span>${fmt(summary.tokenAllocation)} tokens @ ${money(summary.tokenPrice)}</span></article>
        <article class="${summary.budgetReconciled?'ok':'warn'}"><small>Total plan cost</small><b>${money(summary.estimatedPlanCost)}</b><span>${summary.budgetUsd>0?`${money(summary.remainingBudget)} remaining · ${pct(summary.budgetUtilization)} used`:'Set a planning budget'}</span></article>
      </div>
      <section class="campaign-plan-table-r56"><header><div><span>APPROVAL BASKET</span><strong>Canonical Creator / KOL assignments</strong></div><small>These are the same assignments used later for post tracking and delivery reporting.</small></header><div><table><thead><tr><th>Talent</th><th>Partner</th><th>Deliverables</th><th>Allocation</th><th>Content / region</th><th>Token terms</th><th>Notes</th><th></th></tr></thead><tbody>${itemRows(item.planItems||[],permissions,planning)}</tbody></table></div></section>
      <section class="campaign-plan-shortlist-r56"><header><div><span>RECOMMENDATION FEED</span><strong>Add evidence-backed talent</strong></div><small>Server-resolved from R8.5E. Adding talent is always a deliberate user action.</small></header>${recommendationCards(payload.recommendations,permissions,planning)}</section>
      <footer class="campaign-plan-footer-r56"><span>Approval is tied to fingerprint <b>${esc(summary.approvedFingerprint||summary.currentFingerprint||'—')}</b>.</span><span>Token value uses the campaign's tracked current/listing token price. Historical allocations are planning signals, not quotes or payment evidence.</span></footer>`;

    panel.querySelector('[data-r56-campaign]')?.addEventListener('change',(event)=>{activeId=event.target.value;loadPlan(true);});
    panel.querySelector('[data-save-plan]')?.addEventListener('click',async()=>{
      const planningPatch={}; panel.querySelectorAll('[data-plan-field]').forEach((field)=>{planningPatch[field.dataset.planField]=field.dataset.planField==='budgetUsd'?Number(field.value||0):field.value;});
      try{await patch({action:'update-plan',planning:planningPatch});}catch(error){alert(error.message);}
    });
    panel.querySelector('[data-submit-plan]')?.addEventListener('click',async()=>{try{await patch({action:'submit-plan'});}catch(error){alert(error.message);}});
    panel.querySelector('[data-approve-plan]')?.addEventListener('click',async()=>{try{await patch({action:'approve-plan'});}catch(error){alert(error.message);}});
    panel.querySelector('[data-reject-plan]')?.addEventListener('click',rejectPlan);
    panel.querySelector('[data-reopen-plan]')?.addEventListener('click',async()=>{try{await patch({action:'reopen-plan'});}catch(error){alert(error.message);}});
    panel.querySelectorAll('[data-plan-item]').forEach((row)=>{
      const planItem=(item.planItems||[]).find((entry)=>entry.id===row.dataset.planItem);
      row.querySelector('[data-edit]')?.addEventListener('click',()=>editItem(planItem));
      row.querySelector('[data-remove]')?.addEventListener('click',async()=>{if(!confirm(`Remove ${planItem.name||planItem.handle||'this talent'} from the plan?`))return;try{await patch({action:'remove-plan-item',assignmentId:planItem.id});}catch(error){alert(error.message);}});
    });
    panel.querySelectorAll('[data-rec]').forEach((card)=>card.querySelector('[data-add]')?.addEventListener('click',async()=>{const button=card.querySelector('[data-add]');button.disabled=true;try{await patch({action:'add-recommended-talent',identityKey:card.dataset.rec});}catch(error){alert(error.message);button.disabled=false;}}));
  }

  async function loadCampaigns(force=false){
    if(loadedCampaigns&&!force)return;
    const response=await api('/api/campaigns');
    campaigns=response.items||[];
    loadedCampaigns=true;
    if(!activeId&&campaigns.length){activeId=(campaigns.find((campaign)=>!['COMPLETED','CANCELLED'].includes(String(campaign.status||'').toUpperCase()))||campaigns[0]).id;}
  }

  async function loadPlan(force=false){
    const panel=shell(); if(!panel||loading)return;
    loading=true; if(force)panel.classList.add('is-loading');
    try{
      await loadCampaigns();
      if(!activeId){payload=null;render();return;}
      payload=await api(`/api/campaign-planning/${encodeURIComponent(activeId)}`);
      render();
    }catch(error){panel.innerHTML=`<div class="campaign-plan-error-r56">${esc(error.message||'Campaign planning workspace could not be loaded.')}</div>`;console.warn('[AKARI campaign planning]',error);}
    finally{loading=false;shell()?.classList.remove('is-loading');}
  }

  let queued=false;
  const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(!campaignPage()){payload=null;loadedCampaigns=false;}loadPlan();});};
  new MutationObserver(()=>queue()).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
  document.addEventListener('click',(event)=>{if(event.target.closest('[data-route],[data-action="new-campaign"]'))setTimeout(queue,0);},true);
  queue();
})();
