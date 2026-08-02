import { readFile } from 'node:fs/promises';

const router = await readFile('public/assets/tenant-routing-r6.js', 'utf8');
const labels = await readFile('public/assets/route-clarity-r10.js', 'utf8');
const html = await readFile('public/app/index.html', 'utf8');
const worker = await readFile('public/sw.js', 'utf8');

for (const token of ["route==='home'?'dashboard'", "normalizeRoute(route)", "/${normalizeRoute(route)}`"]) {
  if (!router.includes(token)) throw new Error(`Tenant router missing ${token}`);
}
if (router.includes("route==='dashboard'?'home':route")) throw new Error('Dashboard still canonicalizes to /home');
for (const token of ['Public Website', 'Open the public CRM by AKARI website', "[data-route=\"day\"] span", 'img.brand-lockup', "replace('./assets/', '/assets/')"]) {
  if (!labels.includes(token)) throw new Error(`Route clarity runtime missing ${token}`);
}
for (const token of ['/assets/tenant-routing-r6.js?v=3', '/assets/route-clarity-r10.js?v=1']) {
  if (!html.includes(token)) throw new Error(`Protected shell missing ${token}`);
}
for (const token of ['akari-crm-shell-v39', 'app/index.html?runtime=v39', './assets/tenant-routing-r6.js?v=3', './assets/route-clarity-r10.js?v=1']) {
  if (!worker.includes(token)) throw new Error(`Service worker missing ${token}`);
}
console.log('AKARI dashboard route clarity validation passed');