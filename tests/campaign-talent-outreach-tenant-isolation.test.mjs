import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/campaign-talent-outreach/[id].js';
import { campaignPlanFingerprint } from '../functions/lib/campaign-planning.js';

class FakeDB {
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);const index=this.calls.length-1;return{
    first:async()=>this.resolver('first',call,index),
    all:async()=>({results:await this.resolver('all',call,index)||[]}),
    run:async()=>this.resolver('run',call,index)||{success:true},
  };}};}
}

function notes({status='ACCEPTED'}={}){
  const tracking={version:3,overview:{},targets:[],socialUpdates:[],creatorPosts:[],creatorAssignments:[{
    id:'cca_1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',agencyName:'',expectedPosts:2,expectedReach:10000,allocatedUsd:150,allocatedTokens:0,active:true,
  }]};
  const planning={status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300,selections:[],compensation:{enabled:false}};
  planning.approvedFingerprint=campaignPlanFingerprint(tracking,planning);
  const campaignTalentOutreach={version:1,records:status==='NOT_CONTACTED'?[]:[{
    assignmentId:'cca_1',status,channel:'Telegram',outreachOwnerId:'user_a',firstContactedAt:'2026-08-09T10:00:00Z',lastContactedAt:'2026-08-09T10:00:00Z',
    quotedUsd:175,agreedUsd:150,agreedTokens:0,deliverablesConfirmed:true,scheduleConfirmed:true,compensationConfirmed:true,
    agencyConfirmed:false,termsConfirmed:true,consentConfirmed:true,evidenceReference:'tg-thread-acceptance',notes:'Manual acceptance evidence',acceptedAt:'2026-08-09T11:00:00Z',acceptedBy:'user_a',
  }]};
  return JSON.stringify({campaignTracking:tracking,campaignPlanning:planning,campaignTalentOutreach});
}

function campaign(value=notes()){return{id:'cam_a',name:'Campaign A',status:'PLANNED',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-24',notes:value,updated_at:'2026-08-09',project_id:'project_a',campaign_owner_id:'user_a',project_name:'Project A'};}
function context({db,method='PATCH',body={action:'confirm',assignmentId:'cca_1'},role='OWNER',id='cam_a'}={}){
  return{env:{DB:db,AUTH_MODE:'access'},data:{auth:{userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:true}},params:{id},request:new Request(`https://crm.example.test/api/campaign-talent-outreach/${id}`,{method,headers:{'content-type':'application/json'},body:method==='PATCH'?JSON.stringify(body):undefined})};
}
async function payload(response){return response.json();}

test('campaign talent outreach lookup cannot resolve another tenant campaign',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/FROM campaigns c/.test(call.sql)?null:[]);
  const response=await onRequestGet(context({db,method:'GET',id:'cam_other'}));
  assert.equal(response.status,404);
  const lookup=db.calls.find((call)=>/FROM campaigns c/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','cam_other']);
  assert.match(lookup.sql,/c\.tenant_id = \? AND c\.id = \?/);
});

test('read-only roles cannot write Creator KOL outreach evidence',async()=>{
  const db=new FakeDB(()=>{throw new Error('Viewer write must fail before database access');});
  const response=await onRequestPatch(context({db,role:'VIEWER',body:{action:'mark-contacted',assignmentId:'cca_1',channel:'Telegram'}}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/Business Development permission/i);
  assert.equal(db.calls.length,0);
});

test('outreach owner must be an active member of the same tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign(notes({status:'NOT_CONTACTED'}));
    if(method==='first'&&/tenant_memberships/.test(call.sql))return null;
    if(method==='run')throw new Error('Invalid outreach owner must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,role:'BD_MEMBER',body:{action:'mark-contacted',assignmentId:'cca_1',channel:'Telegram',outreachOwnerId:'other_tenant_user'}}));
  assert.equal(response.status,422);
  assert.match((await payload(response)).error,/not an active member/i);
  const memberLookup=db.calls.find((call)=>/tenant_memberships/.test(call.sql));
  assert.deepEqual(memberLookup.bindings,['tenant_a','other_tenant_user']);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});

test('BD Member cannot perform final Creator KOL participation confirmation',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign();
    if(method==='run')throw new Error('Non-manager confirmation must not write');
    return [];
  });
  const response=await onRequestPatch(context({db,role:'BD_MEMBER'}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/Owner, Admin or BD Manager/i);
  assert.equal(db.calls.some((call)=>/UPDATE campaigns/.test(call.sql)),false);
});

test('manager confirmation remains tenant scoped and audits exact campaign talent evidence',async()=>{
  let savedNotes='';
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign();
    if(method==='all'&&/tenant_memberships/.test(call.sql))return[{id:'user_a',full_name:'Owner A',email:'owner@example.com',role:'OWNER'}];
    if(method==='run'&&/UPDATE campaigns/.test(call.sql)){savedNotes=call.bindings[0];return{success:true};}
    return null;
  });
  const response=await onRequestPatch(context({db}));
  assert.equal(response.status,200);
  const body=await payload(response);
  assert.equal(body.item.summary.confirmedCount,1);
  assert.equal(body.item.summary.readyForActivation,true);
  const saved=JSON.parse(savedNotes);
  assert.equal(saved.campaignTalentOutreach.records[0].status,'CONFIRMED');
  const update=db.calls.find((call)=>/UPDATE campaigns/.test(call.sql));
  assert.deepEqual(update.bindings.slice(-2),['tenant_a','cam_a']);
  const audit=db.calls.find((call)=>/INSERT INTO audit_logs/.test(call.sql));
  assert.equal(audit.bindings[1],'tenant_a');
  assert.equal(audit.bindings[3],'CAMPAIGN_TALENT_PARTICIPATION_CONFIRMED');
});
