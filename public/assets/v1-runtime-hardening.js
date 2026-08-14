(()=>{
  const rootId='v1-runtime-status';
  let hideTimer=null,lastFailureAt=0;
  function root(){let node=document.getElementById(rootId);if(node)return node;node=document.createElement('div');node.id=rootId;node.setAttribute('aria-live','polite');document.body.appendChild(node);return node;}
  function show(title,message,kind='warning',{persistent=false,duration=4500}={}){
    clearTimeout(hideTimer);const host=root();host.innerHTML='';const banner=document.createElement('div');banner.className='v1-runtime-banner';banner.dataset.kind=kind;banner.setAttribute('role',kind==='error'?'alert':'status');const strong=document.createElement('strong');strong.textContent=title;const span=document.createElement('span');span.textContent=message;banner.append(strong,span);host.appendChild(banner);requestAnimationFrame(()=>banner.classList.add('show'));if(!persistent)hideTimer=setTimeout(()=>{banner.classList.remove('show');setTimeout(()=>{if(host.contains(banner))banner.remove();},220);},duration);
  }
  function reportFailure(reason){const now=Date.now();if(now-lastFailureAt<10000)return;lastFailureAt=now;console.error('CRM by AKARI runtime failure',reason);show('Something went wrong','Refresh the page if this screen stops responding.','error');}
  window.addEventListener('offline',()=>show('Connection lost','You are offline. Live CRM actions need a connection.','warning',{persistent:true}));
  window.addEventListener('online',()=>show('Connection restored','CRM by AKARI is back online.','success'));
  window.addEventListener('error',event=>reportFailure(event.error||event.message));
  window.addEventListener('unhandledrejection',event=>{if(event.reason?.name==='AbortError')return;reportFailure(event.reason);});
  if(!navigator.onLine)show('Connection lost','You are offline. Live CRM actions need a connection.','warning',{persistent:true});
  window.AkariRuntimeStatus={show};
})();
