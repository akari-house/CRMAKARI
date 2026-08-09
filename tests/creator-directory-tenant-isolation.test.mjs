import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as getDirectory } from '../functions/api/creator-directory.js';
import { onRequestPost as addHouseTalent } from '../functions/api/campaign-planning/[id]/house-talent.js';

class FakeDB {
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);const index=this.calls.length-1;return{
    first:async()=>this.resolver('first',call,index),
    all:async()=>({results:await this.resolver('all',call,index)||[]}),
    run:async()=>this.resolver('run',call,index)||{success:true},
  };}};}
}
const auth=(role='OWNER')=>({userId:'user_a',tenantId:'tenant_a',tenantSlug:'akari-house',role,financeAccess:true});
const feed={source:'AKARI_HOUSE_PUBLIC_CREATOR_DIRECTORY',schemaVersion:'1',publicProfilesOnly:true,profileDataStatus:'PROFILE_PROVIDED',items:[{akariCreatorId:'house_1',username:'alice',displayName:'Alice Creator',profileUrl:'https://akarihouse.com/profiles/alice',location:'',socials:[{platform:'X',profileUrl:'https://x.com/alice',followerCount:25000,countSource:'member_reported'}],sorsaScore:640,sorsaSource:'partner_verified',xScore:720,xScoreSource:'partner_verified'}]};
const fetchFeed=async()=>new Response(JSON.stringify(feed),{status:200,headers:{'content-type':'application/json'}});
function campaignNotes(status='DRAFT'){
  return JSON.stringify({campaignTracking:{version:3,overview:{},targets:[],socialUpdates:[],creatorAssignments:[],creatorPosts:[]},campaignPlanning:{version:1,status,objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'EMEA',budgetUsd:500,selections:[]}});
}
function campaign(status='DRAFT'){return{id:'cam_a',name:'Campaign A',status:'PLANNED',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-31',notes:campaignNotes(status),updated_at:'2026-08-09',project_id:'project_a',project_name:'Project A'};}
function addContext({db,role='OWNER',body={akariCreatorId:'house_1'},id='cam_a'}={}){return{env:{DB:db,AUTH_MODE:'access'},data:{auth:auth(role)},params:{id},request:new Request(`https://crm.example.test/api/campaign-planning/${id}/house-talent`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})};}
async function body(response){return response.json();}

async function withFetch(mock,fn){const previous=globalThis.fetch;globalThis.fetch=mock;try{return await fn();}finally{globalThis.fetch=previous;}}

test('Creator directory builds performance only from authenticated tenant campaigns and partners',async()=>withFetch(fetchFeed,async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='all'&&/FROM campaigns c/.test(call.sql))return[];
    if(method==='all'&&/FROM partners/.test(call.sql))return[];
    return null;
  });
  const response=await getDirectory({env:{DB:db},data:{auth:auth()},request:new Request('https://crm.example.test/api/creator-directory')});
  assert.equal(response.status,200);
  const payload=await body(response);
  assert.equal(payload.directory.creatorCount,1);
  assert.equal(payload.directory.items[0].historyState,'NEW_NO_CAMPAIGN_HISTORY');
  assert.equal(payload.directory.items[0].performance,null);
  const campaignRead=db.calls.find((call)=>/FROM campaigns c/.test(call.sql));
  const partnerRead=db.calls.find((call)=>/FROM partners/.test(call.sql));
  assert.deepEqual(campaignRead.bindings,['tenant_a']);
  assert.deepEqual(partnerRead.bindings,['tenant_a']);
  assert.match(campaignRead.sql,/c\.tenant_id = \?/);
  assert.match(partnerRead.sql,/tenant_id = \?/);
}));

