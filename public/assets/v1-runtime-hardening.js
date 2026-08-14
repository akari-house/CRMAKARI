(()=>{
  const rootId='v1-runtime-status',dataRoomFallbackId='v1-data-room-fallback-root';
  let hideTimer=null,lastFailureAt=0,dataRoomAttemptToken=0;
  function root(){let node=document.getElementById(rootId);if(node)return node;node=document.createElement('div');node.id=rootId;node.setAttribute('aria-live','polite');document.body.appendChild(node);return node;}
  function show(title,message,kind='warning',{persistent=false,duration=4500}={}){
    clearTimeout(hideTimer);const host=root();host.innerHTML='';const banner=document.createElement('div');banner.className='v1-runtime-banner';banner.dataset.kind=kind;banner.setAttribute('role',kind==='error'?'alert':'status');const strong=document.createElement('strong');strong.textContent=title;const span=document.createElement('span');span.textContent=message;banner.append(strong,span);host.appendChild(banner);requestAnimationFrame(()=>banner.classList.add('show'));if(!persistent)hideTimer=setTimeout(()=>{banner.classList.remove('show');setTimeout(()=>{if(host.contains(banner))banner.remove();},220);},duration);
  }
  function reportFailure(reason){const now=Date.now();if(now-lastFailureAt<10000)return;lastFailureAt=now;console.error('CRM by AKARI runtime failure',reason);show('Something went wrong','Refresh the page if this screen stops responding.','error');}
  function visible(node){return Boolean(node&&node.isConnected&&node.getClientRects().length&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');}
  function selectedFundraisingRound(){return String(document.querySelector('#founder-capital-command-r67 [data-fcr67-round]')?.value||'').trim();}
  function setIfDifferent(node,attribute,value){if(node.getAttribute(attribute)!==value)node.setAttribute(attribute,value);}
  function setStyleIfDifferent(node,property,value){if(node.style[property]!==value)node.style[property]=value;}
  function dedupeDataRoomLaunches(){const nodes=[...document.querySelectorAll('#data-room-r72-launch')];nodes.slice(1).forEach(node=>node.remove());}
  function closeDataRoomFallback(){document.getElementById(dataRoomFallbackId)?.remove();syncModalSafety();}
  function showDataRoomFallback(){
    if(document.querySelector('.dr72-modal[role="dialog"]'))return;
    let host=document.getElementById(dataRoomFallbackId);if(host)return;
    host=document.createElement('div');host.id=dataRoomFallbackId;
    host.innerHTML='<div class="dr72-backdrop"><section class="dr72-modal" role="dialog" aria-modal="true" aria-label="Fundraising data room"><header><div><span class="eyebrow">CAPITAL BY AKARI</span><h2>Fundraising data room</h2><span class="dr72-muted">Institutional Data Room</span></div><button type="button" class="dr72-close" data-v1-dr-close aria-label="Close">×</button></header><div class="dr72-panel"><div class="dr72-empty"><strong>Data Room is not available for this round yet.</strong><p>The institutional workspace could not be loaded. Refresh the fundraising workspace or complete the normalized round setup, then try again.</p><button type="button" class="btn" data-v1-dr-retry>Retry Data Room</button></div></div></section></div>';
    document.body.appendChild(host);
    host.querySelector('[data-v1-dr-close]')?.addEventListener('click',closeDataRoomFallback);
    host.querySelector('.dr72-backdrop')?.addEventListener('click',event=>{if(event.target.classList.contains('dr72-backdrop'))closeDataRoomFallback();});
    host.querySelector('[data-v1-dr-retry]')?.addEventListener('click',()=>{closeDataRoomFallback();openInstitutionalDataRoom(0,true);});
    syncModalSafety();
  }
  function dataRoomDialogVisible(){return [...document.querySelectorAll('.dr72-modal[role="dialog"]')].some(dialog=>visible(dialog));}
  function openInstitutionalDataRoom(attempt=0,forceNew=false){
    if(forceNew||attempt===0)dataRoomAttemptToken++;
    const token=dataRoomAttemptToken,roundId=selectedFundraisingRound();let launcher=null;
    if(roundId){try{launcher=document.querySelector(`[data-dr72-round="${CSS.escape(roundId)}"]`);}catch{}}
    launcher=launcher||document.querySelector('[data-dr72-round]');
    if(launcher){
      launcher.click();
      setTimeout(()=>{if(token===dataRoomAttemptToken&&!dataRoomDialogVisible())showDataRoomFallback();},900);
      return true;
    }
    if(attempt<16){setTimeout(()=>{if(token===dataRoomAttemptToken)openInstitutionalDataRoom(attempt+1,false);},75);return false;}
    showDataRoomFallback();return false;
  }
  function syncVisualPolish(){
    document.querySelectorAll('[data-bd-command-center="ready"] [data-bd-command-refresh]').forEach(button=>{if(button.textContent!=='Refresh priorities')button.textContent='Refresh priorities';setIfDifferent(button,'aria-label','Refresh ranked BD priorities');});
    document.querySelectorAll('[data-bd-command-center="ready"] .segmented [data-bd-command-scope]').forEach(button=>setIfDifferent(button,'aria-pressed',button.classList.contains('active')?'true':'false'));
    document.querySelectorAll('.bd-command-next__rank').forEach(rank=>{setIfDifferent(rank,'title','Priority score combines urgency, overdue status, ownership, pipeline evidence and commercial readiness.');setIfDifferent(rank,'aria-label',`Priority score ${rank.querySelector('strong')?.textContent?.trim()||'0'}. Based on urgency, overdue status, ownership, pipeline evidence and commercial readiness.`);});
    document.querySelectorAll('.bd-command-next__copy h3,.bd-command-row__copy strong,.record-main strong').forEach(node=>{const label=node.textContent?.trim();if(label)setIfDifferent(node,'title',label);});
    const relationshipLauncher=document.getElementById('rel73-launch');if(relationshipLauncher){setIfDifferent(relationshipLauncher,'title','Open Relationship 360');setIfDifferent(relationshipLauncher,'aria-label','Open Relationship 360');}
  }
  function syncModalSafety(){
    dedupeDataRoomLaunches();
    document.querySelectorAll('.dr72-modal[role="dialog"]').forEach(dialog=>{setIfDifferent(dialog,'aria-label','Fundraising data room');setIfDifferent(dialog,'aria-modal','true');});
    syncVisualPolish();
    const relationshipLauncher=document.getElementById('rel73-launch');if(!relationshipLauncher)return;
    const activeDialog=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(dialog=>visible(dialog));
    setStyleIfDifferent(relationshipLauncher,'pointerEvents',activeDialog?'none':'');
    setStyleIfDifferent(relationshipLauncher,'opacity',activeDialog?'0':'');
    setIfDifferent(relationshipLauncher,'aria-hidden',activeDialog?'true':'false');
    if(relationshipLauncher.tabIndex!==(activeDialog?-1:0))relationshipLauncher.tabIndex=activeDialog?-1:0;
  }
  window.addEventListener('offline',()=>show('Connection lost','You are offline. Live CRM actions need a connection.','warning',{persistent:true}));
  window.addEventListener('online',()=>show('Connection restored','CRM by AKARI is back online.','success'));
  window.addEventListener('error',event=>reportFailure(event.error||event.message));
  window.addEventListener('unhandledrejection',event=>{if(event.reason?.name==='AbortError')return;reportFailure(event.reason);});
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-fcr67-nav="data-room"]'))queueMicrotask(()=>openInstitutionalDataRoom(0,true));},true);
  new MutationObserver(syncModalSafety).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',syncModalSafety);
  if(!navigator.onLine)show('Connection lost','You are offline. Live CRM actions need a connection.','warning',{persistent:true});
  syncModalSafety();
  window.AkariRuntimeStatus={show,syncModalSafety,syncVisualPolish,openInstitutionalDataRoom,showDataRoomFallback};
})();
