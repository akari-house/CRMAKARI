(() => {
  'use strict';
  if (window.__akariDeliveryPartnerPortfolioR53) return;
  window.__akariDeliveryPartnerPortfolioR53 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const money=(value)=>`$${fmt(value,2)}`;
  const pct=(value)=>`${fmt(value,1)}%`;
  const labels={TOP_PERFORMING:'Top Performing',RELIABLE:'Reliable',NEEDS_ATTENTION:'Needs Attention',UNDERPERFORMING:'Underperforming',INACTIVE:'Inactive'};
  const tones={TOP_PERFORMING:'top',RELIABLE:'reliable',NEEDS_ATTENTION:'attention',UNDERPERFORMING:'under',INACTIVE:'inactive'};
  let loading=false;

  function partnerPage() {
    return Boolean(document.querySelector('#view-root [data-action="new-partner"]'));
  }

  function shell() {
    const table=document.querySelector('#view-root .table-shell');
    if (!partnerPage() || !table) return null;
    let panel=document.querySelector('#view-root .partner-portfolio-r53');
    if (!panel) {
      panel=document.createElement('section');
      panel.className='partner-portfolio-r53';
      panel.innerHTML='<div class="partner-portfolio-loading-r53">Loading portfolio partner intelligence…</div>';
      table.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }

  function row(item) {
    const rank=labels[item.classification]||item.classification;
    const tone=tones[item.classification]||'inactive';
    const last=item.lastActiveDate ? new Date(`${item.lastActiveDate}T00:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'No campaign activity';
    return `<tr>
      <td><strong>${esc(item.partnerName)}</strong><span>${esc(item.partnerType||'Delivery partner')}</span></td>
      <td><b class="partner-rank-r53 ${tone}">${esc(rank)}</b><span>Score ${fmt(item.portfolioScore,1)}</span></td>
      <td><strong>${fmt(item.activeCampaigns)} active</strong><span>${fmt(item.completedCampaigns)} completed</span></td>
      <td><strong>${fmt(item.lifetimeContributors)}</strong><span>${fmt(item.creatorCount)} creators · ${fmt(item.kolCount)} KOLs</span></td>
      <td><strong>${pct(item.averageDeliveryCompletion)}</strong><span>${pct(item.campaignReliability)} reliable campaigns</span></td>
      <td><strong>${pct(item.averageReachTargetAchievement)}</strong><span>${fmt(item.approvedPosts)} Approved posts</span></td>
      <td><strong>${fmt(item.approvedReach)}</strong><span>${fmt(item.approvedEngagements)} engagements</span></td>
      <td><strong>${money(item.totalCampaignCost)}</strong><span>Cash ${money(item.totalCashSpend)} · token est. ${money(item.totalEstimatedTokenCost)}</span></td>
      <td><strong>${money(item.lifetimeCpv)}</strong><span>CPE ${money(item.lifetimeCpe)}</span></td>
      <td><strong>${pct(item.rejectionRate)} rejected</strong><span>${pct(item.holdingRate)} holding</span></td>
      <td><strong>${esc(last)}</strong><span>Sorsa ${fmt(item.averageSorsaScore,1)} · XScore ${fmt(item.averageXScore,1)}</span></td>
    </tr>`;
  }

  function render(portfolio) {
    const panel=shell();
    if (!panel) return;
    const items=portfolio.items||[];
    panel.innerHTML=`<header><div><span>PORTFOLIO PARTNER INTELLIGENCE</span><strong>Delivery partner portfolio</strong><small>Tenant-wide, read-only analytics across every campaign. Performance uses Approved creator/KOL posts only.</small></div><div><b>${fmt(portfolio.partnersWithCampaignHistory)}</b><span>partners with campaign history</span></div></header>
      <div class="partner-portfolio-kpis-r53">
        <article><small>Active partners</small><b>${fmt(portfolio.activePartners)}</b></article>
        <article><small>Approved posts</small><b>${fmt(portfolio.totalApprovedPosts)}</b></article>
        <article><small>Approved tracked reach</small><b>${fmt(portfolio.totalApprovedReach)}</b><span>Non-deduplicated</span></article>
        <article><small>Total tracked cost</small><b>${money(portfolio.totalCampaignCost)}</b></article>
        <article><small>Needs attention</small><b>${fmt(portfolio.needsAttention)}</b></article>
      </div>
      ${portfolio.legacyUnmappedAssignments ? `<div class="partner-portfolio-warning-r53">${fmt(portfolio.legacyUnmappedAssignments)} legacy creator/KOL assignment(s) across ${fmt(portfolio.legacyUnmappedCampaigns)} campaign(s) are still free-text and are excluded from named-partner portfolio rankings until mapped.</div>` : ''}
      <div class="partner-portfolio-table-r53"><table><thead><tr><th>Partner</th><th>Rank</th><th>Campaigns</th><th>Contributors</th><th>Delivery</th><th>Reach target</th><th>Approved reach</th><th>Tracked cost</th><th>CPV</th><th>Quality</th><th>Last active</th></tr></thead><tbody>
        ${items.length ? items.map(row).join('') : '<tr><td colspan="11"><div class="partner-portfolio-empty-r53">No reusable delivery partners are available yet.</div></td></tr>'}
      </tbody></table></div>
      <footer><span>Ranking: Top Performing ≥85 with 2+ campaigns · Reliable ≥70 · Needs Attention ≥50 · Underperforming &lt;50 · Inactive = no history or 180+ days without an active campaign.</span><span>Token allocation can span different campaign assets; estimated token cost uses each campaign’s tracked token price.</span></footer>`;
  }

  async function load() {
    const panel=shell();
    if (!panel || loading || panel.dataset.loaded==='true') return;
    loading=true;
    try {
      const response=await fetch('/api/delivery-partner-intelligence',{credentials:'same-origin',headers:{'content-type':'application/json'}});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error||'Portfolio partner intelligence request failed');
      render(payload.portfolio||{});
      const mounted=shell(); if (mounted) mounted.dataset.loaded='true';
    } catch (error) {
      const mounted=shell();
      if (mounted) mounted.innerHTML=`<div class="partner-portfolio-error-r53">${esc(error.message||'Portfolio partner intelligence could not be loaded.')}</div>`;
      console.warn('[AKARI portfolio partner intelligence]',error);
    } finally { loading=false; }
  }

  let queued=false;
  const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;load();});};
  new MutationObserver(()=>queue()).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
  document.addEventListener('click',(event)=>{if(event.target.closest('[data-route],[data-action="new-partner"]'))setTimeout(queue,0);},true);
  queue();
})();
