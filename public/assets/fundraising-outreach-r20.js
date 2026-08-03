(() => {
  'use strict';

  const state = { payload:null,tab:'drafts',loading:false,scheduled:false };
  const $ = (selector,root=document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase());
  const dateLabel = (value) => {
    if (!value) return 'Not scheduled';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
  };

  function isFundraisingRoute() {
    const path=String(location.pathname || '').replace(/\/+$/,'');
    return path.endsWith('/fundraising') || path === '/fundraising';
  }

  async function api(path,options={}) {
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function notify(message,tone='success') {
    const root=$('#toast-root');
    if(!root) return;
    const node=document.createElement('div');
    node.className=`toast ${tone}`;
    node.textContent=message;
    root.appendChild(node);
    setTimeout(()=>node.remove(),3800);
  }

  function modalRoot() {
    let root=$('#fundraising-outreach-modal-root');
    if(!root){root=document.createElement('div');root.id='fundraising-outreach-modal-root';document.body.appendChild(root);}
    return root;
  }

  function chip(value) {
    const normalized=String(value || 'UNKNOWN').toUpperCase();
    const tone=['FULLY_APPROVED','SENT','REPLIED','COMPLETED','POSITIVE','MEETING_BOOKED'].includes(normalized)?'positive'
      :['CANCELLED','CLOSED','NEGATIVE','PASSED','NO_SHOW'].includes(normalized)?'danger'
      :['FOUNDER_APPROVED','EXPORTED','SCHEDULED','NOT_NOW','NEUTRAL'].includes(normalized)?'warning':'neutral';
    return `<span class="fo20-chip fo20-chip--${tone}">${esc(title(normalized))}</span>`;
  }

  function summary(payload) {
    const data=payload.summary || {};
    return `<div class="fo20-summary">
      <article><span>Drafts</span><strong>${Number(data.drafts||0)}</strong><small>${Number(data.awaitingFounder||0)} awaiting founder approval</small></article>
      <article><span>Approval queue</span><strong>${Number(data.awaitingAkari||0)}</strong><small>${Number(data.approved||0)} fully approved</small></article>
      <article><span>Messages recorded</span><strong>${Number(data.sent||0)}</strong><small>Manual sends only · no automatic dispatch</small></article>
      <article><span>Investor meetings</span><strong>${Number(data.upcomingMeetings||0)}</strong><small>${Number(data.followUpsDue||0)} follow-ups due</small></article>
    </div>`;
  }

  function safetyBanner(payload) {
    return `<div class="fo20-safety"><div><strong>Human approval controls are active</strong><p>OpenAI/ChatGPT or Anthropic/Claude may propose content. AKARI never sends the message automatically. Exact recipient, subject and body require founder and AKARI approval before export or manual-send recording.</p></div><span>${payload.storageMode === 'NORMALIZED_D1' ? 'NORMALIZED TARGETS' : 'CAPITAL ROOM COMPATIBILITY'}</span></div>`;
  }

  function tabButton(tab,label,count) {
    return `<button type="button" class="${state.tab===tab?'is-active':''}" data-fo20-tab="${tab}"><span>${esc(label)}</span><b>${Number(count||0)}</b></button>`;
  }

  function approval(item,kind) {
    const approved=item.approvalState?.[kind];
    return `<span class="fo20-approval ${approved?'is-approved':''}"><i>${approved?'✓':'○'}</i>${kind==='founder'?'Founder':'AKARI'}</span>`;
  }

  function draftsView(payload) {
    const items=payload.drafts || [];
    if(!items.length) return '<div class="fo20-empty"><strong>No investor messages yet</strong><p>Create a manual draft or ask the configured ChatGPT/Claude provider for a proposal. Every draft remains unsent until both approvals are recorded.</p></div>';
    return `<div class="fo20-drafts">${items.map((item)=>`<article data-fo20-draft="${esc(item.id)}">
      <header><div><span>${esc(title(item.purpose))}</span><h3>${esc(item.investorName || 'Investor')}</h3><p>${esc(item.personName || item.recipient)} · ${esc(title(item.channel))}</p></div>${chip(item.status)}</header>
      <div class="fo20-subject"><span>Subject</span><strong>${esc(item.subject || 'No subject')}</strong></div>
      <p class="fo20-preview">${esc(item.body || '').slice(0,260)}${String(item.body||'').length>260?'…':''}</p>
      <div class="fo20-approvals">${approval(item,'founder')}${approval(item,'akari')}<span class="fo20-disclosure">${esc(title(item.disclosurePolicy))}</span></div>
      <div class="fo20-meta"><span>Follow-up ${dateLabel(item.followUpAt)}</span>${item.ai?.provider?`<span>${esc(item.ai.provider)} · ${esc(item.ai.model||'model')}</span>`:'<span>Manual draft</span>'}</div>
      <footer><button type="button" data-fo20-action="open-draft" data-id="${esc(item.id)}">Open</button>${draftActions(item,payload)}</footer>
    </article>`).join('')}</div>`;
  }

  function draftActions(item,payload) {
    if(!payload.permissions?.canWrite) return '';
    const actions=[];
    if(!['SENT','REPLIED','CLOSED'].includes(item.status)) actions.push(`<button type="button" data-fo20-action="edit-draft" data-id="${esc(item.id)}">Edit</button>`);
    if(payload.permissions.canApprove && !item.approvalState?.founder) actions.push(`<button type="button" data-fo20-action="approve-founder" data-id="${esc(item.id)}">Founder approve</button>`);
    if(payload.permissions.canApprove && !item.approvalState?.akari) actions.push(`<button type="button" data-fo20-action="approve-akari" data-id="${esc(item.id)}">AKARI approve</button>`);
    if(item.approvalState?.fullyApproved && !['EXPORTED','SENT','REPLIED','CLOSED'].includes(item.status)) actions.push(`<button type="button" data-fo20-action="mark-exported" data-id="${esc(item.id)}">Mark exported</button>`);
    if(item.approvalState?.fullyApproved && !['SENT','REPLIED','CLOSED'].includes(item.status)) actions.push(`<button type="button" data-fo20-action="mark-sent" data-id="${esc(item.id)}">Record manual send</button>`);
    if(['SENT','REPLIED'].includes(item.status)) actions.push(`<button type="button" data-fo20-action="record-reply" data-id="${esc(item.id)}">Record reply</button>`);
    return actions.join('');
  }

  function meetingsView(payload) {
    const items=payload.meetings || [];
    if(!items.length) return '<div class="fo20-empty"><strong>No investor meetings recorded</strong><p>Schedule an investor call, prepare a provider-generated meeting brief, then record notes, outcome and next steps.</p></div>';
    return `<div class="fo20-meetings">${items.map((item)=>`<article data-fo20-meeting="${esc(item.id)}"><header><div><h3>${esc(item.title)}</h3><p>${esc(item.investorName)}${item.personName?` · ${esc(item.personName)}`:''}</p></div>${chip(item.status)}</header><div class="fo20-meeting-time"><strong>${dateLabel(item.meetingAt || item.occurredAt)}</strong><span>${Number(item.durationMinutes||30)} min · ${esc(item.timezone||'')}</span></div><p>${esc(item.agenda||item.brief||'No agenda recorded').slice(0,260)}</p><div class="fo20-meta"><span>Owner ${esc(item.ownerName||item.actorName||'Workspace member')}</span><span>Follow-up ${dateLabel(item.followUpAt)}</span></div><footer><button type="button" data-fo20-action="open-meeting" data-id="${esc(item.id)}">Open</button>${payload.permissions?.canWrite?`<button type="button" data-fo20-action="edit-meeting" data-id="${esc(item.id)}">Edit</button>${item.status==='SCHEDULED'?`<button type="button" data-fo20-action="complete-meeting" data-id="${esc(item.id)}">Complete</button>`:''}<button type="button" data-fo20-action="create-task" data-id="${esc(item.id)}" data-entity-type="MEETING">Follow-up task</button>`:''}</footer></article>`).join('')}</div>`;
  }

  function followUpsView(payload) {
    const records=[...(payload.drafts||[]).map((item)=>({...item,entityType:'DRAFT'})),...(payload.meetings||[]).map((item)=>({...item,entityType:'MEETING'}))]
      .filter((item)=>item.followUpAt)
      .sort((a,b)=>Date.parse(a.followUpAt)-Date.parse(b.followUpAt));
    if(!records.length) return '<div class="fo20-empty"><strong>No scheduled follow-ups</strong><p>Add a follow-up date to a reply or investor meeting.</p></div>';
    return `<div class="fo20-followups">${records.map((item)=>`<article><div><span>${esc(item.entityType)}</span><strong>${esc(item.investorName||item.title||'Investor follow-up')}</strong><small>${esc(item.nextSteps||item.replySummary||item.subject||item.next_action||'Follow-up action')}</small></div><div><b>${dateLabel(item.followUpAt)}</b>${payload.permissions?.canWrite?`<button type="button" data-fo20-action="create-task" data-id="${esc(item.id)}" data-entity-type="${esc(item.entityType)}">Create task</button>`:''}</div></article>`).join('')}</div>`;
  }

  function view(payload) {
    if(state.tab==='meetings') return meetingsView(payload);
    if(state.tab==='followups') return followUpsView(payload);
    return draftsView(payload);
  }

  function render(root) {
    const payload=state.payload;
    if(!payload) return;
    root.innerHTML=`<section class="fo20-shell" aria-labelledby="fo20-title"><header class="fo20-header"><div><span class="fo20-eyebrow">FUNDRAISING OS 2.0</span><h2 id="fo20-title">Controlled Outreach & Meetings</h2><p>Provider-neutral message proposals, exact-content approval, manual-send records, meeting briefs, outcomes and accountable follow-up work.</p></div><div class="fo20-actions">${payload.permissions?.canWrite?'<button type="button" data-fo20-action="new-ai-draft">AI proposal</button><button type="button" data-fo20-action="new-draft">Manual draft</button><button type="button" data-fo20-action="new-meeting">Schedule meeting</button>':''}</div></header>${safetyBanner(payload)}${summary(payload)}<nav class="fo20-tabs">${tabButton('drafts','Message drafts',payload.drafts?.length)}${tabButton('meetings','Investor meetings',payload.meetings?.length)}${tabButton('followups','Follow-ups',payload.summary?.followUpsDue)}</nav><div class="fo20-view" data-fo20-view>${view(payload)}</div></section>`;
  }

  function loading(root){root.innerHTML='<section class="fo20-shell fo20-loading"><i></i><strong>Loading outreach and meetings…</strong><span>Resolving approvals, manual sends and follow-up work</span></section>';}
  function failed(root,message){root.innerHTML=`<section class="fo20-shell fo20-error"><strong>Outreach workspace could not be loaded</strong><p>${esc(message)}</p><button type="button" data-fo20-action="refresh">Try again</button></section>`;}

  async function load(root,force=false){
    if(state.loading) return;
    if(state.payload&&!force){render(root);return;}
    state.loading=true;loading(root);
    try{state.payload=await api('/api/fundraising/outreach');if(isFundraisingRoute())render(root);}catch(cause){failed(root,cause.message||'Unknown error');}finally{state.loading=false;}
  }

  function targetOptions(selected='') {
    return (state.payload?.targets||[]).map((item)=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.project_name)} · ${esc(item.investor_name)}${item.person_name?` · ${esc(item.person_name)}`:''}</option>`).join('');
  }
  function memberOptions(selected='') {
    return (state.payload?.members||[]).map((item)=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.full_name)} · ${esc(title(item.role))}</option>`).join('');
  }
  function selectedTarget(id){return (state.payload?.targets||[]).find((item)=>item.id===id)||null;}
  function draftById(id){return (state.payload?.drafts||[]).find((item)=>item.id===id)||null;}
  function meetingById(id){return (state.payload?.meetings||[]).find((item)=>item.id===id)||null;}

  function formShell(titleText,description,body,submitLabel='Save'){
    modalRoot().innerHTML=`<div class="fo20-backdrop" data-fo20-action="close-modal"><section class="fo20-modal" role="dialog" aria-modal="true" aria-label="${esc(titleText)}"><header><div><span class="fo20-eyebrow">CONTROLLED FUNDRAISING</span><h2>${esc(titleText)}</h2><p>${esc(description)}</p></div><button type="button" data-fo20-action="close-modal" aria-label="Close">×</button></header><form data-fo20-form><div class="fo20-form-grid">${body}</div><footer><button type="button" data-fo20-action="close-modal">Cancel</button><button type="submit">${esc(submitLabel)}</button></footer></form></section></div>`;
    return $('[data-fo20-form]',modalRoot());
  }
  function input(label,name,value='',type='text',attributes=''){return `<label><span>${esc(label)}</span><input type="${type}" name="${esc(name)}" value="${esc(value)}" ${attributes}></label>`;}
  function select(label,name,values,selected=''){return `<label><span>${esc(label)}</span><select name="${esc(name)}">${values.map((value)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(title(value))}</option>`).join('')}</select></label>`;}
  function textarea(label,name,value='',full=true){return `<label class="${full?'full':''}"><span>${esc(label)}</span><textarea name="${esc(name)}">${esc(value)}</textarea></label>`;}

  async function submit(form,body,success){
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{await api('/api/fundraising/outreach',{method:'POST',body:JSON.stringify(body)});modalRoot().innerHTML='';notify(success);state.payload=null;await load($('#fundraising-outreach-root'),true);}catch(cause){notify(cause.message||'Outreach record could not be updated','error');button.disabled=false;}
  }

  function draftForm(item={},aiResult=null){
    const target=selectedTarget(item.targetId)||state.payload?.targets?.[0]||{};
    const form=formShell(item.id?'Edit outreach draft':'Create outreach draft','Exact recipient, subject and body are hashed. Editing any approved content resets both approvals.',`
      <label class="full"><span>Investor target *</span><select name="targetId" required><option value="">Select target</option>${targetOptions(item.targetId||target.id)}</select></label>
      ${select('Channel','channel',state.payload.controls.channels,item.channel||'EMAIL')}
      ${select('Purpose','purpose',state.payload.controls.purposes,item.purpose||'FOLLOW_UP_DRAFT')}
      ${select('Disclosure policy','disclosurePolicy',state.payload.controls.disclosures,item.disclosurePolicy||'SAFE_FOR_OUTREACH')}
      ${input('Recipient *','recipient',item.recipient||target.primary_contact||'','text','required')}
      ${input('Subject','subject',item.subject||aiResult?.subject||'')}
      ${input('Follow-up date','followUpAt',item.followUpAt?String(item.followUpAt).slice(0,16):'','datetime-local')}
      ${textarea('Message body *','body',item.body||aiResult?.body||'',true)}
      <input type="hidden" name="id" value="${esc(item.id||'')}">
      ${aiResult?`<div class="fo20-ai-note full"><strong>${esc(aiResult.provider||'AI')} · ${esc(aiResult.model||'configured model')}</strong><span>Proposal only. Human review is required.</span></div>`:''}
    `,'Save draft');
    form.addEventListener('change',(event)=>{
      if(event.target.name!=='targetId')return;
      const chosen=selectedTarget(event.target.value);
      if(chosen&&!form.elements.recipient.value)form.elements.recipient.value=chosen.primary_contact||'';
    });
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:'save-draft',...data,ai:aiResult?{provider:aiResult.provider,model:aiResult.model,fallbackUsed:aiResult.fallbackUsed,requestId:aiResult.requestId}:item.ai},item.id?'Outreach draft updated':'Outreach draft saved');});
  }

  function parseProposal(result){
    const proposal=result.proposal||result.content||result.text||'';
    if(typeof proposal==='object')return{subject:proposal.subject||'',body:proposal.body||proposal.message||JSON.stringify(proposal)};
    const text=String(proposal);
    const subjectMatch=text.match(/^Subject:\s*(.+)$/im);
    const body=subjectMatch?text.replace(subjectMatch[0],'').trim():text;
    return{subject:subjectMatch?.[1]?.trim()||'',body};
  }

  function aiDraftForm(){
    const target=state.payload?.targets?.[0]||{};
    const form=formShell('Generate AI outreach proposal','Choose OpenAI/ChatGPT or Anthropic/Claude in Settings. This action creates a proposal only and never sends a message.',`
      <label class="full"><span>Investor target *</span><select name="targetId" required><option value="">Select target</option>${targetOptions(target.id)}</select></label>
      ${select('Purpose','purpose',['INTRODUCTION_DRAFT','FOLLOW_UP_DRAFT','DILIGENCE_RESPONSE'],'FOLLOW_UP_DRAFT')}
      ${select('Disclosure policy','disclosurePolicy',['SAFE_FOR_OUTREACH','MEETING_ONLY','DILIGENCE_ONLY'],'SAFE_FOR_OUTREACH')}
      ${textarea('Instructions *','instructions','Draft a concise, evidence-led investor message with a clear next step.',true)}
      ${textarea('Approved context','context',`Investor: ${target.investor_name||''}\nRound: ${target.round_name||''}\nStage: ${target.stage||''}\nNext action: ${target.next_action||''}`,true)}
    `,'Generate proposal');
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Generating…';const data=Object.fromEntries(new FormData(form).entries());
      try{const result=await api('/api/ai/propose',{method:'POST',body:JSON.stringify({purpose:data.purpose,disclosurePolicy:data.disclosurePolicy,context:data.context,instructions:data.instructions})});const parsed=parseProposal(result);draftForm({targetId:data.targetId,purpose:data.purpose,disclosurePolicy:data.disclosurePolicy,channel:'EMAIL'}, { ...parsed,provider:result.provider,model:result.model,fallbackUsed:result.fallbackUsed,requestId:result.requestId });}catch(cause){notify(cause.message||'AI proposal could not be generated','error');button.disabled=false;button.textContent='Generate proposal';}
    });
  }

  function approvalForm(id,kind){
    const item=draftById(id);if(!item)return;
    const form=formShell(`${kind==='FOUNDER'?'Founder':'AKARI'} approval`,'Approval is tied to the current recipient, subject, message body and disclosure policy. Any later edit resets approval.',`${textarea('Approval note','note','')}<input type="hidden" name="id" value="${esc(id)}">`,'Record approval');
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:kind==='FOUNDER'?'approve-founder':'approve-akari',...data},`${kind==='FOUNDER'?'Founder':'AKARI'} approval recorded`);});
  }

  function referenceForm(id,status){
    const form=formShell(status==='SENT'?'Record manual send':'Record export',status==='SENT'?'AKARI records the external message identifier; it does not send the message.':'Record that the fully approved message was copied or exported for manual sending.',`${status==='SENT'?input('Message reference *','reference','','text','required'):input('Export note','reference','Copied to approved email client')}<input type="hidden" name="id" value="${esc(id)}">`,status==='SENT'?'Record send':'Mark exported');
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:status==='SENT'?'mark-sent':'mark-exported',...data},status==='SENT'?'Manual send recorded':'Export recorded');});
  }

  function replyForm(id){
    const form=formShell('Record investor reply','Summarise the response without copying unnecessary sensitive message content.',`${select('Reply outcome','replyStatus',state.payload.controls.replyStates.filter((value)=>value!=='NONE'),'NEUTRAL')}${input('Follow-up date','followUpAt','','datetime-local')}${textarea('Reply summary *','replySummary','')}<input type="hidden" name="id" value="${esc(id)}">`,'Record reply');
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:'record-reply',...data},'Investor reply recorded');});
  }

  function meetingForm(item={},aiResult=null){
    const target=selectedTarget(item.targetId)||state.payload?.targets?.[0]||{};
    const form=formShell(item.id?'Edit investor meeting':'Schedule investor meeting','Prepare an agenda and meeting brief, then record notes and outcomes after the call.',`
      <label class="full"><span>Investor target *</span><select name="targetId" required><option value="">Select target</option>${targetOptions(item.targetId||target.id)}</select></label>
      ${input('Meeting title *','title',item.title||`Investor meeting · ${target.investor_name||''}`,'text','required')}
      ${input('Meeting date *','meetingAt',item.meetingAt?String(item.meetingAt).slice(0,16):'','datetime-local','required')}
      ${input('Duration minutes','durationMinutes',item.durationMinutes||30,'number','min="15" max="480"')}
      ${input('Timezone','timezone',item.timezone||'Europe/Berlin')}
      ${input('HTTPS meeting link','meetingLink',item.meetingLink||'','url')}
      <label><span>Meeting owner</span><select name="ownerUserId">${memberOptions(item.ownerUserId||'')}</select></label>
      ${input('Follow-up date','followUpAt',item.followUpAt?String(item.followUpAt).slice(0,16):'','datetime-local')}
      ${textarea('Agenda','agenda',item.agenda||'')}
      ${textarea('Meeting brief','brief',item.brief||aiResult?.body||'')}
      <input type="hidden" name="id" value="${esc(item.id||'')}">
    `,'Save meeting');
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:'save-meeting',...data,durationMinutes:Number(data.durationMinutes),ai:aiResult?{provider:aiResult.provider,model:aiResult.model,fallbackUsed:aiResult.fallbackUsed,requestId:aiResult.requestId}:item.ai},item.id?'Investor meeting updated':'Investor meeting scheduled');});
  }

  function completeMeetingForm(id){
    const item=meetingById(id);if(!item)return;
    const form=formShell('Complete investor meeting','Notes, outcome and next steps are required so the relationship history remains useful and accountable.',`${textarea('Meeting notes *','notes',item.notes||'')}${textarea('Outcome *','outcome',item.outcome||'')}${textarea('Next steps *','nextSteps',item.nextSteps||'')}${input('Follow-up date','followUpAt',item.followUpAt?String(item.followUpAt).slice(0,16):'','datetime-local')}<input type="hidden" name="id" value="${esc(id)}">`,'Complete meeting');
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:'complete-meeting',...data},'Investor meeting completed');});
  }

  function taskForm(id,entityType){
    const item=entityType==='MEETING'?meetingById(id):draftById(id);if(!item)return;
    const form=formShell('Create outreach follow-up task','Create one Work OS task linked to this investor relationship record.',`${input('Task title','title',`${entityType==='MEETING'?'Investor meeting follow-up':'Investor outreach follow-up'} · ${item.investorName||''}`)}<label><span>Task owner</span><select name="ownerUserId">${memberOptions('')}</select></label>${input('Due date *','dueAt',item.followUpAt?String(item.followUpAt).slice(0,16):'','datetime-local','required')}${textarea('Description','description',item.nextSteps||item.replySummary||'Complete the next investor follow-up action.')}<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="entityType" value="${esc(entityType)}">`,'Create task');
    form.addEventListener('submit',(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());submit(form,{action:'create-follow-up-task',...data},'Outreach follow-up task created');});
  }

  function detailDraft(id){
    const item=draftById(id);if(!item)return;
    modalRoot().innerHTML=`<div class="fo20-backdrop" data-fo20-action="close-modal"><section class="fo20-modal fo20-detail" role="dialog" aria-modal="true" aria-label="Outreach draft"><header><div><span class="fo20-eyebrow">OUTREACH DRAFT</span><h2>${esc(item.investorName)}</h2><p>${esc(item.recipient)} · ${esc(title(item.channel))}</p></div><button type="button" data-fo20-action="close-modal">×</button></header><div class="fo20-detail-body"><section><span>Subject</span><strong>${esc(item.subject||'No subject')}</strong></section><section><span>Message</span><pre>${esc(item.body)}</pre></section><section class="fo20-detail-approvals">${approval(item,'founder')}${approval(item,'akari')}${chip(item.status)}</section></div><footer><button type="button" data-fo20-action="close-modal">Close</button></footer></section></div>`;
  }

  function detailMeeting(id){
    const item=meetingById(id);if(!item)return;
    modalRoot().innerHTML=`<div class="fo20-backdrop" data-fo20-action="close-modal"><section class="fo20-modal fo20-detail" role="dialog" aria-modal="true" aria-label="Investor meeting"><header><div><span class="fo20-eyebrow">INVESTOR MEETING</span><h2>${esc(item.title)}</h2><p>${dateLabel(item.meetingAt)} · ${esc(item.investorName)}</p></div><button type="button" data-fo20-action="close-modal">×</button></header><div class="fo20-detail-body"><section><span>Agenda</span><pre>${esc(item.agenda||'Not recorded')}</pre></section><section><span>Meeting brief</span><pre>${esc(item.brief||'Not recorded')}</pre></section>${item.status==='COMPLETED'?`<section><span>Notes</span><pre>${esc(item.notes||'')}</pre></section><section><span>Outcome & next steps</span><pre>${esc(item.outcome||'')}\n\n${esc(item.nextSteps||'')}</pre></section>`:''}</div><footer><button type="button" data-fo20-action="close-modal">Close</button></footer></section></div>`;
  }

  function handleAction(action,dataset,root){
    if(action==='refresh'){state.payload=null;load(root,true);}
    if(action==='new-draft')draftForm();
    if(action==='new-ai-draft')aiDraftForm();
    if(action==='new-meeting')meetingForm();
    if(action==='open-draft')detailDraft(dataset.id);
    if(action==='edit-draft')draftForm(draftById(dataset.id)||{});
    if(action==='approve-founder')approvalForm(dataset.id,'FOUNDER');
    if(action==='approve-akari')approvalForm(dataset.id,'AKARI');
    if(action==='mark-exported')referenceForm(dataset.id,'EXPORTED');
    if(action==='mark-sent')referenceForm(dataset.id,'SENT');
    if(action==='record-reply')replyForm(dataset.id);
    if(action==='open-meeting')detailMeeting(dataset.id);
    if(action==='edit-meeting')meetingForm(meetingById(dataset.id)||{});
    if(action==='complete-meeting')completeMeetingForm(dataset.id);
    if(action==='create-task')taskForm(dataset.id,dataset.entityType||'DRAFT');
  }

  function bindRoot(root){
    root.addEventListener('click',(event)=>{const tab=event.target.closest('[data-fo20-tab]');if(tab){state.tab=tab.dataset.fo20Tab;render(root);return;}const action=event.target.closest('[data-fo20-action]');if(action)handleAction(action.dataset.fo20Action,action.dataset,root);});
  }
  document.addEventListener('click',(event)=>{const action=event.target.closest('#fundraising-outreach-modal-root [data-fo20-action]');if(!action)return;if(action.dataset.fo20Action==='close-modal'){if(event.target===action||action.tagName==='BUTTON')modalRoot().innerHTML='';return;}handleAction(action.dataset.fo20Action,action.dataset,$('#fundraising-outreach-root'));},true);

  function mount(){state.scheduled=false;if(!isFundraisingRoute())return;const view=$('#view-root');if(!view)return;let root=$('#fundraising-outreach-root',view);if(!root){root=document.createElement('div');root.id='fundraising-outreach-root';root.dataset.fundraisingOutreach='r20';const capital=$('#capital-room-command-centre',view);if(capital)capital.insertAdjacentElement('beforebegin',root);else view.appendChild(root);bindRoot(root);}if(root.dataset.fo20Loaded==='true')return;root.dataset.fo20Loaded='true';load(root);}
  function scheduleMount(){if(state.scheduled)return;state.scheduled=true;requestAnimationFrame(mount);}
  new MutationObserver(scheduleMount).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',scheduleMount);document.addEventListener('akari:route-rendered',scheduleMount);window.addEventListener('popstate',scheduleMount);scheduleMount();
})();
