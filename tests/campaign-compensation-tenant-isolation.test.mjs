import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/campaign-compensation/[id].js';

class FakeDB {
  constructor(resolver) { this.resolver=resolver; this.calls=[]; }
  prepare(sql) {
    return { bind:(...bindings)=>{
      const call={sql:String(sql),bindings}; this.calls.push(call);
      return {
        first:async()=>this.resolver('first',call,this.calls.length-1),
        all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),
        run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true},
      };
    }};
  }
}

const compensation={
  enabled:true,
  budgetUsdt:500,
  bonusPoolUsdt:50,
  maximumBaseAllocationUsdt:100,
  maximumBonusPerTalentUsdt:25,
  platformWeights:{X:100,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},
  postingCadence:'WEEKLY_3',
  dailyEngagementRequired:true,
  engagementActions:['COMMENT','LIKE'],
  talentInputs:[{assignmentId:'a1',included:true,selectedPlatforms:['X'],followers:{X:10000,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},postingDays:[1,3,5],engagementAccepted:true,metricsVerified:false}],
};
const tracking={version:3,overview:{currentTokenPrice:1},targets:[],socialUpdates:[],creatorAssignments:[
  {id:'a1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',xScore:700,sorsaScore:650,expectedPosts:2,expectedReach:1000,allocatedUsd:0,allocatedTokens:0,active:true},
],creatorPosts:[]};
const campaign={id:'cam_a',tenant_id:'tenant_a',project_id:'project_a',name:'Launch',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-31',project_name:'Project A',project_website:'https://example.com',updated_at:'2026-08-08T00:00:00Z',notes:JSON.stringify({campaignTracking:tracking,campaignPlanning:{status:'DRAFT',objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,selections:[],compensation}})};

function context({db,id='cam_a',method='GET',body=null,role='OWNER'}){
  return {env:{DB:db,AUTH_MODE:'access'},data:{auth:{userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:true}},params:{id},request:new Request(`https://crm.example.test/api/campaign-compensation/${id}`,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined})};
}
async function payload(response){return response.json();}

test('campaign compensation lookup cannot resolve another tenant campaign',async()=>{
  const db=new FakeDB(()=>null);
  const response=await onRequestGet(context({db,id:'cam_tenant_b'}));
  assert.equal(response.status,404);
  assert.match((await payload(response)).error,/campaign engagement not found/i);
  assert.deepEqual(db.calls[0].bindings,['tenant_a','cam_tenant_b']);
  assert.match(db.calls[0].sql,/c\.tenant_id = \? AND c\.id = \?/);
  assert.match(db.calls[0].sql,/p\.tenant_id = c\.tenant_id/);
});

test('BD Member cannot apply AKARI USDT allocations',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign;
    if(method==='run')throw new Error('Unauthorized compensation application must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,method:'PATCH',role:'BD_MEMBER',body:{action:'apply-calculation'}}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/owner, admin or bd manager/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});

test('unverified Creator metrics fail closed before applying compensation',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign;
    if(method==='run')throw new Error('Unverified compensation must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,method:'PATCH',role:'OWNER',body:{action:'apply-calculation'}}));
  assert.equal(response.status,422);
  assert.match((await payload(response)).error,/unverified compensation metrics/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});

test('USDT compensation budget cannot exceed the campaign planning budget',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign;
    if(method==='run')throw new Error('Over-budget compensation rules must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,method:'PATCH',role:'OWNER',body:{action:'update-compensation',compensation:{...compensation,budgetUsdt:1200,bonusPoolUsdt:100,maximumBaseAllocationUsdt:100,maximumBonusPerTalentUsdt:25}}}));
  assert.equal(response.status,422);
  assert.match((await payload(response)).error,/cannot exceed the campaign planning budget/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});
