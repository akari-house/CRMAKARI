(() => {
  'use strict';
  if (window.__akariCampaignTalentRecommendationsR55) return;
  window.__akariCampaignTalentRecommendationsR55 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const money=(value)=>`$${fmt(value,2)}`;
  const pct=(value)=>`${fmt(value,1)}%`;
  const label=(value)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  let loading=false;
  let loaded=false;
  let state={ objective:'BALANCED', platform:'ALL', creatorType:'ALL', contentType:'ALL', region:'ALL', budgetUsd:0, limit:10 };
  let lastPayload=null;

  function campaignPage() {
    return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));
  }

  function shell() {
    const grid=document.querySelector('#view-root .grid-2');
    if (!campaignPage() || !grid) return null;
    let panel=document.querySelector('#view-root .campaign-talent-r55');
    if (!panel) {
      panel=document.createElement('section');
      panel.className='campaign-talent-r55';
      panel.innerHTML='<div class="campaign-talent-loading-r55">Loading Campaign Talent Intelligence…</div>';
      grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }

  function option(value,current) {
    const display=value==='ALL'?'All':label(value);
    return `<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(display)}</option>`;
  }

  function scoreTone(score) {
    if (score>=85) return 'top';
    if (score>=70) return 'reliable';
    if (score>=50) return 'attention';
    return 'under';
  }

  function reasons(item) {
    const positives=(item.recommendationReasons||[]).map((reason)=>`<li class="positive">✓ ${esc(reason)}</li>`).join('');
    const risks=(item.riskSignals||[]).map((risk)=>`<li class="risk">! ${esc(risk)}</li>`).join('');
    return `<details class="talent-why-r55"><summary>Why this rank</summary><ul>${positives||'<li>No strong positive signal recorded yet.</li>'}${risks}</ul></details>`;
  }

  function talentRow(item,index) {
    const evidence=item.platformEvidence || item.contentEvidence;
    const evidenceText=evidence ? `${fmt(evidence.posts)} Approved · ${fmt(evidence.reach)} reach · ${fmt(evidence.engagements)} eng.` : `${fmt(item.approvedPosts)} Approved · ${fmt(item.approvedReach)} lifetime reach`;
    const allocation=item.historicalAverageAllocation>0 ? money(item.historicalAverageAllocation) : 'No historical price signal';
    const workload=item.activeCampaigns===0 ? 'No active campaigns' : `${fmt(item.activeCampaigns)} active campaign${item.activeCampaigns===1?'':'s'}`;
    return `<tr>
      <td><span class="talent-position-r55">#${index+1}</span><strong>${esc(item.name)}</strong><small>${esc(item.handle||'No handle')} · ${esc(label(item.creatorType))} · ${(item.platforms||[]).map(label).join(', ')}</small></td>
      <td><b class="talent-score-r55 ${scoreTone(item.recommendationScore)}">${fmt(item.recommendationScore,1)}</b><span>Portfolio ${fmt(item.portfolioScore,1)}</span></td>
      <td><strong>${esc(evidenceText)}</strong><span>${pct(item.averageDeliveryCompletion)} delivery · ${pct(item.campaignReliability)} reliability</span></td>
      <td><strong>${item.approvedReach?money(item.lifetimeCpv):'—'} CPV</strong><span>${item.approvedEngagements?money(item.lifetimeCpe):'—'} CPE</span></td>
      <td><strong>${esc(workload)}</strong><span>${pct(item.rejectionRate)} rejected · ${pct(item.holdingRate)} Holding</span></td>
      <td><strong>${esc(allocation)}</strong><span>Historical avg tracked allocation / campaign</span></td>
      <td>${reasons(item)}</td>
    </tr>`;
  }

  function basket(data) {
    if (!(data?.budgetUsd>0)) return '';
    const items=data.items||[];
    return `<section class="talent-basket-r55"><header><div><span>BUDGET-FIT BASKET</span><strong>${money(data.budgetUsd)} planning budget</strong></div><div><b>${money(data.estimatedHistoricalAllocation)}</b><span>historical allocation fit</span></div></header>
      ${items.length ? `<div class="talent-basket-grid-r55">${items.map((item)=>`<article><strong>${esc(item.name)}</strong><span>${esc(item.handle||label(item.creatorType))}</span><b>${money(item.historicalAverageAllocation)}</b><small>Historical avg · score ${fmt(item.recommendationScore,1)}</small></article>`).join('')}</div>` : '<div class="talent-empty-r55">No ranked contributor with a recorded historical allocation fits inside this budget yet.</div>'}
      <footer>${esc(data.note||'')}</footer></section>`;
  }

  function partnerCards(items) {
    return `<section class="talent-partners-r55"><header><span>DELIVERY PARTNER MATCH</span><strong>Agencies aligned with the shortlist</strong></header>${items?.length ? `<div>${items.map((item)=>`<article><div><strong>${esc(item.partnerName)}</strong><span>${esc(label(item.partnerType||'Partner'))} · ${fmt(item.campaignCount)} campaigns</span></div><b>${fmt(item.recommendationScore,1)}</b><small>${fmt(item.matchedTalent)} shortlisted talent match${item.matchedTalent===1?'':'es'} · ${pct(item.campaignReliability)} reliability · ${fmt(item.approvedReach)} Approved reach</small></article>`).join('')}</div>` : '<div class="talent-empty-r55">No canonical delivery partner has enough matching history for this shortlist yet.</div>'}</section>`;
  }

  function insightList(title,items,kind) {
    const rows=(items||[]).map((item)=>{
      if (kind==='spend') return `<li><strong>${esc(item.name)}</strong><span>${money(item.trackedAllocationValue)} tracked allocation · ${fmt(item.approvedPosts)} Approved posts · ${pct(item.averageDeliveryCompletion)} delivery</span></li>`;
      if (kind==='used') return `<li><strong>${esc(item.name)}</strong><span>${fmt(item.campaignCount)} campaigns · ${fmt(item.approvedReach)} Approved reach · score ${fmt(item.portfolioScore,1)}</span></li>`;
      return `<li><strong>${esc(item.name)}</strong><span>${fmt(item.campaignCount)} campaigns · ${pct(item.campaignReliability)} reliability · ${fmt(item.approvedReach)} Approved reach</span></li>`;
    }).join('');
    return `<article><strong>${esc(title)}</strong>${rows?`<ul>${rows}</ul>`:'<span>No qualifying signal yet.</span>'}</article>`;
  }

  function render(data) {
    lastPayload=data;
    const panel=shell();
    if (!panel) return;
    const criteria=data.criteria||state;
    state={...state,...criteria};
    const facets=data.facets||{};
    const recs=data.recommendations||[];
    panel.innerHTML=`<header class="talent-head-r55"><div><span>CAMPAIGN TALENT SELECTION · R8.5E</span><strong>Recommendation intelligence</strong><small>Deterministic, read-only recommendations from AKARI campaign history. Approved performance only.</small></div><div><b>${fmt(data.eligibleCount)}</b><span>eligible contributors</span></div></header>
      <div class="talent-planner-r55">
        <label>Objective<select data-r55-field="objective">${(facets.objectives||['BALANCED','REACH','ENGAGEMENT','RELIABILITY']).map((v)=>option(v,state.objective)).join('')}</select></label>
        <label>Platform<select data-r55-field="platform">${(facets.platforms||['ALL']).map((v)=>option(v,state.platform)).join('')}</select></label>
        <label>Talent type<select data-r55-field="creatorType">${(facets.creatorTypes||['ALL','CREATOR','KOL']).map((v)=>option(v,state.creatorType)).join('')}</select></label>
        <label>Content type<select data-r55-field="contentType">${(facets.contentTypes||['ALL']).map((v)=>option(v,state.contentType)).join('')}</select></label>
        <label>Region<select data-r55-field="region">${(facets.regions||['ALL']).map((v)=>option(v,state.region)).join('')}</select></label>
        <label>Budget USD<input data-r55-field="budgetUsd" type="number" min="0" step="100" value="${esc(state.budgetUsd||'') }" placeholder="Optional"></label>
        <button type="button" data-r55-run>Generate shortlist</button>
      </div>
      <div class="talent-method-r55"><span>Objective: <b>${esc(label(state.objective))}</b></span><span>Platform: <b>${esc(label(state.platform))}</b></span><span>Type: <b>${esc(label(state.creatorType))}</b></span><span>Content: <b>${esc(label(state.contentType))}</b></span><span>Region: <b>${esc(label(state.region))}</b></span></div>
      <div class="talent-table-r55"><table><thead><tr><th>Recommended talent</th><th>Score</th><th>Approved evidence</th><th>Efficiency</th><th>Quality / workload</th><th>Budget signal</th><th>Decision notes</th></tr></thead><tbody>${recs.length?recs.map(talentRow).join(''):'<tr><td colspan="7"><div class="talent-empty-r55">No contributor matches the selected criteria. Broaden platform, content, region or talent type.</div></td></tr>'}</tbody></table></div>
      ${basket(data.basket)}
      ${partnerCards(data.partnerRecommendations||[])}
      <section class="talent-insights-r55">${insightList('Reliable but underused',data.insights?.underusedReliable,'underused')}${insightList('Spend without delivery',data.insights?.spendWithoutDelivery,'spend')}${insightList('Most frequently used',data.insights?.mostUsed,'used')}</section>
      <footer class="talent-footer-r55"><span>Recommendation scores are decision support, not automatic campaign assignments. Active-campaign counts are workload signals, not verified availability.</span><span>Budget fit uses historical tracked allocation averages only. It is not a quote, commitment, payment record or guaranteed future performance.</span></footer>`;

    panel.querySelector('[data-r55-run]')?.addEventListener('click',()=>{
      panel.querySelectorAll('[data-r55-field]').forEach((field)=>{ state[field.dataset.r55Field]=field.dataset.r55Field==='budgetUsd'?Number(field.value||0):field.value; });
      load(true);
    });
  }

  async function load(force=false) {
    const panel=shell();
    if (!panel || loading || (loaded&&!force)) return;
    loading=true;
    if (force) panel.classList.add('is-loading');
    try {
      const query=new URLSearchParams({
        objective:state.objective,
        platform:state.platform,
        creatorType:state.creatorType,
        contentType:state.contentType,
        region:state.region,
        budgetUsd:String(state.budgetUsd||0),
        limit:String(state.limit||10),
      });
      const response=await fetch(`/api/campaign-talent-recommendations?${query}`,{credentials:'same-origin',headers:{'content-type':'application/json'}});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error||'Talent recommendation request failed');
      render(payload.intelligence||{});
      loaded=true;
    } catch (error) {
      const mounted=shell();
      if (mounted) mounted.innerHTML=`<div class="talent-error-r55">${esc(error.message||'Campaign talent recommendations could not be loaded.')}</div>`;
      console.warn('[AKARI campaign talent recommendations]',error);
    } finally {
      loading=false;
      shell()?.classList.remove('is-loading');
    }
  }

  let queued=false;
  const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(!campaignPage())loaded=false;load();});};
  new MutationObserver(()=>queue()).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
  document.addEventListener('click',(event)=>{if(event.target.closest('[data-route],[data-action="new-campaign"]'))setTimeout(queue,0);},true);
  queue();
})();
