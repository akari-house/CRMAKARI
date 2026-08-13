import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as onboardingGet, onRequestPost as onboardingPost } from '../functions/api/fundraising/onboarding.js';
import { onRequestGet as portalOnboardingGet, onRequestPatch as portalOnboardingPatch } from '../functions/api/portal/project/[id]/onboarding.js';
import { onboardingReadiness } from '../functions/lib/founder-onboarding.js';

class FakeDB {
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}}}};}
}

function internalCtx({db,path='/api/fundraising/onboarding',method='GET',body={},role='OWNER',userId='owner_a'}){
  return {env:{DB:db},data:{auth:{userId,tenantId:'tenant_a',tenantSlug:'tenant-a',tenantName:'Tenant A',email:`${userId}@example.test`,fullName:'Internal User',role,financeAccess:role==='OWNER'}},request:new Request(`https://crm.example.test${path}`,{method,headers:{'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)})};
}

function portalCtx({db,path='/api/portal/project/project_a/onboarding',method='GET',body={},params={id:'project_a'}}){
  return {env:{DB:db},data:{auth:{userId:'founder_a',tenantId:'tenant_a',tenantSlug:'tenant-a',tenantName:'Tenant A',email:'founder@example.test',fullName:'Founder A',role:'EXTERNAL_COLLABORATOR',financeAccess:false}},params,request:new Request(`https://crm.example.test${path}`,{method,headers:{'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)})};
}

const project={id:'project_a',name:'FounderCo',category:'Web3',region:'Europe',country:'Germany',website:'https://founder.example',lifecycle_status:'CLIENT'};
const grant={recordType:'AKARI_EXTERNAL_PORTAL_ACCESS_V1',version:1,userId:'founder_a',projectId:'project_a',portalType:'FOUNDER',status:'ACTIVE',permissions:{viewEngagement:true,viewCampaigns:true,viewFundraising:true,viewDocuments:true,viewReports:true,updateOwnTasks:true,answerDiligence:true,updateOnboarding:true},updatedAt:'2026-08-13T00:00:00.000Z',updatedBy:'owner_a'};
const grantRow={id:'grant_a',user_id:'owner_a',project_id:'project_a',description:JSON.stringify(grant),occurred_at:'2026-08-13T00:00:00.000Z',created_at:'2026-08-13T00:00:00.000Z'};

test('R71 internal writes reject read-only roles before any database access',async()=>{
  const db=new FakeDB(()=>null);
  const response=await onboardingPost(internalCtx({db,method:'POST',role:'VIEWER',userId:'viewer_a',body:{action:'save-item',roundId:'round_a',item:{key:'COMPANY',data:{legalName:'FounderCo',jurisdiction:'Germany'}}}}));
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
  assert.match((await response.json()).error,/permission/i);
});

test('R71 round lookup is always scoped to the authenticated tenant',async()=>{
  const round={id:'round_a',tenant_id:'tenant_a',project_id:'project_a',round_name:'Seed',stage:'OPEN',instrument:'SAFE',funding_stage:'Seed',currency:'USD',target_amount:500000,valuation:5000000,readiness_score:0,project_name:'FounderCo',project_region:'Europe',project_country:'Germany',project_website:'https://founder.example'};
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM founder_onboarding_items/i.test(call.sql))return{id:'schema_probe'};
    if(method==='first'&&/FROM fundraising_rounds r JOIN projects/i.test(call.sql))return round;
    if(method==='all'&&/FROM founder_onboarding_items/i.test(call.sql))return[];
    return null;
  });
  const response=await onboardingGet(internalCtx({db,path:'/api/fundraising/onboarding?roundId=round_a'}));
  assert.equal(response.status,200);
  const lookup=db.calls.find(call=>/WHERE r\.tenant_id=\? AND r\.id=\?/i.test(call.sql));
  assert.ok(lookup);
  assert.deepEqual(lookup.bindings,['tenant_a','round_a']);
  const payload=await response.json();
  assert.equal(payload.round.id,'round_a');
});

test('R71 founder portal cannot open onboarding for an ungranted project',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM projects/i.test(call.sql))return project;
    if(method==='all'&&/FROM activities/i.test(call.sql))return[];
    return null;
  });
  const response=await portalOnboardingGet(portalCtx({db}));
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/do not have portal access/i);
  assert.equal(db.calls.some(call=>/founder_onboarding_items/i.test(call.sql)),false);
  assert.deepEqual(db.calls[0].bindings,['tenant_a','project_a']);
});

test('R71 founder portal rejects a round outside the granted tenant project before any onboarding write',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM projects/i.test(call.sql))return project;
    if(method==='all'&&/FROM activities/i.test(call.sql))return[grantRow];
    if(method==='first'&&/SELECT id FROM founder_onboarding_items/i.test(call.sql))return{id:'schema_probe'};
    if(method==='first'&&/FROM fundraising_rounds r JOIN projects/i.test(call.sql))return null;
    return null;
  });
  const response=await portalOnboardingPatch(portalCtx({db,method:'PATCH',body:{action:'SAVE_ONBOARDING_ITEM',roundId:'round_other',item:{key:'COMPANY',data:{legalName:'FounderCo',jurisdiction:'Germany'}}}}));
  assert.equal(response.status,404);
  const lookup=db.calls.find(call=>/WHERE r\.tenant_id=\? AND r\.project_id=\? AND r\.id=\?/i.test(call.sql));
  assert.ok(lookup);
  assert.deepEqual(lookup.bindings,['tenant_a','project_a','round_other']);
  assert.equal(db.calls.some(call=>call.sql.includes('INSERT INTO founder_onboarding_items')||call.sql.includes('UPDATE founder_onboarding_items')),false);
});

test('R71 readiness is evidence-derived and excludes non-applicable tokenomics from the denominator',()=>{
  const round={target_amount:500000,instrument:'SAFE'};
  const project={name:'FounderCo',country:'Germany'};
  const items=[
    {item_key:'COMPANY',status:'COMPLETE',data_json:JSON.stringify({legalName:'FounderCo',jurisdiction:'Germany'})},
    {item_key:'RAISE',status:'COMPLETE',data_json:'{}'},
    {item_key:'TOKENOMICS',status:'NOT_APPLICABLE',data_json:JSON.stringify({web3Relevant:false})},
  ];
  const readiness=onboardingReadiness(items,round,project);
  assert.equal(readiness.applicable,10);
  assert.equal(readiness.complete,2);
  assert.equal(readiness.checks.find(item=>item.key==='TOKENOMICS').status,'NOT_APPLICABLE');
  assert.equal(readiness.score,26);
});
