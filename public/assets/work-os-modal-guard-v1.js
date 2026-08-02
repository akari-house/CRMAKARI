(()=>{'use strict';
document.addEventListener('click',(event)=>{
  const backdrop=event.target.closest?.('.work-modal-backdrop');
  if(!backdrop)return;
  const explicitClose=event.target.closest?.('[data-work-action="close-modal"]');
  if(event.target!==backdrop&&!explicitClose){
    event.stopImmediatePropagation();
  }
},true);
})();
