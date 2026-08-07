(() => {
  'use strict';
  if (window.__akariDeliveryPlanningCapacityR39) return;
  window.__akariDeliveryPlanningCapacityR39 = true;

  const clean = (value) => String(value || '').trim();
  const asDate = (value) => { const parsed = Date.parse(clean(value)); return Number.isFinite(parsed) ? new Date(parsed) : null; };
  const daysFromNow = (date) => date ? Math.ceil((date.getTime() - Date.now()) / 86400000) : null;

  function collectItems(workspace) {
    return [...workspace.querySelectorAll('.delivery-item-list article')].map((article) => {
      const copy = article.querySelector('.delivery-item-copy');
      const title = clean(copy?.querySelector('strong')?.textContent) || 'Delivery item';
      const meta = clean(copy?.querySelector('span')?.textContent);
      const status = clean(article.querySelector('.delivery-pill')?.textContent).toUpperCase();
      const owner = clean(meta.split('·')[0]) || 'Unassigned';
      const dueText = meta.match(/Due\s+(.+?)(?:\s+·|$)/i)?.[1] || '';
      const due = dueText && dueText !== '-' ? asDate(dueText) : null;
      return {
        title, owner, due, status,
        waiting:/(WAITING|REVIEW|APPROVAL|SUBMITTED)/.test(status),
        blocked:/(BLOCKED|DECLINED|DISPUTED)/.test(status),
        complete:/(COMPLETE|COMPLETED|DONE|APPROVED|PUBLISHED|PAID)/.test(status),
      };
    });
  }

  function capacity(items) {
    const byOwner = new Map();
    items.filter((item) => !item.complete).forEach((item) => {
      const current = byOwner.get(item.owner) || { owner:item.owner, active:0, overdue:0, blocked:0 };
      current.active += 1;
      if (item.due && item.due.getTime() < Date.now()) current.overdue += 1;
      if (item.blocked) current.blocked += 1;
      byOwner.set(item.owner,current);
    });
    return [...byOwner.values()].sort((a,b)=>(b.blocked*10+b.overdue*5+b.active)-(a.blocked*10+a.overdue*5+a.active));
  }

  function renderWorkspace() {
    const workspace = document.querySelector('.delivery-workspace:not([data-planning-r39])');
    const body = workspace?.querySelector('.delivery-workspace-body');
    if (!workspace || !body) return;
    const items = collectItems(workspace);
    const owners = capacity(items);
    const upcoming = items.filter((item)=>item.due&&!item.complete).sort((a,b)=>a.due-b.due).slice(0,6);
    const approvals = items.filter((item)=>item.waiting).length;
    const unassigned = items.filter((item)=>!item.complete&&item.owner.toLowerCase()==='unassigned').length;
    const overdue = items.filter((item)=>!item.complete&&item.due&&item.due.getTime()<Date.now()).length;
    const tone = (active) => active >= 8 ? 'high' : active >= 5 ? 'medium' : 'low';
    const panel = document.createElement('section');
    panel.className = 'delivery-planning-r39';
    panel.setAttribute('aria-label','Delivery planning and team capacity');
    panel.innerHTML = `<header><div><span>DELIVERY CONTROL</span><strong>Planning & team capacity</strong></div><div class="planning-alerts-r39"><b class="${overdue?'attention':''}">${overdue} overdue</b><b class="${approvals?'attention':''}">${approvals} approvals</b><b class="${unassigned?'attention':''}">${unassigned} unassigned</b></div></header><div class="planning-grid-r39"><section><div class="planning-section-head-r39"><strong>Team workload</strong><span>Open delivery items by owner</span></div><div class="capacity-list-r39">${owners.length ? owners.map((entry)=>`<article><div><strong>${entry.owner}</strong><span>${entry.overdue} overdue · ${entry.blocked} blocked</span></div><div class="capacity-meter-r39"><i class="${tone(entry.active)}" style="width:${Math.min(100,entry.active*12.5)}%"></i></div><b>${entry.active}</b></article>`).join('') : '<p class="planning-empty-r39">No active assigned work.</p>'}</div></section><section><div class="planning-section-head-r39"><strong>Delivery timeline</strong><span>Nearest active deadlines</span></div><div class="timeline-list-r39">${upcoming.length ? upcoming.map((item)=>{const days=daysFromNow(item.due);const status=days<0?`${Math.abs(days)}d overdue`:days===0?'Due today':`${days}d remaining`;return `<article class="${days<0?'overdue':days<=3?'soon':''}"><time>${item.due.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</time><div><strong>${item.title}</strong><span>${item.owner} · ${status}</span></div></article>`;}).join('') : '<p class="planning-empty-r39">No dated active work.</p>'}</div></section></div>`;
    const health = body.querySelector('.delivery-health-panel-r38');
    if (health) health.insertAdjacentElement('afterend',panel); else body.insertAdjacentElement('afterbegin',panel);
    workspace.dataset.planningR39 = 'ready';
  }

  let queued = false;
  const queue = () => { if (queued) return; queued = true; requestAnimationFrame(()=>{ queued=false; renderWorkspace(); }); };
  new MutationObserver((mutations)=>{
    if (mutations.some((mutation)=>[...mutation.addedNodes].some((node)=>node.nodeType===1&&(node.matches?.('.delivery-workspace')||node.querySelector?.('.delivery-workspace'))))) queue();
  }).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',(event)=>{ if(event.target.closest('[data-delivery-action]')) setTimeout(queue,0); },true);
  renderWorkspace();

  const assets = [
    ['link','delivery-governance-r40','/assets/delivery-approvals-dependencies-r40.css?v=1'],
    ['script','delivery-governance-r40','/assets/delivery-approvals-dependencies-r40.js?v=1'],
    ['link','delivery-closeout-r41','/assets/delivery-closeout-renewal-r41.css?v=1'],
    ['script','delivery-closeout-r41','/assets/delivery-closeout-renewal-r41.js?v=1'],
    ['link','campaign-tracking-r42','/assets/campaign-tracking-r42.css?v=1'],
    ['script','campaign-tracking-r42','/assets/campaign-tracking-r42.js?v=1'],
    ['link','campaign-creator-tracking-r43','/assets/campaign-creator-tracking-r43.css?v=1'],
    ['script','campaign-creator-tracking-r43','/assets/campaign-creator-tracking-r43.js?v=1'],
  ];
  assets.forEach(([type,key,url])=>{
    if (document.querySelector(`${type}[data-${key}]`)) return;
    const asset = document.createElement(type);
    if (type === 'link') { asset.rel='stylesheet'; asset.href=url; } else { asset.src=url; asset.defer=true; }
    asset.dataset[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())] = 'true';
    document.head.appendChild(asset);
  });
})();
