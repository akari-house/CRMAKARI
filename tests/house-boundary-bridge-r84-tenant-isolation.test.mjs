import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as ndaStatus} from '../functions/api/v1/house-nda-status.js';
import {onRequestPost as updateBridge} from '../functions/api/v1/house-bridge.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[]}
  prepare(sql){
    return{bind:(...bindings)=>{
      const call={sql:String(sql),bindings};this.calls.push(call);const index=this.calls.length-1;
      return{
        first:async()=>this.resolver('first',call,index),
        all:async()=>({results:await this.resolver('all',call,index)||[]}),
        run:async()=>this.resolver('run',call,index)||{success:true},
      };
    }};
  }
}

const auth={apiKeyId:'key_a',tenantId:'tenant_a',tenantSlug:'akari-house',role:'API',scopes:['read','write']};
const payload=response=>response.json();
function getContext(db,query='houseProjectId=house_project_a&houseMemberId=house_member_a'){
  return{env:{DB:db},data:{auth},request:new Request(`https://crm.test/api/v1/house-nda-status?${query}`)};
}
function postContext(db,body){
  return{env:{DB:db},data:{auth},request:new Request('https://crm.test/api/v1/house-bridge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})};
}

const schemaResolver=(method,call)=>{
  if(method==='first'&&/sqlite_master/.test(call.sql))return{name:call.bindings[0]};
  return undefined;
};

test('R84 NDA lookup requires a tenant-scoped explicit House project mapping',async()=>{
  const db=new FakeDB((method,call)=>{
    const schema=schemaResolver(method,call);if(schema)return schema;
    if(method==='first'&&/FROM external_entity_links/.test(call.sql))return null;
    return null;
  });
  const response=await ndaStatus(getContext(db));
  assert.equal(response.status,200);
  const body=await payload(response);
  assert.equal(body.signed,false);
  assert.equal(body.authoritative,true);
  assert.equal(body.reason,'PROJECT_NOT_LINKED');
  const lookup=db.calls.find(call=>/FROM external_entity_links/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','house_project_a']);
  assert.match(lookup.sql,/eel\.tenant_id=\?/);
  assert.match(lookup.sql,/p\.tenant_id=eel\.tenant_id/);
});

test('R84 NDA lookup is scoped by tenant, CRM project and stable House member id',async()=>{
  const db=new FakeDB((method,call)=>{
    const schema=schemaResolver(method,call);if(schema)return schema;
    if(method==='first'&&/FROM external_entity_links/.test(call.sql))return{project_id:'crm_project_a'};
    if(method==='first'&&/FROM agreements a/.test(call.sql))return{id:'agr_a',status:'ACTIVE',signed_at:'2026-08-01T00:00:00Z',activated_at:'2026-08-02T00:00:00Z',end_date:'2027-08-01T00:00:00Z'};
    return null;
  });
  const response=await ndaStatus(getContext(db));
  const body=await payload(response);
  assert.equal(body.signed,true);
  assert.equal(body.provenance.agreementId,'agr_a');
  const lookup=db.calls.find(call=>/FROM agreements a/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','crm_project_a','house_member_a']);
  assert.match(lookup.sql,/a\.tenant_id=\?/);
  assert.match(lookup.sql,/a\.agreement_type='NDA'/);
  assert.match(lookup.sql,/aci\.external_member_id=\?/);
});

test('R84 entity reconciliation refuses silent remapping to another CRM record',async()=>{
  const db=new FakeDB((method,call)=>{
    const schema=schemaResolver(method,call);if(schema)return schema;
    if(method==='first'&&/SELECT id FROM projects/.test(call.sql))return{id:'crm_project_new'};
    if(method==='first'&&/external_entity_id=\?/.test(call.sql))return{id:'link_a',local_entity_id:'crm_project_existing'};
    return null;
  });
  const response=await updateBridge(postContext(db,{operation:'link-entity',externalEntityType:'PROJECT',externalEntityId:'house_project_a',localEntityType:'PROJECT',localEntityId:'crm_project_new'}));
  assert.equal(response.status,409);
  assert.match((await payload(response)).error,/already linked to a different CRM record/i);
  assert.equal(db.calls.some(call=>/INSERT INTO external_entity_links/.test(call.sql)),false);
});

test('R84 entity reconciliation refuses a CRM record already claimed by another House entity',async()=>{
  const db=new FakeDB((method,call)=>{
    const schema=schemaResolver(method,call);if(schema)return schema;
    if(method==='first'&&/SELECT id FROM projects/.test(call.sql))return{id:'crm_project_a'};
    if(method==='first'&&/external_entity_id=\?/.test(call.sql))return null;
    if(method==='first'&&/local_entity_id=\?/.test(call.sql))return{id:'link_existing',external_entity_id:'house_project_other'};
    return null;
  });
  const response=await updateBridge(postContext(db,{operation:'link-entity',externalEntityType:'PROJECT',externalEntityId:'house_project_a',localEntityType:'PROJECT',localEntityId:'crm_project_a'}));
  assert.equal(response.status,409);
  assert.match((await payload(response)).error,/already linked to a different House entity/i);
  assert.equal(db.calls.some(call=>/INSERT INTO external_entity_links/.test(call.sql)),false);
});

test('R84 agreement counterparty binding rejects a contact from another project',async()=>{
  const db=new FakeDB((method,call)=>{
    const schema=schemaResolver(method,call);if(schema)return schema;
    if(method==='first'&&/FROM agreements WHERE/.test(call.sql))return{id:'agr_a',project_id:'crm_project_a'};
    if(method==='first'&&/FROM contacts WHERE/.test(call.sql))return{id:'contact_b',project_id:'crm_project_b'};
    return null;
  });
  const response=await updateBridge(postContext(db,{operation:'bind-agreement-counterparty',agreementId:'agr_a',houseMemberId:'house_member_a',contactId:'contact_b'}));
  assert.equal(response.status,422);
  assert.match((await payload(response)).error,/must belong to the agreement project/i);
  assert.equal(db.calls.some(call=>/INSERT INTO agreement_counterparty_identity/.test(call.sql)),false);
});
