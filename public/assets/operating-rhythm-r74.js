(() => {
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector);
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const title=(value)=>String(value||'').toLowerCase().replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());
  const isMyDay=()=>$('#view-root .page-head h1')?.textContent?.trim()==='My Day';
  const api=async(url,init={})=>{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...init});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`Request failed (${response.status})`);return payload;};
  let loading=false,scope='mine',lastPayload=null;

  function root(){return $('#operating-rhythm-r74');}
  function metric(label,value,className=''){return `<div class="or74__metric ${className}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
  function dueLabel(value){if(!value)return 'No due date';const ts=Date.parse(value);if(!Number.isFinite(ts))return String(value).slice(0,10);const diff=Math.ceil((ts-Date.now())/86400000);if(diff<0)return `${Math.abs(diff)}d overdue`;if(diff===0)return 'Due today';if(diff===1)return 'Due tomorrow';return `Due in ${diff}d`;}
  function attentionCard(item){
    return `<article class="or74__item" data-attention-id="${esc(item.id)}"><div><span class="or74__eyebrow">${esc(title(item.source_type))}</span><h3>${esc(item.title)}</h3><p>${esc(item.summary||'Needs attention.')}</p><div class="or74__meta"><span class="or74__tag" data-priority="${esc(item.priority)}">${esc(item.priority)}</span><span class="or74__tag">${esc(dueLabel(item.due_at))}</span>${item.status!=='OPEN'?`<span class="or74__tag">${esc(title(item.status))}</span>`:''}</div></div><div class="or74__item-actions">${item.status==='OPEN'?'<button class="btn small" data-or74-status="ACKNOWLEDGED">Acknowledge</button>':''}<button class="btn small" data-or74-snooze>Snooze 1d</button><button class="btn small" data-or74-status="RESOLVED">Resolve</button></div></article>`;
  }
  function render(payload){
    lastPayload=payload;
    const node=root();if(!node)return;
    const summary=payload.summary||{},items=payload.attention||[];
    node.innerHTML=`<div class="or74__head"><div><span class="or74__eyebrow">OPERATING RHYTHM</span><h2>Attention Engine</h2><p>One queue for follow-ups, delivery, diligence, finance, agreements and renewals.</p></div><div class="or74__actions"><button class="btn small" data-or74-scope>${scope==='mine'?'My attention':'Team attention'}</button><button class="btn small" data-or74-refresh>Refresh</button><button class="btn small" data-or74-reports>Reports</button></div></div><div class="or74__summary">${metric('Open',summary.total??items.length)}${metric('Urgent',summary.urgent??0,'is-critical')}${metric('High',summary.high??0,'is-high')}${metric('Overdue',summary.overdue??0)}</div><div class="or74__list">${items.length?items.slice(0,12).map(attentionCard).join(''):'<div class="or74__empty">No active attention items. Your operating queue is clear.</div>'}</div><div class="or74__footer"><span>${items.length>12?`Showing 12 of ${items.length}`:`${items.length} active item${items.length===1?'':'s'}`}</span><span>Updated ${new Date(payload.generatedAt||Date.now()).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>`;
  }
  async function load(nextScope=scope){
    if(loading)return;loading=true;scope=nextScope;
    const node=root();if(node)node.setAttribute('aria-busy','true');
    try{render(await api(`/api/operating-rhythm?scope=${encodeURIComponent(scope)}`));}
    catch(error){
      if(scope==='team'&&/manager permission/i.test(error.message)){scope='mine';return load('mine');}
      if(node)node.innerHTML=`<div class="or74-error">${esc(error.message)}</div>`;
    }finally{loading=false;root()?.removeAttribute('aria-busy');}
  }
  function ensure(){
    if(!isMyDay()){root()?.remove();return;}
    if(root())return;
    const pageHead=$('#view-root .page-head');if(!pageHead)return;
    const node=document.createElement('section');node.id='operating-rhythm-r74';node.className='or74';node.setAttribute('aria-live','polite');node.innerHTML='<div class="or74__empty">Loading operating attention…</div>';pageHead.insertAdjacentElement('afterend',node);load();
  }
  async function updateItem(id,status,snoozedUntil=''){
    await api('/api/operating-rhythm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'update-attention',id,status,snoozedUntil})});
    await load();
  }

  function primitive(value){return value===null||['string','number','boolean'].includes(typeof value);}
  function formatValue(value){if(typeof value==='number')return Number.isInteger(value)?String(value):value.toLocaleString(undefined,{maximumFractionDigits:2});if(typeof value==='boolean')return value?'Yes':'No';return String(value??'—');}
  function renderObject(obj){
    const entries=Object.entries(obj||{}).filter(([,value])=>primitive(value));
    if(!entries.length)return '';
    return `<div class="or74-report__grid">${entries.map(([key,value])=>`<div class="or74-report__kv"><span>${esc(title(key))}</span><strong>${esc(formatValue(value))}</strong></div>`).join('')}</div>`;
  }
  function renderArray(rows){
    if(!rows?.length)return '<div class="or74__empty">No records for this section.</div>';
    if(!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))return `<div>${esc(rows.map(formatValue).join(', '))}</div>`;
    const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>rows.some(row=>primitive(row[key]))).slice(0,7);
    return `<div style="overflow:auto"><table class="or74-report__table"><thead><tr>${keys.map(key=>`<th>${esc(title(key))}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,30).map(row=>`<tr>${keys.map(key=>`<td>${esc(formatValue(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function reportSections(report){
    return Object.entries(report||{}).filter(([key])=>!['reportType','generatedAt','periodStart','periodEnd'].includes(key)).map(([key,value])=>{
      let content='';
      if(Array.isArray(value))content=renderArray(value);
      else if(value&&typeof value==='object'){
        const primitives=renderObject(value);
        const nested=Object.entries(value).filter(([,item])=>item&&typeof item==='object').map(([nestedKey,item])=>`<div style="margin-top:10px"><strong>${esc(title(nestedKey))}</strong>${Array.isArray(item)?renderArray(item):renderObject(item)}</div>`).join('');
        content=primitives+nested;
      }else content=`<div>${esc(formatValue(value))}</div>`;
      return `<section class="or74-report__section"><h3>${esc(title(key))}</h3>${content}</section>`;
    }).join('');
  }
  function entityNeeded(type){return ['CLIENT','CAMPAIGN','FOUNDER_WEEKLY','INVESTOR_UPDATE'].includes(type);}
  function openReports(){
    if($('#or74-report-modal'))return;
    const modal=document.createElement('div');modal.className='or74-modal';modal.id='or74-report-modal';modal.innerHTML=`<div class="or74-modal__card" role="dialog" aria-modal="true" aria-labelledby="or74-report-title"><div class="or74-modal__head"><div><span class="or74__eyebrow">R74 REPORTING</span><strong id="or74-report-title">Operating Reports</strong></div><button class="btn small" data-or74-close>Close</button></div><div class="or74-modal__body"><div class="or74-report-controls"><select data-or74-report-type><option>MANAGEMENT</option><option>REVENUE</option><option>FUNDRAISING</option><option>FOUNDER_WEEKLY</option><option>CLIENT</option><option>CAMPAIGN</option><option>INVESTOR_UPDATE</option></select><input data-or74-entity placeholder="Project / Campaign / Round ID" disabled><button class="btn small" data-or74-run-report>Generate</button><button class="btn small" data-or74-snapshot disabled>Save Snapshot</button></div><div class="or74-report" data-or74-report-output><div class="or74__empty">Choose a report and generate a live view.</div></div></div></div>`;document.body.appendChild(modal);modal.querySelector('[data-or74-report-type]')?.focus();
  }
  async function runReport(){
    const modal=$('#or74-report-modal'),type=modal?.querySelector('[data-or74-report-type]')?.value||'',entityId=modal?.querySelector('[data-or74-entity]')?.value.trim()||'',output=modal?.querySelector('[data-or74-report-output]');
    if(!output)return;if(entityNeeded(type)&&!entityId){output.innerHTML='<div class="or74-error">This report needs the relevant Project, Campaign or Fundraising Round ID.</div>';return;}
    output.innerHTML='<div class="or74__empty">Generating report…</div>';
    try{const payload=await api(`/api/operating-rhythm?action=report&reportType=${encodeURIComponent(type)}&entityId=${encodeURIComponent(entityId)}`);output.innerHTML=reportSections(payload.report);modal.dataset.reportType=type;modal.dataset.entityId=entityId;modal.querySelector('[data-or74-snapshot]').disabled=false;}
    catch(error){output.innerHTML=`<div class="or74-error">${esc(error.message)}</div>`;modal.querySelector('[data-or74-snapshot]').disabled=true;}
  }
  async function snapshotReport(){
    const modal=$('#or74-report-modal');if(!modal?.dataset.reportType)return;
    const button=modal.querySelector('[data-or74-snapshot]');button.disabled=true;button.textContent='Saving…';
    try{await api('/api/operating-rhythm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'snapshot-report',reportType:modal.dataset.reportType,entityId:modal.dataset.entityId||'',entityType:modal.dataset.reportType==='CAMPAIGN'?'CAMPAIGN':modal.dataset.reportType==='INVESTOR_UPDATE'?'FUNDRAISING_ROUND':'PROJECT'})});button.textContent='Snapshot Saved';}
    catch(error){button.textContent=error.message||'Save failed';}
    setTimeout(()=>{if(button?.isConnected){button.textContent='Save Snapshot';button.disabled=false;}},1800);
  }

  document.addEventListener('click',async(event)=>{
    const statusButton=event.target.closest?.('[data-or74-status]');if(statusButton){const card=statusButton.closest('[data-attention-id]');if(card)await updateItem(card.dataset.attentionId,statusButton.dataset.or74Status);return;}
    const snooze=event.target.closest?.('[data-or74-snooze]');if(snooze){const card=snooze.closest('[data-attention-id]');if(card)await updateItem(card.dataset.attentionId,'SNOOZED',new Date(Date.now()+86400000).toISOString());return;}
    if(event.target.closest?.('[data-or74-refresh]')){await load();return;}
    if(event.target.closest?.('[data-or74-scope]')){await load(scope==='mine'?'team':'mine');return;}
    if(event.target.closest?.('[data-or74-reports]')){openReports();return;}
    if(event.target.closest?.('[data-or74-close]')){$('#or74-report-modal')?.remove();return;}
    if(event.target.closest?.('[data-or74-run-report]')){await runReport();return;}
    if(event.target.closest?.('[data-or74-snapshot]')){await snapshotReport();return;}
  },true);
  document.addEventListener('change',(event)=>{const select=event.target.closest?.('[data-or74-report-type]');if(!select)return;const input=$('#or74-report-modal [data-or74-entity]');if(input){input.disabled=!entityNeeded(select.value);if(input.disabled)input.value='';}const save=$('#or74-report-modal [data-or74-snapshot]');if(save)save.disabled=true;});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape')$('#or74-report-modal')?.remove();});
  const observer=new MutationObserver(()=>queueMicrotask(ensure));observer.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('DOMContentLoaded',ensure);ensure();
})();
