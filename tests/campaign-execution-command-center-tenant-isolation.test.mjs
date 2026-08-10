import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/campaign-execution-command-center.js';

class FakeDB {
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);const index=this.calls.length-1;return{
    first:async()=>this.resolver('first',call,index),
    all:async()=>({results:await this.resolver('all',call,index)||[]}),
    run:async()=>this.resolver('run',call,index)||{success:true},
  };}};}
}

const auth=(userId='user_a')=>({userId,tenantId:'tenant_a',tenantSlug:'akari-house',role:'OWNER',financeAccess:true});
const emptyNotes=JSON.stringify({campaignTracking:{version:3,overview:{},targets:[],socialUpdates:[],creatorAssignments:[],creatorPosts:[]},campaignPlanning:{version:1,status:'DRAFT',objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0,selections:[]}});
const campaigns=[
  {id:'cam_a',name:'Owned Campaign',status:'PLANNED',region:'EMEA',start_date:'2026-08-10',end_date:'2026-08-20',notes:emptyNotes,project_id:'prj_a',campaign_owner_id:'user_a',updated_at:'2026-08-09',project_name:'Project A',owner_name:'Owner A'},
  {id:'cam_b',name:'Team Campaign',status:'PLANNED',region:'APAC',start_date:'2026-08-11',end_date:'2026-08-21',notes:emptyNotes,project_id:'prj_b',campaign_owner_id:'user_b',updated_at:'2026-08-09',project_name:'Project B',owner_name:'Owner B'},
];
const tasks=[
  {id:'tsk_a',campaign_id:'cam_a',title:'Owned task',status:'TODO',priority:'HIGH',due_at:'2026-08-10',owner_user_id:'user_a',owner_name:'Owner A'},
  {id:'tsk_b',campaign_id:'cam_b',title:'Assigned team task',status:'TODO',priority:'MEDIUM',due_at:'2026-08-11',owner_user_id:'user_a',owner_name:'Owner A'},
];

function dbWith(rows=campaigns,taskRows=tasks){return new FakeDB((method,call)=>{
  if(method==='all'&&/FROM campaigns c/.test(call.sql))return rows;
  if(method==='all'&&/FROM tasks t/.test(call.sql))return taskRows;
  if(method==='run')throw new Error('Command centre must remain read only');
  return null;
});}
async function payload(response){return response.json();}

test('campaign and Work OS reads remain scoped to the authenticated tenant',async()=>{
  const db=dbWith();
  const response=await onRequestGet({env:{DB:db},data:{auth:auth()},request:new Request('https://crm.example.test/api/campaign-execution-command-center?scope=team')});
  assert.equal(response.status,200);
  const campaignRead=db.calls.find((call)=>/FROM campaigns c/.test(call.sql));
  const taskRead=db.calls.find((call)=>/FROM tasks t/.test(call.sql));
  assert.deepEqual(campaignRead.bindings,['tenant_a']);
  assert.deepEqual(taskRead.bindings,['tenant_a']);
  assert.match(campaignRead.sql,/c\.tenant_id=\?/);
  assert.match(campaignRead.sql,/p\.tenant_id=c\.tenant_id/);
  assert.match(taskRead.sql,/t\.tenant_id=\?/);
  assert.equal(db.calls.some((call)=>/\b(?:INSERT|UPDATE|DELETE)\b/i.test(call.sql)),false);
});

test('team scope returns only the rows supplied by the tenant-scoped reads',async()=>{
  const db=dbWith();
  const response=await onRequestGet({env:{DB:db},data:{auth:auth()},request:new Request('https://crm.example.test/api/campaign-execution-command-center?scope=team')});
  const body=await payload(response);
  assert.equal(body.command.scope,'TEAM');
  assert.deepEqual(body.command.items.map((item)=>item.id).sort(),['cam_a','cam_b']);
  assert.equal(body.methodology.tenantScoped,true);
  assert.equal(body.methodology.approvedOnlyPerformance,true);
});

test('mine scope includes campaigns owned by the user or containing their open Work OS task',async()=>{
  const db=dbWith();
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('user_a')},request:new Request('https://crm.example.test/api/campaign-execution-command-center?scope=mine')});
  const body=await payload(response);
  assert.equal(body.command.scope,'MINE');
  assert.deepEqual(body.command.items.map((item)=>item.id).sort(),['cam_a','cam_b']);
});

test('mine scope excludes a team campaign when the user neither owns it nor has open work',async()=>{
  const db=dbWith(campaigns,[{...tasks[0]},{...tasks[1],owner_user_id:'user_b',owner_name:'Owner B'}]);
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('user_a')},request:new Request('https://crm.example.test/api/campaign-execution-command-center?scope=mine')});
  const body=await payload(response);
  assert.deepEqual(body.command.items.map((item)=>item.id),['cam_a']);
});

test('closed tasks do not pull another team campaign into mine scope',async()=>{
  const closed=[{...tasks[0]},{...tasks[1],status:'DONE'}];
  const db=dbWith(campaigns,closed);
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('user_a')},request:new Request('https://crm.example.test/api/campaign-execution-command-center?scope=mine')});
  const body=await payload(response);
  assert.deepEqual(body.command.items.map((item)=>item.id),['cam_a']);
});
