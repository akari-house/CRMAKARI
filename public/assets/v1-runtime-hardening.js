(()=>{
  const rootId='v1-runtime-status';
  let hideTimer=null,lastFailureAt=0;
  function root(){let node=document.getElementById(rootId);if(node)return node;node=document.createElement('div');node.id=rootId;node.setAttribute('aria-live','polite');document.body.appendChild(node);return node;}
  function show(title,message,kind='warning',{persistent=false,duration=4500}={}){
    clearTimeout(hideTimer);const host=root();host.innerHTML='';const banner=document.createElement('div');banner.className='v1-runtime-banner';banner.dataset.kind=kind;banner.setAttribute('role',kind==='error'?'alert':'status');const strong=document.createElement('strong');strong.textContent=title;const span=document.createElement('span');span.textContent=message;banner.append(strong,span);host.appendChild(banner);requestAnimationFrame(()=>banner.classList.add('show'));if(!persistent)hideTimer=setTimeout(()=>{banner.classList.remove('show');setTimeout(()=>{if(host.contains(banner))banner.remove();},220);},duration);
  }
  function reportFailure(reason){const now=Date.now();if(now-lastFailureAt<10000)return;lastFailureAt=now;console.error('CRM by AKARI runtime failure',reason);show('Something went wrong','Refresh the page if this screen stops responding.','error');}
  function visible(node){return Boolean(node&&node.isConnected&&node.getClientRects().length&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');}
  function selectedFundraisingRound(){return String(document.querySelector('#founder-capital-command-r67 [data-fcr67-round]')?.value||'').trim();}
  function openInstitutionalDataRoom(attempt=0){
    const roundId=selectedFundraisingRound();let launcher=null;
    if(roundId){try{launcher=document.querySelector(`[data-dr72-round="${CSS.escape(roundId)}"]`);}catch{}}
    launcher=launcher||document.querySelector('[data-dr72-round]');
    if(launcher){launcher.click();return true;}
    if(attempt<20)setTimeout(()=>openInstitutionalDataRoom(attempt+1),75);
    return false;
  }
  function syncModalSafety(){
    document.querySelectorAll('.dr72-modal[role="dialog"]').forEach(dialog=>{dialog.setAttribute('aria-label','Fundraising data room');dialog.setAttribute('aria-modal','true');});
    const relationshipLauncher=document.getElementById('rel73-launch');if(!relationshipLauncher)return;
    const activeDialog=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(dialog=>visible(dialog));
    relationshipLauncher.style.pointerEvents=activeDialog?'none':'';relationshipLauncher.style.opacity=activeDialog?'0':'';relationshipLauncher.setAttribute('aria-hidden',activeDialog?'true':'false');relationshipLauncher.tabIndex=activeDialog?-1:0;
  }
  window.addEventListener('offline',()=>show('Connection lost','You are offline. Live CRM actions need a connection.','warning',{persistent:true}));
  window.addEventListener('online',()=>show('Connection restored','CRM by AKARI is back online.','success'));
  window.addEventListener('error',event=>reportFailure(event.error||event.message));
  window.addEventListener('unhandledrejection',event=>{if(event.reason?.name==='AbortError')return;reportFailure(event.reason);});
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-fcr67-nav="data-room"]'))queueMicrotask(()=>openInstitutionalDataRoom());},true);
  new MutationObserver(syncModalSafety).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','aria-modal']});
  document.addEventListener('DOMContentLoaded',syncModalSafety);
  if(!navigator.onLine)show('Connection lost','You are offline. Live CRM actions need a connection.','warning',{persistent:true});
  syncModalSafety();
  window.AkariRuntimeStatus={show,syncModalSafety,openInstitutionalDataRoom};
})();
