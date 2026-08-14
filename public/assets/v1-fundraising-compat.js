(()=>{
  'use strict';
  if(window.__akariV1FundraisingCompat)return;
  window.__akariV1FundraisingCompat=true;

  const visible=(node)=>Boolean(node&&node.isConnected&&node.getClientRects().length&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');

  function selectedRoundId(){
    return String(document.querySelector('#founder-capital-command-r67 [data-fcr67-round]')?.value||'').trim();
  }

  function openInstitutionalDataRoom(attempt=0){
    const roundId=selectedRoundId();
    let launcher=null;
    if(roundId){
      try{launcher=document.querySelector(`[data-dr72-round="${CSS.escape(roundId)}"]`);}catch{}
    }
    launcher=launcher||document.querySelector('[data-dr72-round]');
    if(launcher){launcher.click();return true;}
    if(attempt<20)setTimeout(()=>openInstitutionalDataRoom(attempt+1),75);
    return false;
  }

  function syncDialogSafety(){
    document.querySelectorAll('.dr72-modal[role="dialog"]').forEach((dialog)=>{
      dialog.setAttribute('aria-label','Fundraising data room');
      dialog.setAttribute('aria-modal','true');
    });
    const relationshipLauncher=document.getElementById('rel73-launch');
    if(!relationshipLauncher)return;
    const activeDialog=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((dialog)=>visible(dialog));
    relationshipLauncher.style.pointerEvents=activeDialog?'none':'';
    relationshipLauncher.style.opacity=activeDialog?'0':'';
    relationshipLauncher.setAttribute('aria-hidden',activeDialog?'true':'false');
    relationshipLauncher.tabIndex=activeDialog?-1:0;
  }

  document.addEventListener('click',(event)=>{
    const nav=event.target.closest?.('[data-fcr67-nav="data-room"]');
    if(nav)queueMicrotask(()=>openInstitutionalDataRoom());
  },true);

  new MutationObserver(syncDialogSafety).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','aria-modal']});
  document.addEventListener('DOMContentLoaded',syncDialogSafety);
  syncDialogSafety();
})();
