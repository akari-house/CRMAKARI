(() => {
  'use strict';
  if (window.__akariCampaignCompensationR57) return;
  window.__akariCampaignCompensationR57 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const money=(value)=>`$${fmt(value,2)}`;
  const usdt=(value)=>`${fmt(value,2)} USDT`;
  const pct=(value)=>`${fmt(value,1)}%`;
  const label=(value)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,(char)=>char.toUpperCase());
  const supportedPlatforms=['X','YOUTUBE','TIKTOK','INSTAGRAM'];
  const days=[['0','Sun'],['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri'],['6','Sat']];

  let activeId='';
  let loadedId='';
  let loading=false;
  let payload=null;
  let campaignFallbackLoaded=false;
  let observerTimer=null;

  function campaignPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function shell(){
    const grid=document.querySelector('#view-root .grid-2');
    if(!campaignPage()||!grid)return null;
    let panel=document.querySelector('#view-root .campaign-compensation-r57');
    if(!panel){
      panel=document.createElement('section');
      panel.className='campaign-compensation-r57';
      panel.innerHTML='<div class="campaign-comp-loading-r57">Loading AKARI USDT compensation…</div>';
      const planning=document.querySelector('#view-root .campaign-planning-r56');
      if(planning)planning.insertAdjacentElement('afterend',panel);
      else{
        const recommendations=document.querySelector('#view-root .campaign-talent-r55');
        if(recommendations)recommendations.insertAdjacentElement('afterend',panel);
        else grid.insertAdjacentElement('beforebegin',panel);
      }
    }
    return panel;
  }
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Campaign compensation request failed');
    return data;
  }
  function closeModal(){document.querySelector('.campaign-comp-modal-r57')?.remove();}
  function modal(title,body,submitLabel,onSubmit){
    closeModal();
    const layer=document.createElement('div');
    layer.className='campaign-comp-modal-r57';
    layer.innerHTML=`<form><header><strong>${esc(title)}</strong><button type="button" data-close>×</button></header><div class="campaign-comp-modal-body-r57">${body}</div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></footer></form>`;
    layer.addEventListener('click',(event)=>{if(event.target===layer||event.target.closest('[data-close]'))closeModal();});
    layer.querySelector('form').addEventListener('submit',async(event)=>{
      event.preventDefault();
      const button=event.submitter;
      button.disabled=true;
      try{await onSubmit(new FormData(event.currentTarget));closeModal();}
      catch(error){alert(error.message);button.disabled=false;}
    });
    document.body.appendChild(layer);
  }
  function syncPlanningPanel(){
    const selector=document.querySelector('#view-root [data-r56-campaign]');
    if(selector)selector.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function patch(body,{refreshPlanning=false}={}){
    if(!activeId)return;
    payload=await api(`/api/campaign-compensation/${encodeURIComponent(activeId)}`,{method:'PATCH',body:JSON.stringify(body)});
    loadedId=activeId;
    render();
    if(refreshPlanning)syncPlanningPanel();
  }

  function platformChecks(input){
    return supportedPlatforms.map((platform)=>`<label><input type="checkbox" name="platform" value="${platform}" ${(input.selectedPlatforms||[]).includes(platform)?'checked':''}>${label(platform)}</label>`).join('');
  }
  function followerFields(input){
    return supportedPlatforms.map((platform)=>`<label>${label(platform)} followers<input type="number" name="followers_${platform}" min="0" step="1" value="${esc(input.followers?.[platform]||0)}"></label>`).join('');
  }
  function dayChecks(input){
    return days.map(([value,name])=>`<label><input type="checkbox" name="postingDay" value="${value}" ${(input.postingDays||[]).includes(Number(value))?'checked':''}>${name}</label>`).join('');
  }
  function editMetrics(item){
    const input=item.compensationInput||{included:false,selectedPlatforms:[],followers:{},postingDays:[],engagementAccepted:false};
    modal(`Compensation metrics · ${item.name||item.handle||'Talent'}`,`
      <label class="full"><span><input type="checkbox" name="included" value="yes" ${input.included?'checked':''}> Include in AKARI USDT calculation</span></label>
      <div class="full"><strong>Supported campaign channels</strong><div class="campaign-comp-platform-grid-r57">${platformChecks(input)}</div></div>
      ${followerFields(input)}
      <div class="full"><strong>Committed posting days</strong><div class="campaign-comp-day-grid-r57">${dayChecks(input)}</div></div>
      <label class="full"><span><input type="checkbox" name="engagementAccepted" value="yes" ${input.engagementAccepted?'checked':''}> Creator/KOL accepted the campaign engagement requirement</span></label>
      <div class="full"><small>Changing scoring inputs resets metric verification. XScore (${fmt(item.xScore,1)}) and Sorsa (${fmt(item.sorsaScore,1)}) come from the canonical campaign assignment.</small></div>`,
      'Save metrics',async(form)=>{
        const selectedPlatforms=form.getAll('platform').map(String);
        const followers=Object.fromEntries(supportedPlatforms.map((platform)=>[platform,Number(form.get(`followers_${platform}`)||0)]));
        const postingDays=form.getAll('postingDay').map(Number);
        await patch({action:'upsert-talent-input',assignmentId:item.id,input:{included:form.get('included')==='yes',selectedPlatforms,followers,postingDays,engagementAccepted:form.get('engagementAccepted')==='yes'}});
      });
  }
  function verifyMetrics(item){
    modal(`Verify metrics · ${item.name||item.handle||'Talent'}`,`
      <label class="full">Verification note<textarea name="note" rows="4" minlength="5" required placeholder="Example: Checked X profile follower count, XScore and Sorsa on 8 Aug 2026.">${esc(item.compensationInput?.verificationNote||'')}</textarea></label>
      <div class="full"><small>Verification records the operator and time. Any later scoring-input change resets this verification.</small></div>`,
      'Verify metrics',async(form)=>patch({action:'verify-talent-metrics',assignmentId:item.id,note:form.get('note')}));
  }

  function weightInputs(compensation,editable){
    return `<div class="campaign-comp-weight-r57">${supportedPlatforms.map((platform)=>`<label>${label(platform)} weight %<input data-comp-weight="${platform}" type="number" min="0" max="100" step="1" value="${esc(compensation.platformWeights?.[platform]??0)}" ${editable?'':'disabled'}></label>`).join('')}</div>`;
  }
  function engagementActions(compensation,editable){
    const actions=['COMMENT','LIKE','REPOST','BOOKMARK'];
    return `<div class="campaign-comp-checks-r57"><label><input data-comp-field="dailyEngagementRequired" type="checkbox" ${compensation.dailyEngagementRequired?'checked':''} ${editable?'':'disabled'}> Daily engagement required</label>${actions.map((action)=>`<label><input data-comp-action="${action}" type="checkbox" ${(compensation.engagementActions||[]).includes(action)?'checked':''} ${editable?'':'disabled'}>${label(action)}</label>`).join('')}</div>`;
  }
  function cadenceOptions(current){
    const values=['ONE_TIME','WEEKLY_1','WEEKLY_2','WEEKLY_3','WEEKLY_4','WEEKLY_5','WEEKLY_6','WEEKLY_7','DAILY'];
    return values.map((value)=>`<option value="${value}" ${value===current?'selected':''}>${value==='DAILY'?'Daily':value==='ONE_TIME'?'One-time':label(value)}</option>`).join('');
  }
  function statusClass(summary){return summary.calculationCurrent?'current':'stale';}

  function talentRows(items,permissions,editable){
    if(!items.length)return '<tr><td colspan="8"><div class="campaign-comp-empty-r57">Add Creator/KOL talent in the R8.5F campaign plan before calculating USDT allocations.</div></td></tr>';
    return items.map((item)=>{
      const input=item.compensationInput||{};
      const calculation=item.calculation||item.lastApplied||null;
      const metricStatus=!input.included?'Excluded':input.metricsVerified?'Verified':'Needs verification';
      return `<tr data-comp-talent="${esc(item.id)}">
        <td><strong>${esc(item.name||item.handle||'Talent')}</strong><span>${esc(item.handle||'')} · ${esc(label(item.creatorType))}</span></td>
        <td><strong>${esc((input.selectedPlatforms||[]).map(label).join(', ')||'No supported channel')}</strong><span>${(input.selectedPlatforms||[]).map((platform)=>`${label(platform)} ${fmt(input.followers?.[platform])}`).join(' · ')||'Configure metrics'}</span></td>
        <td><strong class="${input.metricsVerified?'verified':'warn'}">${esc(metricStatus)}</strong><span>XScore ${fmt(item.xScore,1)} · Sorsa ${fmt(item.sorsaScore,1)}</span>${input.verifiedAt?`<small>${esc(input.verificationNote||'Verified')}</small>`:''}</td>
        <td><strong>${fmt((input.postingDays||[]).length)} days</strong><span>${input.engagementAccepted?'Engagement accepted':'Engagement not accepted'}</span></td>
        <td class="campaign-comp-score-r57"><strong>${calculation?fmt((calculation.selectionScore||0)*100,1):'—'}</strong><span>${calculation?`Platform ${pct((calculation.platformScore||0)*100)}`:'Awaiting valid roster'}</span></td>
        <td><strong>${calculation?usdt(calculation.payoutUsdt):'—'}</strong><span>${calculation?`${pct(calculation.payoutPercent)} of base pool`:'Not calculated'}</span></td>
        <td><strong>${money(item.allocatedUsd)}</strong><span>Current canonical cash allocation</span></td>
        <td>${editable?`<button data-metrics>Edit metrics</button>${permissions.canManage&&input.included&&!input.metricsVerified?'<button class="primary" data-verify>Verify</button>':''}`:'<span>Locked</span>'}</td>
      </tr>`;
    }).join('');
  }

  function render(){
    const panel=shell();
    if(!panel)return;
    if(!payload?.item){panel.innerHTML='<div class="campaign-comp-loading-r57">Select a campaign in the planning workspace to load compensation.</div>';return;}
    const item=payload.item;
    const compensation=item.compensation||{};
    const summary=item.summary||{};
    const planSummary=item.planSummary||{};
    const permissions=payload.permissions||{};
    const editable=permissions.canWrite&&['DRAFT','REJECTED'].includes(item.planningStatus);
    const canApply=permissions.canManage&&editable&&compensation.enabled;
    const statusText=!compensation.enabled?'Engine Off':summary.calculationCurrent?'Calculation Current':'Recalculation Required';
    panel.innerHTML=`
      <header class="campaign-comp-head-r57"><div><span>CAMPAIGN COMPENSATION · R8.5G</span><strong>AKARI USDT Allocation Intelligence</strong><small>Budget-safe Creator/KOL allocations using the same percentile model deployed in AKARI House.</small></div><div class="campaign-comp-status-r57 ${statusClass(summary)}"><b>${esc(statusText)}</b><span>${esc(label(item.planningStatus||'DRAFT'))} plan</span></div></header>
      <div class="campaign-comp-toolbar-r57"><div><strong>${esc(item.name)}</strong><span>${esc(item.projectName||'')} · Planning budget ${money(item.planningBudgetUsd)}</span></div><div>${canApply?'<button class="primary" data-apply-comp>Calculate & apply USDT allocations</button>':''}</div></div>
      <div class="campaign-comp-controls-r57">
        <label>AKARI USDT engine<select data-comp-field="enabled" ${editable?'':'disabled'}><option value="false" ${!compensation.enabled?'selected':''}>Off</option><option value="true" ${compensation.enabled?'selected':''}>Enabled</option></select></label>
        <label>Total Creator/KOL budget (USDT)<input data-comp-field="budgetUsdt" type="number" min="0" step="0.01" value="${esc(compensation.budgetUsdt||0)}" ${editable?'':'disabled'}></label>
        <label>Reserved performance bonus (USDT)<input data-comp-field="bonusPoolUsdt" type="number" min="0" step="0.01" value="${esc(compensation.bonusPoolUsdt||0)}" ${editable?'':'disabled'}></label>
        <label>Maximum base allocation / talent<input data-comp-field="maximumBaseAllocationUsdt" type="number" min="0" step="0.01" value="${esc(compensation.maximumBaseAllocationUsdt||0)}" ${editable?'':'disabled'}></label>
        <label>Maximum bonus / talent<input data-comp-field="maximumBonusPerTalentUsdt" type="number" min="0" step="0.01" value="${esc(compensation.maximumBonusPerTalentUsdt||0)}" ${editable?'':'disabled'}></label>
        <label>Posting cadence<select data-comp-field="postingCadence" ${editable?'':'disabled'}>${cadenceOptions(compensation.postingCadence||'WEEKLY_3')}</select></label>
        <label class="wide">Formula scope<input value="X / YouTube / TikTok / Instagram" disabled></label>
        ${weightInputs(compensation,editable)}
        ${engagementActions(compensation,editable)}
        ${editable?'<button data-save-comp>Save compensation rules</button>':''}
      </div>
      <div class="campaign-comp-kpis-r57">
        <article><small>Base allocation pool</small><b>${usdt(summary.baseBudgetUsdt)}</b><span>Total less reserved bonus</span></article>
        <article><small>Calculated base allocation</small><b>${usdt(summary.calculatedBaseAllocationUsdt)}</b><span>${fmt(summary.includedTalentCount)} included · ${fmt(summary.verifiedTalentCount)} verified</span></article>
        <article><small>Reserved bonus</small><b>${usdt(summary.bonusPoolUsdt)}</b><span>Not automatically distributed</span></article>
        <article><small>Unallocated base</small><b>${usdt(summary.unallocatedBaseUsdt)}</b><span>Available under current ceilings</span></article>
        <article><small>Total plan cost</small><b>${money(planSummary.estimatedPlanCost)}</b><span>${money(planSummary.remainingBudget)} planning budget remaining</span></article>
      </div>
      ${summary.calculationError?`<div class="campaign-comp-alert-r57"><strong>Calculation needs attention</strong><span>${esc(summary.calculationError)}</span></div>`:''}
      ${compensation.enabled&&!summary.calculationCurrent&&!summary.calculationError?'<div class="campaign-comp-alert-r57"><strong>Recalculation required</strong><span>Compensation rules, verified metrics, or the talent roster changed after the last applied allocation.</span></div>':''}
      <section class="campaign-comp-section-r57"><header><div><span>VERIFIED TALENT ECONOMICS</span><strong>Creator / KOL compensation roster</strong></div><small>Metrics are campaign-specific. Changing scoring inputs automatically resets verification.</small></header><div class="campaign-comp-table-r57"><table><thead><tr><th>Talent</th><th>Channels / followers</th><th>Verification</th><th>Commitment</th><th>Score</th><th>Calculated USDT</th><th>Plan cash</th><th></th></tr></thead><tbody>${talentRows(item.talent||[],permissions,editable)}</tbody></table></div></section>
      <section class="campaign-comp-section-r57"><header><div><span>AKARI HOUSE FORMULA</span><strong>How the reward is calculated</strong></div><small>Percentiles compare each selected Creator/KOL against the verified roster in this campaign.</small></header><div class="campaign-comp-method-r57"><article><strong>X reputation score</strong><span>40% follower percentile + 30% XScore percentile + 30% Sorsa percentile.</span></article><article><strong>Final selection score</strong><span>70% platform score + 20% posting commitment + 10% engagement commitment.</span></article><article><strong>Budget protection</strong><span>The strongest verified talent can reach the configured ceiling. Lower scores receive proportionally less, then the roster is scaled so the base pool cannot be exceeded.</span></article></div></section>
      <footer class="campaign-comp-footer-r57"><span>USDT is treated as USD-equivalent at 1:1 only for campaign planning and budget reconciliation.</span><span>Allocations are planned economics, not proof that a Creator/KOL was paid. Performance bonuses require a separate controlled award/payment event.</span></footer>`;

    panel.querySelector('[data-save-comp]')?.addEventListener('click',async()=>{
      const field=(name)=>panel.querySelector(`[data-comp-field="${name}"]`);
      const platformWeights=Object.fromEntries(supportedPlatforms.map((platform)=>[platform,Number(panel.querySelector(`[data-comp-weight="${platform}"]`)?.value||0)]));
      const engagementActions=[...panel.querySelectorAll('[data-comp-action]:checked')].map((node)=>node.dataset.compAction);
      const compensationUpdate={
        enabled:field('enabled')?.value==='true',
        budgetUsdt:Number(field('budgetUsdt')?.value||0),
        bonusPoolUsdt:Number(field('bonusPoolUsdt')?.value||0),
        maximumBaseAllocationUsdt:Number(field('maximumBaseAllocationUsdt')?.value||0),
        maximumBonusPerTalentUsdt:Number(field('maximumBonusPerTalentUsdt')?.value||0),
        postingCadence:field('postingCadence')?.value||'WEEKLY_3',
        dailyEngagementRequired:Boolean(field('dailyEngagementRequired')?.checked),
        engagementActions,
        platformWeights,
      };
      try{await patch({action:'update-compensation',compensation:compensationUpdate});}catch(error){alert(error.message);}
    });
    panel.querySelector('[data-apply-comp]')?.addEventListener('click',async()=>{try{await patch({action:'apply-calculation'},{refreshPlanning:true});}catch(error){alert(error.message);}});
    panel.querySelectorAll('[data-comp-talent]').forEach((row)=>{
      const talent=(item.talent||[]).find((candidate)=>candidate.id===row.dataset.compTalent);
      row.querySelector('[data-metrics]')?.addEventListener('click',()=>editMetrics(talent));
      row.querySelector('[data-verify]')?.addEventListener('click',()=>verifyMetrics(talent));
    });
  }

  async function load(force=false){
    if(!activeId||loading||(!force&&loadedId===activeId))return;
    loading=true;
    const panel=shell();
    if(panel&&!payload)panel.innerHTML='<div class="campaign-comp-loading-r57">Loading AKARI USDT compensation…</div>';
    try{payload=await api(`/api/campaign-compensation/${encodeURIComponent(activeId)}`);loadedId=activeId;render();}
    catch(error){if(panel)panel.innerHTML=`<div class="campaign-comp-alert-r57"><strong>Compensation workspace unavailable</strong><span>${esc(error.message)}</span></div>`;}
    finally{loading=false;}
  }
  async function loadFallbackCampaign(){
    if(campaignFallbackLoaded||loading||activeId)return;
    campaignFallbackLoaded=true;
    try{
      const data=await api('/api/campaigns');
      activeId=data.items?.[0]?.id||'';
      if(activeId)load(true);
    }catch{}
  }
  function tick(){
    if(!campaignPage())return;
    shell();
    const selector=document.querySelector('#view-root [data-r56-campaign]');
    const selected=selector?.value||'';
    if(selected&&selected!==activeId){activeId=selected;loadedId='';payload=null;load(true);return;}
    if(!activeId){loadFallbackCampaign();return;}
    if(loadedId!==activeId)load();
  }

  document.addEventListener('change',(event)=>{
    if(event.target?.matches?.('#view-root [data-r56-campaign]')){
      const next=event.target.value;
      if(next&&next!==activeId){activeId=next;loadedId='';payload=null;load(true);}
    }
  });
  const observer=new MutationObserver(()=>{clearTimeout(observerTimer);observerTimer=setTimeout(tick,60);});
  observer.observe(document.documentElement,{subtree:true,childList:true});
  setTimeout(tick,250);
})();
