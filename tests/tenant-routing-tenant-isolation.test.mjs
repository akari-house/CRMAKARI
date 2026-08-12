import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {onRequestGet as appRouteGet} from '../functions/app/[[path]].js';

const middleware=await readFile('functions/_middleware.js','utf8');
const runtime=await readFile('public/assets/tenant-routing-r6.js','utf8');
const app=await readFile('public/app/index.html','utf8');
const redirects=await readFile('public/_redirects','utf8');

test('tenant slug is resolved from protected app or portal routes or API header',()=>{
  assert.match(middleware,/x-akari-tenant/);
  assert.match(middleware,/url\.pathname\.match\(\/\^\\\/\(\?:app\|portal\)\\\/\(\[\^\/\]\+\)\//);
  assert.match(middleware,/rows\.find\(\(?row\)?\s*=>\s*String\(row\.tenant_slug\)/);
});

test('cross-tenant workspace access is rejected',()=>{
  assert.match(middleware,/You do not have access to this CRM workspace/);
  assert.match(middleware,/WHERE\s+lower\(u\.email\)\s*=\s*lower\(\?\)/);
  assert.match(middleware,/tm\.status\s*=\s*'ACTIVE'/);
});

test('app root redirects to the authenticated workspace resolver without loading assets',async()=>{
  let assetFetches=0;
  const response=await appRouteGet({
    request:new Request('https://crm.test/app/'),
    data:{auth:{tenantSlug:'akari-house'}},
    env:{ASSETS:{fetch:async()=>{assetFetches+=1;return new Response('unexpected');}}},
  });
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'https://crm.test/enter-crm');
  assert.equal(assetFetches,0);
});

test('canonical tenant route serves the directory app shell exactly once',async()=>{
  let fetchedPath='';
  let assetFetches=0;
  const response=await appRouteGet({
    request:new Request('https://crm.test/app/akari-house/home'),
    data:{auth:{tenantSlug:'akari-house'}},
    env:{ASSETS:{fetch:async request=>{
      assetFetches+=1;
      fetchedPath=new URL(request.url).pathname;
      return new Response('protected shell',{status:200,headers:{'content-type':'text/html'}});
    }}},
  });
  assert.equal(assetFetches,1);
  assert.equal(fetchedPath,'/app/');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-akari-shell'),'protected-crm');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(await response.text(),'protected shell');
});

test('canonical workspace routing wraps the existing CRM renderer without duplicate Pages redirects',()=>{
  assert.match(runtime,/\/app\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(runtime,/x-akari-tenant/);
  assert.ok(app.indexOf('tenant-routing-r6.js')<app.indexOf('crm.js'));
  assert.doesNotMatch(redirects,/^\/app(?:\/|\/\*)?\s/m);
  assert.match(redirects,/\/fundraising \/enter-crm 302/);
});
