(() => {
  'use strict';
  if (window.__akariCampaignSettlementR58) return;
  window.__akariCampaignSettlementR58 = true;

  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,d=0)=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:d});
  const usdt=(v)=>`${fmt(v,2)} USDT`;
  const pct=(v)=>`${fmt(v,1)}%`;
  const label=(v)=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  let activeId='';
  let loadedId='';
  let loading=false;
  let payload=null;
  let timer=null;

  function campaignsPage(){return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));}
  function shell(){
    if(!campaignsPage())return null;
    let panel=document.querySelector('#view-root .campaign-settlement-r58');
    if(!panel){
      panel=document.createElement('section');
      panel.className='campaign-settlement-r58';
      panel.innerHTML='<div class="campaign-settlement-loading-r58">Loading Creator/KOL settlement…</div>';
      const comp=document.querySelector('#view-root .campaign-compensation-r57');
      const planning=document.querySelector('#view-root .campaign-planning-r56');
      const grid=document.querySelector('#view-root .grid-2');
      if(comp)comp.insertAdjacentElement('afterend',panel);
      else if(planning)planning.insertAdjacentElement('afterend',panel);
      else if(grid)grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }
  async function api(url,options={}){
    const response=await fetch(url,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||'Campaign settlement request failed');
    return data;
  }
  function closeModal(){document.querySelector('.campaign-settlement-modal-r58')?.remove();}
  function modal(title,body,submitLabel,onSubmit){
    closeModal();
    const layer=document.createElement('div');
    layer.className='campaign-settlement-modal-r58';
    layer.innerHTML=`<form><header><strong>${esc(title)}</strong><button type="button" data-close>×</button></header><div class="campaign-settlement-modal-body-r58">${body}</div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></footer></form>`;
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
    payload=await api(`/api/campaign-settlement/${encodeURIComponent(activeId)}`,{method:'PATCH',body:JSON.stringify(body)});
    loadedId=activeId;
    render();
  }
  function approve(item){
    modal(`Approve settlement · ${item.name||item.handle||'Talent'}`,`
      <label>Approved base (USDT)<input name="base" type="number" min="0" step="0.01" max="${esc(item.basePlannedUsdt)}" value="${esc(item.settlement?.baseApprovedUsdt||item.basePlannedUsdt||0)}" required></label>
      <label>Approved bonus (USDT)<input name="bonus" type="number" min="0" step="0.01" max="${esc(payload.item.summary.maximumBonusPerTalentUsdt||0)}" value="${esc(item.settlement?.bonusApprovedUsdt||item.bonusRecommendedUsdt||0)}"></label>
      <label class="full">Approval note<textarea name="note" rows="4" minlength="5" required placeholder="Confirm delivery evidence and any approved variance.">${esc(item.settlement?.approvalNote||'')}</textarea></label>
      <div class="full"><small>Approval establishes an amount due. It does not record payment. Current evidence fingerprint: ${esc(item.currentEvidenceFingerprint)}</small></div>`,
      'Approve settlement',async(form)=>patch({action:'approve-settlement',assignmentId:item.id,baseApprovedUsdt:Number(form.get('base')||0),bonusApprovedUsdt:Number(form.get('bonus')||0),note:form.get('note')}));
  }
  function dispute(item){
    modal(`Dispute settlement · ${item.name||item.handle||'Talent'}`,`
      <label class="full">Dispute reason<textarea name="reason" rows="4" minlength="5" required placeholder="Describe the evidence, delivery, or amount issue.">${esc(item.settlement?.disputeReason||'')}</textarea></label>`,
      'Mark disputed',async(form)=>patch({action:'mark-disputed',assignmentId:item.id,reason:form.get('reason')}));
  }
  function payment(item){
    modal(`Record payment · ${item.name||item.handle||'Talent'}`,`
      <label>Amount (USDT)<input name="amount" type="number" min="0.01" step="0.01" max="${esc(item.outstandingUsdt||0)}" value="${esc(item.outstandingUsdt||0)}" required></label>
      <label>Paid date<input name="paidAt" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
      <label>Method<select name="method"><option value="USDT_ONCHAIN">USDT on-chain</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label>
      <label>Reference<input name="reference" maxlength="500" required placeholder="Transaction hash / bank reference"></label>
      <label class="full">Payment note<textarea name="note" rows="3" placeholder="Optional internal note"></textarea></label>`,
      'Record payment',async(form)=>patch({action:'record-payment',assignmentId:item.id,amountUsdt:Number(form.get('amount')||0),paidAt:form.get('paidAt'),method:form.get('method'),reference:form.get('reference'),note:form.get('note')}));
  }
  function voidPayment(paymentRow){
    modal('Void payment record',`<label class="full">Reason<textarea name="reason" rows="4" minlength="5" required placeholder="Explain why this payment record must be voided."></textarea></label><div class="full"><small>The payment is preserved in history and marked void. It is never deleted.</small></div>`,
      'Void payment',async(form)=>patch({action:'void-payment',paymentId:paymentRow.id,reason:form.get('reason')}));
  }

  function badge(status){return `<span class="campaign-settlement-badge-r58 ${String(status||'').toLowerCase()}">${esc(label(status))}</span>`;}
  function row(item,permissions){
    const canApprove=permissions.canApprove&&item.baseReady;
    const canPay=permissions.canFinance&&item.paymentStatus!=='EVIDENCE_CHANGED'&&item.settlement?.status==='APPROVED'&&Number(item.outstandingUsdt||0)>0;
    return `<tr data-settlement-talent="${esc(item.id)}">
      <td><strong>${esc(item.name||item.handle||'Talent')}</strong><span>${esc(item.handle||'')} · ${esc(label(item.creatorType))}</span></td>
      <td><strong>${fmt(item.approvedPosts)} / ${fmt(item.expectedPosts)} Approved</strong><span>${fmt(item.holdingPosts)} holding · ${fmt(item.rejectedPosts)} rejected</span></td>
      <td><strong>${fmt(item.approvedReach)} / ${fmt(item.expectedReach)}</strong><span>${pct(item.reachAchievement)} reach achievement · ${fmt(item.approvedEngagements)} engagements</span></td>
      <td><strong>${usdt(item.basePlannedUsdt)}</strong><span>${item.baseReady?'Base ready':'Awaiting Approved delivery'}</span></td>
      <td><strong>${item.bonusEligible?usdt(item.bonusRecommendedUsdt):'—'}</strong><span>${item.bonusEligible?`Performance score ${pct(item.performanceScore)}`:'Bonus target not met'}</span></td>
      <td><strong>${usdt(item.totalApprovedUsdt)}</strong><span>${badge(item.paymentStatus)}${item.approvalDrift?'<em> Evidence changed</em>':''}</span></td>
      <td><strong>${item.paidUsdt===null?'Restricted':usdt(item.paidUsdt)}</strong><span>${item.outstandingUsdt===null?'Finance permission required':`${usdt(item.outstandingUsdt)} outstanding`}</span></td>
      <td><div class="campaign-settlement-actions-r58">${canApprove?'<button data-approve>Review / approve</button>':''}${permissions.canApprove?'<button data-dispute>Dispute</button>':''}${canPay?'<button class="primary" data-payment>Record payment</button>':''}</div></td>
    </tr>`;
  }
  function paymentHistory(items,permissions){
    const payments=items.flatMap((item)=>(item.payments||[]).map((payment)=>({...payment,talentName:item.name||item.handle||'Talent'})));
    if(!permissions.canFinance)return '<div class="campaign-settlement-private-r58">Payment references are visible only to finance-authorized workspace members.</div>';
    if(!payments.length)return '<div class="campaign-settlement-private-r58">No settlement payments have been recorded.</div>';
    return `<div class="campaign-settlement-payments-r58">${payments.sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt))).map((payment)=>`<article class="${payment.voidedAt?'voided':''}"><div><strong>${esc(payment.talentName)}</strong><span>${usdt(payment.amountUsdt)} · ${esc(label(payment.method))} · ${esc(payment.paidAt||'')}</span><small>${esc(payment.reference||'')}</small>${payment.voidedAt?`<em>Voided: ${esc(payment.voidReason||'')}</em>`:''}</div>${permissions.canVoid&&!payment.voidedAt?`<button data-void-payment="${esc(payment.id)}">Void</button>`:''}</article>`).join('')}</div>`;
  }

  function render(){
    const panel=shell();if(!panel)return;
    if(!payload?.item){panel.innerHTML='<div class="campaign-settlement-loading-r58">Select a campaign in the planning workspace to load settlement.</div>';return;}
    const item=payload.item;
    const summary=item.summary||{};
    const permissions=payload.permissions||{};
    const warning=!summary.governanceReady
      ? `<div class="campaign-settlement-alert-r58"><strong>Settlement locked</strong><span>${summary.planningStatus!=='APPROVED'?'Approve the campaign plan first. ':''}${summary.planningApprovalDrift?'The approved talent basket changed. Reapprove the plan. ':''}${!summary.compensationCalculationCurrent?'Recalculate AKARI USDT allocations before settlement.':''}</span></div>`
      : summary.driftCount>0?`<div class="campaign-settlement-alert-r58"><strong>Settlement evidence changed</strong><span>${fmt(summary.driftCount)} approved settlement${summary.driftCount===1?' has':'s have'} changed performance evidence and must be reapproved before another payment.</span></div>`:'';
    panel.innerHTML=`
      <header class="campaign-settlement-head-r58"><div><span>PERFORMANCE & SETTLEMENT · R8.5H</span><strong>Creator / KOL Settlement Control</strong><small>Approved delivery evidence → performance bonus recommendation → finance approval → payment evidence.</small></div><div>${badge(summary.governanceReady?'READY':'LOCKED')}</div></header>
      <div class="campaign-settlement-toolbar-r58"><div><strong>${esc(item.name)}</strong><span>${esc(item.projectName||'')} · ${esc(label(item.planningStatus||''))} plan</span></div><small>Bonus pool ${usdt(summary.bonusPoolUsdt)} · max ${usdt(summary.maximumBonusPerTalentUsdt)} / talent</small></div>
      <div class="campaign-settlement-kpis-r58">
        <article><small>Base ready</small><b>${fmt(summary.baseReadyCount)} / ${fmt(summary.talentCount)}</b><span>Approved post commitment delivered</span></article>
        <article><small>Recommended bonus</small><b>${usdt(summary.recommendedBonusUsdt)}</b><span>${fmt(summary.bonusEligibleCount)} performance-eligible</span></article>
        <article><small>Approved due</small><b>${usdt(Number(summary.approvedBaseUsdt||0)+Number(summary.approvedBonusUsdt||0))}</b><span>${usdt(summary.approvedBonusUsdt)} approved bonus</span></article>
        <article><small>Paid</small><b>${summary.paidUsdt===null?'Restricted':usdt(summary.paidUsdt)}</b><span>${summary.outstandingUsdt===null?'Finance permission required':`${usdt(summary.outstandingUsdt)} outstanding`}</span></article>
        <article><small>Control state</small><b>${fmt(summary.disputedCount)} disputed</b><span>${fmt(summary.driftCount)} evidence drift · ${fmt(summary.paidCount)} paid</span></article>
      </div>
      ${warning}
      <section class="campaign-settlement-section-r58"><header><div><span>APPROVED-ONLY PERFORMANCE</span><strong>Settlement roster</strong></div><small>Holding and Rejected posts never contribute reach or engagement; they affect quality state only.</small></header><div class="campaign-settlement-table-r58"><table><thead><tr><th>Talent</th><th>Delivery</th><th>Performance</th><th>Base plan</th><th>Bonus recommendation</th><th>Approved due</th><th>Payment</th><th></th></tr></thead><tbody>${(item.talent||[]).length?(item.talent||[]).map((entry)=>row(entry,permissions)).join(''):'<tr><td colspan="8">No active Creator/KOL assignments.</td></tr>'}</tbody></table></div></section>
      <section class="campaign-settlement-section-r58"><header><div><span>FINANCE EVIDENCE</span><strong>Payment history</strong></div><small>Payment records are evidence only after a finance-authorized user records an amount, date, method and reference.</small></header>${paymentHistory(item.talent||[],permissions)}</section>
      <footer class="campaign-settlement-foot-r58">Bonus formula: 55% reach achievement (capped at 150% overperformance) + 30% Approved engagement percentile + 15% approval-quality state. Recommendations are not payments.</footer>`;
    panel.querySelectorAll('[data-settlement-talent]').forEach((tr)=>{
      const entry=(item.talent||[]).find((candidate)=>String(candidate.id)===tr.dataset.settlementTalent);
      if(!entry)return;
      tr.querySelector('[data-approve]')?.addEventListener('click',()=>approve(entry));
      tr.querySelector('[data-dispute]')?.addEventListener('click',()=>dispute(entry));
      tr.querySelector('[data-payment]')?.addEventListener('click',()=>payment(entry));
    });
    panel.querySelectorAll('[data-void-payment]').forEach((button)=>{
      const paymentRow=(item.talent||[]).flatMap((entry)=>entry.payments||[]).find((entry)=>entry.id===button.dataset.voidPayment);
      if(paymentRow)button.addEventListener('click',()=>voidPayment(paymentRow));
    });
  }

  async function load(id,force=false){
    if(!id||loading||(!force&&loadedId===id))return;
    loading=true;activeId=id;shell();
    try{payload=await api(`/api/campaign-settlement/${encodeURIComponent(id)}`);loadedId=id;render();}
    catch(error){const panel=shell();if(panel)panel.innerHTML=`<div class="campaign-settlement-alert-r58"><strong>Settlement unavailable</strong><span>${esc(error.message)}</span></div>`;}
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
    if(selector&&!selector.dataset.r58Bound){selector.dataset.r58Bound='1';selector.addEventListener('change',()=>{loadedId='';load(selector.value,true);});}
    if(campaignsPage())resolveCampaign();
    else{loadedId='';activeId='';payload=null;}
  }
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(watch,80);});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',watch,{once:true});
  watch();
})();
