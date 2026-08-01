const CACHE_NAME = 'akari-crm-shell-v27';
const APP_SHELL = [
  './index.html?runtime=v27',
  './assets/crm.css?v=15',
  './assets/runtime-guard.css?v=15',
  './assets/operations-v1.css?v=15',
  './assets/lifecycle-v1.css?v=15',
  './assets/uilib.css?v=15',
  './assets/page-upgrades-v1.css?v=15',
  './assets/crm-stabilization-m1.css?v=15',
  './assets/dashboard-polish-v1.css?v=15',
  './assets/akari-app-v1.css?v=15',
  './assets/bd-workflow-v1.css?v=23',
  './assets/revenue-lifecycle-v2.css?v=27',
  './assets/akari-brand-v2.css?v=21',
  './assets/global-flow-v1.js?v=26',
  './assets/crm.js?v=21',
  './assets/operations-v1.js?v=15',
  './assets/lifecycle-v1.js?v=15',
  './assets/identity-v1.js?v=15',
  './assets/page-upgrades-v1.js?v=15',
  './assets/crm-stabilization-m1.js?v=15',
  './assets/akari-app-v1.js?v=15',
  './assets/bd-workflow-v1.js?v=23',
  './assets/revenue-lifecycle-v2.js?v=27',
  './assets/brand/akari-icon.png?v=18',
  './assets/brand/akari-crm-lockup.png?v=18',
  './manifest.webmanifest?v=18',
];
self.addEventListener('install',(event)=>{event.waitUntil(caches.open(CACHE_NAME).then(async(cache)=>{for(const asset of APP_SHELL){try{await cache.add(asset);}catch(error){console.warn('AKARI CRM asset was not pre-cached',asset,error);}}}));self.skipWaiting();});
self.addEventListener('activate',(event)=>{event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE_NAME).map((key)=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',(event)=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.pathname.startsWith('/api/'))return;event.respondWith(fetch(request,{cache:'no-store'}).then((response)=>{if(response.ok&&url.origin===self.location.origin)caches.open(CACHE_NAME).then((cache)=>cache.put(request,response.clone()));return response;}).catch(async()=>(await caches.match(request))||caches.match('./index.html?runtime=v27')));});
