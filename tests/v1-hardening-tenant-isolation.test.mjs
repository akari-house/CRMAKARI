import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';
import { onRequestGet as systemHealth } from '../functions/api/system-health.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call),all:async()=>({results:await this.resolver('all',call)||[]}),run:async()=>({success:true})}}};}
}

test('R10 API middleware adds correlation and hardening headers',async()=>{
  const response=await apiMiddleware({
    request:new Request('https://crm.akarihouse.com/api/projects',{headers:{'x-request-id':'req_test_1'}}),
    data:{auth:{tenantId:'tenant_a',userId:'user_a'}},
    next:async()=>new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}}),
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-request-id'),'req_test_1');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('R10 API middleware redacts uncaught server errors from clients',async()=>{
  const response=await apiMiddleware({
    request:new Request('https://crm.akarihouse.com/api/projects'),
    data:{auth:{tenantId:'tenant_a',userId:'user_a'}},
    next:async()=>{throw new Error('secret database implementation detail');},
  });
  const payload=await response.json();
  assert.equal(response.status,500);
  assert.equal(payload.error,'Unexpected server error');
  assert.equal(JSON.stringify(payload).includes('secret database implementation detail'),false);
  assert.ok(payload.requestId);
});

test('R10 system health is authenticated-tenant scoped and verifies V1 schema',async()=>{
  const tables=['agreements','founder_onboarding_items','fundraising_data_room_requirements','relationship_profiles','operational_attention','operating_report_snapshots','platform_admins','workspace_usage_snapshots','workspace_integrations','workspace_api_keys','webhook_endpoints'];
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM tenants WHERE id=\?/i.test(call.sql)){
      assert.deepEqual(call.bindings,['tenant_a']);
      return{id:'tenant_a',slug:'tenant-a',status:'ACTIVE'};
    }
    if(method==='all'&&/FROM sqlite_schema/i.test(call.sql))return tables.map(name=>({name}));
    return null;
  });
  const response=await systemHealth({data:{auth:{tenantId:'tenant_a'},requestId:'req_health_1'},env:{DB:db}});
  const payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.status,'OK');
  assert.equal(payload.requestId,'req_health_1');
  assert.equal(payload.workspace.slug,'tenant-a');
  assert.equal(payload.schema.missing.length,0);
  assert.equal(db.calls.some(call=>call.bindings.includes('tenant_b')),false);
});

test('R10 system health degrades when the production schema is incomplete',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM tenants WHERE id=\?/i.test(call.sql))return{id:'tenant_a',slug:'tenant-a',status:'ACTIVE'};
    if(method==='all'&&/FROM sqlite_schema/i.test(call.sql))return[{name:'agreements'}];
    return null;
  });
  const response=await systemHealth({data:{auth:{tenantId:'tenant_a'},requestId:'req_health_2'},env:{DB:db}});
  const payload=await response.json();
  assert.equal(response.status,503);
  assert.equal(payload.status,'DEGRADED');
  assert.ok(payload.schema.missing.includes('workspace_integrations'));
});
