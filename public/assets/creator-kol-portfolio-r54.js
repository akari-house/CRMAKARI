(() => {
  'use strict';
  if (window.__akariCreatorKolPortfolioR54) return;
  window.__akariCreatorKolPortfolioR54 = true;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt=(value,digits=0)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:digits});
  const money=(value)=>`$${fmt(value,2)}`;
  const pct=(value)=>`${fmt(value,1)}%`;
  const label=(value)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());
  const labels={TOP_PERFORMING:'Top Performing',RELIABLE:'Reliable',NEEDS_ATTENTION:'Needs Attention',UNDERPERFORMING:'Underperforming',INACTIVE:'Inactive'};
  const tones={TOP_PERFORMING:'top',RELIABLE:'reliable',NEEDS_ATTENTION:'attention',UNDERPERFORMING:'under',INACTIVE:'inactive'};
  let loading=false;
  let activeFilter='ALL';
  let searchTerm='';

  function campaignPage() {
    return Boolean(document.querySelector('#view-root [data-action="new-campaign"]'));
  }

  function shell() {
    const grid=document.querySelector('#view-root .grid-2');
    if (!campaignPage() || !grid) return null;
    let panel=document.querySelector('#view-root .creator-kol-portfolio-r54');
    if (!panel) {
      panel=document.createElement('section');
      panel.className='creator-kol-portfolio-r54';
      panel.innerHTML='<div class="creator-kol-loading-r54">Loading Creator / KOL portfolio intelligence…</div>';
      grid.insertAdjacentElement('beforebegin',panel);
    }
    return panel;
  }

  function dateLabel(value) {
    if (!value) return 'No activity';
    const parsed=new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? esc(value) : parsed.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  }

  function history(item) {
    return `<details class="creator-history-r54"><summary>${fmt(item.history?.length)} record${item.history?.length===1?'':'s'}</summary><div class="creator-history-list-r54">${(item.history||[]).map((entry)=>`<article>
      <header><div><strong>${esc(entry.campaignName||'Campaign')}</strong><span>${esc(entry.projectName||'Project')} · ${esc(label(entry.campaignStatus||''))}</span></div><b>${esc(entry.startDate||'—')}</b></header>
      <div><span>${esc(label(entry.creatorType))} · ${esc(label(entry.platform))}</span><span>${esc(entry.agencyName||'Direct / Unassigned')}</span></div>
      <div><span>${fmt(entry.approvedPosts)}/${fmt(entry.expectedPosts)} Approved posts</span><span>${fmt(entry.approvedReach)} / ${fmt(entry.expectedReach)} reach</span></div>
      <div><span>${pct(entry.deliveryCompletion)} delivery</span><span>${pct(entry.reachCompletion)} reach target</span></div>
      <div><span>Sorsa ${fmt(entry.sorsaScore,1)} · XScore ${fmt(entry.xScore,1)}</span><span>${money(entry.trackedAllocationValue)} tracked allocation</span></div>
      <small>${fmt(entry.holdingPosts)} Holding · ${fmt(entry.rejectedPosts)} Rejected · last post ${esc(entry.lastPostDate||'—')}</small>
    </article>`).join('')}</div></details>`;
  }

  function row(item) {
    const rank=labels[item.classification]||label(item.classification);
    const tone=tones[item.classification]||'inactive';
    const bestPlatform=item.bestPlatform ? `${label(item.bestPlatform.name)} · ${fmt(item.bestPlatform.reach)} reach` : 'No Approved performance';
    const bestContent=item.bestContentType ? `${item.bestContentType.name} · ${fmt(item.bestContentType.reach)} reach` : 'No content signal';
    const profile=item.profileUrl ? `<a href="${esc(item.profileUrl)}" target="_blank" rel="noopener">Open profile</a>` : '';
    const search=[item.name,item.handle,item.creatorType,...(item.platforms||[]),...(item.agencies||[])].join(' ').toLowerCase();
    return `<tr data-creator-type="${esc(item.creatorType)}" data-state="${esc(item.contributorState)}" data-classification="${esc(item.classification)}" data-search="${esc(search)}">
      <td><strong>${esc(item.name)}</strong><span>${esc(item.handle||'No handle')} · ${esc(label(item.creatorType))}</span><small>${esc((item.platforms||[]).map(label).join(', ')||'Platform not set')} · identity ${esc(item.identityConfidence.toLowerCase())}</small>${profile}</td>
      <td><b class="creator-rank-r54 ${tone}">${esc(rank)}</b><span>${esc(label(item.contributorState))} · score ${fmt(item.portfolioScore,1)}</span></td>
      <td><strong>${fmt(item.activeCampaigns)} active</strong><span>${fmt(item.completedCampaigns)} completed · ${fmt(item.campaignCount)} total</span></td>
      <td><strong>${pct(item.averageDeliveryCompletion)}</strong><span>${pct(item.campaignReliability)} reliable campaigns</span></td>
      <td><strong>${fmt(item.approvedReach)} reach</strong><span>${fmt(item.approvedPosts)} Approved posts · ${fmt(item.approvedEngagements)} engagements</span></td>
      <td><strong>${money(item.trackedAllocationValue)}</strong><span>${money(item.cashAllocation)} cash · ${money(item.estimatedTokenValue)} est. token value</span></td>
      <td><strong>${item.approvedReach?money(item.lifetimeCpv):'—'} CPV</strong><span>${item.approvedEngagements?money(item.lifetimeCpe):'—'} CPE</span></td>
      <td><strong>Sorsa ${fmt(item.latestSorsaScore,1)}</strong><span>XScore ${fmt(item.latestXScore,1)} · avg ${fmt(item.averageSorsaScore,1)} / ${fmt(item.averageXScore,1)}</span></td>
      <td><strong>${esc(bestPlatform)}</strong><span>${esc(bestContent)}</span></td>
      <td><strong>${esc((item.agencies||[]).join(', ')||'Direct / Unassigned')}</strong><span>${pct(item.rejectionRate)} rejected · ${pct(item.holdingRate)} Holding</span></td>
      <td><strong>${esc(dateLabel(item.lastActiveDate))}</strong><span>${esc(item.firstActiveDate?`Since ${dateLabel(item.firstActiveDate)}`:'No first activity')}</span></td>
      <td>${history(item)}</td>
    </tr>`;
  }

  function applyFilters() {
    const panel=shell();
    if (!panel) return;
    panel.querySelectorAll('[data-portfolio-filter]').forEach((button)=>button.classList.toggle('active',button.dataset.portfolioFilter===activeFilter));
    panel.querySelectorAll('tbody tr[data-creator-type]').forEach((row)=>{
      const type=row.dataset.creatorType;
      const state=row.dataset.state;
      const classification=row.dataset.classification;
      const matchesFilter=activeFilter==='ALL' ||
        (activeFilter==='CREATOR' && ['CREATOR','MIXED'].includes(type)) ||
        (activeFilter==='KOL' && ['KOL','MIXED'].includes(type)) ||
        (activeFilter==='ACTIVE' && state==='ACTIVE') ||
        (activeFilter==='ATTENTION' && ['NEEDS_ATTENTION','UNDERPERFORMING'].includes(classification));
      const matchesSearch=!searchTerm || String(row.dataset.search||'').includes(searchTerm);
      row.hidden=!(matchesFilter&&matchesSearch);
    });
  }

  function render(portfolio) {
    const panel=shell();
    if (!panel) return;
    const items=portfolio.items||[];
    panel.innerHTML=`<header><div><span>CREATOR / KOL PORTFOLIO INTELLIGENCE</span><strong>Cross-campaign contributor performance</strong><small>Read-only analytics grouped from existing campaign assignments. Approved posts only count toward performance.</small></div><div><b>${fmt(portfolio.contributorCount)}</b><span>grouped contributors</span></div></header>
      <div class="creator-kol-kpis-r54">
        <article><small>Active contributors</small><b>${fmt(portfolio.activeContributors)}</b><span>${fmt(portfolio.creators)} creators · ${fmt(portfolio.kols)} KOLs</span></article>
        <article><small>Approved posts</small><b>${fmt(portfolio.totalApprovedPosts)}</b></article>
        <article><small>Approved tracked reach</small><b>${fmt(portfolio.totalApprovedReach)}</b><span>Non-deduplicated</span></article>
        <article><small>Tracked allocation value</small><b>${money(portfolio.totalTrackedAllocationValue)}</b></article>
        <article><small>Needs attention</small><b>${fmt(portfolio.needsAttention)}</b></article>
      </div>
      ${portfolio.lowConfidenceIdentities ? `<div class="creator-kol-warning-r54">${fmt(portfolio.lowConfidenceIdentities)} contributor identit${portfolio.lowConfidenceIdentities===1?'y is':'ies are'} grouped from name-only or assignment-only data. Add stable profile URLs/handles in campaign tracking to improve cross-campaign identity confidence.</div>` : ''}
      <div class="creator-kol-controls-r54"><div>${[['ALL','All'],['CREATOR','Creators'],['KOL','KOLs'],['ACTIVE','Active'],['ATTENTION','Needs attention']].map(([value,text])=>`<button data-portfolio-filter="${value}">${text}</button>`).join('')}</div><label>Search<input type="search" data-creator-search placeholder="Name, handle, agency or platform"></label></div>
      <div class="creator-kol-table-r54"><table><thead><tr><th>Creator / KOL</th><th>Rank</th><th>Campaigns</th><th>Delivery</th><th>Approved performance</th><th>Tracked allocation</th><th>Efficiency</th><th>Scores</th><th>Best fit</th><th>Agencies / quality</th><th>Last active</th><th>History</th></tr></thead><tbody>
        ${items.length?items.map(row).join(''):'<tr><td colspan="12"><div class="creator-kol-empty-r54">No Creator / KOL campaign assignments are available yet.</div></td></tr>'}
      </tbody></table></div>
      <footer><span>Ranking: Top Performing ≥85 with 2+ campaigns · Reliable ≥70 · Needs Attention ≥50 · Underperforming &lt;50 · Inactive = 180+ days without an active campaign.</span><span>Tracked allocation is not proof of payment. Token value uses each campaign’s tracked token price; raw token units can represent different assets and are not summed for comparison.</span></footer>`;
    panel.querySelectorAll('[data-portfolio-filter]').forEach((button)=>button.addEventListener('click',()=>{activeFilter=button.dataset.portfolioFilter;applyFilters();}));
    panel.querySelector('[data-creator-search]')?.addEventListener('input',(event)=>{searchTerm=String(event.target.value||'').trim().toLowerCase();applyFilters();});
    applyFilters();
  }

  async function load() {
    const panel=shell();
    if (!panel || loading || panel.dataset.loaded==='true') return;
    loading=true;
    try {
      const response=await fetch('/api/creator-kol-intelligence',{credentials:'same-origin',headers:{'content-type':'application/json'}});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(payload.error||'Creator / KOL portfolio intelligence request failed');
      render(payload.portfolio||{});
      const mounted=shell();
      if (mounted) mounted.dataset.loaded='true';
    } catch (error) {
      const mounted=shell();
      if (mounted) mounted.innerHTML=`<div class="creator-kol-error-r54">${esc(error.message||'Creator / KOL portfolio intelligence could not be loaded.')}</div>`;
      console.warn('[AKARI Creator / KOL portfolio intelligence]',error);
    } finally { loading=false; }
  }

  let queued=false;
  const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;load();});};
  new MutationObserver(()=>queue()).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
  document.addEventListener('click',(event)=>{if(event.target.closest('[data-route],[data-action="new-campaign"]'))setTimeout(queue,0);},true);
  queue();
})();