test('House source failure degrades safely to tenant historical talent instead of leaking or failing',async()=>withFetch(async()=>new Response('unavailable',{status:503}),async()=>{
  const historical=JSON.stringify({campaignTracking:{version:3,overview:{},targets:[],socialUpdates:[],creatorAssignments:[{id:'cca_legacy',creatorType:'CREATOR',name:'Legacy Creator',handle:'@legacy',platform:'X',profileUrl:'https://x.com/legacy',expectedPosts:1,expectedReach:1000,allocatedUsd:100,allocatedTokens:0,active:true}],creatorPosts:[]},campaignPlanning:{version:1,status:'DRAFT',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'ALL',budgetUsd:200,selections:[]}});
  const db=new FakeDB((method,call)=>{
    if(method==='all'&&/FROM campaigns c/.test(call.sql))return[{id:'cam_legacy',name:'Legacy',status:'LIVE',region:'ALL',start_date:'2026-07-01',end_date:'2026-07-31',notes:historical,updated_at:'2026-07-31',project_name:'Legacy Project'}];
    if(method==='all'&&/FROM partners/.test(call.sql))return[];
    return null;
  });
  const response=await getDirectory({env:{DB:db},data:{auth:auth()},request:new Request('https://crm.example.test/api/creator-directory')});
  assert.equal(response.status,200);
  const payload=await body(response);
  assert.equal(payload.directory.sourceAvailable,false);
  assert.match(payload.directory.sourceWarning,/temporarily unavailable/i);
  assert.equal(payload.directory.externalUnlinkedCount,1);
  assert.equal(payload.directory.external[0].historyState,'EXTERNAL_UNLINKED');
}));

test('Viewer cannot add House Creator talent before any database or House request',async()=>{
  const db=new FakeDB(()=>{throw new Error('Viewer write must fail before database access');});
  const previous=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Viewer write must fail before network access');};
  try{
    const response=await addHouseTalent(addContext({db,role:'VIEWER'}));
    assert.equal(response.status,403);
    assert.match((await body(response)).error,/Campaign planning write permission/i);
    assert.equal(db.calls.length,0);
  }finally{globalThis.fetch=previous;}
});

test('House talent campaign lookup is tenant scoped and cannot resolve another workspace campaign',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/FROM campaigns c/.test(call.sql)?null:null);
  const response=await addHouseTalent(addContext({db,id:'cam_other'}));
  assert.equal(response.status,404);
  const lookup=db.calls.find((call)=>/FROM campaigns c/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','cam_other']);
  assert.match(lookup.sql,/c\.tenant_id=\? AND c\.id=\?/);
});

test('submitted or approved campaign plan cannot add House talent',async()=>{
  for(const status of ['READY_FOR_APPROVAL','APPROVED']){
    const db=new FakeDB((method,call)=>method==='first'&&/FROM campaigns c/.test(call.sql)?campaign(status):null);
    const previous=globalThis.fetch;let fetchCalled=false;globalThis.fetch=async()=>{fetchCalled=true;return fetchFeed();};
    try{
      const response=await addHouseTalent(addContext({db}));
      assert.equal(response.status,409);
      assert.match((await body(response)).error,/must be reopened before editing|submitted campaign plan/i);
      assert.equal(fetchCalled,false);
      assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
    }finally{globalThis.fetch=previous;}
  }
});

test('new House Creator enters Draft plan with zero reach and zero cash or token allocation',async()=>withFetch(fetchFeed,async()=>{
  let savedNotes='';
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign('DRAFT');
    if(method==='run'&&/UPDATE campaigns/.test(call.sql)){savedNotes=call.bindings[0];return{success:true};}
    return null;
  });
  const response=await addHouseTalent(addContext({db,role:'BD_MEMBER'}));
  assert.equal(response.status,200);
  const payload=await body(response);
  assert.equal(payload.assignment.expectedPosts,1);
  assert.equal(payload.assignment.expectedReach,0);
  assert.equal(payload.assignment.allocatedUsd,0);
  assert.equal(payload.assignment.allocatedTokens,0);
  assert.equal(payload.houseCreator.profileDataStatus,'PROFILE_PROVIDED');
  const saved=JSON.parse(savedNotes);
  assert.equal(saved.campaignPlanning.selections[0].akariCreatorId,'house_1');
  assert.equal(saved.campaignPlanning.selections[0].identitySource,'AKARI_HOUSE');
  const update=db.calls.find((call)=>/UPDATE campaigns/.test(call.sql));
  assert.deepEqual(update.bindings.slice(-2),['tenant_a','cam_a']);
  const audit=db.calls.find((call)=>/INSERT INTO audit_logs/.test(call.sql));
  assert.equal(audit.bindings[1],'tenant_a');
  assert.equal(audit.bindings[3],'cam_a');
}));
