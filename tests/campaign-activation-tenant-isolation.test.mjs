import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/campaign-activation/[id].js';
import { campaignPlanFingerprint } from '../functions/lib/campaign-planning.js';

class FakeDB {
  constructor(resolver) { this.resolver=resolver; this.calls=[]; }
  prepare(sql) {
    return { bind:(...bindings)=>{
      const call={ sql:String(sql), bindings };
      this.calls.push(call);
      const index=this.calls.length-1;
      return {
        first:async()=>this.resolver('first',call,index),
        all:async()=>({ results:await this.resolver('all',call,index)||[] }),
        run:async()=>this.resolver('run',call,index)||{ success:true },
      };
    } };
  }
}

function approvedNotes({ approved=true, drift=false, confirmed=true }={}) {
  const tracking={
    version:3,overview:{},targets:[],socialUpdates:[],creatorPosts:[],
    creatorAssignments:[{ id:'cca_1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',expectedPosts:2,expectedReach:10000,allocatedUsd:100,allocatedTokens:0,active:true }],
  };
  let planning={ status:approved?'APPROVED':'DRAFT',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300,selections:[],compensation:{ enabled:false } };
  planning.approvedFingerprint=approved?campaignPlanFingerprint(tracking,planning):null;
  const campaignTalentOutreach={version:1,records:confirmed?[{
    assignmentId:'cca_1',status:'CONFIRMED',agreedUsd:100,agreedTokens:0,
    deliverablesConfirmed:true,scheduleConfirmed:true,compensationConfirmed:true,agencyConfirmed:false,
    termsConfirmed:true,consentConfirmed:true,evidenceReference:'tg-thread-1',confirmedAt:'2026-08-09T10:00:00Z',confirmedBy:'user_a',
  }]:[]};
  if(drift) tracking.creatorAssignments[0].expectedPosts=3;
  return JSON.stringify({ campaignTracking:tracking, campaignPlanning:planning, campaignTalentOutreach });
}

function campaign(notes=approvedNotes()) {
  return { id:'cam_a',name:'Launch Campaign',status:'PLANNED',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-24',notes,updated_at:'2026-08-09',project_id:'project_a',opportunity_id:'opp_a',campaign_owner_id:'user_a',project_name:'Project A' };
}

function context({ db, method='PATCH', body={ action:'activate',executionOwnerId:'user_a' }, role='OWNER', id='cam_a' }) {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:true } },
    params:{ id },
    request:new Request(`https://crm.example.test/api/campaign-activation/${id}`,{ method,headers:{'content-type':'application/json'},body:method==='PATCH'?JSON.stringify(body):undefined }),
  };
}

async function payload(response){return response.json();}

test('campaign activation lookup cannot resolve another tenant campaign',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/FROM campaigns c/.test(call.sql)?null:[]);
  const response=await onRequestGet(context({db,method:'GET',id:'cam_other'}));
  assert.equal(response.status,404);
  const lookup=db.calls.find((call)=>/FROM campaigns c/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','cam_other']);
  assert.match(lookup.sql,/c\.tenant_id = \? AND c\.id = \?/);
});

test('BD Member cannot activate campaign execution',async()=>{
  const db=new FakeDB(()=>{throw new Error('Non-manager activation must fail before database access');});
  const response=await onRequestPatch(context({db,role:'BD_MEMBER'}));
  assert.equal(response.status,403);
  assert.match((await payload(response)).error,/Owner, Admin or BD Manager/i);
  assert.equal(db.calls.length,0);
});

test('activation fails closed when the campaign plan is not approved',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign(approvedNotes({approved:false}));
    if(method==='run')throw new Error('Locked activation must not write tasks');
    return [];
  });
  const response=await onRequestPatch(context({db}));
  assert.equal(response.status,409);
  assert.match((await payload(response)).error,/Approve the campaign plan/i);
  assert.equal(db.calls.some((call)=>/INSERT INTO tasks/.test(call.sql)),false);
});

