import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as relationshipMiddleware } from '../functions/api/relationships/_middleware.js';
import { onRequestGet,onRequestPost } from '../functions/api/relationships/index.js';
import { strongestPath,pathScore } from '../functions/lib/relationship-intelligence.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}}}};}
}
function auth(role='OWNER'){return{userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:role==='OWNER'};}

test('R73 relationship API middleware blocks external portal collaborators before handler execution',async()=>{
  let nextCalled=false;
  const response=await relationshipMiddleware({data:{auth:auth('EXTERNAL_COLLABORATOR')},next:async()=>{nextCalled=true;return new Response('ok');}});
  assert.equal(response.status,403);
  assert.equal(nextCalled,false);
  assert.match((await response.json()).error,/internal-only/i);
});

test('R73 relationship API middleware allows authenticated internal workspace users',async()=>{
  let nextCalled=false;
  const response=await relationshipMiddleware({data:{auth:auth('BD_MEMBER')},next:async()=>{nextCalled=true;return new Response('ok',{status:204});}});
  assert.equal(nextCalled,true);
  assert.equal(response.status,204);
});

test('R73 read-only roles cannot mutate relationship intelligence before database access',async()=>{
  const db=new FakeDB(()=>null);
  const response=await onRequestPost({env:{DB:db},data:{auth:auth('VIEWER')},request:new Request('https://crm.test/api/relationships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save-profile',item:{entityType:'CREATOR',entityId:'creator_a',displayName:'Creator A'}})})});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('R73 relationship search binds every entity lookup to the authenticated tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM relationship_profiles LIMIT 1/i.test(call.sql))return{id:'schema'};
    if(method==='all')return[];
    return null;
  });
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('OWNER')},request:new Request('https://crm.test/api/relationships?q=Acme')});
  assert.equal(response.status,200);
  const searches=db.calls.filter(call=>/LIKE \? COLLATE NOCASE/i.test(call.sql));
  assert.equal(searches.length,6);
  for(const call of searches)assert.equal(call.bindings[0],'tenant_a');
});

test('R73 rejects a relationship owner who is not an active member of the authenticated tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM relationship_profiles LIMIT 1/i.test(call.sql))return{id:'schema'};
    if(method==='first'&&/FROM relationship_profiles WHERE tenant_id=\? AND entity_type=\?/i.test(call.sql))return null;
    if(method==='first'&&/FROM users u JOIN tenant_memberships/i.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost({env:{DB:db},data:{auth:auth('OWNER')},request:new Request('https://crm.test/api/relationships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save-profile',item:{entityType:'CREATOR',entityId:'creator_a',displayName:'Creator A',relationshipOwnerUserId:'user_other_tenant'}})})});
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/not an active workspace member/i);
  assert.equal(db.calls.some(call=>/INSERT INTO relationship_profiles/i.test(call.sql)),false);
});

test('R73 strongest warm path rewards verification and consent while penalizing revoked consent',()=>{
  const strongVerified={strength:'STRONG',verification_status:'VERIFIED',consent_status:'GRANTED',path_type:'WARM_INTRO',connector_name:'Muaz'};
  const directRevoked={strength:'STRONG',verification_status:'VERIFIED',consent_status:'REVOKED',path_type:'DIRECT',connector_name:'Other'};
  assert.ok(pathScore(strongVerified)>pathScore(directRevoked));
  assert.equal(strongestPath([directRevoked,strongVerified]).connector_name,'Muaz');
});
