const CACHE_NAME='akari-crm-shell-v42';
const APP_SHELL=['./app/index.html?runtime=v42','./assets/tenant-routing-r6.js?v=3','./assets/tenant-routing-r6.css?v=2','./assets/crm.css?v=15','./assets/runtime-guard.css?v=15','./assets/operations-v1.css?v=15','./assets/lifecycle-v1.css?v=15','./assets/uilib.css?v=15','./assets/page-upgrades-v1.css?v=15','./assets/crm-stabilization-m1.css?v=15','./assets/dashboard-polish-v1.css?v=15','./assets/akari-app-v1.css?v=15','./assets/bd-workflow-v1.css?v=23','./assets/revenue-lifecycle-v2.css?v=27','./assets/bd-operations-v1.css?v=29','./assets/commercial-hardening-v3.css?v=30','./assets/service-delivery-v4.css?v=33','./assets/fundraising-os-r5.css?v=35','./assets/fundraising-dataroom-r5.css?v=36','./assets/fundraising-closing-r5.css?v=37','./assets/akari-brand-v2.css?v=22','./assets/commercial-modal-stack-v1.css?v=32','./assets/work-os-v1.css?v=1','./assets/work-os-fixes-v1.css?v=1','./assets/my-day-canonical-r8.css?v=1','./assets/modal-system-r9.css?v=1','./assets/deal-outcomes-r11.css?v=1','./assets/select-option-contrast-v1.css?v=1','./assets/custom-select-v2.css?v=1','./assets/global-flow-v1.js?v=26','./assets/my-day-canonical-r8.js?v=1','./assets/crm.js?v=22','./assets/operations-v1.js?v=15','./assets/lifecycle-v1.js?v=15','./assets/identity-v1.js?v=15','./assets/page-upgrades-v1.js?v=15','./assets/crm-stabilization-m1.js?v=15','./assets/akari-app-v1.js?v=15','./assets/bd-workflow-v1.js?v=23','./assets/revenue-lifecycle-v2.js?v=27','./assets/revenue-engagement-prefill-v1.js?v=28','./assets/bd-operations-v1.js?v=29','./assets/commercial-hardening-v3.js?v=30','./assets/commercial-finance-v3-fix.js?v=31','./assets/commercial-command-dedupe-v1.js?v=1','./assets/service-delivery-v4.js?v=33','./assets/fundraising-os-r5.js?v=35','./assets/fundraising-dataroom-r5.js?v=36','./assets/fundraising-closing-r5.js?v=37','./assets/work-os-modal-guard-v1.js?v=1','./assets/work-os-v1.js?v=1','./assets/modal-system-r9.js?v=1','./assets/deal-outcomes-r11.js?v=1','./assets/route-clarity-r10.js?v=1','./assets/custom-select-v2.js?v=1','./assets/brand/akari-icon.png?v=18','./assets/brand/akari-crm-lockup.png?v=18','./manifest.webmanifest?v=18'];

async function store(cache, request, response){
  if(response&&response.ok){try{await cache.put(request,response.clone());}catch(error){console.warn('AKARI CRM cache write skipped',request.url||request,error);}}
  return response;
}

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  const cache=await caches.open(CACHE_NAME);
  return store(cache,request,await fetch(request));
}

async function networkFirst(request){
  const cache=await caches.open(CACHE_NAME);
  try{return await store(cache,request,await fetch(request,{cache:'no-store'}));}
  catch(error){return (await caches.match(request))||null;}
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>Promise.allSettled(APP_SHELL.map(asset=>cache.add(asset)))).then(results=>{
    results.forEach((result,index)=>{if(result.status==='rejected')console.warn('AKARI CRM asset was not pre-cached',APP_SHELL[index],result.reason);});
  }));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  const sameOrigin=url.origin===self.location.origin;
  const versionedStatic=sameOrigin&&(url.pathname.startsWith('/assets/')||url.pathname==='/manifest.webmanifest');
  if(versionedStatic){event.respondWith(cacheFirst(request));return;}
  event.respondWith((async()=>{
    const response=await networkFirst(request);
    if(response)return response;
    const crmRoute=url.pathname==='/app'||url.pathname.startsWith('/app/')||['/dashboard','/home','/flows','/day','/leads','/contacts','/opportunities','/fundraising','/campaigns','/partners','/finance','/reports','/team','/settings'].includes(url.pathname);
    return crmRoute?(await caches.match('./app/index.html?runtime=v42'))||Response.error():Response.error();
  })());
});