test('activation fails closed when the approved plan fingerprint drifted',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign(approvedNotes({drift:true}));
    if(method==='run')throw new Error('Drifted activation must not write tasks');
    return [];
  });
  const response=await onRequestPatch(context({db}));
  assert.equal(response.status,409);
  assert.match((await payload(response)).error,/changed.*reapproved/i);
  assert.equal(db.calls.some((call)=>/INSERT INTO tasks/.test(call.sql)),false);
});

test('activation fails closed until every active Creator KOL has confirmed participation evidence',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign(approvedNotes({confirmed:false}));
    if(method==='run')throw new Error('Unconfirmed activation must not write tasks');
    return [];
  });
  const response=await onRequestPatch(context({db}));
  assert.equal(response.status,409);
  assert.match((await payload(response)).error,/confirmed participation evidence/i);
  assert.equal(db.calls.some((call)=>/INSERT INTO tasks/.test(call.sql)),false);
});

test('activation creates one tenant-scoped canonical Work OS plan and blocks duplicate markers',async()=>{
  const inserted=[];
  let duplicate=false;
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign();
    if(method==='first'&&/tenant_memberships/.test(call.sql))return { id:'user_a',full_name:'Owner A',email:'owner@example.com',role:'OWNER' };
    if(method==='first'&&/activity_type LIKE/.test(call.sql))return duplicate?{id:'existing'}:null;
    if(method==='all'&&/FROM tasks t/.test(call.sql))return inserted.map((row)=>({ ...row,owner_name:'Owner A' }));
    if(method==='all'&&/tenant_memberships/.test(call.sql))return [{ id:'user_a',full_name:'Owner A',email:'owner@example.com',role:'OWNER' }];
    if(method==='run'&&/INSERT INTO tasks/.test(call.sql)){
      inserted.push({ id:call.bindings[0],title:call.bindings[2],description:call.bindings[3],owner_user_id:call.bindings[4],status:'TODO',priority:call.bindings[6],due_at:call.bindings[7],activity_type:call.bindings[11],created_at:call.bindings[12],updated_at:call.bindings[13] });
    }
    return null;
  });
  const response=await onRequestPatch(context({db}));
  assert.equal(response.status,200);
  const body=await payload(response);
  assert.equal(body.item.activation.status,'ACTIVE');
  assert.match(body.item.activation.talentConfirmationFingerprint,/^cto_/);
  assert.equal(body.item.tasks.length,6);
  assert.equal(inserted.length,6);
  const taskWrites=db.calls.filter((call)=>/INSERT INTO tasks/.test(call.sql));
  assert.equal(taskWrites.every((call)=>call.bindings[1]==='tenant_a'&&call.bindings[10]==='cam_a'),true);
  assert.equal(taskWrites.every((call)=>String(call.bindings[11]).startsWith('SERVICE_CAMPAIGN_ACTIVATION:cam_a:')),true);

  duplicate=true;
  const duplicateDb=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM campaigns c/.test(call.sql))return campaign();
    if(method==='first'&&/tenant_memberships/.test(call.sql))return { id:'user_a',full_name:'Owner A' };
    if(method==='first'&&/activity_type LIKE/.test(call.sql))return { id:'existing_task' };
    if(method==='run')throw new Error('Duplicate activation must not create tasks');
    return [];
  });
  const duplicateResponse=await onRequestPatch(context({db:duplicateDb}));
  assert.equal(duplicateResponse.status,409);
  assert.match((await payload(duplicateResponse)).error,/already exists/i);
  const duplicateLookup=duplicateDb.calls.find((call)=>/activity_type LIKE/.test(call.sql));
  assert.deepEqual(duplicateLookup.bindings,['tenant_a','cam_a','SERVICE_CAMPAIGN_ACTIVATION:cam_a:%']);
});
