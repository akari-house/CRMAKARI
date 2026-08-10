(() => {
  'use strict';
  if (window.__akariFounderCapitalCommandR67) return;
  window.__akariFounderCapitalCommandR67 = true;

  const ENDPOINTS = [
    '/api/fundraising',
    '/api/fundraising/intelligence',
    '/api/fundraising/universe',
    '/api/fundraising/targeting',
    '/api/fundraising/outreach',
    '/api/fundraising/closing',
    '/api/fundraising/strategy',
  ];
  const READINESS_WEIGHTS = Object.freeze({
    targetAmount:7,instrument:7,owner:7,targetClose:7,thesisAndNextAction:7,
    dataRoomDocuments:10,noOverdueDiligence:10,noUnansweredQuestions:5,
    investorTargets:10,decisionMaker:5,nextInvestorAction:5,warmOrProgressedPath:5,
    noOverdueFollowUps:5,outreachEvidence:5,approvedOrSentOutreach:5,
  });
  const PROGRESSED_STAGES = new Set(['CONTACTED','MEETING','DILIGENCE','PARTNER_MEETING','SOFT_CIRCLE','COMMITTED']);
  const CLOSED_DILIGENCE = new Set(['RESOLVED','CLOSED']);
  const ANSWERED_QUESTION = new Set(['ANSWERED','CLOSED']);
  const OUTREACH_EVIDENCE_STATES = new Set(['DRAFT','FOUNDER_APPROVED','FULLY_APPROVED','EXPORTED','SENT','REPLIED','CLOSED']);
  const APPROVED_OUTREACH_STATES = new Set(['FULLY_APPROVED','EXPORTED','SENT','REPLIED','CLOSED']);
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const text = (value) => String(value ?? '').trim();
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const upper = (value) => text(value).toUpperCase();
  const title = (value) => text(value).replaceAll('_',' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const money = (value, currency = 'USD') => { try { return new Intl.NumberFormat('en-US',{style:'currency',currency:currency || 'USD',maximumFractionDigits:0}).format(number(value)); } catch { return `${number(value).toLocaleString()} ${currency || 'USD'}`; } };
  const isFundraisingRoute = () => {
    const path = String(location.pathname || '').replace(/\/+$/,'');
    return path.endsWith('/fundraising') || path === '/fundraising' || $('#view-root .page-head h1')?.textContent?.trim() === 'Fundraising';
  };
  const state = { data:null, roundId:'', loading:false, scheduled:false, failures:[] };

  async function read(path) {
    const response = await fetch(path,{credentials:'same-origin',cache:'no-store'});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${path} failed (${response.status})`);
    return payload;
  }
  async function loadSources() {
    const settled = await Promise.allSettled(ENDPOINTS.map((path) => read(path)));
    const data = {};
    state.failures = [];
    settled.forEach((result,index) => {
      const key = ['legacy','intelligence','universe','targeting','outreach','closing','strategy'][index];
      if (result.status === 'fulfilled') data[key] = result.value;
      else { data[key] = null; state.failures.push({key,path:ENDPOINTS[index],message:result.reason?.message || 'Unavailable'}); }
    });
    return data;
  }

  function normalizedRounds(data) {
    const normalized = data.intelligence?.rounds || [];
    if (normalized.length) return normalized.map((round) => ({
      id:round.id,projectId:round.project_id || round.projectId || '',projectName:round.project_name || round.projectName || 'Founder project',roundName:round.round_name || round.roundName || 'Current round',stage:upper(round.stage || 'PREPARING'),currency:round.currency || 'USD',targetAmount:number(round.target_amount ?? round.targetAmount),valuation:number(round.valuation),instrument:text(round.instrument),ownerUserId:round.owner_user_id || round.ownerUserId || '',targetCloseDate:round.target_close_date || round.targetCloseDate || '',thesis:text(round.thesis),nextAction:text(round.next_action || round.nextAction),manualReadiness:number(round.readiness_score ?? round.readinessScore),weightedPipeline:number(round.economics?.weightedPipeline),confirmedCommitments:number(round.economics?.confirmedCommitments),fundsReceived:number(round.economics?.fundsReceived),source:'NORMALIZED_D1',
    }));
    const closing = data.closing?.items || [];
    if (closing.length) return closing.map((round) => ({
      id:round.id,projectId:round.projectId || '',projectName:round.projectName || 'Founder project',roundName:round.roundName || 'Current round',stage:upper(round.stage || 'PREPARING'),currency:round.currency || 'USD',targetAmount:number(round.targetAmount ?? round.summary?.target),valuation:number(round.valuation),instrument:text(round.instrument),ownerUserId:round.ownerUserId || '',targetCloseDate:round.targetCloseDate || '',thesis:text(round.thesis),nextAction:text(round.nextAction),manualReadiness:number(round.readinessScore),weightedPipeline:0,confirmedCommitments:number(round.summary?.confirmed),fundsReceived:number(round.summary?.received),source:round.sourceModel || data.closing?.storageMode || 'COMPATIBILITY',
    }));
    return (data.legacy?.items || []).map((room) => ({
      id:room.id,projectId:room.projectId || '',projectName:room.projectName || room.project?.name || 'Founder project',roundName:room.roundName || 'Current round',stage:upper(room.stage || 'PREPARING'),currency:room.currency || 'USD',targetAmount:number(room.targetAmount),valuation:number(room.valuation),instrument:text(room.roundType || room.instrument),ownerUserId:room.ownerUserId || '',targetCloseDate:room.targetCloseDate || '',thesis:text(room.thesis),nextAction:text(room.nextAction),manualReadiness:number(room.readinessScore),weightedPipeline:number(room.investorSummary?.weightedValue),confirmedCommitments:number(room.committedAmount),fundsReceived:0,source:'LEGACY_COMPATIBILITY',
    }));
  }
  function matchByRoundOrProject(items,round) {
    return (items || []).find((item) => item.id === round.id || item.round_id === round.id || item.roundId === round.id) || (items || []).find((item) => (item.project_id || item.projectId) === round.projectId) || null;
  }
  function contextFor(data,round) {
    const legacyRoom = matchByRoundOrProject(data.legacy?.items,round);
    const targetRound = matchByRoundOrProject(data.targeting?.rounds,round);
    const closingRound = matchByRoundOrProject(data.closing?.items,round);
    const strategyRound = matchByRoundOrProject(data.strategy?.rounds,round);
    const targets = targetRound?.targets || closingRound?.investorPipeline || legacyRoom?.investorPipeline || [];
    const outreachDrafts = (data.outreach?.drafts || []).filter((item) => item.roundId === round.id || item.projectId === round.projectId || (!item.roundId && item.projectId === round.projectId));
    const meetings = (data.outreach?.meetings || []).filter((item) => item.roundId === round.id || item.projectId === round.projectId || (!item.roundId && item.projectId === round.projectId));
    const documents = legacyRoom?.dataRoomDocuments || [];
    const diligence = legacyRoom?.diligenceRequests || [];
    const questions = legacyRoom?.investorQuestions || [];
    return {legacyRoom,targetRound,closingRound,strategyRound,targets,outreachDrafts,meetings,documents,diligence,questions};
  }
  function isOverdue(value) { const time = Date.parse(value || ''); return Number.isFinite(time) && time < Date.now(); }
  function hasVerifiedConsentedPath(target) {
    return (target.introduction_paths || target.introductionPaths || []).some((path) => upper(path.verification_status || path.verificationStatus) === 'VERIFIED' && upper(path.consent_status || path.consentStatus) === 'GRANTED');
  }
  function draftFullyApproved(item) {
    if (item.approvalState?.fullyApproved) return true;
    return APPROVED_OUTREACH_STATES.has(upper(item.status));
  }
  function readiness(round,ctx,data) {
    const overdueDiligence = ctx.diligence.filter((item) => !CLOSED_DILIGENCE.has(upper(item.status)) && isOverdue(item.dueDate || item.due_date));
    const unansweredQuestions = ctx.questions.filter((item) => !ANSWERED_QUESTION.has(upper(item.status)));
    const overdueTargetCount = ctx.targets.filter((item) => {
      const followUp = item.next_follow_up_at || item.nextFollowUpAt;
      return followUp && isOverdue(followUp) && !['COMMITTED','PASSED','NOT_NOW'].includes(upper(item.stage));
    }).length;
    const progressed = ctx.targets.some((target) => PROGRESSED_STAGES.has(upper(target.stage)) || hasVerifiedConsentedPath(target));
    const outreachEvidence = ctx.outreachDrafts.some((item) => OUTREACH_EVIDENCE_STATES.has(upper(item.status))) || ctx.meetings.length > 0;
    const approvedOutreach = ctx.outreachDrafts.some(draftFullyApproved) || ctx.meetings.some((item) => ['SCHEDULED','COMPLETED'].includes(upper(item.status)));
    const checks = [
      {key:'targetAmount',group:'Round setup',label:'Target amount configured',weight:READINESS_WEIGHTS.targetAmount,ok:round.targetAmount>0,action:'Set the fundraising target amount',nav:'round'},
      {key:'instrument',group:'Round setup',label:'Instrument configured',weight:READINESS_WEIGHTS.instrument,ok:Boolean(round.instrument),action:'Set the fundraising instrument',nav:'round'},
      {key:'owner',group:'Round setup',label:'Fundraising owner assigned',weight:READINESS_WEIGHTS.owner,ok:Boolean(round.ownerUserId),action:'Assign the fundraising owner',nav:'round'},
      {key:'targetClose',group:'Round setup',label:'Target close date configured',weight:READINESS_WEIGHTS.targetClose,ok:Boolean(round.targetCloseDate),action:'Set a target close date',nav:'round'},
      {key:'thesisAndNextAction',group:'Round setup',label:'Thesis and next action recorded',weight:READINESS_WEIGHTS.thesisAndNextAction,ok:Boolean(round.thesis&&round.nextAction),action:'Complete the fundraising thesis and next action',nav:'round'},
      {key:'dataRoomDocuments',group:'Materials & diligence',label:'Data room has fundraising materials',weight:READINESS_WEIGHTS.dataRoomDocuments,ok:ctx.documents.length>0,action:'Add core fundraising materials to the Data Room',nav:'data-room'},
      {key:'noOverdueDiligence',group:'Materials & diligence',label:'No overdue diligence requests',weight:READINESS_WEIGHTS.noOverdueDiligence,ok:overdueDiligence.length===0,action:'Resolve overdue diligence requests',nav:'diligence'},
      {key:'noUnansweredQuestions',group:'Materials & diligence',label:'Investor questions answered',weight:READINESS_WEIGHTS.noUnansweredQuestions,ok:unansweredQuestions.length===0,action:'Answer outstanding investor questions',nav:'diligence'},
      {key:'investorTargets',group:'Investor strategy',label:'Investor target list exists',weight:READINESS_WEIGHTS.investorTargets,ok:ctx.targets.length>0,action:'Build the investor target list',nav:'investors'},
      {key:'decisionMaker',group:'Investor strategy',label:'A decision maker is identified',weight:READINESS_WEIGHTS.decisionMaker,ok:ctx.targets.some((item)=>Boolean(item.primary_person_name||item.person_name||item.decisionMaker)),action:'Identify a decision maker for a priority investor',nav:'investors'},
      {key:'nextInvestorAction',group:'Investor strategy',label:'Investor next action is explicit',weight:READINESS_WEIGHTS.nextInvestorAction,ok:ctx.targets.some((item)=>Boolean(item.next_action||item.nextAction||item.next_follow_up_at||item.nextFollowUpAt)),action:'Set the next investor action or follow-up',nav:'investors'},
      {key:'warmOrProgressedPath',group:'Investor strategy',label:'Verified path or active investor progress exists',weight:READINESS_WEIGHTS.warmOrProgressedPath,ok:progressed,action:'Verify an introduction path or progress a priority investor',nav:'investors'},
      {key:'noOverdueFollowUps',group:'Execution governance',label:'No overdue investor follow-ups',weight:READINESS_WEIGHTS.noOverdueFollowUps,ok:overdueTargetCount===0,action:'Clear overdue investor follow-ups',nav:'investors'},
      {key:'outreachEvidence',group:'Execution governance',label:'Outreach evidence exists',weight:READINESS_WEIGHTS.outreachEvidence,ok:ctx.targets.length>0&&outreachEvidence,action:'Prepare controlled investor outreach',nav:'outreach'},
      {key:'approvedOrSentOutreach',group:'Execution governance',label:'Approved/sent outreach evidence exists',weight:READINESS_WEIGHTS.approvedOrSentOutreach,ok:ctx.targets.length>0&&approvedOutreach,action:'Complete founder and AKARI outreach approval',nav:'outreach'},
    ];
    const score = checks.reduce((sum,item)=>sum+(item.ok?item.weight:0),0);
    return {score,checks,overdueDiligence,unansweredQuestions,overdueTargetCount};
  }

  function nextRequiredAction(round,ctx,ready) {
    const setup = ready.checks.filter((item)=>item.group==='Round setup'&&!item.ok);
    if (setup.length) return setup[0];
    if (!ctx.targets.length) return {action:'Build the investor target list',nav:'investors'};
    if (ready.overdueTargetCount>0) return {action:`Clear ${ready.overdueTargetCount} overdue investor follow-up${ready.overdueTargetCount===1?'':'s'}`,nav:'investors'};
    if (ready.overdueDiligence.length || ready.unansweredQuestions.length) return {action:'Resolve outstanding investor diligence',nav:'diligence'};
    const pendingApprovals = ctx.outreachDrafts.filter((item)=>!draftFullyApproved(item)&&!['SENT','REPLIED','CLOSED'].includes(upper(item.status)));
    if (pendingApprovals.length) return {action:`Complete approval for ${pendingApprovals.length} investor outreach item${pendingApprovals.length===1?'':'s'}`,nav:'outreach'};
    if (!ctx.outreachDrafts.length && !ctx.meetings.length) return {action:'Prepare and approve investor outreach',nav:'outreach'};
    const reviewingTerms=(ctx.strategyRound?.termSheets||[]).filter((item)=>['RECEIVED','REVIEWING'].includes(upper(item.status)));
    if (reviewingTerms.length) return {action:`Review ${reviewingTerms.length} active term sheet${reviewingTerms.length===1?'':'s'}`,nav:'terms'};
    const summary=ctx.closingRound?.summary||{};
    if (number(summary.outstanding)>0 || (number(summary.commitmentCount)>0 && number(summary.fundedCount)<number(summary.commitmentCount))) return {action:'Reconcile commitments and incoming funds',nav:'commitments'};
    if (ctx.closingRound && round.stage!=='CLOSED' && summary.canClose===false && (summary.blockers||[]).length) return {action:'Clear the remaining round-closing blockers',nav:'closing'};
    if (round.stage==='CLOSED') return {action:'Prepare the next investor relations update',nav:'investor-relations'};
    return {action:round.nextAction || 'Advance the highest-priority investor relationship',nav:'investors'};
  }
  function roundMetrics(round,ctx,data) {
    const targetSummary=ctx.targetRound?.stageSummary||[];
    const weightedFromTargets=targetSummary.reduce((sum,item)=>sum+number(item.weightedExpected),0);
    const closing=ctx.closingRound?.summary||{};
    const strategy=ctx.strategyRound||{};
    const upcomingMeetings=ctx.meetings.filter((item)=>upper(item.status)==='SCHEDULED'&&(!item.meetingAt||Date.parse(item.meetingAt)>=Date.now())).length;
    return {
      target:round.targetAmount,
      weighted:round.weightedPipeline||weightedFromTargets||number(data.targeting?.summary?.expectedPipeline),
      committed:round.confirmedCommitments||number(closing.confirmed),
      received:round.fundsReceived||number(closing.received),
      targetCount:ctx.targets.length,
      upcomingMeetings,
      openDiligence:ctx.diligence.filter((item)=>!CLOSED_DILIGENCE.has(upper(item.status))).length,
      openQuestions:ctx.questions.filter((item)=>!ANSWERED_QUESTION.has(upper(item.status))).length,
      termsReview:(strategy.termSheets||[]).filter((item)=>['RECEIVED','REVIEWING'].includes(upper(item.status))).length,
      closingBlockers:(closing.blockers||[]).length,
      investorUpdates:(ctx.closingRound?.updates||[]).length,
      currency:round.currency||'USD',
    };
  }
  function modeTone(score){return score>=85?'good':score>=65?'warn':'bad';}
  function moduleFailures(){if(!state.failures.length)return '';return `<div class="fcr67-degraded"><strong>${state.failures.length} fundraising module${state.failures.length===1?' is':'s are'} temporarily unavailable</strong><span>The Capital Room remains usable with the available canonical evidence. No fallback data is fabricated.</span><small>${state.failures.map((item)=>esc(item.key)).join(' · ')}</small></div>`;}
  function navButton(key,label){return `<button type="button" data-fcr67-nav="${key}">${esc(label)}</button>`;}
  function readinessGroups(ready){
    const groups=['Round setup','Materials & diligence','Investor strategy','Execution governance'];
    return groups.map((group)=>{const checks=ready.checks.filter((item)=>item.group===group);const earned=checks.reduce((sum,item)=>sum+(item.ok?item.weight:0),0);const total=checks.reduce((sum,item)=>sum+item.weight,0);return `<section><header><strong>${esc(group)}</strong><span>${earned}/${total}</span></header>${checks.map((item)=>`<div class="${item.ok?'is-done':'is-blocked'}"><span>${item.ok?'✓':'!'}</span><b>${esc(item.label)}</b><small>${item.weight} pts</small>${item.ok?'':`<button type="button" data-fcr67-nav="${item.nav}">Fix</button>`}</div>`).join('')}</section>`;}).join('');
  }
  function render() {
    if(!isFundraisingRoute()) return;
    const view=$('#view-root');if(!view||!state.data)return;
    let root=$('#founder-capital-command-r67',view);
    if(!root){root=document.createElement('section');root.id='founder-capital-command-r67';root.className='fcr67-shell';const head=$('.page-head',view);head?.insertAdjacentElement('afterend',root);}
    const rounds=normalizedRounds(state.data);
    if(!rounds.length){root.innerHTML=`<header class="fcr67-head"><div><span>FUNDRAISING OS · R67</span><h2>Founder Capital Room</h2><p>One governed path from fundraising readiness to investor relations.</p></div><span class="fcr67-mode">No active round</span></header>${moduleFailures()}<div class="fcr67-empty"><strong>Create a Founder Capital Room to begin.</strong><span>Round setup remains owned by the existing canonical Capital Room.</span>${navButton('round','Open Round Setup')}</div>`;return;}
    if(!state.roundId||!rounds.some((round)=>round.id===state.roundId))state.roundId=rounds[0].id;
    const round=rounds.find((item)=>item.id===state.roundId)||rounds[0];
    const ctx=contextFor(state.data,round);const ready=readiness(round,ctx,state.data);const metrics=roundMetrics(round,ctx,state.data);const next=nextRequiredAction(round,ctx,ready);
    const percentage=round.targetAmount?Math.min(100,Math.round(metrics.received/round.targetAmount*100)):0;
    root.innerHTML=`
      <header class="fcr67-head"><div><span>FOUNDER CAPITAL ROOM · R67</span><h2>Founder Capital Command Centre</h2><p>Readiness → Round → Data Room → Investors → Outreach → Diligence → Terms → Commitments → Closing → Investor Relations.</p></div><span class="fcr67-mode">${esc(round.source)}</span></header>
      ${moduleFailures()}
      <div class="fcr67-roundbar"><label><span>Fundraising round</span><select data-fcr67-round>${rounds.map((item)=>`<option value="${esc(item.id)}" ${item.id===round.id?'selected':''}>${esc(item.projectName)} · ${esc(item.roundName)}</option>`).join('')}</select></label><div><span>Stage</span><strong>${esc(title(round.stage))}</strong></div><div><span>Manual / stored readiness</span><strong>${Math.round(round.manualReadiness||0)}%</strong></div></div>
      <nav class="fcr67-nav" aria-label="Capital Room modules">${navButton('overview','Overview')}${navButton('readiness','Readiness')}${navButton('round','Round')}${navButton('data-room','Data Room')}${navButton('investors','Investors')}${navButton('outreach','Outreach')}${navButton('diligence','Diligence')}${navButton('terms','Terms')}${navButton('commitments','Commitments')}${navButton('closing','Closing')}${navButton('investor-relations','Investor Relations')}</nav>
      <div class="fcr67-overview" data-fcr67-section="overview">
        <article class="fcr67-score fcr67-score--${modeTone(ready.score)}"><span>Calculated Readiness</span><strong>${ready.score}<small>/100</small></strong><div><i style="width:${ready.score}%"></i></div><small>Transparent evidence score · does not overwrite stored readiness.</small></article>
        <div class="fcr67-kpis"><article><span>Target</span><strong>${money(metrics.target,metrics.currency)}</strong><small>${percentage}% received</small></article><article><span>Weighted pipeline</span><strong>${money(metrics.weighted,metrics.currency)}</strong><small>${metrics.targetCount} investor targets</small></article><article><span>Committed</span><strong>${money(metrics.committed,metrics.currency)}</strong><small>${money(metrics.received,metrics.currency)} received</small></article><article><span>Active diligence</span><strong>${metrics.openDiligence+metrics.openQuestions}</strong><small>${metrics.openDiligence} requests · ${metrics.openQuestions} questions</small></article><article><span>Terms in review</span><strong>${metrics.termsReview}</strong><small>Closing issues · ${metrics.closingBlockers}</small></article><article><span>Investor relations</span><strong>${metrics.investorUpdates}</strong><small>${metrics.upcomingMeetings} upcoming meetings</small></article></div>
      </div>
      <section class="fcr67-next"><div><span>NEXT REQUIRED ACTION</span><strong>${esc(next.action)}</strong><small>Ranked from current round evidence and governance blockers.</small></div><button type="button" class="primary" data-fcr67-nav="${esc(next.nav)}">Open required workspace</button></section>
      <div class="fcr67-readiness" data-fcr67-section="readiness"><header><div><span>READINESS BREAKDOWN</span><strong>${ready.checks.filter((item)=>item.ok).length}/${ready.checks.length} controls satisfied</strong></div><small>Every missing point links to the canonical module that owns the evidence.</small></header><div>${readinessGroups(ready)}</div></div>
      <footer class="fcr67-foot"><strong>Governance:</strong> this command centre is read-only. Investor outreach still requires exact founder + AKARI approval; commitments and closing remain finance-permission controlled; term flags are planning signals, not legal advice.</footer>`;
  }

  function visibleNode(node){return Boolean(node&&node.isConnected&&node.getClientRects().length&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');}
  function focusNode(node){if(!visibleNode(node))return false;node.scrollIntoView({behavior:'smooth',block:'start'});node.classList.add('fcr67-focus');setTimeout(()=>node.classList.remove('fcr67-focus'),1600);return true;}
  function scrollTo(selector){return focusNode($(selector));}
  function recoverCanonical(selector,loadedKey,fallbackSelector='',fallbackKey='',attempt=0){
    const node=$(selector);
    if(node&&focusNode(node))return true;
    if(attempt>=2){if(fallbackSelector)return recoverCanonical(fallbackSelector,fallbackKey,'','',0);return false;}
    if(node&&loadedKey)delete node.dataset[loadedKey];
    document.dispatchEvent(new CustomEvent('akari:route-rendered'));
    setTimeout(()=>recoverCanonical(selector,loadedKey,fallbackSelector,fallbackKey,attempt+1),120);
    return true;
  }
  function openDataRoom() {
    const rounds=normalizedRounds(state.data||{});const round=rounds.find((item)=>item.id===state.roundId)||rounds[0];if(!round)return false;const ctx=contextFor(state.data,round);const id=ctx.legacyRoom?.id;const button=id?$(`[data-dr-room="${CSS.escape(id)}"]`):null;if(button){button.click();return true;}return scrollTo('#fundraising-dataroom-actions')||scrollTo('#capital-room-command-centre');
  }
  function handoff(key){
    if(key==='overview'){scrollTo('#founder-capital-command-r67');return;}
    if(key==='readiness'){scrollTo('[data-fcr67-section="readiness"]');return;}
    if(key==='round'){scrollTo('#capital-room-command-centre');return;}
    if(key==='data-room'||key==='diligence'){openDataRoom();return;}
    if(key==='investors'){recoverCanonical('#fundraising-targeting-root','ft19Loaded','#investor-universe-root','iu18Loaded');return;}
    if(key==='outreach'){recoverCanonical('#fundraising-outreach-root','fo20Loaded');return;}
    if(key==='terms'){recoverCanonical('#fundraising-strategy-root','fs22Loaded');return;}
    if(['commitments','closing','investor-relations'].includes(key)){recoverCanonical('#fundraising-closing-centre','fc5Loaded');}
  }
  function bind(root){
    if(root.dataset.fcr67Bound)return;root.dataset.fcr67Bound='1';root.addEventListener('change',(event)=>{if(event.target.matches('[data-fcr67-round]')){state.roundId=event.target.value;render();}});root.addEventListener('click',(event)=>{const nav=event.target.closest('[data-fcr67-nav]');if(nav)handoff(nav.dataset.fcr67Nav);});
  }
  function renderCached(){if(!state.data||!isFundraisingRoute())return;render();const root=$('#founder-capital-command-r67');if(root)bind(root);}
  async function load(force=false){
    if(state.loading)return;
    if(state.data&&!force){renderCached();return;}
    state.loading=true;
    try{state.data=await loadSources();renderCached();}finally{state.loading=false;}
  }
  function mount(){
    state.scheduled=false;
    if(!isFundraisingRoute()){state.data=null;state.roundId='';return;}
    if(state.data)renderCached();else load();
  }
  function schedule(){if(state.scheduled)return;state.scheduled=true;requestAnimationFrame(mount);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule);document.addEventListener('akari:route-rendered',schedule);window.addEventListener('popstate',schedule);schedule();
})();