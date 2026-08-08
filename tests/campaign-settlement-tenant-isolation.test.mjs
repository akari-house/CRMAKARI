import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/campaign-settlement/[id].js';

class FakeDB {
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{
    first:async()=>this.resolver('first',call,this.calls.length-1),
    all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),
    run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true},
  };}};}
}

const tracking={version:3,overview:{currentTokenPrice:1},targets:[],socialUpdates:[],creatorAssignments:[
  {id:'a1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',xScore:700,sorsaScore:650,expectedPosts:2,expectedReach:1000,allocatedUsd:100,allocatedTokens:0,active:true},
],creatorPosts:[]};
const compensation={enabled:false,budgetUsdt:0,bonusPoolUsdt:0,maximumBaseAllocationUsdt:0,maximumBonusPerTalentUsdt:0,platformWeights:{X:100,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},postingCadence:'WEEKLY_2',dailyEngagementRequired:false,engagementActions:[],talentInputs:[],lastResult:{items:[]}};
const campaign={id:'cam_a',tenant_id:'tenant_a',project_id:'project_a',name:'Launch',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-31',project_name:'Project A',project_website:'https://example.com',updated_at:'2026-08-08T00:00:00Z',notes:JSON.stringify({campaignTracking:tracking,campaignPlanning:{status:'DRAFT',objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,selections:[],compensation}})};

function context({db,id='cam_a',body=null,role='OWNER',financeAccess=true}){
  return {env:{DB:db,AUTH_MODE:'access'},data:{auth:{userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess}},params:{id},request:new Request(`https://crm.example.test/api/campaign-settlement/${id}`,{method:body?'PATCH':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined})};
}
async function payload(response){return response.json();}

test('campaign settlement lookup cannot resolve another tenant campaign',async()=>{
  const db=new FakeDB(()=>null);
  const response=await onRequestGet(context({db,id:'cam_tenant_b'}));
  assert.equal(response.status,404);
  assert.match((await payload(response)).error,/campaign engagement not found/i);
  assert.deepEqual(db.calls[0].bindings,['tenant_a','cam_tenant_b']);
  assert.match(db.calls[0].sql,/c\.tenant_id = \? AND c\.id = \?/);
  assert.match(db.calls[0].sql,/p\.tenant_id = c\.tenant_id/);
});

test('payment recording requires finance permission before any write',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign;
    if(method==='run')throw new Error('Unauthorized settlement payment must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,role:'BD_MEMBER',financeAccess:false,body:{action:'record-payment',assignmentId:'a1',amountUsdt:10,paidAt:'2026-08-08',method:'USDT_ONCHAIN',reference:'0x1234'}}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/finance permission/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});

test('settlement approval requires manager authority even with finance access',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign;
    if(method==='run')throw new Error('Non-manager settlement approval must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,role:'FINANCE',financeAccess:true,body:{action:'approve-settlement',assignmentId:'a1',baseApprovedUsdt:100,bonusApprovedUsdt:0,note:'Reviewed evidence'}}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/owner, admin or bd manager/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});

test('only Owner or Admin can void a settlement payment',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign;
    if(method==='run')throw new Error('Unauthorized payment void must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,role:'BD_MANAGER',financeAccess:true,body:{action:'void-payment',paymentId:'csp_1',reason:'Incorrect reference'}}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/owner or admin/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});
