(() => {
  'use strict';

  const state = { overview:null, workspace:null, templates:null, loading:false, currentId:'' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';
  const money = (value, currency = 'USD') => {
    if (value === null || value === undefined) return 'Restricted';
    const amount = Number(value || 0);
    const code = String(currency || 'USD').trim().toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', { style:'currency', currency:code, maximumFractionDigits:2 }).format(amount);
    } catch {
      return `${new Intl.NumberFormat('en-US', { maximumFractionDigits:2 }).format(amount)} ${code}`;
    }
  };
  const isCampaignPage = () => $('#view-root .page-head h1')?.textContent?.trim() === 'Campaigns';

  function root() {
    let node = $('#delivery-modal-root');
    if (!node) {
      node = document.createElement('div');
      node.id = 'delivery-modal-root';
      document.body.appendChild(node);
    }
    return node;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options, headers:{ 'content-type':'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message, type = 'success') {
    const container = $('#toast-root');
    if (!container) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    container.appendChild(node);
    setTimeout(() => node.remove(), 4000);
  }

  function tone(value) {
    const key = String(value || '').toUpperCase();
    if (['COMPLETED','DONE','COMPLETE','APPROVED','PUBLISHED','PAID'].includes(key)) return 'green';
    if (['BLOCKED','CANCELLED','DECLINED','DISPUTED'].includes(key)) return 'red';
    if (['LIVE','IN_PROGRESS','WAITING','REPORTING','DUE'].includes(key)) return 'yellow';
    return '';
  }

  function pill(value) { return `<span class="delivery-pill ${tone(value)}">${esc(title(value || '—'))}</span>`; }
  function progress(value) { const safe=Math.min(Math.max(Number(value || 0),0),100); return `<div class="delivery-progress"><span style="width:${safe}%"></span></div>`; }
  function memberOptions(selected = '') {
    const members = state.workspace?.members || [];
    return [['','Unassigned'], ...members.map((member) => [member.id, member.fullName || member.email])].map(([value,label]) => `<option value="${esc(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }

  function overviewRows(items) {
    if (!items.length) return '<div class="delivery-empty">No service engagements yet. Won opportunities create the operational workspace.</div>';
    return `<div class="delivery-overview-list">${items.map((item) => `<article class="delivery-overview-row" data-delivery-id="${esc(item.id)}"><div class="delivery-overview-main"><div class="delivery-overview-title"><strong>${esc(item.name)}</strong><span>${esc(item.projectName || 'AKARI client')} · ${esc(title(item.serviceType || 'Service'))}</span></div><div class="delivery-overview-progress">${progress(item.progress)}<span>${item.progress}% complete · ${item.overdue} overdue${item.blocked ? ` · ${item.blocked} blocked` : ''}</span></div></div><div class="delivery-overview-meta"><span><b>${item.completedMilestones}/${item.milestones}</b> milestones</span><span><b>${item.completedDeliverables}/${item.deliverables}</b> deliverables</span><span><b>${item.activeCreators}/${item.creators}</b> creators</span>${item.outstandingAmount !== undefined ? `<span class="finance-value"><b>${money(item.outstandingAmount,item.currency)}</b> outstanding</span>` : ''}</div><div class="delivery-overview-actions">${pill(item.status)}<button type="button" class="btn small primary" data-delivery-action="open" data-id="${esc(item.id)}">Manage delivery</button></div></article>`).join('')}</div>`;
  }

  async function renderOverview(force = false) {
    if (!isCampaignPage() || state.loading) return;
    const existing = $('#service-delivery-command-centre');
    if (existing && !force) return;
    state.loading = true;
    try {
      const payload = await request('/api/service-delivery');
      state.overview = payload;
      if (!isCampaignPage()) return;
      existing?.remove();
      const metrics = payload.metrics || {};
      const section = document.createElement('section');
      section.id = 'service-delivery-command-centre';
      section.className = 'delivery-command-centre';
      section.innerHTML = `<div class="delivery-kpis"><article><span>Active engagements</span><strong>${Number(metrics.active || 0)}</strong><small>${Number(metrics.live || 0)} live · ${Number(metrics.onboarding || 0)} onboarding</small></article><article class="${metrics.overdue ? 'attention' : ''}"><span>Delivery attention</span><strong>${Number(metrics.overdue || 0)}</strong><small>${Number(metrics.blocked || 0)} blocked items</small></article><article><span>Average progress</span><strong>${Number(metrics.averageProgress || 0)}%</strong><small>${Number(metrics.reporting || 0)} in reporting</small></article>${payload.financeVisible ? `<article><span>Portfolio outstanding</span><strong>${money(metrics.outstanding || 0)}</strong><small>${money(metrics.netRevenue || 0)} AKARI net</small></article>` : `<article><span>Completed</span><strong>${Number(metrics.completed || 0)}</strong><small>Financial values restricted</small></article>`}</div><div class="delivery-toolbar"><div><strong>Campaign and service delivery</strong><span>Onboarding, milestones, deliverables, creators, client reporting and renewal.</span></div><div><button type="button" class="btn" data-delivery-action="templates">Service templates</button><button type="button" class="btn" data-delivery-action="refresh-overview">Refresh</button></div></div><div class="delivery-panel"><header><div><strong>Engagement portfolio</strong><span>Operational work created from won opportunities and direct campaigns.</span></div>${pill(`${payload.total || 0} engagements`)}</header>${overviewRows(payload.items || [])}</div>`;
      $('#view-root .page-head')?.insertAdjacentElement('afterend', section);
    } catch (cause) {
      if (isCampaignPage()) notify(cause.message || 'Service delivery could not be loaded', 'error');
    } finally { state.loading = false; }
  }

  function closeWorkspace() { root().innerHTML = ''; state.workspace = null; state.currentId = ''; }
  function closeForm() { const layer=$('#delivery-form-layer', root()); layer?.replaceChildren(); if(layer && !$('#delivery-modal-root .delivery-workspace')) layer.remove(); }

  function stages(current) {
    const values = ['CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','COMPLETED'];
    const currentIndex = values.indexOf(current);
    return `<div class="delivery-stepper">${values.map((value,index) => `<div class="delivery-step ${index < currentIndex ? 'complete' : index === currentIndex ? 'current' : ''}"><span>${index < currentIndex ? '✓' : index + 1}</span><strong>${esc(title(value))}</strong></div>`).join('')}</div>`;
  }

  function itemList(items, kind, labelKey) {
    if (!items.length) return `<div class="delivery-empty">No ${esc(kind.toLowerCase())} items yet.</div>`;
    return `<div class="delivery-item-list">${items.map((item) => `<article><div class="delivery-item-status">${pill(item.status)}</div><div class="delivery-item-copy"><strong>${esc(item[labelKey])}</strong><span>${esc(item.ownerUserId ? (state.workspace.members.find((member) => member.id === item.ownerUserId)?.fullName || 'Assigned') : 'Unassigned')} · Due ${esc(date(item.dueDate))}${item.required === false ? ' · Optional' : ''}</span>${item.notes || item.internalNotes ? `<small>${esc(item.notes || item.internalNotes)}</small>` : ''}</div><div class="delivery-item-actions">${item.evidenceUrl || item.publishedUrl || item.draftUrl ? `<a class="btn small" href="${esc(item.publishedUrl || item.evidenceUrl || item.draftUrl)}" target="_blank" rel="noopener">Evidence</a>` : ''}<button type="button" class="btn small" data-delivery-action="edit-${kind.toLowerCase()}" data-id="${esc(item.id)}">Update</button></div></article>`).join('')}</div>`;
  }

  function creatorList(items) {
    if (!items.length) return '<div class="delivery-empty">No creators have been shortlisted.</div>';
    return `<div class="delivery-item-list">${items.map((item) => `<article><div class="delivery-item-status">${pill(item.status)}</div><div class="delivery-item-copy"><strong>${esc(item.name)}</strong><span>${esc(item.handle || 'No handle')} · ${esc(item.platform || 'Platform not set')} · ${Number(item.submittedLinks?.length || 0)} links</span>${state.workspace.permissions.canFinance ? `<small class="finance-value">${money(item.reward,item.currency)} · ${esc(title(item.paymentStatus))}</small>` : '<small>Reward details restricted</small>'}</div><div class="delivery-item-actions"><button type="button" class="btn small" data-delivery-action="edit-creator" data-id="${esc(item.id)}">Update</button></div></article>`).join('')}</div>`;
  }

  function workspaceHtml(payload) {
    const item = payload.item;
    const summary = item.summary || {};
    const finance = payload.permissions.canFinance;
    return `<div class="delivery-backdrop" data-delivery-action="workspace-backdrop"><section class="delivery-workspace" role="dialog" aria-modal="true" aria-label="Service delivery workspace"><header class="delivery-workspace-head"><div><div class="eyebrow">CAMPAIGN & SERVICE DELIVERY</div><h2>${esc(item.name)}</h2><p>${esc(item.projectName)} · ${esc(title(item.serviceType))} · ${esc(item.ownerName || 'Unassigned')}</p></div><div class="delivery-head-actions"><button type="button" class="btn" data-delivery-action="print-report">Client report</button><button type="button" class="close" data-delivery-action="close-workspace">×</button></div></header>${stages(item.status)}<div class="delivery-workspace-body"><div class="delivery-summary"><article><span>Progress</span><strong>${summary.progress || 0}%</strong>${progress(summary.progress)}</article><article><span>Overdue</span><strong>${summary.overdue || 0}</strong><small>${summary.blocked || 0} blocked</small></article><article><span>Deliverables</span><strong>${summary.deliverableDone || 0}/${summary.deliverableTotal || 0}</strong><small>${summary.publishedDeliverables || 0} published</small></article><article><span>Creators</span><strong>${summary.activeCreators || 0}/${summary.creators || 0}</strong><small>${Number(summary.reach || 0).toLocaleString()} reach</small></article>${finance ? `<article><span>AKARI net</span><strong>${money(item.akariNetRevenue,item.currency)}</strong><small>${money(item.outstandingAmount,item.currency)} outstanding</small></article>` : `<article><span>Next action</span><strong class="delivery-summary-text">${esc(item.nextAction || 'Not set')}</strong></article>`}</div><div class="delivery-actions-bar"><div>${pill(item.status)}<span>${esc(item.templateName || 'No delivery template applied')}</span></div><div>${payload.permissions.canManage ? `<button type="button" class="btn" data-delivery-action="apply-template">Apply template</button>` : ''}${payload.permissions.canWrite ? `<button type="button" class="btn" data-delivery-action="edit-overview">Engagement settings</button>` : ''}${payload.permissions.canManage && item.status !== 'COMPLETED' ? `<button type="button" class="btn primary" data-delivery-action="complete">Complete engagement</button>` : ''}${payload.permissions.canManage && item.status === 'COMPLETED' && !item.renewalOpportunityId ? `<button type="button" class="btn primary" data-delivery-action="renewal">Create renewal</button>` : ''}</div></div><div class="delivery-grid"><section class="delivery-section"><header><div><strong>Client onboarding</strong><span>${summary.onboardingDone || 0}/${summary.onboardingTotal || 0} completed</span></div>${payload.permissions.canWrite ? `<button class="btn small" data-delivery-action="new-onboarding">Add item</button>` : ''}</header>${itemList(item.onboarding || [],'ONBOARDING','label')}</section><section class="delivery-section"><header><div><strong>Milestones</strong><span>Owners, deadlines, dependencies and completion evidence.</span></div>${payload.permissions.canWrite ? `<button class="btn small" data-delivery-action="new-milestone">Add milestone</button>` : ''}</header>${itemList(item.milestones || [],'MILESTONE','title')}</section><section class="delivery-section wide"><header><div><strong>Deliverables</strong><span>Drafts, approvals, published links and performance.</span></div>${payload.permissions.canWrite ? `<button class="btn small" data-delivery-action="new-deliverable">Add deliverable</button>` : ''}</header>${itemList(item.deliverables || [],'DELIVERABLE','title')}</section><section class="delivery-section"><header><div><strong>Creator operations</strong><span>Selection, content submissions and reward status.</span></div>${payload.permissions.canWrite ? `<button class="btn small" data-delivery-action="new-creator">Add creator</button>` : ''}</header>${creatorList(item.creators || [])}</section><section class="delivery-section"><header><div><strong>Client reporting</strong><span>Structured results, work completed and recommendations.</span></div>${payload.permissions.canWrite ? `<button class="btn small" data-delivery-action="report">Edit report</button>` : ''}</header><div class="delivery-report-preview"><strong>${esc(item.report?.executiveSummary || 'No executive summary yet.')}</strong><span>${esc(item.report?.recommendations || 'Add recommendations before completing the engagement.')}</span>${item.report?.approvedAt ? pill('APPROVED') : pill('DRAFT')}</div></section>${finance ? `<section class="delivery-section wide"><header><div><strong>Budget and profitability</strong><span>Visible only to finance-authorised users.</span></div></header><div class="delivery-finance-grid"><div><span>Contract value</span><strong>${money(item.grossRevenue,item.currency)}</strong></div><div><span>Campaign cost</span><strong>${money(item.campaignCost,item.currency)}</strong></div><div><span>Creator cost</span><strong>${money(item.creatorCost,item.currency)}</strong></div><div><span>Other cost</span><strong>${money(item.otherCost,item.currency)}</strong></div><div><span>Referral liability</span><strong>${money(item.referralReward,item.currency)}</strong></div><div><span>AKARI net</span><strong>${money(item.akariNetRevenue,item.currency)}</strong></div><div><span>Invoiced</span><strong>${money(item.amountInvoiced,item.currency)}</strong></div><div><span>Collected</span><strong>${money(item.amountReceived,item.currency)}</strong></div></div></section>` : ''}</div></div><div id="delivery-form-layer"></div></section></div>`;
  }

  async function openWorkspace(id) {
    if (!id) return;
    state.currentId = id;
    root().innerHTML = '<div class="delivery-backdrop"><div class="delivery-loading"><strong>Opening service delivery…</strong><span>Loading onboarding, milestones, deliverables, creators and reporting.</span></div></div>';
    try {
      state.workspace = await request(`/api/service-delivery/${encodeURIComponent(id)}`);
      root().innerHTML = workspaceHtml(state.workspace);
    } catch (cause) { closeWorkspace(); notify(cause.message || 'Service delivery could not be opened','error'); }
  }

  async function refreshWorkspace() {
    if (!state.currentId) return;
    state.workspace = await request(`/api/service-delivery/${encodeURIComponent(state.currentId)}`);
    root().innerHTML = workspaceHtml(state.workspace);
  }

  function field(name,label,value='',type='text',options={}) { return `<label class="delivery-field ${options.full ? 'full' : ''}"><span>${esc(label)}${options.required ? ' *' : ''}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value ?? '')}" ${options.required ? 'required' : ''} ${options.min !== undefined ? `min="${esc(options.min)}"` : ''} ${options.max !== undefined ? `max="${esc(options.max)}"` : ''} ${options.step !== undefined ? `step="${esc(options.step)}"` : ''} placeholder="${esc(options.placeholder || '')}"/></label>`; }
  function textarea(name,label,value='',options={}) { return `<label class="delivery-field ${options.full === false ? '' : 'full'}"><span>${esc(label)}${options.required ? ' *' : ''}</span><textarea name="${esc(name)}" rows="${options.rows || 4}" ${options.required ? 'required' : ''} placeholder="${esc(options.placeholder || '')}">${esc(value ?? '')}</textarea></label>`; }
  function select(name,label,options,selected='',config={}) { return `<label class="delivery-field ${config.full ? 'full' : ''}"><span>${esc(label)}${config.required ? ' *' : ''}</span><select name="${esc(name)}" ${config.required ? 'required' : ''}>${options.map(([value,copy]) => `<option value="${esc(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(copy)}</option>`).join('')}</select></label>`; }
  function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }

  function openForm(titleText,subtitle,body,submitText,onSubmit,wide=false) {
    let layer = $('#delivery-form-layer', root());
    if (!layer) { layer=document.createElement('div'); layer.id='delivery-form-layer'; root().appendChild(layer); }
    layer.innerHTML = `<div class="delivery-form-backdrop"><section class="delivery-form-card ${wide ? 'wide' : ''}"><header><div><h3>${esc(titleText)}</h3><p>${esc(subtitle || '')}</p></div><button type="button" class="close" data-delivery-action="close-form">×</button></header><form id="delivery-active-form"><div class="delivery-form-body"><div class="delivery-form-grid">${body}</div></div><footer><button type="button" class="btn" data-delivery-action="close-form">Cancel</button><button type="submit" class="btn primary">${esc(submitText)}</button></footer></form></section></div>`;
    const form = $('#delivery-active-form', layer);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Saving…';
      try { await onSubmit(form); }
      catch (cause) { notify(cause.message || 'Action failed','error'); button.disabled=false; button.textContent=original; }
    });
  }

  async function patch(body,message) {
    const payload = await request(`/api/service-delivery/${encodeURIComponent(state.currentId)}`, { method:'PATCH', body:JSON.stringify(body) });
    state.workspace.item = payload.item;
    root().innerHTML = workspaceHtml(state.workspace);
    notify(message);
    await renderOverview(true);
  }

  async function loadTemplates(force=false) {
    if (!force && state.templates) return state.templates;
    const payload = await request('/api/service-delivery/templates');
    state.templates = payload.items || [];
    return state.templates;
  }

  async function applyTemplate() {
    const templates = await loadTemplates();
    const item = state.workspace.item;
    openForm('Apply service template','Creates the onboarding checklist, milestones, deliverables and My Day tasks.',`${select('templateId','Template',templates.map((entry)=>[entry.id,`${entry.name} · ${entry.durationDays} days`]),item.templateId || templates[0]?.id,{required:true,full:true})}<label class="delivery-check full"><input type="checkbox" name="replaceExisting"/><span><strong>Replace existing delivery items</strong><small>Required when an engagement already contains onboarding, milestones or deliverables.</small></span></label>${field('startDate','Delivery start',item.startDate || new Date().toISOString().slice(0,10),'date',{required:true})}${select('ownerUserId','Delivery owner',[['','Choose owner'],...(state.workspace.members||[]).map((member)=>[member.id,member.fullName || member.email])],item.ownerId || '',{required:true})}`,'Apply template',async(form)=>{ const data=formValues(form); await patch({action:'apply-template',templateId:data.templateId,startDate:data.startDate,ownerUserId:data.ownerUserId,replaceExisting:Boolean(data.replaceExisting)},'Service template applied'); },true);
  }

  function editOverview() {
    const item=state.workspace.item; const statuses=['CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','PAUSED','CANCELLED'];
    openForm('Engagement settings','Control ownership, stage, dates, next action and permitted financial values.',`${field('name','Engagement name',item.name,'text',{required:true})}${select('status','Delivery stage',statuses.map((value)=>[value,title(value)]),item.status,{required:true})}${field('serviceType','Service type',item.serviceType,'text',{required:true})}${select('ownerUserId','Delivery owner',[['','Choose owner'],...(state.workspace.members||[]).map((member)=>[member.id,member.fullName || member.email])],item.ownerId || '',{required:true})}${field('startDate','Start date',item.startDate || '','date')}${field('endDate','Target end',item.endDate || '','date')}${field('reportingDueDate','Reporting due',item.reportingDueDate || '','date')}${textarea('nextAction','Next action',item.nextAction || '',{required:true})}${state.workspace.permissions.canFinance ? `${field('grossRevenue','Contract value',item.grossRevenue,'number',{min:0,step:'0.01'})}${field('campaignCost','Campaign cost',item.campaignCost,'number',{min:0,step:'0.01'})}${field('creatorCost','Creator cost',item.creatorCost,'number',{min:0,step:'0.01'})}${field('otherCost','Other cost',item.otherCost,'number',{min:0,step:'0.01'})}` : ''}`,'Save settings',async(form)=>{ const data=formValues(form); const body={action:'update-overview',...data}; ['grossRevenue','campaignCost','creatorCost','otherCost'].forEach((key)=>{if(data[key]!==undefined) body[key]=Number(data[key]||0);}); await patch(body,'Engagement settings updated'); },true);
  }

  function itemForm(kind,id='') {
    const item=state.workspace.item;
    const config=kind==='onboarding' ? {list:item.onboarding||[], key:'label', title:'Onboarding item', action:'upsert-onboarding'} : kind==='milestone' ? {list:item.milestones||[],key:'title',title:'Milestone',action:'upsert-milestone'} : {list:item.deliverables||[],key:'title',title:'Deliverable',action:'upsert-deliverable'};
    const existing=config.list.find((entry)=>entry.id===id) || {};
    const statuses=[['NOT_STARTED','Not started'],['IN_PROGRESS','In progress'],['WAITING','Waiting'],['BLOCKED','Blocked'],[kind==='deliverable'?'PUBLISHED':kind==='onboarding'?'DONE':'COMPLETE',kind==='deliverable'?'Published':'Complete'],['CANCELLED','Cancelled']];
    let body=`${field(config.key,config.title,existing[config.key]||'','text',{required:true,full:true})}${select('status','Status',statuses,existing.status||'NOT_STARTED',{required:true})}${select('ownerUserId','Owner',[['','Choose owner'],...(state.workspace.members||[]).map((member)=>[member.id,member.fullName||member.email])],existing.ownerUserId||'')}${field('dueDate','Due date',existing.dueDate||'','date')}${select('required','Requirement',[['true','Required'],['false','Optional']],existing.required===false?'false':'true')}`;
    if(kind==='milestone') body+=`${select('stage','Delivery stage',[['ONBOARDING','Onboarding'],['PLANNING','Planning'],['CREATOR_SELECTION','Creator selection'],['LIVE','Live'],['REPORTING','Reporting']],existing.stage||'PLANNING')}${field('evidenceUrl','Completion evidence URL',existing.evidenceUrl||'','url',{full:true})}${textarea('dependencies','Dependencies',existing.dependencies||'')}${textarea('internalNotes','Internal notes',existing.internalNotes||'')}${textarea('clientNotes','Client-visible notes',existing.clientNotes||'')}`;
    else if(kind==='deliverable') body+=`${field('type','Deliverable type',existing.type||'CONTENT')}${field('platform','Platform',existing.platform||'')}${field('creatorName','Creator / responsible party',existing.creatorName||'')}${field('draftUrl','Draft URL',existing.draftUrl||'','url')}${field('publishedUrl','Published URL',existing.publishedUrl||'','url')}${field('revisions','Revision count',existing.revisions||0,'number',{min:0,max:99})}${select('internalApproval','Internal approval',[['false','Pending'],['true','Approved']],existing.internalApproval?'true':'false')}${select('clientApproval','Client approval',[['false','Pending'],['true','Approved']],existing.clientApproval?'true':'false')}${field('reach','Reach',existing.performance?.reach||0,'number',{min:0})}${field('engagements','Engagements',existing.performance?.engagements||0,'number',{min:0})}${field('clicks','Clicks',existing.performance?.clicks||0,'number',{min:0})}${field('conversions','Conversions',existing.performance?.conversions||0,'number',{min:0})}${textarea('notes','Internal notes',existing.notes||'')}`;
    else body+=textarea('notes','Notes',existing.notes||'');
    openForm(id?`Update ${config.title.toLowerCase()}`:`Add ${config.title.toLowerCase()}`,item.name,body,id?'Update':'Add',async(form)=>{ const data=formValues(form); const payload={...data,id:existing.id,required:data.required==='true'}; ['internalApproval','clientApproval'].forEach((key)=>{if(data[key]!==undefined)payload[key]=data[key]==='true';}); if(kind==='deliverable')payload.performance={reach:Number(data.reach||0),engagements:Number(data.engagements||0),clicks:Number(data.clicks||0),conversions:Number(data.conversions||0)}; await patch({action:config.action,item:payload},`${config.title} updated`); },true);
  }

  function creatorForm(id='') {
    const existing=(state.workspace.item.creators||[]).find((entry)=>entry.id===id)||{};
    openForm(id?'Update creator':'Add creator',state.workspace.item.name,`${field('name','Creator name',existing.name||'','text',{required:true})}${field('handle','Handle',existing.handle||'')}${field('platform','Platform',existing.platform||'')}${select('status','Participation status',[['SHORTLISTED','Shortlisted'],['INVITED','Invited'],['CONFIRMED','Confirmed'],['ACTIVE','Active'],['SUBMITTED','Submitted'],['APPROVED','Approved'],['DECLINED','Declined'],['REMOVED','Removed']],existing.status||'SHORTLISTED')}${field('postQuantity','Required posts',existing.postQuantity||0,'number',{min:0})}${state.workspace.permissions.canFinance ? `${field('reward','Creator reward',existing.reward||0,'number',{min:0,step:'0.01'})}${select('currency','Currency',[['USD','USD'],['USDT','USDT'],['EUR','EUR']],existing.currency||'USDT')}${select('paymentStatus','Payment status',[['NOT_DUE','Not due'],['PENDING','Pending'],['DUE','Due'],['PAID','Paid'],['DISPUTED','Disputed'],['CANCELLED','Cancelled']],existing.paymentStatus||'NOT_DUE')}` : ''}${textarea('submittedLinks','Submitted links',(existing.submittedLinks||[]).join('\n'),{placeholder:'One URL per line'})}${textarea('notes','Notes',existing.notes||'')}`,'Save creator',async(form)=>{ const data=formValues(form); const item={...data,id:existing.id,postQuantity:Number(data.postQuantity||0),submittedLinks:String(data.submittedLinks||'').split('\n').map((value)=>value.trim()).filter(Boolean)}; if(data.reward!==undefined)item.reward=Number(data.reward||0); await patch({action:'upsert-creator',item},'Creator record updated'); },true);
  }

  function reportForm() {
    const report=state.workspace.item.report||{};
    openForm('Client delivery report','Prepare the authenticated print-ready report before completing the engagement.',`${textarea('executiveSummary','Executive summary',report.executiveSummary||'',{required:true})}${textarea('workCompleted','Work completed',report.workCompleted||'',{required:true})}${textarea('results','Results and performance',report.results||'')}${textarea('clientVisibleNotes','Client-visible notes',report.clientVisibleNotes||'')}${textarea('recommendations','Next recommendations',report.recommendations||'',{required:true})}<label class="delivery-check full"><input type="checkbox" name="approved" ${report.approvedAt?'checked':''}/><span><strong>Approve this report</strong><small>Records the internal approval timestamp.</small></span></label>`,'Save report',async(form)=>{ const data=formValues(form); await patch({action:'save-report',...data,approved:Boolean(data.approved)},'Client report updated'); },true);
  }

  function completeForm() {
    openForm('Complete engagement','Required onboarding, milestones, deliverables and the final report must be resolved.',`${textarea('outcome','Client outcome','',{required:true})}${textarea('internalLearning','Internal learning','')}${select('testimonialStatus','Testimonial',[['NOT_REQUESTED','Not requested'],['REQUESTED','Requested'],['RECEIVED','Received'],['DECLINED','Declined']],'NOT_REQUESTED')}${select('caseStudyPermission','Case-study permission',[['NOT_REQUESTED','Not requested'],['REQUESTED','Requested'],['APPROVED','Approved'],['DECLINED','Declined']],'NOT_REQUESTED')}${field('endDate','Completion date',new Date().toISOString().slice(0,10),'date',{required:true})}`,'Complete engagement',async(form)=>{ await patch({action:'complete',...formValues(form)},'Engagement completed'); });
  }

  function renewalForm() {
    const item=state.workspace.item;
    openForm('Create renewal opportunity','Creates a new opportunity on the same client relationship without duplicating the project.',`${field('name','Opportunity name',`${item.name} renewal`,'text',{required:true,full:true})}${field('estimatedValue','Estimated value',item.grossRevenue||0,'number',{min:0,step:'0.01'})}${field('expectedCloseDate','Expected close date','','date')}${field('nextFollowUpAt','Next follow-up','','datetime-local')}${textarea('description','Renewal / upsell scope','')}${textarea('nextAction','Next action','Confirm renewal scope with client',{required:true})}`,'Create renewal',async(form)=>{ const data=formValues(form); data.estimatedValue=Number(data.estimatedValue||0); await patch({action:'create-renewal',...data},'Renewal opportunity created'); },true);
  }

  async function templatesForm() {
    const templates=await loadTemplates(true);
    openForm('Service delivery templates','Built-in templates are ready to apply. Add tenant-specific templates for AKARI services.',`<div class="delivery-template-list full">${templates.map((item)=>`<article><div><strong>${esc(item.name)}</strong><span>${esc(title(item.serviceType))} · ${item.durationDays} days · ${item.onboarding?.length||0} onboarding · ${item.milestones?.length||0} milestones</span></div>${item.system?'Built in':`<button type="button" class="btn small" data-delivery-action="archive-template" data-id="${esc(item.id)}">Archive</button>`}</article>`).join('')}</div>${field('name','Template name','','text',{required:true})}${field('serviceType','Service type','OTHER')}${field('durationDays','Duration days',30,'number',{min:1,max:730})}${textarea('onboarding','Onboarding items','',{placeholder:'One item per line'})}${textarea('milestones','Milestones','',{placeholder:'One milestone per line'})}${textarea('deliverables','Deliverables','',{placeholder:'One deliverable per line'})}`,'Save template',async(form)=>{ await request('/api/service-delivery/templates',{method:'POST',body:JSON.stringify(formValues(form))}); state.templates=null; closeForm(); notify('Service template saved'); await templatesForm(); },true);
  }

  async function handleAction(name,element) {
    if(name==='open')return openWorkspace(element.dataset.id);
    if(name==='close-workspace'||name==='workspace-backdrop')return closeWorkspace();
    if(name==='close-form')return closeForm();
    if(name==='refresh-overview')return renderOverview(true);
    if(name==='templates')return templatesForm();
    if(name==='archive-template'){await request('/api/service-delivery/templates',{method:'POST',body:JSON.stringify({action:'archive',id:element.dataset.id})});state.templates=null;closeForm();notify('Service template archived');return templatesForm();}
    if(name==='apply-template')return applyTemplate();
    if(name==='edit-overview')return editOverview();
    if(name==='new-onboarding')return itemForm('onboarding');
    if(name==='edit-onboarding')return itemForm('onboarding',element.dataset.id);
    if(name==='new-milestone')return itemForm('milestone');
    if(name==='edit-milestone')return itemForm('milestone',element.dataset.id);
    if(name==='new-deliverable')return itemForm('deliverable');
    if(name==='edit-deliverable')return itemForm('deliverable',element.dataset.id);
    if(name==='new-creator')return creatorForm();
    if(name==='edit-creator')return creatorForm(element.dataset.id);
    if(name==='report')return reportForm();
    if(name==='complete')return completeForm();
    if(name==='renewal')return renewalForm();
    if(name==='print-report')return window.open(`/api/service-delivery/${encodeURIComponent(state.currentId)}/report`,'_blank','noopener');
  }

  function enhanceRevenueWorkspace(){ document.querySelectorAll('#modal-root .revenue-workspace [data-revenue-action="edit-engagement"][data-id]').forEach((button)=>{ if(button.parentElement?.querySelector(`[data-delivery-linked="${CSS.escape(button.dataset.id)}"]`))return; const delivery=document.createElement('button'); delivery.type='button'; delivery.className='btn small'; delivery.dataset.deliveryAction='open'; delivery.dataset.id=button.dataset.id; delivery.dataset.deliveryLinked=button.dataset.id; delivery.textContent='Delivery workspace'; button.insertAdjacentElement('afterend',delivery); }); }

  document.addEventListener('click',async(event)=>{
    const element=event.target.closest('[data-delivery-action]');
    if(!element)return;
    const name=element.dataset.deliveryAction;
    if(name==='workspace-backdrop'&&event.target!==element)return;
    event.preventDefault();event.stopImmediatePropagation();
    try{await handleAction(name,element);}catch(cause){notify(cause.message||'Delivery action failed','error');}
  },true);
  document.addEventListener('keydown',(event)=>{if(event.key!=='Escape')return;if($('#delivery-form-layer .delivery-form-card'))closeForm();else if($('#delivery-modal-root .delivery-workspace'))closeWorkspace();});
  const observer=new MutationObserver(()=>{renderOverview();enhanceRevenueWorkspace();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{renderOverview();enhanceRevenueWorkspace();});
})();
