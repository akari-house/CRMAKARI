import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPatch as patchOpportunity } from '../functions/api/opportunities/[id].js';
import { onRequestPost as holdOpportunity } from '../functions/api/opportunities/[id]/hold.js';
import { onRequestPatch as patchProposal } from '../functions/api/proposals/[id].js';
import { onRequest as commercialMiddleware } from '../functions/api/opportunities/[id]/_middleware.js';

class FakeDB {
  constructor(resolver) { this.resolver=resolver; this.calls=[]; }
  prepare(sql){ return { bind:(...bindings)=>{ const call={sql:String(sql),bindings}; this.calls.push(call); return {
    first:async()=>this.resolver('first',call,this.calls.length-1),
    all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),
    run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true},
  }; }}; }
}
function ctx({db,path,method='POST',body={},role='OWNER',params={id:'opp_a'},next}){ return {
  env:{DB:db,AUTH_MODE:'access'}, data:{auth:{userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:true}}, params,
  request:new Request(`https://crm.test${path}`,{method,headers:{'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)}),
  next:next || (async () => new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}})),
}; }
const opportunity={id:'opp_a',tenant_id:'tenant_a',project_id:'project_a',primary_contact_id:'contact_a',name:'Campaign',stage:'QUALIFIED',probability_percentage:60,owner_user_id:'user_a'};
const proposalRow={
  id:'proposal_a',tenant_id:'tenant_a',project_id:'project_a',opportunity_id:'opp_a',contact_id:'contact_a',user_id:'user_a',activity_type:'PROPOSAL',subject:'Proposal',outcome:'SENT',occurred_at:'2026-08-03T10:00:00Z',next_action:'Follow up',follow_up_at:null,
  description:JSON.stringify({recordType:'AKARI_PROPOSAL_V1',status:'SENT',version:1,amount:10000,currency:'USD',serviceType:'MARKETING',commercialModel:'FIXED_FEE'}),
  opportunity_stage:'PROPOSAL',need_confirmed:1,decision_maker_confirmed:1,timeline_confirmed:1,budget_status:'CONFIRMED',probability_percentage:70,opportunity_project_id:'project_a',project_name:'Client',primary_contact_name:'Alice',
};
async function body(response){return response.json();}

test('direct won/lost/hold stage shortcuts are rejected inside the tenant',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/SELECT \* FROM opportunities/.test(call.sql)?opportunity:null);
  for(const stage of ['WON','LOST','ON_HOLD']){
    const response=await patchOpportunity(ctx({db,path:'/api/opportunities/opp_a',method:'PATCH',body:{stage}}));
    assert.equal(response.status,409);
  }
  assert.ok(db.calls.every((call)=>call.bindings[0]==='tenant_a'));
  assert.equal(db.calls.filter((call)=>/UPDATE opportunities/.test(call.sql)).length,0);
});

test('controlled hold requires manager evidence and writes stage history',async()=>{
  const denied=await holdOpportunity(ctx({db:new FakeDB(()=>null),path:'/api/opportunities/opp_a/hold',body:{action:'HOLD'},role:'BD_MEMBER'}));
  assert.equal(denied.status,403);
  const db=new FakeDB((method,call)=>method==='first'&&/FROM opportunities o/.test(call.sql)?{...opportunity,project_name:'Client'}:null);
  const response=await holdOpportunity(ctx({db,path:'/api/opportunities/opp_a/hold',body:{action:'HOLD',category:'CLIENT_TIMING',reason:'Launch moved',nextAction:'Review with client',reviewAt:'2026-08-15'}}));
  const payload=await body(response);
  assert.equal(response.status,200); assert.equal(payload.stage,'ON_HOLD');
  assert.ok(db.calls.some((call)=>/INSERT INTO opportunity_stage_history/.test(call.sql)));
  assert.ok(db.calls.some((call)=>call.bindings.includes('OPPORTUNITY_PLACED_ON_HOLD')));
});

test('proposal acceptance requires explicit who, when, method, reference and terms confirmation',async()=>{
  const resolver=(method,call)=>{
    if(method==='first'&&/FROM activities a/.test(call.sql)) return proposalRow;
    if(method==='all') return [];
    return null;
  };
  const missing=await patchProposal(ctx({db:new FakeDB(resolver),path:'/api/proposals/proposal_a',method:'PATCH',params:{id:'proposal_a'},body:{status:'ACCEPTED'}}));
  assert.equal(missing.status,422); assert.match((await body(missing)).error,/who accepted/i);
  const db=new FakeDB(resolver);
  const response=await patchProposal(ctx({db,path:'/api/proposals/proposal_a',method:'PATCH',params:{id:'proposal_a'},body:{status:'ACCEPTED',acceptedBy:'Alice',acceptedAt:'2026-08-04T10:00',acceptanceMethod:'EMAIL',acceptanceReference:'Email subject: Accepted',termsConfirmed:true,nextAction:'Close as won'}}));
  assert.equal(response.status,200);
  const update=db.calls.find((call)=>/UPDATE activities SET outcome/.test(call.sql));
  const metadata=JSON.parse(update.bindings[1]);
  assert.equal(metadata.acceptedBy,'Alice'); assert.equal(metadata.termsConfirmed,true); assert.equal(metadata.acceptanceMethod,'EMAIL');
});

test('proposal creation middleware rejects final states before controlled approval',async()=>{
  let called=false;
  const response=await commercialMiddleware(ctx({db:new FakeDB(()=>null),path:'/api/opportunities/opp_a/proposal',body:{status:'SENT'},next:async()=>{called=true;return new Response(null,{status:200});}}));
  assert.equal(response.status,422); assert.equal(called,false);
  assert.match((await body(response)).error,/Draft or Internal review/i);
});

test('won close requires accepted proposal evidence or complete manual confirmation',async()=>{
  let called=false;
  const noEvidence=new FakeDB((method,call)=>method==='first'&&/FROM activities/.test(call.sql)?null:null);
  const denied=await commercialMiddleware(ctx({db:noEvidence,path:'/api/opportunities/opp_a/close',body:{outcome:'WON',finalValue:10000,currency:'USD',nextAction:'Onboard'},next:async()=>{called=true;return new Response(null,{status:200});}}));
  assert.equal(denied.status,422); assert.equal(called,false);
  const accepted={id:'proposal_a',outcome:'ACCEPTED',description:JSON.stringify({recordType:'AKARI_PROPOSAL_V1',status:'ACCEPTED',version:1,amount:10000,currency:'USD',serviceType:'MARKETING',commercialModel:'FIXED_FEE',acceptedBy:'Alice',acceptedAt:'2026-08-04T10:00',acceptanceMethod:'EMAIL',acceptanceReference:'Email accepted',termsConfirmed:true})};
  const db=new FakeDB((method,call)=>method==='first'&&/FROM activities/.test(call.sql)?accepted:null);
  const response=await commercialMiddleware(ctx({db,path:'/api/opportunities/opp_a/close',body:{outcome:'WON',sourceProposalId:'proposal_a',finalValue:10000,currency:'USD',serviceType:'MARKETING',commercialModel:'FIXED_FEE',nextAction:'Onboard'},next:async()=>{called=true;return new Response(JSON.stringify({closed:true}),{status:200});}}));
  assert.equal(response.status,200); assert.equal(called,true);
  assert.ok(db.calls.some((call)=>/COMMERCIAL_CLOSE_GOVERNANCE/.test(call.sql)));
  assert.ok(db.calls.some((call)=>/COMMERCIAL_CLOSE_EVIDENCE_RECORDED/.test(call.sql)));
});