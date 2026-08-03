import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet,onRequestPost } from '../functions/api/fundraising/outreach.js';

class FakeDB {
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}};}};}
}

function context({db,body,role='OWNER',tenantId='tenant_a'}){
  return{env:{DB:db},data:{auth:{userId:'user_a',tenantId,tenantSlug:'tenant-a',role,financeAccess:true}},request:new Request('https://crm.test/api/fundraising/outreach',body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})};
}

const target={
  id:'target_a',round_id:'round_a',organisation_id:'org_a',primary_person_id:'person_a',stage:'CONTACTED',fit_score:82,expected_check:250000,next_action:'Send follow-up',next_follow_up_at:'2026-08-05T10:00:00.000Z',
  project_id:'project_a',round_name:'Seed',currency:'USD',project_name:'Founder A',investor_name:'North Star Ventures',person_name:'Alex Partner',primary_contact:'alex@northstar.example',primary_contact_kind:'WORK_EMAIL',
};

function draftData(overrides={}){
  return{
    id:'draft_a',projectId:'project_a',roundId:'round_a',targetId:'target_a',organisationId:'org_a',investorName:'North Star Ventures',personId:'person_a',personName:'Alex Partner',recipient:'alex@northstar.example',channel:'EMAIL',purpose:'FOLLOW_UP_DRAFT',disclosurePolicy:'SAFE_FOR_OUTREACH',subject:'Seed follow-up',body:'Hello Alex',status:'DRAFT',founderApproval:null,akariApproval:null,contentHash:'hash_a',followUpAt:'',createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z',...overrides,
  };
}

function draftRow(overrides={}){
  const data=draftData(overrides);
  return{id:data.id,tenant_id:'tenant_a',project_id:'project_a',user_id:'user_a',activity_type:'FUNDRAISING_OUTREACH_DRAFT',subject:data.subject,description:JSON.stringify(data),outcome:data.status,occurred_at:data.updatedAt,follow_up_at:data.followUpAt||null,created_at:data.createdAt};
}

function meetingData(overrides={}){
  return{id:'meeting_a',projectId:'project_a',roundId:'round_a',targetId:'target_a',organisationId:'org_a',investorName:'North Star Ventures',personId:'person_a',personName:'Alex Partner',title:'Investor meeting · North Star Ventures',meetingAt:'2026-08-08T10:00:00.000Z',durationMinutes:30,timezone:'Europe/Berlin',meetingLink:'https://meet.example/a',agenda:'Round and product',brief:'Meeting brief',status:'SCHEDULED',ownerUserId:'user_a',followUpAt:'',notes:'',outcome:'',nextSteps:'',createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z',...overrides};
}

function meetingRow(overrides={}){const data=meetingData(overrides);return{id:data.id,tenant_id:'tenant_a',project_id:'project_a',user_id:'user_a',activity_type:'FUNDRAISING_INVESTOR_MEETING',subject:data.title,description:JSON.stringify(data),outcome:data.status,occurred_at:data.meetingAt,follow_up_at:data.followUpAt||null,created_at:data.createdAt};}

function normalizedTargetResolver(method,call){
  if(method==='all'&&/FROM fundraising_targets t/.test(call.sql))return[target];
  if(method==='first'&&/FROM projects WHERE tenant_id/.test(call.sql))return{id:'project_a',name:'Founder A'};
  return undefined;
}

test('outreach reads audited activities, targets and members only inside the authenticated tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='all'&&/FROM activities a/.test(call.sql))return[draftRow(),meetingRow()];
    if(method==='all'&&/FROM fundraising_targets t/.test(call.sql))return[target];
    if(method==='all'&&/FROM tenant_memberships tm/.test(call.sql))return[{id:'user_a',full_name:'Muaz',role:'OWNER'}];
    return null;
  });
  const response=await onRequestGet(context({db}));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.drafts.length,1);
  assert.equal(payload.meetings.length,1);
  assert.equal(payload.targets[0].investor_name,'North Star Ventures');
  const activityRead=db.calls.find((call)=>/FROM activities a/.test(call.sql));
  assert.deepEqual(activityRead.bindings,['tenant_a','FUNDRAISING_OUTREACH_DRAFT','FUNDRAISING_INVESTOR_MEETING']);
  const targetRead=db.calls.find((call)=>/FROM fundraising_targets t/.test(call.sql));
  assert.deepEqual(targetRead.bindings,['tenant_a']);
  const memberRead=db.calls.find((call)=>/FROM tenant_memberships tm/.test(call.sql));
  assert.deepEqual(memberRead.bindings,['tenant_a']);
});

