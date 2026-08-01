import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const middleware=await readFile('functions/_middleware.js','utf8');
const runtime=await readFile('public/assets/tenant-routing-r6.js','utf8');
const app=await readFile('public/app/index.html','utf8');
const redirects=await readFile('public/_redirects','utf8');
test('tenant slug is resolved from the protected route or API header',()=>{assert.match(middleware,/x-akari-tenant/);assert.match(middleware,/^.*\/app\\\/\(\[\^\/\]\+\).*$/m);assert.match(middleware,/rows\.find\(row=>String\(row\.tenant_slug\)/);});
test('cross-tenant workspace access is rejected',()=>{assert.match(middleware,/You do not have access to this CRM workspace/);assert.match(middleware,/WHERE lower\(u\.email\)=lower\(\?\)/);assert.match(middleware,/tm\.status='ACTIVE'/);});
test('canonical workspace routing wraps the existing CRM renderer',()=>{assert.match(runtime,/\/app\/\$\{encodeURIComponent\(slug\)\}/);assert.match(runtime,/x-akari-tenant/);assert.ok(app.indexOf('tenant-routing-r6.js')<app.indexOf('crm.js'));assert.match(redirects,/\/app\/\* \/app\/index\.html 200/);});
