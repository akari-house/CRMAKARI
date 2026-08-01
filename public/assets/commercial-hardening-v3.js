(() => {
  'use strict';

  const state = { currentOpportunityId:'', workspace:null, overview:null, templates:null, financeLoading:false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style:'currency', currency:currency || 'USD', maximumFractionDigits:2 }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '—';
  const pageHeading = () => $('#view-root .page-head h1')?.textContent?.trim() || '';
  const isFinancePage = () => ['Finance', 'Invoices & Finance'].includes(pageHeading());

  function commercialRoot() {
    let root = $('#commercial-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'commercial-modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials:'same-origin', ...options, headers:{ 'content-type':'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function pill(value, tone = '') { return `<span class="commercial-pill ${tone}">${esc(title(value || '—'))}</span>`; }
  function tone(value) {
    const key = String(value || '').toUpperCase();
    if (['PAID','ACCEPTED','APPROVED'].includes(key)) return 'green';
    if (['OVERDUE','REJECTED','CANCELLED'].includes(key)) return 'red';
    if (['INTERNAL_REVIEW','SENT','DUE','PARTIALLY_PAID','PARTIALLY_CREDITED'].includes(key)) return 'yellow';
    return '';
  }

  function closeModal() { commercialRoot().innerHTML = ''; }
  function modal(titleText, subtitle, body, submitText, onSubmit, wide = false) {
    const root = commercialRoot();
    root.innerHTML = `<div class="commercial-modal-backdrop" data-commercial-action="modal-backdrop"><section class="commercial-modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><header><div><h2>${esc(titleText)}</h2><p>${esc(subtitle || '')}</p></div><button type="button" class="close" data-commercial-action="close-modal">×</button></header><form id="commercial-active-form"><div class="commercial-modal-body">${body}</div><footer><button type="button" class="btn" data-commercial-action="close-modal">Cancel</button>${submitText ? `<button type="submit" class="btn primary">${esc(submitText)}</button>` : ''}</footer></form></section></div>`;
    const form = $('#commercial-active-form', root);
    if (form && onSubmit) form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Saving…';
      try { await onSubmit(form); }
      catch (cause) { notify(cause.message || 'Action failed', 'error'); button.disabled = false; button.textContent = original; }
    });
  }

  function field(name, label, value = '', type = 'text', options = {}) {
    const { required = false, full = false, placeholder = '', min = '', max = '', step = '' } = options;
    return `<label class="commercial-field ${full ? 'full' : ''}"><span>${esc(label)}${required ? ' *' : ''}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${min !== '' ? `min="${esc(min)}"` : ''} ${max !== '' ? `max="${esc(max)}"` : ''} ${step !== '' ? `step="${esc(step)}"` : ''}/></label>`;
  }
  function textarea(name, label, value = '', options = {}) {
    return `<label class="commercial-field ${options.full === false ? '' : 'full'}"><span>${esc(label)}${options.required ? ' *' : ''}</span><textarea name="${esc(name)}" rows="${options.rows || 4}" ${options.required ? 'required' : ''} placeholder="${esc(options.placeholder || '')}">${esc(value ?? '')}</textarea></label>`;
  }
  function select(name, label, options, selected = '', config = {}) {
    return `<label class="commercial-field ${config.full ? 'full' : ''}"><span>${esc(label)}${config.required ? ' *' : ''}</span><select name="${esc(name)}" ${config.required ? 'required' : ''}>${options.map(([value, copy]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(copy)}</option>`).join('')}</select></label>`;
  }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

  async function loadTemplates(force = false) {
    if (!force && state.templates) return state.templates;
    const payload = await request('/api/commercial/templates');
    state.templates = payload.items || [];
    return state.templates;
  }

  async function renderFinance(force = false) {
    if (!isFinancePage() || state.financeLoading) return;
    const existing = $('#commercial-command-centre');
    if (existing && !force) return;
    state.financeLoading = true;
    try {
      const payload = await request('/api/commercial/overview');
      state.overview = payload;
      if (!isFinancePage()) return;
      existing?.remove();
      const invoices = payload.invoices || [];
      const referrals = payload.referrals || [];
      const proposals = payload.proposals || [];
      const root = document.createElement('section');
      root.id = 'commercial-command-centre';
      root.className = 'commercial-command-centre';
      root.innerHTML = `
        <div class="commercial-kpis">
          <article><span>Invoiced</span><strong>${money(payload.metrics?.invoiced || 0)}</strong><small>After credit notes</small></article>
          <article><span>Collected</span><strong>${money(payload.metrics?.collected || 0)}</strong><small>Allocated receipts</small></article>
          <article class="attention"><span>Outstanding</span><strong>${money(payload.metrics?.outstanding || 0)}</strong><small>${payload.metrics?.overdueInvoices || 0} overdue</small></article>
          <article><span>Referral due</span><strong>${money(payload.metrics?.referralDue || 0)}</strong><small>Approved liability</small></article>
        </div>
        <div class="commercial-toolbar"><div><strong>Commercial operations</strong><span>Proposal approvals, invoice schedules, collections and referral settlement.</span></div><div><button class="btn" data-commercial-action="templates">Proposal templates</button><a class="btn" href="/api/commercial/export?type=invoices">Export ledger</a><a class="btn" href="/api/commercial/export?type=referrals">Export referrals</a></div></div>
        <div class="commercial-grid">
          <article class="commercial-panel wide"><header><div><strong>Invoice collection queue</strong><span>Draft, outstanding and overdue invoices.</span></div>${pill(`${invoices.length} invoices`)}</header>${invoiceTable(invoices)}</article>
          <article class="commercial-panel"><header><div><strong>Proposal approvals</strong><span>Internal review and approved proposals.</span></div>${pill(`${proposals.filter((item) => ['INTERNAL_REVIEW','APPROVED','SENT'].includes(item.status)).length} active`)}</header>${proposalList(proposals)}</article>
          <article class="commercial-panel"><header><div><strong>Referral statements</strong><span>Confirmed, due and paid rewards.</span></div>${pill(`${referrals.length} records`)}</header>${referralList(referrals)}</article>
        </div>`;
      $('#view-root .page-head')?.insertAdjacentElement('afterend', root);
    } catch (cause) {
      if (isFinancePage()) notify(cause.message || 'Commercial controls could not be loaded', 'error');
    } finally { state.financeLoading = false; }
  }

  function invoiceTable(items) {
    if (!items.length) return '<div class="commercial-empty">No hardened invoice records yet.</div>';
    return `<div class="commercial-table-wrap"><table class="commercial-table"><thead><tr><th>Invoice</th><th>Client</th><th>Total</th><th>Received</th><th>Outstanding</th><th>Status</th><th>Actions</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${esc(item.invoiceNumber)}</strong><span>${esc(date(item.dueDate))}</span></td><td>${esc(item.projectName || '—')}</td><td>${money(item.total,item.currency)}</td><td>${money(item.received,item.currency)}</td><td>${money(item.outstanding,item.currency)}</td><td>${pill(item.displayStatus || item.status,tone(item.displayStatus || item.status))}</td><td><div class="commercial-row-actions"><button class="btn small" data-commercial-action="print-invoice" data-id="${esc(item.id)}">View</button>${item.outstanding > 0 && !['DRAFT','CANCELLED','CREDITED'].includes(item.status) ? `<button class="btn small primary" data-commercial-action="pay-invoice" data-id="${esc(item.id)}">Payment</button><button class="btn small" data-commercial-action="remind-invoice" data-id="${esc(item.id)}">Reminder</button><button class="btn small" data-commercial-action="credit-invoice" data-id="${esc(item.id)}">Credit</button>` : ''}${['DRAFT','INVOICED'].includes(item.status) && item.received <= 0 && item.credited <= 0 ? `<button class="btn small" data-commercial-action="cancel-invoice" data-id="${esc(item.id)}">Cancel</button>` : ''}${item.status === 'DRAFT' ? `<button class="btn small primary" data-commercial-action="issue-invoice" data-id="${esc(item.id)}">Issue</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  }

  function proposalList(items) {
    const active = items.filter((item) => ['INTERNAL_REVIEW','APPROVED','SENT'].includes(item.status)).slice(0, 8);
    if (!active.length) return '<div class="commercial-empty">No proposals awaiting commercial action.</div>';
    return `<div class="commercial-list">${active.map((item) => `<article><div><strong>${esc(item.title)}</strong><span>v${esc(item.version)} · ${money(item.amount,item.currency)}</span></div><div>${pill(item.status,tone(item.status))}<button class="btn small" data-commercial-action="print-proposal" data-id="${esc(item.id)}">View</button>${item.status === 'INTERNAL_REVIEW' ? `<button class="btn small primary" data-commercial-action="proposal-status" data-id="${esc(item.id)}" data-status="APPROVED">Approve</button>` : ''}${item.status === 'APPROVED' ? `<button class="btn small primary" data-commercial-action="proposal-status" data-id="${esc(item.id)}" data-status="SENT">Mark sent</button>` : ''}${item.status === 'SENT' ? `<button class="btn small" data-commercial-action="proposal-decision" data-id="${esc(item.id)}">Decision</button>` : ''}</div></article>`).join('')}</div>`;
  }

  function referralList(items) {
    const active = items.filter((item) => ['CONFIRMED','DUE','PAID'].includes(item.status)).slice(0, 8);
    if (!active.length) return '<div class="commercial-empty">No referral statements yet.</div>';
    return `<div class="commercial-list">${active.map((item) => `<article><div><strong>${esc(item.partnerName)}</strong><span>${esc(item.projectName || item.engagementName || 'Commercial engagement')}</span></div><div><strong>${money(item.amount,item.currency)}</strong>${pill(item.status,tone(item.status))}</div></article>`).join('')}</div>`;
  }

  async function enhanceWorkspace() {
    const workspace = $('#modal-root .revenue-workspace');
    if (!workspace || !state.currentOpportunityId || workspace.dataset.commercialHardening === 'loading' || workspace.querySelector('[data-commercial-workspace]')) return;
    workspace.dataset.commercialHardening = 'loading';
    try {
      const [payload, overview] = await Promise.all([
        request(`/api/opportunities/${encodeURIComponent(state.currentOpportunityId)}/workspace`),
        request(`/api/commercial/overview?opportunityId=${encodeURIComponent(state.currentOpportunityId)}`),
      ]);
      if (!document.body.contains(workspace)) return;
      state.workspace = payload;
      const panel = document.createElement('section');
      panel.className = 'revenue-panel commercial-workspace-panel';
      panel.dataset.commercialWorkspace = 'ready';
      const proposals = payload.proposals || [];
      const invoices = overview.invoices || [];
      panel.innerHTML = `<div class="revenue-panel-head"><div><strong>Commercial control</strong><span>Approvals, printable documents, invoice schedules and collection actions.</span></div><div>${payload.permissions.canWrite && !['WON','LOST'].includes(payload.opportunity.stage) ? `<button class="btn small" data-commercial-action="new-proposal">New from template</button>` : ''}${payload.permissions.canFinance && payload.engagements?.length ? `<button class="btn small primary" data-commercial-action="new-invoice">Scheduled invoice</button>` : ''}</div></div><div class="commercial-workspace-grid"><div><h4>Proposal versions</h4>${proposals.length ? `<div class="commercial-list">${proposals.slice(0,6).map((item) => { const status = item.metadata?.status || item.outcome; return `<article><div><strong>${esc(item.metadata?.title || item.subject)}</strong><span>v${esc(item.metadata?.version || 1)} · ${money(item.metadata?.amount || 0,item.metadata?.currency || 'USD')}</span></div><div>${pill(status,tone(status))}<button class="btn small" data-commercial-action="print-proposal" data-id="${esc(item.id)}">View</button>${status === 'INTERNAL_REVIEW' && payload.permissions.canApproveProposal ? `<button class="btn small primary" data-commercial-action="proposal-status" data-id="${esc(item.id)}" data-status="APPROVED">Approve</button>` : ''}${status === 'APPROVED' && payload.permissions.canApproveProposal ? `<button class="btn small primary" data-commercial-action="proposal-status" data-id="${esc(item.id)}" data-status="SENT">Send</button>` : ''}${status === 'SENT' && payload.permissions.canApproveProposal ? `<button class="btn small" data-commercial-action="proposal-decision" data-id="${esc(item.id)}">Decision</button>` : ''}</div></article>`; }).join('')}</div>` : '<div class="commercial-empty">No proposal versions.</div>'}</div><div><h4>Invoice schedule and collection</h4>${invoices.length ? invoiceTable(invoices) : '<div class="commercial-empty">No invoices connected to this opportunity.</div>'}</div></div>`;
      workspace.querySelector('.revenue-workspace-body')?.appendChild(panel);
      workspace.dataset.commercialHardening = 'ready';
    } catch (cause) { workspace.dataset.commercialHardening = 'error'; console.warn('Commercial workspace enhancement failed', cause); }
  }

  async function openTemplates() {
    const templates = await loadTemplates(true);
    modal('Proposal templates','Reusable tenant-owned scope, deliverables and terms.',`<div class="commercial-template-list">${templates.length ? templates.map((item) => `<article><div><strong>${esc(item.name)}</strong><span>${esc(title(item.serviceType))} · ${esc(title(item.commercialModel))}</span></div><button type="button" class="btn small" data-commercial-action="archive-template" data-id="${esc(item.id)}">Archive</button></article>`).join('') : '<div class="commercial-empty">No templates yet.</div>'}</div><div class="commercial-form-grid">${field('name','Template name','', 'text',{required:true})}${field('serviceType','Service type','MARKETING_CAMPAIGN')}${select('commercialModel','Commercial model',[['FIXED_FEE','Fixed fee'],['RETAINER','Retainer'],['PERFORMANCE','Performance'],['HYBRID','Hybrid']],'FIXED_FEE')}${field('defaultValidityDays','Validity days',14,'number',{min:1,max:365})}${textarea('scope','Scope','',{required:true})}${textarea('deliverables','Deliverables','',{required:true})}${textarea('timeline','Timeline')}${textarea('paymentTerms','Payment terms')}${textarea('assumptions','Assumptions')}</div>`,'Save template',async(form)=>{ const data=formData(form); await request('/api/commercial/templates',{method:'POST',body:JSON.stringify(data)}); state.templates=null; closeModal(); notify('Proposal template saved'); if(isFinancePage()) renderFinance(true); },true);
  }

  async function newProposal() {
    const templates = await loadTemplates();
    const w = state.workspace;
    if (!w?.opportunity) return;
    modal('New proposal from template',`${w.opportunity.project_name} · ${w.opportunity.name}`,`<div class="commercial-form-grid">${select('templateId','Template',[['','No template'],...templates.map((item)=>[item.id,item.name])],'')}${field('title','Proposal title',`${w.opportunity.name} proposal`,'text',{required:true})}${field('amount','Amount',w.opportunity.estimated_value || 0,'number',{required:true,min:0,step:'0.01'})}${select('currency','Currency',[['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']],w.opportunity.currency || 'USD')}${select('status','Initial status',[['DRAFT','Draft'],['INTERNAL_REVIEW','Submit for internal review']],'INTERNAL_REVIEW')}${field('validityDate','Valid until','', 'date')}${textarea('scope','Scope','',{required:true})}${textarea('deliverables','Deliverables','',{required:true})}${textarea('timeline','Timeline')}${textarea('paymentTerms','Payment terms')}${textarea('assumptions','Assumptions')}${field('nextAction','Next action','Review and approve proposal','text',{full:true})}</div>`,'Create proposal',async(form)=>{ const data=formData(form); await request(`/api/opportunities/${encodeURIComponent(w.opportunity.id)}/proposal`,{method:'POST',body:JSON.stringify(data)}); closeModal(); notify('Proposal version created'); await refreshWorkspace(); },true);
    const form=$('#commercial-active-form', commercialRoot());
    form.elements.templateId.addEventListener('change',()=>{ const item=templates.find((entry)=>entry.id===form.elements.templateId.value); if(!item)return; ['scope','deliverables','timeline','paymentTerms','assumptions'].forEach((key)=>{ if(form.elements[key]) form.elements[key].value=item[key]||''; }); });
  }

  function parseSchedule(value) {
    if (!String(value || '').trim()) return [];
    return String(value).split(String.fromCharCode(10)).map((line,index)=>{ const [label,dueDate,amount]=line.split('|').map((part)=>part.trim()); if(!label||!dueDate||!amount) throw new Error(`Payment schedule line ${index+1} must be Label | YYYY-MM-DD | Amount`); return {label,dueDate,amount:Number(amount)}; });
  }

  async function newInvoice() {
    const w=state.workspace;
    const engagement=w?.engagements?.[0];
    if(!w?.opportunity||!engagement)return notify('A won service engagement is required.','error');
    const today=new Date().toISOString().slice(0,10); const due=new Date(); due.setDate(due.getDate()+14);
    modal('Create scheduled invoice',`${w.opportunity.project_name} · ${engagement.name}`,`<div class="commercial-form-grid">${select('status','Invoice state',[['DRAFT','Draft'],['INVOICED','Issue now']],'DRAFT')}${field('invoiceDate','Invoice date',today,'date',{required:true})}${field('dueDate','Due date',due.toISOString().slice(0,10),'date')}${select('currency','Currency',[['USD','USD'],['EUR','EUR'],['USDT','USDT'],['GBP','GBP']],engagement.currency || 'USD')}${field('recipientName','Client billing name',w.opportunity.project_name,'text',{required:true})}${field('recipientEmail','Billing email',w.opportunity.primary_contact_email || '','email')}${field('recipientAddressLine1','Client address','','text',{required:true})}${field('recipientCountry','Client country','','text',{required:true})}${field('description','Invoice item',engagement.name,'text',{required:true})}${field('amount','Amount',engagement.grossRevenue || 0,'number',{required:true,min:0,step:'0.01'})}${field('taxRate','Tax rate %',0,'number',{min:0,max:100,step:'0.01'})}${textarea('taxLabel','Tax note')}${textarea('paymentSchedule','Payment schedule','',{placeholder:'One milestone per line: Deposit | YYYY-MM-DD | Amount'})}${textarea('notes','Invoice notes')}</div>`,'Create invoice',async(form)=>{ const data=formData(form); const schedule=parseSchedule(data.paymentSchedule); await request('/api/invoices',{method:'POST',body:JSON.stringify({projectId:w.opportunity.project_id,campaignId:engagement.id,opportunityId:w.opportunity.id,status:data.status,invoiceDate:data.invoiceDate,dueDate:data.dueDate,currency:data.currency,taxRate:Number(data.taxRate||0),taxLabel:data.taxLabel,notes:data.notes,paymentSchedule:schedule,recipient:{name:data.recipientName,email:data.recipientEmail,addressLine1:data.recipientAddressLine1,country:data.recipientCountry},lineItems:[{description:data.description,quantity:1,unitPrice:Number(data.amount||0)}]})}); closeModal(); notify('Invoice created'); await refreshWorkspace(); },true);
  }

  async function invoiceDetail(id) { return request(`/api/invoices/${encodeURIComponent(id)}`); }
  async function payInvoice(id) {
    const payload=await invoiceDetail(id); const item=payload.item;
    modal('Record client payment',`${item.invoiceNumber} · ${money(item.outstanding,item.currency)} outstanding`,`<div class="commercial-form-grid">${field('amount','Payment amount',item.outstanding,'number',{required:true,min:0.01,step:'0.01'})}${field('receivedDate','Received date',new Date().toISOString().slice(0,10),'date',{required:true})}${select('paymentMethod','Method',[['BANK_TRANSFER','Bank transfer'],['USDT','USDT'],['CRYPTO','Crypto'],['CARD','Card'],['OTHER','Other']],'BANK_TRANSFER')}${field('reference','Transaction / bank reference','','text',{required:true})}${field('referralDueInDays','Referral due in days',7,'number',{min:0,max:365})}${textarea('notes','Payment notes')}</div>`,'Record payment',async(form)=>{ await request(`/api/invoices/${encodeURIComponent(id)}/receipts`,{method:'POST',body:JSON.stringify(formData(form))}); closeModal(); notify('Payment allocated'); await refreshAll(); });
  }
  async function remindInvoice(id) {
    modal('Create payment follow-up','Adds an audited task to My Day.',`<div class="commercial-form-grid">${field('dueAt','Follow-up date and time','', 'datetime-local',{required:true})}${select('priority','Priority',[['URGENT','Urgent'],['HIGH','High'],['MEDIUM','Medium']],'HIGH')}${textarea('notes','Task notes')}</div>`,'Create reminder',async(form)=>{ await request(`/api/invoices/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({action:'reminder',...formData(form)})}); closeModal(); notify('Payment reminder added to My Day'); await refreshAll(); });
  }
  async function creditInvoice(id) {
    const payload=await invoiceDetail(id); const item=payload.item;
    modal('Issue credit note',`${item.invoiceNumber} · ${money(item.total-item.credited,item.currency)} available to credit`,`<div class="commercial-form-grid">${field('amount','Credit amount',item.outstanding || item.total-item.credited,'number',{required:true,min:0.01,step:'0.01'})}${field('issuedDate','Issue date',new Date().toISOString().slice(0,10),'date',{required:true})}${field('reference','Transaction / accounting reference')}${textarea('reason','Credit reason','',{required:true})}</div>`,'Issue credit note',async(form)=>{ await request(`/api/invoices/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({action:'credit',...formData(form)})}); closeModal(); notify('Credit note issued'); await refreshAll(); });
  }
  async function cancelInvoice(id) {
    modal('Cancel invoice','Cancellation is allowed only before any receipt or credit note.',`<div class="commercial-form-grid">${textarea('reason','Cancellation reason','',{required:true})}</div>`,'Cancel invoice',async(form)=>{ await request(`/api/invoices/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({action:'cancel',...formData(form)})}); closeModal(); notify('Invoice cancelled'); await refreshAll(); });
  }
  async function issueInvoice(id) {
    const payload=await invoiceDetail(id); const item=payload.item;
    modal('Issue draft invoice',item.invoiceNumber,`<div class="commercial-form-grid">${field('dueDate','Due date',item.dueDate || '','date',{required:true})}</div>`,'Issue invoice',async(form)=>{ await request(`/api/invoices/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({action:'issue',...formData(form)})}); closeModal(); notify('Invoice issued'); await refreshAll(); });
  }
  async function proposalStatus(id,status,extra={}) { await request(`/api/proposals/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status,...extra})}); notify(`Proposal moved to ${title(status)}`); await refreshAll(); }
  async function proposalDecision(id) {
    modal('Record proposal decision','Preserve the client decision and next action.',`<div class="commercial-form-grid">${select('status','Decision',[['ACCEPTED','Accepted'],['REJECTED','Rejected'],['EXPIRED','Expired']],'ACCEPTED')}${field('acceptedBy','Accepted by')}${textarea('reason','Rejection reason')}${field('nextAction','Next action','Confirm contract and close as won','text',{full:true})}</div>`,'Save decision',async(form)=>{ const data=formData(form); await proposalStatus(id,data.status,data); closeModal(); });
  }

  async function refreshWorkspace() {
    const panel=$('[data-commercial-workspace]'); panel?.remove(); const workspace=$('#modal-root .revenue-workspace'); if(workspace) workspace.dataset.commercialHardening=''; await enhanceWorkspace();
  }
  async function refreshAll() { state.overview=null; if(isFinancePage()) await renderFinance(true); if($('#modal-root .revenue-workspace')) await refreshWorkspace(); }

  async function action(name, element) {
    if(name==='close-modal'||name==='modal-backdrop')return closeModal();
    if(name==='templates')return openTemplates();
    if(name==='archive-template'){ await request('/api/commercial/templates',{method:'POST',body:JSON.stringify({action:'archive',id:element.dataset.id})}); state.templates=null; closeModal(); notify('Template archived'); return openTemplates(); }
    if(name==='print-invoice')return window.open(`/api/invoices/${encodeURIComponent(element.dataset.id)}/document`,'_blank','noopener');
    if(name==='print-proposal')return window.open(`/api/proposals/${encodeURIComponent(element.dataset.id)}/document`,'_blank','noopener');
    if(name==='pay-invoice')return payInvoice(element.dataset.id);
    if(name==='remind-invoice')return remindInvoice(element.dataset.id);
    if(name==='credit-invoice')return creditInvoice(element.dataset.id);
    if(name==='cancel-invoice')return cancelInvoice(element.dataset.id);
    if(name==='issue-invoice')return issueInvoice(element.dataset.id);
    if(name==='proposal-status')return proposalStatus(element.dataset.id,element.dataset.status);
    if(name==='proposal-decision')return proposalDecision(element.dataset.id);
    if(name==='new-proposal')return newProposal();
    if(name==='new-invoice')return newInvoice();
  }

  window.addEventListener('click',(event)=>{ const open=event.target.closest('[data-revenue-action="open"][data-id]'); if(open) state.currentOpportunityId=open.dataset.id; },true);
  document.addEventListener('click',async(event)=>{
    const element=event.target.closest('[data-commercial-action]'); if(!element)return;
    if(element.dataset.commercialAction==='modal-backdrop'&&event.target!==element)return;
    event.preventDefault(); event.stopImmediatePropagation();
    try{await action(element.dataset.commercialAction,element);}catch(cause){notify(cause.message||'Commercial action failed','error');}
  },true);
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&$('#commercial-modal-root .commercial-modal'))closeModal();});

  const observer=new MutationObserver(()=>{renderFinance();enhanceWorkspace();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{renderFinance();enhanceWorkspace();});
})();
