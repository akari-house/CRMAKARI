(()=>{
  const MODULES=new Set(['dashboard','home','day','flows','leads','contacts','opportunities','fundraising','campaigns','partners','finance','reports','team','settings']);
  const normalizeRoute=(route)=>route==='home'?'dashboard':MODULES.has(route)?route:'dashboard';
  const parts=location.pathname.split('/').filter(Boolean);
  const isApp=parts[0]==='app';
  let tenantSlug=isApp&&parts[1]?decodeURIComponent(parts[1]):'';
  let moduleName=normalizeRoute(isApp&&parts[2]?decodeURIComponent(parts[2]):'dashboard');

  const canonical=(slug,route='dashboard')=>`/app/${encodeURIComponent(slug)}/${normalizeRoute(route)}`;
  const nativePush=history.pushState.bind(history);
  const nativeReplace=history.replaceState.bind(history);

  async function loadWorkspaces(){
    const headers=tenantSlug?{'x-akari-tenant':tenantSlug}:{};
    const response=await window.fetch('/api/workspaces',{credentials:'same-origin',headers});
    if(response.status===401||response.status===403)throw new Error('CRM access is not assigned to this account');
    if(!response.ok)throw new Error('Unable to load workspaces');
    return response.json();
  }

  if(isApp&&!tenantSlug){
    loadWorkspaces().then(({workspaces=[]})=>{
      const selected=workspaces[0];
      if(!selected)throw new Error('No active CRM workspace is assigned');
      location.replace(canonical(selected.tenantSlug,'dashboard'));
    }).catch((error)=>{
      const app=document.querySelector('#app');
      if(app)app.innerHTML=`<div class="boot-card ak-panel"><strong>CRM access unavailable</strong><span>${String(error.message||error)}</span><a href="/">Return to CRM by AKARI</a></div>`;
    });
    return;
  }

  if(!isApp||!tenantSlug)return;
  window.__AKARI_TENANT_SLUG__=tenantSlug;
  window.__AKARI_ROUTE__=moduleName;

  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init={})=>{
    const url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
      const headers=new Headers(init.headers||(typeof input!=='string'?input.headers:undefined)||{});
      headers.set('x-akari-tenant',tenantSlug);
      init={...init,headers};
    }
    return nativeFetch(input,init);
  };

  function routeFromTarget(target){
    if(typeof target!=='string')return null;
    const match=target.match(/^#\/?([^?]+)/);
    if(match&&MODULES.has(match[1]))return normalizeRoute(match[1]);
    try{
      const targetUrl=new URL(target,location.origin);
      if(targetUrl.pathname==='/')return 'dashboard';
      const cleanRoute=targetUrl.pathname.match(/^\/([^/]+)\/?$/)?.[1];
      return cleanRoute&&MODULES.has(cleanRoute)?normalizeRoute(cleanRoute):null;
    }catch{return null;}
  }
  history.pushState=(state,title,target)=>{
    const route=routeFromTarget(target);
    return nativePush(state,title,route?canonical(tenantSlug,route):target);
  };
  history.replaceState=(state,title,target)=>{
    const route=routeFromTarget(target);
    return nativeReplace(state,title,route?canonical(tenantSlug,route):target);
  };

  nativeReplace(history.state,'',`${location.pathname}${location.search}#/${moduleName}`);
  const clean=()=>nativeReplace(history.state,'',canonical(tenantSlug,moduleName)+location.search);
  addEventListener('load',()=>setTimeout(clean,0),{once:true});
  addEventListener('popstate',()=>{
    const p=location.pathname.split('/').filter(Boolean);
    if(p[0]!=='app'||p[1]!==tenantSlug)return;
    const route=normalizeRoute(p[2]||'dashboard');
    nativeReplace(history.state,'',`${location.pathname}${location.search}#/${route}`);
    setTimeout(()=>nativeReplace(history.state,'',canonical(tenantSlug,route)+location.search),0);
  },true);

  function closePicker(){document.querySelector('#tenant-workspace-picker')?.remove();}
  async function openPicker(){
    closePicker();
    const payload=await loadWorkspaces();
    const workspaces=payload.workspaces||[];
    const modal=document.createElement('div');modal.id='tenant-workspace-picker';modal.className='tenant-picker-backdrop';
    modal.innerHTML=`<section class="tenant-picker" role="dialog" aria-modal="true" aria-label="Switch workspace"><header><div><span>CRM by AKARI</span><h2>Switch workspace</h2></div><button type="button" data-close aria-label="Close">×</button></header><div class="tenant-picker-list">${workspaces.map(w=>`<button type="button" data-tenant="${w.tenantSlug}" class="${w.tenantSlug===tenantSlug?'active':''}"><span class="tenant-avatar">${String(w.tenantName||w.tenantSlug).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}</span><span><strong>${w.tenantName||w.tenantSlug}</strong><small>${String(w.role||'Member').replaceAll('_',' ')}</small></span>${w.tenantSlug===tenantSlug?'<b>Current</b>':'<b>Open</b>'}</button>`).join('')}</div></section>`;
    modal.addEventListener('click',(event)=>{if(event.target===modal||event.target.closest('[data-close]'))closePicker();const button=event.target.closest('[data-tenant]');if(button)location.assign(canonical(button.dataset.tenant,'dashboard'));});
    document.body.appendChild(modal);
  }
  document.addEventListener('click',(event)=>{if(event.target.closest('[data-action="workspace"]')){event.preventDefault();event.stopImmediatePropagation();openPicker().catch(error=>console.error(error));}},true);
})();