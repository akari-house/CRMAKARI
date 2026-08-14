import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as getReadiness,onRequestPost as updateReadiness } from '../functions/api/production-readiness/index.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call),all:async()=>({results:await this.resolver('all',call)||[]}),run:async()=>this.resolver('run',call)||{success:true}}}};}
}
function auth(role='OWNER'){return{userId:'user_a',email:'owner@example.test',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:true};}
function readContext(db){return{env:{DB:db},data:{auth:auth()},request:new Request('https://crm.test/api/production-readiness')};}

test('V1 release sign-off exposes every frozen acceptance gate',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM tenants/.test(call.sql))return{id:'tenant_a',name:'Tenant A',slug:'tenant-a',status:'ACTIVE',base_currency:'USD',timezone:'Europe/Berlin',plan_code:'FOUNDING',user_limit:3,storage_limit_mb:500};
    if(method==='first'&&/AS projects/.test(call.sql))return{projects:1,leads:1,leads_with_owner:1,leads_with_follow_up:1,contacts:1,open_tasks:0,overdue_tasks:0,open_opportunities:0,won_opportunities:1,active_campaigns:0,payment_records:1,active_members:2,active_owners:1};
    if(method==='all'&&/GROUP BY role/.test(call.sql))return[{role:'OWNER',member_count:1},{role:'BD_MEMBER',member_count:1}];
    if(method==='first'&&/feature_flags_json/.test(call.sql))return{feature_flags_json:'{}'};
    return null;
  });
  const response=await getReadiness(readContext(db)),payload=await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.release,'CRM by AKARI V1.0');
  assert.equal(payload.manualTotal,12);
  const keys=new Set(payload.manualChecks.map(item=>item.key));
  for(const key of ['accessBoundary','roleMatrix','leadToCash','campaignJourney','fundraisingJourney','platformJourney','tenantTwo','portalPrivacy','backupRestore','mobile','integrations','ownerApproval'])assert.ok(keys.has(key),`missing ${key}`);
  assert.equal(payload.manualCompleted,0);
});

test('V1 release sign-off stores new gates in the existing tenant feature flag and audit log',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/feature_flags_json/.test(call.sql)?{feature_flags_json:'{}'}:null);
  const request=new Request('https://crm.test/api/production-readiness',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'portalPrivacy',completed:true,note:'External collaborator regression checked'})});
  const response=await updateReadiness({env:{DB:db},data:{auth:auth()},request});
  assert.equal(response.status,200);
  const update=db.calls.find(call=>/UPDATE tenant_settings/.test(call.sql));
  assert.ok(update);
  const stored=JSON.parse(update.bindings[0]);
  assert.equal(stored.productionReadinessV1.version,2);
  assert.equal(stored.productionReadinessV1.signoff.portalPrivacy.completed,true);
  assert.equal(stored.productionReadinessV1.release,'CRM by AKARI V1.0');
  const audit=db.calls.find(call=>/PRODUCTION_SIGNOFF_UPDATED/.test(call.sql));
  assert.ok(audit);
  assert.equal(audit.bindings[1],'tenant_a');
});