test('outreach writes reject non-manager roles before database access',async()=>{
  const db=new FakeDB(()=>{throw new Error('database must not be queried');});
  const response=await onRequestPost(context({db,role:'BD_MEMBER',body:{action:'save-draft'}}));
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('draft target resolution never accepts another tenant project',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='all'&&/FROM fundraising_targets t/.test(call.sql))return[target];
    if(method==='first'&&/FROM projects WHERE tenant_id/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-draft',targetId:'target_a',channel:'EMAIL',purpose:'FOLLOW_UP_DRAFT',disclosurePolicy:'SAFE_FOR_OUTREACH',recipient:'alex@northstar.example',subject:'Follow-up',body:'Hello'}}));
  assert.equal(response.status,404);
  assert.match((await response.json()).error,/Founder project was not found/i);
  const lookup=db.calls.find((call)=>/FROM projects WHERE tenant_id/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','project_a']);
  assert.equal(db.calls.some((call)=>/INSERT INTO activities/.test(call.sql)),false);
});

test('saving a changed draft resets exact-content approvals and redacts body from audit payloads',async()=>{
  const approved=draftData({founderApproval:{status:'APPROVED',contentHash:'old_hash'},akariApproval:{status:'APPROVED',contentHash:'old_hash'},contentHash:'old_hash'});
  const db=new FakeDB((method,call)=>{
    const resolved=normalizedTargetResolver(method,call);if(resolved!==undefined)return resolved;
    if(method==='first'&&/FROM activities WHERE tenant_id/.test(call.sql))return draftRow(approved);
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-draft',id:'draft_a',targetId:'target_a',channel:'EMAIL',purpose:'FOLLOW_UP_DRAFT',disclosurePolicy:'SAFE_FOR_OUTREACH',recipient:'alex@northstar.example',subject:'Updated subject',body:'Updated confidential body'}}));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.item.founderApproval,null);
  assert.equal(payload.item.akariApproval,null);
  const audit=db.calls.find((call)=>/INSERT INTO audit_logs/.test(call.sql));
  const auditText=JSON.stringify(audit.bindings);
  assert.equal(auditText.includes('Updated confidential body'),false);
  assert.ok(auditText.includes('[REDACTED]'));
});

test('founder and AKARI approvals are Owner/Admin controlled',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM activities WHERE tenant_id/.test(call.sql))return draftRow();
    return null;
  });
  const response=await onRequestPost(context({db,role:'BD_MANAGER',body:{action:'approve-founder',id:'draft_a',note:'Founder confirmed'}}));
  assert.equal(response.status,403);
  assert.equal(db.calls.some((call)=>/UPDATE activities/.test(call.sql)),false);
});

test('export and manual-send records require both approvals tied to the current content hash',async()=>{
  const base=draftData();
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({recipient:base.recipient,channel:base.channel,subject:base.subject,body:base.body,disclosurePolicy:base.disclosurePolicy})));
  const contentHash=[...new Uint8Array(hash)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
  const approved={...base,contentHash,founderApproval:{status:'APPROVED',contentHash,by:'user_a'},akariApproval:null};
  const db=new FakeDB((method,call)=>method==='first'&&/FROM activities WHERE tenant_id/.test(call.sql)?draftRow(approved):null);
  const response=await onRequestPost(context({db,body:{action:'mark-sent',id:'draft_a',reference:'message-123'}}));
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/both founder and AKARI approval/i);
  assert.equal(db.calls.some((call)=>/UPDATE activities/.test(call.sql)),false);
});

test('reply recording is blocked until a manual send is recorded',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/FROM activities WHERE tenant_id/.test(call.sql)?draftRow({status:'DRAFT'}):null);
  const response=await onRequestPost(context({db,body:{action:'record-reply',id:'draft_a',replyStatus:'POSITIVE',replySummary:'Interested'}}));
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/only be recorded after the message is sent/i);
});

test('meeting owner must be an active member of the authenticated workspace',async()=>{
  const db=new FakeDB((method,call)=>{
    const resolved=normalizedTargetResolver(method,call);if(resolved!==undefined)return resolved;
    if(method==='first'&&/FROM users u/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-meeting',targetId:'target_a',title:'Investor meeting',meetingAt:'2026-08-08T10:00:00.000Z',ownerUserId:'user_tenant_b'}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/active workspace member/i);
  const lookup=db.calls.find((call)=>/FROM users u/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','user_tenant_b']);
  assert.equal(db.calls.some((call)=>/INSERT INTO activities/.test(call.sql)),false);
});

test('meeting completion requires notes outcome and next steps',async()=>{
  const db=new FakeDB((method,call)=>method==='first'&&/FROM activities WHERE tenant_id/.test(call.sql)?meetingRow():null);
  const response=await onRequestPost(context({db,body:{action:'complete-meeting',id:'meeting_a',notes:'Discussion notes',outcome:'Positive',nextSteps:''}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/notes, outcome and next steps are required/i);
  assert.equal(db.calls.some((call)=>/UPDATE activities/.test(call.sql)),false);
});

test('outreach follow-up tasks validate tenant ownership and block duplicate open work',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM activities WHERE tenant_id/.test(call.sql))return meetingRow({followUpAt:'2026-08-10T10:00:00.000Z'});
    if(method==='first'&&/FROM users u/.test(call.sql))return{id:'user_a',full_name:'Muaz'};
    if(method==='first'&&/SELECT id FROM tasks/.test(call.sql))return{id:'task_existing'};
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'create-follow-up-task',entityType:'MEETING',id:'meeting_a',ownerUserId:'user_a',dueAt:'2026-08-10T10:00:00.000Z'}}));
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/open follow-up task already exists/i);
  const duplicate=db.calls.find((call)=>/SELECT id FROM tasks/.test(call.sql));
  assert.deepEqual(duplicate.bindings,['tenant_a','%[Fundraising Outreach:meeting_a]%']);
  assert.equal(db.calls.some((call)=>/INSERT INTO tasks/.test(call.sql)),false);
});
