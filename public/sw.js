const CACHE_NAME = 'akari-crm-shell-v14';
const APP_SHELL = [
  './index.html?runtime=v14',
  './assets/crm.css?v=14',
  './assets/runtime-guard.css?v=14',
  './assets/operations-v1.css?v=14',
  './assets/lifecycle-v1.css?v=14',
  './assets/uilib.css?v=14',
  './assets/page-upgrades-v1.css?v=14',
  './assets/crm-stabilization-m1.css?v=14',
  './assets/crm-stabilization-runtime-m1.css?v=14',
  './assets/dashboard-polish-v1.css?v=14',
  './assets/crm.js?v=14',
  './assets/operations-v1.js?v=14',
  './assets/lifecycle-v1.js?v=14',
  './assets/identity-v1.js?v=14',
  './assets/page-upgrades-v1.js?v=14',
  './assets/runtime-v8-compat.js?v=14',
  './assets/runtime-v8.js?v=14',
  './assets/runtime-v8-final.js?v=14',
  './assets/crm-stabilization-m1.js?v=14',
  './assets/crm-stabilization-runtime-m1.js?v=14',
  './assets/crm-stabilization-runtime-guard-m1.js?v=14',
  './assets/favicon.svg',
  './manifest.webmanifest?v=14',
];
self.addEventListener('install',(event)=>{event.waitUntil(caches.open(CACHE_NAME).then(async(cache)=>{for(const asset of APP_SHELL){try{await cache.add(asset);}catch(error){console.warn('AKARI CRM asset was not pre-cached',asset,error);}}}));self.skipWaiting();});
self.addEventListener('activate',(event)=>{event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',(event)=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.pathname.startsWith('/api/'))return;event.respondWith(fetch(request,{cache:'no-store'}).then((response)=>{if(response.ok&&url.origin===self.location.origin)caches.open(CACHE_NAME).then((cache)=>cache.put(request,response.clone()));return response;}).catch(async()=>(await caches.match(request))||caches.match('./index.html?runtime=v14')));});