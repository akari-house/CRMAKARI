import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as operatingMiddleware } from '../functions/api/operating-rhythm/_middleware.js';
import { onRequestGet,onRequestPost } from '../functions/api/operating-rhythm/index.js';
import { normalizeReportType,overdueDays,priorityFor } from '../functions/lib/reporting-attention.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}}}};}
}
function auth(role='OWNER',financeAccess=role==='OWNER'){return{userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess};}

test('R74 operating rhythm middleware blocks external portal collaborators',async()=>{
  let nextCalled=false;
  const response=await operatingMiddleware({data:{auth:auth('EXTERNAL_COLLABORATOR',false)},next:async()=>{nextCalled=true;return new Response('ok');}});
  assert.equal(response.status,403);
  assert.equal(nextCalled,false);
  assert.match((await response.json()).error,/internal-only/i);
});

test('R74 read-only roles cannot mutate attention before database access',async()=>{
  const db=new FakeDB(()=>null);
  const response=await onRequestPost({env:{DB:db},data:{auth:auth('VIEWER',false)},request:new Request('https://crm.test/api/operating-rhythm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'refresh-attention'})})});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('R74 personal attention query is tenant and owner scoped',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM operational_attention LIMIT 1/i.test(call.sql))return{id:'schema'};
    if(method==='all'&&/FROM operational_attention WHERE/i.test(call.sql))return[];
    return null;
  });
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('BD_MEMBER',false)},request:new Request('https://crm.test/api/operating-rhythm?scope=mine&refresh=0')});
  assert.equal(response.status,200);
  const query=db.calls.find(call=>/FROM operational_attention WHERE/i.test(call.sql)&&/owner_user_id = \?/i.test(call.sql));
  assert.ok(query);
  assert.equal(query.bindings[0],'tenant_a');
  assert.equal(query.bindings[1],'user_a');
});

test('R74 team attention is manager-only',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/SELECT id FROM operational_attention LIMIT 1/i.test(call.sql)?{id:'schema'}:null);
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('BD_MEMBER',false)},request:new Request('https://crm.test/api/operating-rhythm?scope=team&refresh=0')});
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/manager permission/i);
});

test('R74 management and revenue reports require finance permission',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/SELECT id FROM operational_attention LIMIT 1/i.test(call.sql)?{id:'schema'}:null);
  for(const reportType of ['MANAGEMENT','REVENUE']){
    const response=await onRequestGet({env:{DB:db},data:{auth:auth('BD_MANAGER',false)},request:new Request(`https://crm.test/api/operating-rhythm?action=report&reportType=${reportType}`)});
    assert.equal(response.status,403);
    assert.match((await response.json()).error,/finance permission/i);
  }
});

test('R74 non-manager cannot change another owner attention item',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM operational_attention LIMIT 1/i.test(call.sql))return{id:'schema'};
    if(method==='first'&&/SELECT id,owner_user_id FROM operational_attention/i.test(call.sql))return{id:'attn_1',owner_user_id:'user_other'};
    return null;
  });
  const response=await onRequestPost({env:{DB:db},data:{auth:auth('BD_MEMBER',false)},request:new Request('https://crm.test/api/operating-rhythm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'update-attention',id:'attn_1',status:'RESOLVED'})})});
  assert.equal(response.status,403);
  assert.equal(db.calls.some(call=>/^UPDATE operational_attention/i.test(call.sql)),false);
});

test('R74 priority escalation is deterministic and report types are controlled',()=>{
  const now=new Date('2026-08-13T12:00:00Z');
  assert.equal(overdueDays('2026-08-12T12:00:00Z',now),1);
  assert.equal(priorityFor({overdueDays:3}),'HIGH');
  assert.equal(priorityFor({overdueDays:14}),'URGENT');
  assert.equal(normalizeReportType('founder_weekly'),'FOUNDER_WEEKLY');
  assert.throws(()=>normalizeReportType('random_report'),/invalid/i);
});
