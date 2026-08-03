import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet,onRequestPost } from '../functions/api/fundraising/closing.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}};}};}
}
function context({db,body,role='OWNER',financeAccess=true,tenantId='tenant_a'}){return{env:{DB:db},data:{auth:{userId:'user_a',tenantId,tenantSlug:'tenant-a',role,financeAccess}},request:new Request('https://crm.test/api/fundraising/closing',body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})};}
const round={id:'round_a',tenant_id:'tenant_a',project_id:'project_a',project_name:'Founder A',round_name:'Seed',stage:'COMMITMENTS',instrument:'SAFE',currency:'USD',target_amount:500000,valuation:5000000,owner_user_id:'user_a',source_model:'NORMALIZED',updated_at:'2026-08-03T10:00:00.000Z'};
const commitment={id:'commit_a',tenant_id:'tenant_a',round_id:'round_a',target_id:'target_a',status:'SIGNED',committed_amount:250000,allocated_amount:200000,received_amount:100000,currency:'USD',instrument:'SAFE',signed_document_url:'https://docs.example/safe',signed_at:'2026-08-02T10:00:00.000Z',investor_name:'North Star Ventures',person_name:'Alex Partner',created_at:'2026-08-01T10:00:00.000Z',updated_at:'2026-08-03T10:00:00.000Z'};
const normalized=(method,call)=>{
  if(method==='first'&&/SELECT id FROM fundraising_rounds/.test(call.sql))return{id:'round_a'};
  return undefined;
};

test('closing snapshot reads rounds commitments receipts updates and members only inside the authenticated tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='all'&&/SELECT r\.\*,p\.name project_name/.test(call.sql))return[round];
    if(method==='all'&&/FROM fundraising_commitments c/.test(call.sql))return[commitment];
    if(method==='all'&&/FROM activities/.test(call.sql))return[];
    if(method==='all'&&/FROM tenant_memberships tm/.test(call.sql))return[{id:'user_a',full_name:'Muaz',role:'OWNER'}];
    return null;
  });
  const response=await onRequestGet(context({db}));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.storageMode,'NORMALIZED_D1');
  assert.equal(payload.items[0].commitments[0].investorName,'North Star Ventures');
  assert.equal(payload.ai.required,false);
  for(const call of db.calls.filter(call=>/fundraising_rounds|fundraising_commitments|activities|tenant_memberships/.test(call.sql)))assert.equal(call.bindings[0],'tenant_a');
});

test('closing writes reject non-manager roles before database access',async()=>{
  const db=new FakeDB(()=>{throw new Error('database must not be queried');});
  const response=await onRequestPost(context({db,role:'VIEWER',body:{action:'save-commitment'}}));
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('commitment and funds actions require finance access before database access',async()=>{
  const db=new FakeDB(()=>{throw new Error('database must not be queried');});
  const response=await onRequestPost(context({db,role:'BD_MANAGER',financeAccess:false,body:{action:'save-commitment',roundId:'round_a',targetId:'target_a'}}));
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/Finance permission is required/i);
  assert.equal(db.calls.length,0);
});

test('normalized commitment target must belong to the selected tenant round',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='first'&&/SELECT r\.\*,p\.name project_name/.test(call.sql))return round;
    if(method==='first'&&/FROM fundraising_targets t/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-commitment',roundId:'round_a',targetId:'target_other',status:'SOFT',committedAmount:100000,allocatedAmount:0}}));
  assert.equal(response.status,404);
  assert.match((await response.json()).error,/Investor target was not found in this round/i);
  const lookup=db.calls.find(call=>/FROM fundraising_targets t/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','round_a','target_other']);
});

test('funds ledger blocks receipts above the tenant commitment allocation',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='first'&&/SELECT c\.\*,r\.project_id/.test(call.sql))return commitment;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'record-funds',id:'commit_a',roundId:'round_a',amount:150000,rail:'BANK_WIRE',reference:'wire-123',receivedAt:'2026-08-03T12:00:00.000Z'}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/cannot exceed the investor allocation/i);
  assert.equal(db.calls.some(call=>/INSERT INTO activities/.test(call.sql)),false);
});

test('round closing is blocked until active commitments are fully funded or cancelled',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='first'&&/SELECT r\.\*,p\.name project_name/.test(call.sql))return round;
    if(method==='all'&&/SELECT \* FROM fundraising_commitments/.test(call.sql))return[commitment];
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'close-round',roundId:'round_a',closedAt:'2026-08-03T12:00:00.000Z',closingNotes:'Final close'}}));
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/Every active commitment must be funded or cancelled/i);
  assert.equal(db.calls.some(call=>/FUNDRAISING_ROUND_CLOSING/.test(JSON.stringify(call.bindings))),false);
});

test('publishing investor updates remains Owner or Admin controlled',async()=>{
  const db=new FakeDB((method,call)=>normalized(method,call)??null);
  const response=await onRequestPost(context({db,role:'BD_MANAGER',body:{action:'publish-investor-update',roundId:'round_a',id:'update_a'}}));
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/Owner or Admin permission is required/i);
});

test('closing follow-up task owner must be an active member of the same tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='first'&&/SELECT r\.\*,p\.name project_name/.test(call.sql))return round;
    if(method==='first'&&/FROM users u/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'create-follow-up-task',roundId:'round_a',ownerUserId:'user_other',dueAt:'2026-08-10T10:00:00.000Z'}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/active workspace member/i);
  const lookup=db.calls.find(call=>/FROM users u/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','user_other']);
});

test('legacy Capital Room remains operational when migration 0002 is not applied',async()=>{
  const flags={fundraisingCapitalRooms:[{id:'legacy_room',projectId:'project_a',projectName:'Founder A',roundName:'Seed',stage:'COMMITMENTS',currency:'USD',targetAmount:500000,investorPipeline:[],commitments:[],investorUpdates:[]}]};
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM fundraising_rounds/.test(call.sql))throw new Error('D1_ERROR: no such table: fundraising_rounds');
    if(method==='first'&&/tenant_settings/.test(call.sql))return{feature_flags_json:JSON.stringify(flags)};
    return null;
  });
  const response=await onRequestGet(context({db}));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.storageMode,'LEGACY_COMPATIBILITY');
  assert.equal(payload.readOnly,false);
  assert.equal(payload.items[0].id,'legacy_room');
});
