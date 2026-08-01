(() => {
  const CURRENCIES = ['USD','EUR','USDT','GBP'];
  const ENTITY_TYPES = [
    ['PROJECT','Project / Startup'],['VENTURE_CAPITAL','Venture Capital'],['FUND','Investment Fund'],
    ['EXCHANGE','Exchange'],['LAUNCHPAD','Launchpad'],['PROTOCOL','Protocol'],['AGENCY','Agency'],
    ['CREATOR_NETWORK','Creator Network'],['SERVICE_PROVIDER','Service Provider'],['OTHER','Other'],
  ];
  const BD_STAGES = [
    ['NEW','New'],['RESEARCHING','Researching'],['PROFILE_READY','Profile ready'],['READY_TO_CONTACT','Ready to contact'],
    ['CONTACTED','Contacted'],['REPLIED','Replied'],['MEETING_BOOKED','Meeting booked'],['QUALIFIED','Qualified'],
    ['DISQUALIFIED','Disqualified'],['ON_HOLD','On hold'],
  ];
  let mePromise;
  let teamPromise;
  let partnersPromise;
  let enhancingLead = false;
  let enhancingSettings = false;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const titleCase = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  const money = (value, currency = 'USD') => value === null || value === undefined || value === '' ? '—' : new Intl.NumberFormat('en-US', { style:'currency', currency, maximumFractionDigits:0 }).format(Number(value || 0));
  const currentLeadId = () => sessionStorage.getItem('akari-current-lead-id') || '';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials:'same-origin',
      ...options,
      headers:{ 'content-type':'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message, type = 'success') {
    const root = document.querySelector('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  const me = () => mePromise ||= request('/api/me');
  const team = () => teamPromise ||= request('/api/team').catch(() => ({ items:[] }));
  const partners = () => partnersPromise ||= request('/api/partners').catch(() => ({ items:[] }));

  function options(items, selected = '') {
    return items.map(([value,label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }

  function input(name, label, { value = '', type = 'text', placeholder = '', required = false, full = false, min = '', max = '', step = '', help = '', className = '' } = {}) {
    return `<label class="bd-field ${full ? 'full' : ''} ${className}"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><input name="${name}" type="${type}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} ${step !== '' ? `step="${step}"` : ''}/>${help ? `<small>${escapeHtml(help)}</small>` : ''}</label>`;
  }

  function textarea(name, label, { value = '', placeholder = '', full = true, help = '' } = {}) {
    return `<label class="bd-field ${full ? 'full' : ''}"><span>${escapeHtml(label)}</span><textarea name="${name}" rows="4" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value ?? '')}</textarea>${help ? `<small>${escapeHtml(help)}</small>` : ''}</label>`;
  }

  function select(name, label, items, selected = '', { full = false, required = false, className = '' } = {}) {
    return `<label class="bd-field ${full ? 'full' : ''} ${className}"><span>${escapeHtml(label)}${required ? ' *' : ''}</span><select name="${name}" ${required ? 'required' : ''}>${options(items, selected)}</select></label>`;
  }

  function section(title, description, body, className = '') {
    return `<section class="bd-form-section ${className}"><header><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div></header><div class="bd-field-grid">${body}</div></section>`;
  }

  function dateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).slice(0,16) : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }

  function profileOf(project) {
    return project?.bdProfile || {
      entityType:'PROJECT',
      funding:{ stage:project?.funding_status || '', amountRaised:project?.funding_amount ?? '', currency:'USD', valuation:project?.valuation ?? '' },
      capital:{ aumAmount:'', currency:'USD', checkSizeMin:'', checkSizeMax:'', investmentFocus:'' },
      qualification:{ bdStage:'NEW', serviceInterest:'', nextAction:'' },
      meeting:{ status:'NOT_BOOKED', scheduledAt:null, durationMinutes:30, timezone:'Europe/Berlin', locationUrl:null, syncStatus:'NOT_CONNECTED' },
    };
  }

  async function enhanceLeadModal() {
    const modal = document.querySelector('#modal-root .modal');
    const heading = modal?.querySelector('.modal-head h2')?.textContent?.trim();
    if (!modal || !['New AKARI lead','Edit AKARI lead'].includes(heading)) return;
    const form = modal.querySelector('#active-form');
    const body = form?.querySelector('.modal-body');
    if (!form || !body || form.dataset.bdProfile === 'ready' || enhancingLead) return;
    enhancingLead = true;
    form.dataset.bdProfile = 'loading';
    try {
      const isEdit = heading.startsWith('Edit');
      const id = currentLeadId();
      const [mePayload, teamPayload, partnerPayload, project] = await Promise.all([
        me(), team(), partners(), isEdit && id ? request(`/api/projects/${encodeURIComponent(id)}`) : Promise.resolve(null),
      ]);
      if (!document.body.contains(form)) return;
      const user = mePayload.user || {};
      const profile = profileOf(project);
      const primary = project?.contacts?.find((item) => item.is_primary_contact) || project?.contacts?.[0] || {};
      const ownerItems = [['','Unassigned'], ...(teamPayload.items || []).filter((item) => item.status === 'ACTIVE').map((item) => [item.userId, `${item.fullName} · ${titleCase(item.role)}`])];
      const partnerItems = [['','No referral / direct'], ...(partnerPayload.items || []).map((item) => [item.id, item.name])];
      const lifecycleItems = [['LEAD','Lead'],['PROSPECT','Prospect'],['ACTIVE_OPPORTUNITY','Active opportunity'],['DORMANT_CLIENT','Dormant client'],['FORMER_CLIENT','Former client'],['ARCHIVED','Archived']];
      const currencyItems = CURRENCIES.map((value) => [value,value]);
      const projectFields = `
        ${input('fundingStage','Funding stage',{value:profile.funding?.stage || '',placeholder:'Pre-seed, Seed, Series A…'})}
        ${input('fundingAmount','Total funding raised',{type:'number',value:profile.funding?.amountRaised ?? '',min:0,step:'0.01'})}
        ${select('fundingCurrency','Funding currency',currencyItems,profile.funding?.currency || 'USD')}
        ${input('valuation','Latest valuation',{type:'number',value:profile.funding?.valuation ?? '',min:0,step:'0.01'})}`;
      const capitalFields = `
        ${input('aumAmount','Assets under management (AUM)',{type:'number',value:profile.capital?.aumAmount ?? '',min:0,step:'0.01'})}
        ${select('aumCurrency','AUM currency',currencyItems,profile.capital?.currency || 'USD')}
        ${input('checkSizeMin','Minimum cheque size',{type:'number',value:profile.capital?.checkSizeMin ?? '',min:0,step:'0.01'})}
        ${input('checkSizeMax','Maximum cheque size',{type:'number',value:profile.capital?.checkSizeMax ?? '',min:0,step:'0.01'})}
        ${textarea('investmentFocus','Investment thesis / focus',{value:profile.capital?.investmentFocus || '',placeholder:'Stages, sectors, geographies and exclusions…'})}`;
      body.innerHTML = `<div class="bd-form-sections">
        <div class="bd-identity-banner"><strong>Required identity</strong><span>Every lead and every saved primary contact must include both an X account and Telegram handle.</span></div>
        ${section('Organisation profile','Identify what this relationship is and how AKARI should qualify it.',`
          ${input('name','Project / organisation',{value:project?.name || '',required:true,placeholder:'Organisation name'})}
          ${select('entityType','Organisation type',ENTITY_TYPES,profile.entityType || 'PROJECT',{required:true})}
          ${input('category','Primary category / sector',{value:project?.category || '',placeholder:'DeFi, AI, VC, Gaming…'})}
          ${input('region','Country / region',{value:project?.region || ''})}
          ${input('website','Website',{type:'url',value:project?.website || '',placeholder:'https://'})}
          ${input('xUrl','X account',{value:project?.x_url || '',required:true,placeholder:'@handle or https://x.com/handle'})}
          ${input('telegram','Telegram',{value:project?.telegram || '',required:true,placeholder:'@handle or https://t.me/handle'})}
          ${select('priority','Priority',[['URGENT','Urgent'],['HIGH','High'],['MEDIUM','Medium'],['LOW','Low']],project?.priority || 'MEDIUM')}
          ${isEdit ? select('lifecycleStatus','Lifecycle',lifecycleItems,project?.lifecycle_status || 'LEAD') : ''}
          ${input('sourceName','Lead source',{value:project?.source_name || '',placeholder:'Referral, outbound research, event…'})}
          ${select('referralPartnerId','Introduced by / referral partner',partnerItems,project?.referral_partner_id || '')}
        `)}
        ${section('Project funding profile','For startups, protocols and operating companies.',projectFields,'bd-project-profile')}
        ${section('Investor profile','For venture-capital firms and investment funds.',capitalFields,'bd-capital-profile')}
        ${section('Primary point of contact','Add the person the BD team should reach. Leave all fields blank when the contact is not known yet.',`
          ${input('contactFullName','Full name',{value:primary.full_name || '',placeholder:'Decision-maker or main POC'})}
          ${input('contactJobTitle','Role / title',{value:primary.job_title || primary.contact_role || ''})}
          ${input('contactEmail','Email',{type:'email',value:primary.email || ''})}
          ${input('contactXHandle','X account',{value:primary.x_handle || '',placeholder:'@handle or profile URL'})}
          ${input('contactTelegram','Telegram',{value:primary.telegram || '',placeholder:'@handle or profile URL'})}
          ${input('contactPhone','Phone / other contact',{value:primary.phone || ''})}
          ${select('contactPreferredChannel','Preferred channel',[['TELEGRAM','Telegram'],['EMAIL','Email'],['X','X'],['PHONE','Phone'],['LINKEDIN','LinkedIn']],primary.preferred_channel || 'TELEGRAM')}
          <label class="bd-check-row"><input type="checkbox" name="contactIsDecisionMaker" ${primary.is_decision_maker || !primary.id ? 'checked' : ''}/><span><strong>Decision-maker</strong><small>This contact can approve or materially influence the partnership.</small></span></label>
          ${textarea('contactNotes','Contact notes',{value:primary.notes || '',placeholder:'Relationship context, communication preferences or introduction notes…'})}
        `)}
        ${section('Qualification and next action','Make every lead actionable before the team moves it forward.',`
          ${select('bdStage','BD stage',BD_STAGES,profile.qualification?.bdStage || 'NEW')}
          ${input('serviceInterest','Potential AKARI service',{value:profile.qualification?.serviceInterest || '',placeholder:'GTM, creator campaign, advisory, partnership…'})}
          ${input('nextAction','Next action',{value:profile.qualification?.nextAction || '',placeholder:'Research decision-maker, send intro, book discovery…'})}
          ${input('nextFollowUpAt','Next follow-up',{type:'datetime-local',value:dateTimeLocal(project?.next_follow_up_at)})}
          ${textarea('description','Partnership scope',{value:project?.description || '',placeholder:'What value or service could AKARI create?'})}
          ${textarea('notes','Internal notes',{value:project?.original_notes || ''})}
        `)}
        ${section('Ownership','Assign responsibility without losing referral attribution.',`
          ${select('ownerUserId','Relationship owner',ownerItems,project?.owner_user_id || user.userId || '')}
          <label class="bd-check-row"><input type="checkbox" name="assignToMe" ${!project || project.owner_user_id === user.userId ? 'checked' : ''}/><span><strong>Assign to me</strong><small>Sets ${escapeHtml(user.fullName || user.email || 'the current user')} as owner.</small></span></label>
        `)}
      </div>`;
      modal.classList.add('bd-lead-modal');
      modal.classList.add('wide');
      form.dataset.bdProfile = 'ready';
      const entity = form.elements.entityType;
      const toggleEntitySections = () => {
        const isCapital = ['VENTURE_CAPITAL','FUND'].includes(entity.value);
        form.querySelector('.bd-project-profile')?.toggleAttribute('hidden', isCapital);
        form.querySelector('.bd-capital-profile')?.toggleAttribute('hidden', !isCapital);
      };
      entity.addEventListener('change', toggleEntitySections);
      toggleEntitySections();
      const owner = form.elements.ownerUserId;
      const assign = form.elements.assignToMe;
      assign.addEventListener('change', () => { if (assign.checked) owner.value = user.userId || ''; });
      owner.addEventListener('change', () => { assign.checked = owner.value === user.userId; });
      body.querySelector('input[name="name"]')?.focus();
    } catch (cause) {
      form.dataset.bdProfile = 'error';
      notify(cause.message || 'The BD lead form could not be prepared','error');
    } finally {
      enhancingLead = false;
    }
  }

  function profileProperty(label, value, tone = '') {
    return `<div class="bd-profile-property ${tone}"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  }

  async function enhanceDrawer() {
    const drawer = document.querySelector('#drawer-root .drawer.open');
    const id = currentLeadId();
    if (!drawer || !id) return;
    const active = drawer.querySelector('.drawer-tab.active')?.textContent?.trim()?.toLowerCase();
    if (active !== 'overview' || drawer.querySelector('[data-bd-profile-panel]')) return;
    try {
      const [project, mePayload] = await Promise.all([request(`/api/projects/${encodeURIComponent(id)}`), me()]);
      if (!document.body.contains(drawer) || drawer.querySelector('[data-bd-profile-panel]')) return;
      const profile = profileOf(project);
      const isCapital = ['VENTURE_CAPITAL','FUND'].includes(profile.entityType);
      const metricHtml = isCapital
        ? `${profileProperty('AUM',money(profile.capital?.aumAmount,profile.capital?.currency || 'USD'),'finance-value')}${profileProperty('Cheque size',`${money(profile.capital?.checkSizeMin,profile.capital?.currency || 'USD')} – ${money(profile.capital?.checkSizeMax,profile.capital?.currency || 'USD')}`)}`
        : `${profileProperty('Funding raised',money(profile.funding?.amountRaised,profile.funding?.currency || 'USD'),'finance-value')}${profileProperty('Valuation',money(profile.funding?.valuation,profile.funding?.currency || 'USD'),'finance-value')}`;
      const panel = document.createElement('section');
      panel.className = 'drawer-section bd-profile-panel';
      panel.dataset.bdProfilePanel = 'ready';
      panel.innerHTML = `<div class="bd-profile-heading"><div><h3>BD qualification profile</h3><span>${escapeHtml(titleCase(profile.entityType))}</span></div><span class="bd-completeness">${Number(project.profile_completeness || 0)}% complete</span></div>
        <div class="bd-profile-progress"><i style="width:${Math.max(0,Math.min(100,Number(project.profile_completeness || 0)))}%"></i></div>
        <div class="bd-profile-grid">
          ${profileProperty('BD stage',escapeHtml(titleCase(profile.qualification?.bdStage || 'NEW')))}
          ${profileProperty('Service interest',escapeHtml(profile.qualification?.serviceInterest || 'Not defined'))}
          ${metricHtml}
          ${isCapital ? profileProperty('Investment focus',escapeHtml(profile.capital?.investmentFocus || 'Not recorded')) : profileProperty('Funding stage',escapeHtml(profile.funding?.stage || 'Not recorded'))}
          ${profileProperty('Next action',escapeHtml(profile.qualification?.nextAction || 'No next action'))}
          ${profileProperty('Meeting',profile.meeting?.scheduledAt ? `${escapeHtml(titleCase(profile.meeting.status))}<small>${escapeHtml(new Date(profile.meeting.scheduledAt).toLocaleString())}</small>` : escapeHtml(titleCase(profile.meeting?.status || 'NOT_BOOKED')))}
          ${profileProperty('Calendar sync',escapeHtml(profile.meeting?.syncStatus === 'PENDING_INTEGRATION' ? 'Saved · Google integration pending' : titleCase(profile.meeting?.syncStatus || 'NOT_CONNECTED')))}
          ${project.invoiceSummary ? profileProperty('Invoices',`${project.invoiceSummary.count} · ${money(project.invoiceSummary.outstanding)} outstanding`,'finance-value') : ''}
        </div>`;
      drawer.querySelector('.drawer-body')?.prepend(panel);
      const actions = drawer.querySelector('.drawer-actions');
      if (actions && !actions.querySelector('[data-bd-action="book-call"]')) {
        actions.insertAdjacentHTML('beforeend', `<button class="btn small" data-bd-action="book-call">◷ Book call</button>${mePayload.user?.financeAccess ? '<button class="btn small yellow" data-bd-action="create-invoice">$ Create invoice</button>' : ''}`);
      }
    } catch (cause) {
      console.warn('BD profile panel could not be loaded',cause);
    }
  }

  function renderOwnModal({ title, subtitle, body, submitText, formName }) {
    const root = document.querySelector('#modal-root');
    root.innerHTML = `<div class="modal-backdrop bd-owned-backdrop"><div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="bd-owned-title"><div class="modal-head"><div><h2 id="bd-owned-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button type="button" class="close" data-bd-action="close-modal">×</button></div><form data-bd-form="${formName}"><div class="modal-body">${body}</div><div class="modal-foot"><button type="button" class="btn" data-bd-action="close-modal">Cancel</button><button type="submit" class="btn primary">${escapeHtml(submitText)}</button></div></form></div></div>`;
    const backdrop = root.querySelector('.bd-owned-backdrop');
    backdrop.addEventListener('click',(event) => { if (event.target === backdrop) root.innerHTML = ''; });
    return root.querySelector(`[data-bd-form="${formName}"]`);
  }

  async function openBookCall() {
    const id = currentLeadId();
    if (!id) return notify('Open a lead before booking a call','error');
    const project = await request(`/api/projects/${encodeURIComponent(id)}`);
    const primary = project.contacts?.find((item) => item.is_primary_contact) || project.contacts?.[0] || {};
    const profile = profileOf(project);
    const form = renderOwnModal({
      title:'Book discovery call',
      subtitle:`Save the meeting against ${project.name}. Google Calendar sync will be connected in a later integration.`,
      submitText:'Save booked call',
      formName:'book-call',
      body:`<div class="bd-form-sections">
        <div class="bd-identity-banner warning"><strong>Calendar preparation</strong><span>This records the booking, creates an optional preparation task and stores a future Google Calendar sync state. It does not yet create an external calendar event.</span></div>
        ${section('Meeting details','Keep the time, owner and joining information inside the relationship history.',`
          ${input('meetingScheduledAt','Date and time',{type:'datetime-local',required:true,value:dateTimeLocal(profile.meeting?.scheduledAt)})}
          ${input('meetingDurationMinutes','Duration (minutes)',{type:'number',value:profile.meeting?.durationMinutes || 30,min:5,max:480,step:5})}
          ${input('meetingTimezone','Timezone',{value:profile.meeting?.timezone || 'Europe/Berlin',required:true})}
          ${input('meetingLocationUrl','Meeting link / location',{value:profile.meeting?.locationUrl || '',placeholder:'Google Meet, Zoom or physical location'})}
          ${select('contactId','Primary contact',[['','No contact selected'],...(project.contacts || []).map((item)=>[item.id,`${item.full_name} · ${item.job_title || item.telegram || 'Contact'}`])],primary.id || '')}
          ${input('subject','Meeting subject',{value:`Discovery call · ${project.name}`,required:true})}
          ${input('nextAction','Next action',{value:'Attend discovery call',required:true})}
          ${textarea('description','Agenda / notes',{placeholder:'Objectives, discovery questions and context for the call…'})}
          ${textarea('preparationNotes','Preparation task notes',{placeholder:'Research or materials that must be ready before the call…'})}
          <label class="bd-check-row full"><input type="checkbox" name="createPreparationTask" checked/><span><strong>Create preparation task</strong><small>Adds a high-priority task to My Day for the relationship owner.</small></span></label>
          <input type="hidden" name="projectId" value="${escapeHtml(project.id)}"/><input type="hidden" name="activityType" value="MEETING"/><input type="hidden" name="outcome" value="BOOKED"/><input type="hidden" name="calendarProvider" value="GOOGLE"/>
        `)}
      </div>`,
    });
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const submit=form.querySelector('[type="submit"]'); submit.disabled=true; submit.textContent='Saving…';
      const data=Object.fromEntries(new FormData(form).entries());
      data.createPreparationTask=form.elements.createPreparationTask.checked;
      try{
        await request('/api/activities',{method:'POST',body:JSON.stringify(data)});
        document.querySelector('#modal-root').innerHTML='';
        notify('Discovery call saved and preparation task created');
        document.querySelector('#drawer-root [data-action="close-drawer"]')?.click();
        setTimeout(()=>document.querySelector(`[data-open-lead="${CSS.escape(project.id)}"]`)?.click(),120);
      }catch(cause){notify(cause.message || 'Call booking could not be saved','error');submit.disabled=false;submit.textContent='Save booked call';}
    });
  }

  function addDays(date, days) {
    const copy = new Date(date); copy.setDate(copy.getDate()+Number(days || 0)); return copy.toISOString().slice(0,10);
  }

  async function openInvoice() {
    const id = currentLeadId();
    if (!id) return notify('Open a relationship before creating an invoice','error');
    const [project, billing] = await Promise.all([request(`/api/projects/${encodeURIComponent(id)}`),request('/api/billing-profile')]);
    const profile = billing.billingProfile || {};
    const ready = Boolean(profile.legalName && profile.addressLine1 && profile.country);
    const primary = project.contacts?.find((item)=>item.is_primary_contact) || project.contacts?.[0] || {};
    const today = new Date().toISOString().slice(0,10);
    const due = addDays(today,profile.defaultPaymentTermsDays ?? 14);
    const form = renderOwnModal({
      title:'Create invoice',subtitle:`Create a finance record connected to ${project.name}.`,submitText:'Create invoice',formName:'create-invoice',
      body:`<div class="bd-form-sections">
        ${ready ? '' : '<div class="bd-identity-banner error"><strong>Billing profile incomplete</strong><span>Add AKARI legal name, address and country in Settings before creating an invoice.</span><button type="button" class="btn small" data-bd-action="open-billing-settings">Open Settings</button></div>'}
        ${section('Invoice details','The resulting invoice remains tenant-scoped and visible only to finance-authorised members.',`
          ${input('invoiceDate','Invoice date',{type:'date',value:today,required:true})}
          ${input('dueDate','Due date',{type:'date',value:due,required:true})}
          ${select('currency','Currency',CURRENCIES.map((value)=>[value,value]),billing.tenant?.baseCurrency || 'USD')}
          ${input('description','Line-item description',{value:'AKARI business development and advisory services',required:true,full:true})}
          ${input('quantity','Quantity',{type:'number',value:1,min:0.01,step:'0.01'})}
          ${input('unitPrice','Unit price',{type:'number',value:'',min:0,step:'0.01',required:true})}
          ${input('taxRate','Tax rate %',{type:'number',value:profile.defaultTaxRate ?? 0,min:0,max:100,step:'0.01'})}
          ${input('taxLabel','Tax note',{value:'',placeholder:'Reverse charge, VAT exempt or tax explanation',full:true})}
        `)}
        ${section('Recipient','Confirm the client billing identity before issuing.',`
          ${input('recipientName','Client / organisation',{value:project.name,required:true})}
          ${input('recipientContactName','Contact name',{value:primary.full_name || ''})}
          ${input('recipientEmail','Contact email',{type:'email',value:primary.email || ''})}
          ${input('recipientAddressLine1','Address line 1',{required:true})}
          ${input('recipientAddressLine2','Address line 2')}
          ${input('recipientCity','City')}
          ${input('recipientPostalCode','Postal code')}
          ${input('recipientCountry','Country',{required:true})}
          ${input('recipientVatId','VAT / tax ID')}
          ${textarea('notes','Invoice notes',{placeholder:'Scope, period or contractual reference…'})}
          <input type="hidden" name="projectId" value="${escapeHtml(project.id)}"/>
        `)}
      </div>`,
    });
    if (!ready) form.querySelector('[type="submit"]').disabled=true;
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Creating…';
      const raw=Object.fromEntries(new FormData(form).entries());
      const payload={
        projectId:raw.projectId,invoiceDate:raw.invoiceDate,dueDate:raw.dueDate,currency:raw.currency,status:'INVOICED',
        taxRate:Number(raw.taxRate||0),taxLabel:raw.taxLabel,notes:raw.notes,
        lineItems:[{description:raw.description,quantity:Number(raw.quantity||1),unitPrice:Number(raw.unitPrice||0)}],
        recipient:{name:raw.recipientName,contactName:raw.recipientContactName,email:raw.recipientEmail,addressLine1:raw.recipientAddressLine1,addressLine2:raw.recipientAddressLine2,city:raw.recipientCity,postalCode:raw.recipientPostalCode,country:raw.recipientCountry,vatId:raw.recipientVatId},
      };
      try{
        const result=await request('/api/invoices',{method:'POST',body:JSON.stringify(payload)});
        document.querySelector('#modal-root').innerHTML='';notify(`Invoice ${result.invoiceNumber} created`);
        document.querySelector('[data-route="finance"]')?.click();
      }catch(cause){notify(cause.message||'Invoice could not be created','error');submit.disabled=false;submit.textContent='Create invoice';}
    });
  }

  async function enhanceSettings() {
    const root=document.querySelector('#view-root');
    if (!root || root.querySelector('[data-bd-billing-profile]') || root.querySelector('.page-head h1')?.textContent?.trim()!=='Settings' || enhancingSettings) return;
    enhancingSettings=true;
    try{
      const [mePayload,payload]=await Promise.all([me(),request('/api/billing-profile')]);
      if (!mePayload.user?.financeAccess || !document.body.contains(root)) return;
      const p=payload.billingProfile||{};
      const panel=document.createElement('div');panel.className='panel bd-billing-panel';panel.dataset.bdBillingProfile='ready';
      panel.innerHTML=`<div class="panel-head"><div class="panel-title"><strong>Billing and invoice profile</strong><span>Required before BD or client relationships can generate invoices.</span></div></div><div class="panel-body"><form data-bd-form="billing-profile"><div class="bd-field-grid">
        ${input('legalName','Legal / trading name',{value:p.legalName||'',required:true})}${input('email','Billing email',{type:'email',value:p.email||''})}
        ${input('addressLine1','Address line 1',{value:p.addressLine1||'',required:true})}${input('addressLine2','Address line 2',{value:p.addressLine2||''})}
        ${input('city','City',{value:p.city||''})}${input('postalCode','Postal code',{value:p.postalCode||''})}
        ${input('country','Country',{value:p.country||'',required:true})}${input('vatId','VAT / tax ID',{value:p.vatId||''})}
        ${input('registrationNumber','Registration number',{value:p.registrationNumber||''})}${input('phone','Phone',{value:p.phone||''})}
        ${input('bankName','Bank name',{value:p.bankName||''})}${input('iban','IBAN',{value:p.iban||''})}
        ${input('bic','BIC / SWIFT',{value:p.bic||''})}${input('walletAddress','USDT / crypto wallet',{value:p.walletAddress||''})}
        ${input('invoicePrefix','Invoice prefix',{value:p.invoicePrefix||'AKARI'})}${input('defaultTaxRate','Default tax rate %',{type:'number',value:p.defaultTaxRate??0,min:0,max:100,step:'0.01'})}
        ${input('defaultPaymentTermsDays','Default payment terms (days)',{type:'number',value:p.defaultPaymentTermsDays??14,min:0,max:365,step:1})}
        ${textarea('paymentInstructions','Payment instructions',{value:p.paymentInstructions||'',placeholder:'Bank transfer, wallet and payment reference instructions…'})}
      </div><div class="bd-settings-actions"><button type="submit" class="btn primary">Save billing profile</button></div></form></div>`;
      root.appendChild(panel);
      const form=panel.querySelector('form');form.addEventListener('submit',async(event)=>{event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Saving…';try{await request('/api/billing-profile',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});notify('Billing profile saved');}catch(cause){notify(cause.message||'Billing profile could not be saved','error');}finally{submit.disabled=false;submit.textContent='Save billing profile';}});
    }catch(cause){console.warn('Billing profile could not be loaded',cause);}finally{enhancingSettings=false;}
  }

  document.addEventListener('click',(event)=>{
    const action=event.target.closest('[data-bd-action]')?.dataset.bdAction;
    if (!action) return;
    event.preventDefault();
    if(action==='book-call') openBookCall().catch((cause)=>notify(cause.message||'Call booking could not open','error'));
    if(action==='create-invoice') openInvoice().catch((cause)=>notify(cause.message||'Invoice could not open','error'));
    if(action==='close-modal') document.querySelector('#modal-root').innerHTML='';
    if(action==='open-billing-settings'){document.querySelector('#modal-root').innerHTML='';document.querySelector('[data-route="settings"]')?.click();}
  });

  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&document.querySelector('.bd-owned-backdrop'))document.querySelector('#modal-root').innerHTML='';});

  const observer=new MutationObserver(()=>{
    enhanceLeadModal();
    enhanceDrawer();
    enhanceSettings();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  enhanceLeadModal();enhanceDrawer();enhanceSettings();
})();
