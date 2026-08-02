(()=>{'use strict';
function guard(){
  document.querySelectorAll('.work-modal-backdrop[data-work-action="close-modal"]').forEach((backdrop)=>{
    backdrop.removeAttribute('data-work-action');
    if(backdrop.dataset.workBackdropBound==='1')return;
    backdrop.dataset.workBackdropBound='1';
    backdrop.addEventListener('click',(event)=>{
      if(event.target!==backdrop)return;
      const root=document.querySelector('#work-os-modal-root');
      if(root)root.innerHTML='';
    });
  });
}
const observer=new MutationObserver(guard);
observer.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',guard);
})();
