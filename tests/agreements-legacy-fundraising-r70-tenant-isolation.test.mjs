import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet,onRequestPost} from '../functions/api/agreements/index.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);const index=this.calls.length-1;return{first:async()=>this.resolver('first',call,index),all:async()=>({results:await this.resolver('all',call,index)||[]}),run:async()=>this.resolver('run',call,index)||{success:true}};}};}
}

const auth={userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role:'OWNER',financeAccess:true};
const ctx=(db,{method='GET',body={}}={})=>({env:{DB:db,AUTH_MODE:'access'},data:{auth},request:new Request('https://crm.test/api/agreements',{method,headers:{'content-type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined})});

function legacyDb(){
  return new FakeDB((method,call)=>{
    if(method==='first'&&/sqlite_master/.test(call.sql)){
      const table=call.bindings[0];
      if(table==='agreements')return{name:'agreements'};
      if(table==='fundraising_rounds')return null;
    }
    if(method==='all'&&/FROM agreements a/.test(call.sql))return[];
    if(method==='all'&&/FROM agreement_reviews r/.test(call.sql))return[];
    if(method==='all'&&/FROM projects/.test(call.sql))return[{id:'project_a',name:'Project A',lifecycle_status:'CLIENT'}];
    if(method==='all'&&/FROM opportunities/.test(call.sql))return[];
    if(method==='all'&&/FROM campaigns/.test(call.sql))return[];
    if(method==='all'&&/FROM partners/.test(call.sql))return[];
    if(method==='all'&&/tenant_memberships/.test(call.sql))return[];
    if(method==='first'&&/SELECT id,name FROM projects/.test(call.sql))return{id:'project_a',name:'Project A'};
    return null;
  });
}

test('R70 Agreement Registry remains available when normalized fundraising migration 0002 is absent',async()=>{
  const db=legacyDb();
  const response=await onRequestGet(ctx(db));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.options.rounds,[]);
  assert.equal(body.capabilities.normalizedFundraising,false);
  const agreementRead=db.calls.find(call=>/FROM agreements a/.test(call.sql));
  assert.ok(agreementRead);
  assert.doesNotMatch(agreementRead.sql,/JOIN fundraising_rounds/i);
  assert.deepEqual(agreementRead.bindings,['tenant_a']);
});

test('R70 fundraising mandate fails closed when normalized fundraising migration 0002 is absent',async()=>{
  const db=legacyDb();
  const response=await onRequestPost(ctx(db,{method:'POST',body:{agreementType:'FUNDRAISING_MANDATE',projectId:'project_a',fundraisingRoundId:'round_a',title:'Fundraising Mandate',counterpartyName:'Project A'}}));
  assert.equal(response.status,503);
  const body=await response.json();
  assert.match(body.error,/Normalized fundraising migration 0002 is required/i);
  assert.equal(db.calls.some(call=>/INSERT INTO agreements/.test(call.sql)),false);
});
