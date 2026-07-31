(() => {
  const ROUTES = {
    dashboard: 'Home', day: 'My Day', leads: 'AKARI Leads', contacts: 'Contacts',
    opportunities: 'Opportunities', fundraising: 'Fundraising', campaigns: 'Campaigns',
    partners: 'Partners', finance: 'Finance', reports: 'Reports', team: 'Team', settings: 'Settings'
  };
  const state = { me: null, route: 'dashboard', projects: [], tasks: [], opportunities: [], campaigns: [], contacts: [], partners: [], payments: [] };
  const $ = (s, r=document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money = (v, c='USD') => new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:0}).format(Number(v||0));
  const title = (v) => String(v||'').toLowerCase().split('_').map(x=>x?x[0].toUpperCase()+x.slice(1):'').join(' ');
  const initials = (v) => String(v||'AK').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
  const date = (v) => { if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(d); };
  const api = async (path, options={}) => {
    const res = await fetch(path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  const toast = (msg, type='success') => {
    const root=$('#toast-root'); if(!root) return;
    const n=document.createElement('div'); n.className=`toast ${type}`; n.textContent=msg; root.appendChild(n); setTimeout(()=>n.remove(),2600);
  };
  const modal = (html) => {
    const root=$('#modal-root'); if(!root) return;
    root.innerHTML=`<div class="modal-backdrop" data-v8-close><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">${html}</div></div>`;
  };
  const closeModal = () => { const r=$('#modal-root'); if(r) r.innerHTML=''; };

  function activateNav(route){
    document.querySelectorAll('[data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
    const crumb=$('.breadcrumb strong'); if(crumb) crumb.textContent=ROUTES[route]||route;
  }
  function route(){ return (location.hash.replace(/^#\/?/,'').split('?')[0] || 'dashboard'); }
  async function go(next){ state.route=ROUTES[next]?next:'dashboard'; if(location.hash!==`#/${state.route}`) history.pushState(null,'',`#/${state.route}`); activateNav(state.route); await render(); }
  const root = () => $('#view-root');
  const head = (eyebrow,h1,p,actions='') => `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(h1)}</h1><p>${esc(p)}</p></div><div class="head-actions">${actions}</div></div>`;
  const empty = (h,p) => `<div class="empty-state"><div><strong>${esc(h)}</strong><span>${esc(p)}</span></div></div>`;
  const pill = (v,t='') => `<span class="pill ${t}">${esc(title(v||'—'))}</span>`;

  async function renderDashboard(){
    const d=await api('/api/dashboard'); const m=d.metrics||{};
    root().innerHTML=head('AKARI HOUSE','Business overview','Performance, pipeline and actions that need attention.')+`
      <div class="kpi-grid">
        ${[['Monthly Target',m.monthlyTarget,'yellow'],['Revenue Booked',m.revenueBooked,''],['Collected',m.revenueCollected,'green'],['AKARI Net Revenue',m.netRevenue,''],['Weighted Pipeline',m.weightedPipeline,'yellow']].map(([l,v,t])=>`<button class="kpi ${t}" data-v8-route="${l==='Weighted Pipeline'?'opportunities':'finance'}"><span class="kpi-accent"></span><span class="kpi-label">${l}</span><strong class="kpi-value finance-value">${v===undefined?'Restricted':money(v,d.currency||'USD')}</strong><span class="kpi-meta">Open related records</span></button>`).join('')}
      </div>
      <div class="mini-grid">
        ${[['Year-to-date revenue',m.yearToDateRevenue,true],['Active customers',m.activeCustomers,false],['Active campaigns',m.activeCampaigns,false],['Active partners',m.activePartners,false],['Outstanding payments',m.outstandingPayments,true],['Referral rewards due',m.referralRewardsDue,true]].map(([l,v,f])=>`<button class="mini-kpi" data-v8-route="${f?'finance':'leads'}"><span>${l}</span><strong class="${f?'finance-value':''}">${v===undefined?'Restricted':f?money(v,d.currency||'USD'):Number(v||0)}</strong></button>`).join('')}
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><div class="panel-title"><strong>My tasks today</strong><span>Open work assigned to you</span></div><button class="btn small" data-v8-route="day">Open My Day</button></div><div class="panel-body" id="v8-dashboard-tasks">Loading…</div></section>
        <section class="panel"><div class="panel-head"><div class="panel-title"><strong>AKARI Leads</strong><span>Tenant-scoped project database</span></div><button class="btn small primary" data-v8-action="new-lead">New lead</button></div><div class="panel-body" id="v8-dashboard-leads">Loading…</div></section>
      </div>`;
    const [tasks,projects]=await Promise.all([api('/api/tasks?scope=mine'),api('/api/projects?limit=5')]);
    $('#v8-dashboard-tasks').innerHTML=(tasks.items||[]).length?(tasks.items||[]).slice(0,5).map(taskRow).join(''):empty('No open tasks','Create a task to start your daily queue.');
    $('#v8-dashboard-leads').innerHTML=(projects.items||[]).length?(projects.items||[]).slice(0,5).map(projectRow).join(''):empty('No AKARI leads yet','Import the approved workbook or create a lead manually.');
  }

  function taskRow(t){ return `<div class="task-item"><div class="task-top"><button class="task-check" data-v8-task="${esc(t.id)}">✓</button><div class="task-copy"><strong>${esc(t.title)}</strong><span>${esc(t.project_name||t.description||'AKARI House')}</span></div><div class="task-right">${esc(date(t.due_at))}</div></div></div>`; }
  function projectRow(p){ return `<button class="record-row" data-v8-project="${esc(p.id)}"><span class="record-avatar">${initials(p.name)}</span><span class="record-main"><strong>${esc(p.name)}</strong><small>${esc(p.category||'Uncategorised')}</small></span><span>${pill(p.lifecycle_status,p.lifecycle_status==='CLIENT'?'green':'pink')}</span></button>`; }

  async function renderDay(){
    const data=await api('/api/tasks?scope=mine'); state.tasks=data.items||[];
    root().innerHTML=head('MY WORKSPACE','My Day',`${state.tasks.length} open tasks`,`<button class="btn primary" data-v8-action="new-task">＋ Add task</button>`)+`<section class="panel"><div class="panel-head"><div class="panel-title"><strong>Priority queue</strong><span>Click the checkbox to complete a task</span></div></div><div class="panel-body task-list">${state.tasks.length?state.tasks.map(taskRow).join(''):empty('No open tasks','Your task queue is clear.')}</div></section>`;
  }

  async function renderLeads(){
    const q=new URLSearchParams(location.hash.split('?')[1]||''); const search=q.get('search')||'';
    const data=await api(`/api/projects?limit=100${search?`&search=${encodeURIComponent(search)}`:''}`); state.projects=data.items||[];
    root().innerHTML=head(`${data.total||state.projects.length} RECORDS`,'AKARI Leads','Search, review, create and import AKARI House leads.',`<button class="btn" data-v8-action="import">Import workbook</button><button class="btn primary" data-v8-action="new-lead">＋ New lead</button>`)+`
      <div class="table-tools"><input class="table-search" id="v8-lead-search" placeholder="Search leads…" value="${esc(search)}"/><button class="btn" data-v8-action="search-leads">Search</button></div>
      <div class="table-wrap"><table><thead><tr><th>Project</th><th>Lifecycle</th><th>Priority</th><th>Owner</th><th>Contact</th><th>Pipeline</th><th>Follow-up</th><th>Source</th></tr></thead><tbody>${state.projects.length?state.projects.map(p=>`<tr data-v8-project="${esc(p.id)}"><td><div class="project-cell"><span class="project-logo">${initials(p.name)}</span><span class="project-name"><strong>${esc(p.name)}</strong><small>${esc(p.category||'Uncategorised')}</small></span></div></td><td>${pill(p.lifecycle_status,p.lifecycle_status==='CLIENT'?'green':'pink')}</td><td>${pill(p.priority,p.priority==='HIGH'?'yellow':'')}</td><td>${esc(p.owner||'Unassigned')}</td><td>${esc(p.primary_contact||'—')}</td><td class="finance-value">${money(p.pipeline_value||0)}</td><td>${esc(date(p.next_follow_up_at))}</td><td>${esc(p.source_name||'—')}</td></tr>`).join(''):`<tr><td colspan="8">${empty('No leads found','Import or create the first AKARI lead.')}</td></tr>`}</tbody></table></div>`;
  }

  async function renderContacts(){ const d=await api('/api/contacts'); state.contacts=d.items||[]; root().innerHTML=head('RELATIONSHIPS','Contacts','People connected to AKARI leads.',`<button class="btn primary" data-v8-action="new-contact">＋ New contact</button>`)+`<section class="panel"><div class="panel-body">${state.contacts.length?state.contacts.map(c=>`<div class="record-row"><span class="record-avatar">${initials(c.full_name)}</span><span class="record-main"><strong>${esc(c.full_name)}</strong><small>${esc(c.project_name||c.job_title||'')}</small></span><span>${esc(c.telegram||c.email||'—')}</span></div>`).join(''):empty('No contacts yet','Contacts will appear after lead import or manual creation.')}</div></section>`; }
  async function renderOpportunities(){ const d=await api('/api/opportunities'); state.opportunities=d.items||[]; const stages=['CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION']; root().innerHTML=head(`${state.opportunities.length} OPPORTUNITIES`,'Opportunity Pipeline','Progress deals with clear ownership and next actions.',`<button class="btn primary" data-v8-action="new-opportunity">＋ New opportunity</button>`)+`<div class="kanban">${stages.map(s=>{const items=state.opportunities.filter(o=>o.stage===s);return `<section class="kanban-col"><div class="kanban-head"><div><strong>${title(s)}</strong><span>${items.length} opportunities</span></div><span class="kanban-total">${items.length}</span></div>${items.length?items.map(o=>`<button class="deal-card" data-v8-project="${esc(o.project_id)}"><strong>${esc(o.project_name||'Project')}</strong><span class="deal-title">${esc(o.name)}</span><span class="deal-data"><b class="finance-value">${money(o.estimated_value||0,o.currency||'USD')}</b><b>${Number(o.probability_percentage||0)}%</b></span><span class="deal-foot"><span>${esc(o.owner_name||'Unassigned')}</span><span>${esc(o.next_action||'No next action')}</span></span></button>`).join(''):empty('Empty stage','No opportunities here.')}</section>`}).join('')}</div>`; }
  async function renderCampaigns(){ const d=await api('/api/campaigns'); state.campaigns=d.items||[]; root().innerHTML=head('DELIVERY','Campaigns','Manage confirmed client work and delivery status.',`<button class="btn primary" data-v8-action="new-campaign">＋ New campaign</button>`)+`<div class="card-grid">${state.campaigns.length?state.campaigns.map(c=>`<article class="campaign-card"><div class="campaign-head"><strong>${esc(c.name)}</strong>${pill(c.status,'pink')}</div><p>${esc(c.project_name||'')}</p><div class="campaign-metrics"><span>Revenue <b class="finance-value">${money(c.gross_revenue||0,c.currency||'USD')}</b></span><span>Received <b class="finance-value">${money(c.amount_received||0,c.currency||'USD')}</b></span></div></article>`).join(''):empty('No campaigns yet','Create a campaign after an opportunity is won.')}</div>`; }
  async function renderPartners(){ const d=await api('/api/partners'); state.partners=d.items||[]; root().innerHTML=head('VALUE ATTRIBUTION','Partners','Referral and strategic partner relationships.',`<button class="btn primary" data-v8-action="new-partner">＋ New partner</button>`)+`<section class="panel"><div class="panel-body">${state.partners.length?state.partners.map(p=>`<div class="record-row"><span class="record-avatar">${initials(p.name)}</span><span class="record-main"><strong>${esc(p.name)}</strong><small>${esc(title(p.partner_type))}</small></span><span>${p.default_referral_percentage||0}%</span></div>`).join(''):empty('No partners yet','Create partner records and referral terms.')}</div></section>`; }
  async function renderFinance(){ const d=await api('/api/payments'); state.payments=d.items||[]; root().innerHTML=head('COMMERCIAL','Finance','Payments, outstanding balances and collection status.',`<button class="btn primary" data-v8-action="new-payment">＋ New payment</button>`)+`<section class="panel"><div class="panel-body">${state.payments.length?state.payments.map(p=>`<div class="record-row"><span class="record-main"><strong>${esc(p.project_name||p.invoice_reference||'Payment')}</strong><small>${esc(title(p.status))} · Due ${esc(date(p.due_date))}</small></span><strong class="finance-value">${money(p.amount||0,p.currency||'USD')}</strong></div>`).join(''):empty('No payments yet','Add payment records after campaigns are confirmed.')}</div></section>`; }
  async function renderReports(){ const d=await api('/api/reports'); root().innerHTML=head('INTELLIGENCE','Reports','Pipeline and revenue source records.')+`<div class="grid-2"><section class="panel"><div class="panel-head"><div class="panel-title"><strong>Pipeline by stage</strong></div></div><div class="panel-body">${(d.pipelineByStage||[]).length?(d.pipelineByStage||[]).map(x=>`<div class="record-row"><span class="record-main"><strong>${esc(title(x.stage))}</strong><small>${Number(x.opportunity_count||0)} opportunities</small></span><strong class="finance-value">${money(x.pipeline_value||0)}</strong></div>`).join(''):empty('No pipeline data','Opportunity reports will populate automatically.')}</div></section><section class="panel"><div class="panel-head"><div class="panel-title"><strong>Revenue by month</strong></div></div><div class="panel-body">${(d.revenueByMonth||[]).length?(d.revenueByMonth||[]).map(x=>`<div class="record-row"><span>${esc(x.month)}</span><strong class="finance-value">${money(x.collected||0)}</strong></div>`).join(''):empty('No revenue data','Revenue reports will populate from paid records.')}</div></section></div>`; }
  function renderSimple(name,subtitle){ root().innerHTML=head('AKARI CRM',name,subtitle)+`<section class="panel"><div class="panel-body">${empty(`${name} workspace is ready`, 'This module is connected to the same tenant and permission system. Detailed workflow is the next implementation layer.')}</div></section>`; }

  async function render(){
    root().innerHTML='<div class="empty-state"><div><strong>Loading workspace…</strong><span>Fetching live AKARI House data.</span></div></div>';
    try{
      if(state.route==='dashboard') await renderDashboard(); else if(state.route==='day') await renderDay(); else if(state.route==='leads') await renderLeads(); else if(state.route==='contacts') await renderContacts(); else if(state.route==='opportunities') await renderOpportunities(); else if(state.route==='campaigns') await renderCampaigns(); else if(state.route==='partners') await renderPartners(); else if(state.route==='finance') await renderFinance(); else if(state.route==='reports') await renderReports(); else renderSimple(ROUTES[state.route], state.route==='fundraising'?'Founder capital room, mandates, investors and closings.':'Tenant administration and configuration.');
    }catch(e){ root().innerHTML=head('WORKSPACE ERROR',ROUTES[state.route]||'CRM','The view could not be loaded.')+`<section class="panel"><div class="panel-body">${empty('Unable to load this view',e.message||'Unknown error')}</div></section>`; toast(e.message||'View failed','error'); }
  }

  async function openProject(id){
    const p=await api(`/api/projects/${encodeURIComponent(id)}`);
    modal(`<div class="modal-head"><div><div class="eyebrow">AKARI LEAD</div><h2>${esc(p.name)}</h2><p>${esc(title(p.lifecycle_status||'LEAD'))} · ${esc(p.category||'Uncategorised')}</p></div><button class="icon-btn" data-v8-close>×</button></div><div class="modal-body"><div class="property-grid"><div class="property"><span>Website</span><strong>${esc(p.website||'—')}</strong></div><div class="property"><span>Telegram</span><strong>${esc(p.telegram||'—')}</strong></div><div class="property"><span>Next follow-up</span><strong>${esc(date(p.next_follow_up_at))}</strong></div><div class="property"><span>Source</span><strong>${esc(p.source_name||'—')}</strong></div></div><div class="form-actions"><button class="btn" data-v8-action="new-task" data-project="${esc(p.id)}">Add task</button><button class="btn" data-v8-action="new-opportunity" data-project="${esc(p.id)}">Create opportunity</button><button class="btn primary" data-v8-action="new-activity" data-project="${esc(p.id)}">Record activity</button></div></div>`);
  }

  function form(titleText, fields, submitText, onSubmit){
    modal(`<form id="v8-form"><div class="modal-head"><div><div class="eyebrow">AKARI CRM</div><h2>${esc(titleText)}</h2></div><button type="button" class="icon-btn" data-v8-close>×</button></div><div class="modal-body"><div class="form-grid">${fields}</div><div class="form-actions"><button type="button" class="btn" data-v8-close>Cancel</button><button class="btn primary" type="submit">${esc(submitText)}</button></div></div></form>`);
    $('#v8-form').addEventListener('submit',async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.currentTarget));try{await onSubmit(fd);closeModal();toast(`${titleText} saved`);await render();}catch(err){toast(err.message||'Save failed','error');}});
  }
  const input=(name,label,type='text',required=false,extra='')=>`<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" ${required?'required':''} ${extra}/></label>`;
  function newLead(){ form('New AKARI Lead',input('name','Project name','text',true)+input('website','Website')+input('category','Category')+input('telegram','Telegram')+input('sourceName','Source')+`<label class="field"><span>Priority</span><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></label>`, 'Create lead', fd=>api('/api/projects',{method:'POST',body:JSON.stringify(fd)})); }
  function newTask(projectId=''){ form('New Task',input('title','Task title','text',true)+input('dueAt','Due date','datetime-local')+`<input type="hidden" name="projectId" value="${esc(projectId)}"/><label class="field"><span>Priority</span><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></label>`, 'Create task', fd=>api('/api/tasks',{method:'POST',body:JSON.stringify(fd)})); }
  function newOpportunity(projectId=''){ form('New Opportunity',input('projectId','Project ID','text',true,`value="${esc(projectId)}"`)+input('name','Opportunity name','text',true)+input('estimatedValue','Estimated value','number')+input('expectedCloseDate','Expected close date','date')+`<label class="field"><span>Stage</span><select name="stage"><option>NEW</option><option>CONTACTED</option><option>DISCOVERY</option><option>QUALIFIED</option><option>PROPOSAL</option></select></label>`, 'Create opportunity', fd=>api('/api/opportunities',{method:'POST',body:JSON.stringify(fd)})); }
  function newActivity(projectId=''){ form('Record Activity',`<input type="hidden" name="projectId" value="${esc(projectId)}"/>`+input('subject','Subject','text',true)+`<label class="field"><span>Activity type</span><select name="activityType"><option>TELEGRAM</option><option>EMAIL</option><option>CALL</option><option>MEETING</option><option>INTERNAL_NOTE</option></select></label>`+input('followUpAt','Follow-up date','datetime-local'), 'Record activity', fd=>api('/api/activities',{method:'POST',body:JSON.stringify(fd)})); }
  function importWorkbook(){ modal(`<div class="modal-head"><div><div class="eyebrow">AKARI HOUSE ONLY</div><h2>Import AKARI Leads</h2><p>The workbook stays private and is not uploaded to GitHub.</p></div><button class="icon-btn" data-v8-close>×</button></div><div class="modal-body"><label class="field"><span>Select CSV or XLSX</span><input id="v8-import-file" type="file" accept=".csv,.xlsx,.xls"/></label><div class="live-banner warning">Required workflow: inspect → map → deduplicate → preview → approve → import.</div><div id="v8-import-result"></div><div class="form-actions"><button class="btn" data-v8-close>Cancel</button><button class="btn primary" id="v8-inspect">Inspect file</button></div></div>`); $('#v8-inspect').onclick=()=>{const f=$('#v8-import-file').files[0]; $('#v8-import-result').innerHTML=f?`<div class="live-banner">Selected: ${esc(f.name)} · ${Math.round(f.size/1024)} KB. The protected importer will perform the dry run before any D1 write.</div>`:`<div class="live-banner error">Choose a file first.</div>`;}; }

  async function action(name, el){
    if(name==='new-lead') return newLead(); if(name==='new-task') return newTask(el.dataset.project||''); if(name==='new-opportunity') return newOpportunity(el.dataset.project||''); if(name==='new-activity') return newActivity(el.dataset.project||''); if(name==='import') return importWorkbook();
    if(name==='search-leads'){const q=$('#v8-lead-search')?.value.trim()||''; history.pushState(null,'',`#/leads${q?`?search=${encodeURIComponent(q)}`:''}`); return renderLeads();}
    if(name==='refresh') return render(); if(name==='toggle-finance'){document.documentElement.classList.toggle('finance-hidden'); return toast('Screen-share privacy toggled');}
    if(name==='quick-create') return modal(`<div class="modal-head"><div><div class="eyebrow">QUICK CREATE</div><h2>Create a record</h2></div><button class="icon-btn" data-v8-close>×</button></div><div class="modal-body"><div class="command-list"><button class="command-item" data-v8-action="new-lead">New AKARI Lead</button><button class="command-item" data-v8-action="new-task">New Task</button><button class="command-item" data-v8-action="new-opportunity">New Opportunity</button></div></div>`);
  }

  document.addEventListener('click', async e=>{
    const close=e.target.closest('[data-v8-close]'); if(close){e.preventDefault();closeModal();return;}
    const r=e.target.closest('[data-v8-route]'); if(r){e.preventDefault();return go(r.dataset.v8Route);}
    const nav=e.target.closest('[data-route]'); if(nav){e.preventDefault();e.stopImmediatePropagation();return go(nav.dataset.route);}
    const p=e.target.closest('[data-v8-project]'); if(p){e.preventDefault();return openProject(p.dataset.v8Project);}
    const t=e.target.closest('[data-v8-task]'); if(t){e.preventDefault();await api(`/api/tasks/${encodeURIComponent(t.dataset.v8Task)}`,{method:'PATCH',body:JSON.stringify({status:'DONE'})});toast('Task completed');return render();}
    const a=e.target.closest('[data-v8-action]'); if(a){e.preventDefault();e.stopImmediatePropagation();return action(a.dataset.v8Action,a);}
    const legacy=e.target.closest('[data-action]'); if(legacy){e.preventDefault();const map={refresh:'refresh','toggle-finance':'toggle-finance','quick-create':'quick-create','new-lead':'new-lead','import-leads':'import'}; if(map[legacy.dataset.action]) return action(map[legacy.dataset.action],legacy);}
  },true);
  window.addEventListener('popstate',()=>{state.route=route();activateNav(state.route);render();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();go('leads');setTimeout(()=>$('#v8-lead-search')?.focus(),50);}});

  async function init(){
    document.documentElement.dataset.akariInteractive='v8';
    state.route=ROUTES[route()]?route():'dashboard';
    try{state.me=await api('/api/me');}catch(e){console.warn('AKARI runtime identity check',e);}
    const wait=()=>{if(root()){activateNav(state.route);render();}else setTimeout(wait,50);}; wait();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
