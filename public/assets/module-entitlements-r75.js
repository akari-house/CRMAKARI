(() => {
  'use strict';
  const ROUTE_MODULE={flows:'BD',leads:'BD',contacts:'BD',opportunities:'BD',partners:'RELATIONSHIPS',fundraising:'FUNDRAISING',campaigns:'CAMPAIGNS',finance:'REVENUE',reports:'REPORTING'};
  let modules=null,scheduled=false;
  const enabled=module=>!module||!Array.isArray(modules)||modules.includes(module);
  function apply(){
    scheduled=false;
    if(!Array.isArray(modules))return;
    document.querySelectorAll('[data-route]').forEach(node=>{
      const module=ROUTE_MODULE[String(node.dataset.route||'')];
      if(!module)return;
      node.hidden=!enabled(module);
      node.setAttribute('aria-hidden',enabled(module)?'false':'true');
    });
    document.querySelectorAll('[data-command]').forEach(node=>{
      const module=ROUTE_MODULE[String(node.dataset.command||'')];
      if(module&&!enabled(module))node.remove();
    });
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(apply);}
  async function load(){
    try{
      const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)return;
      const payload=await response.json();
      modules=payload?.user?.modules||payload?.modules||null;
      if(Array.isArray(modules))modules=modules.map(value=>String(value||'').toUpperCase());
      schedule();
    }catch{}
  }
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',load);
  load();
})();
