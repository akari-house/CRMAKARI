import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet,onRequestPost } from '../functions/api/fundraising/strategy.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}};}};}
}
function context({db,body,role='OWNER',financeAccess=true,tenantId='tenant_a'}){return{env:{DB:db},data:{auth:{userId:'user_a',tenantId,tenantSlug:'tenant-a',role,financeAccess}},request:new Request('https://crm.test/api/fundraising/strategy',body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})};}
const round={id:'round_a',tenant_id:'tenant_a',project_id:'project_a',project_name:'Founder A',round_name:'Seed',stage:'OUTREACH',instrument:'SAFE',currency:'USD',target_amount:500000,valuation:5000000,owner_user_id:'user_a',source_model:'NORMALIZED',updated_at:'2026-08-03T10:00:00.000Z'};
const target={id:'target_a',investor_name:'North Star Ventures',person_name:'Alex Partner'};
const termData={id:'term_a',roundId:'round_a',projectId:'project_a',projectName:'Founder A',roundName:'Seed',targetId:'target_a',investorName:'North Star Ventures',personName:'Alex Partner',status:'REVIEWING',instrument:'SAFE',proposedInvestment:250000,valuation:0,valuationCap:8000000,discountPercentage:20,interestRate:0,maturityMonths:0,proRataRights:true,informationRights:true,boardSeat:false,observerRights:false,liquidationPreference:1,participatingPreference:false,antiDilution:'NONE',exclusivityDays:15,documentUrl:'https://docs.example/term',riskFlags:[],riskCount:0,createdAt:'2026-08-01T10:00:00.000Z'};
function activityRow(type,data=termData){return{id:data.id,tenant_id:'tenant_a',project_id:'project_a',user_id:'user_a',activity_type:type,subject:'Record',description:JSON.stringify(data),outcome:data.status||data.stage,occurred_at:'2026-08-03T10:00:00.000Z',created_at:data.createdAt||'2026-08-01T10:00:00.000Z'};}
function normalized(method,call){if(method==='first'&&/SELECT id FROM fundraising_rounds/.test(call.sql))return{id:'round_a'};if(method==='all'&&/SELECT r\.\*,p\.name project_name/.test(call.sql))return[round];if(method==='all'&&/FROM fundraising_commitments c/.test(call.sql))return[];if(method==='all'&&/FROM activities/.test(call.sql)&&/activity_type=\?/.test(call.sql))return[];return undefined;}

test('strategy snapshot reads rounds records and members only inside the authenticated tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='all'&&/activity_type IN/.test(call.sql))return[activityRow('FUNDRAISING_TERM_SHEET')];
    if(method==='all'&&/FROM tenant_memberships tm/.test(call.sql))return[{id:'user_a',full_name:'Muaz',role:'OWNER'}];
    return null;
  });
  const response=await onRequestGet(context({db}));
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.rounds[0].termSheets[0].investorName,'North Star Ventures');
  assert.equal(payload.ai.required,false);
  assert.match(payload.disclaimers.capTable,/not the legal cap table/i);
  for(const call of db.calls.filter(call=>/fundraising_rounds|fundraising_commitments|activities|tenant_memberships/.test(call.sql)))assert.equal(call.bindings[0],'tenant_a');
});

test('strategy writes reject non-manager roles before database access',async()=>{
  const db=new FakeDB(()=>{throw new Error('database must not be queried');});
  const response=await onRequestPost(context({db,role:'VIEWER',body:{action:'save-term-sheet'}}));
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('final term ownership and award decisions require Owner Admin finance permission before database access',async()=>{
  for(const action of ['decide-term-sheet','approve-cap-table','recognize-funding-award']){
    const db=new FakeDB(()=>{throw new Error('database must not be queried');});
    const response=await onRequestPost(context({db,role:'BD_MANAGER',financeAccess:false,body:{action,id:'record_a'}}));
    assert.equal(response.status,403);
    assert.equal(db.calls.length,0);
  }
});

test('term sheet investor target must belong to the selected tenant round',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='all'&&/activity_type IN/.test(call.sql))return[];
    if(method==='all'&&/FROM tenant_memberships tm/.test(call.sql))return[];
    if(method==='first'&&/FROM fundraising_targets t/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-term-sheet',roundId:'round_a',targetId:'target_other',instrument:'SAFE',proposedInvestment:100000,status:'DRAFT'}}));
  assert.equal(response.status,404);
  assert.match((await response.json()).error,/Investor target was not found/i);
  const lookup=db.calls.find(call=>/FROM fundraising_targets t/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','round_a','target_other']);
  assert.equal(db.calls.some(call=>/INSERT INTO activities/.test(call.sql)),false);
});

test('ownership scenario rejects stakeholder ownership above one hundred percent',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='first'&&/SELECT \* FROM activities/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-cap-table',roundId:'round_a',scenarioName:'Invalid',preMoneyValuation:5000000,newInvestment:500000,existingOptionPoolPercentage:10,proposedOptionPoolPercentage:10,stakeholders:[{name:'Founder A',type:'FOUNDER',beforePercentage:70},{name:'Founder B',type:'FOUNDER',beforePercentage:40}]}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/cannot exceed 100%/i);
  assert.equal(db.calls.some(call=>/INSERT INTO activities/.test(call.sql)),false);
});

test('strategic funding owner must be an active member of the same tenant',async()=>{
  const db=new FakeDB((method,call)=>{
    const base=normalized(method,call);if(base!==undefined)return base;
    if(method==='first'&&/FROM users u/.test(call.sql))return null;
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'save-strategic-funding',roundId:'round_a',ownerUserId:'user_other',programmeName:'Innovation Grant',providerName:'Agency',fundingType:'GRANT',stage:'RESEARCHING',amount:100000}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/active workspace member/i);
  const lookup=db.calls.find(call=>/FROM users u/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','user_other']);
});

test('funding award cannot be recognised before an amount is recorded',async()=>{
  const funding={id:'funding_a',roundId:'round_a',projectId:'project_a',programmeName:'Innovation Grant',providerName:'Agency',stage:'SUBMITTED',status:'SUBMITTED',amount:0,createdAt:'2026-08-01T10:00:00.000Z'};
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT \* FROM activities/.test(call.sql))return activityRow('FUNDRAISING_STRATEGIC_FUNDING',funding);
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'recognize-funding-award',id:'funding_a',reason:'Award letter received',awardedAt:'2026-08-03T10:00:00.000Z'}}));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/amount must be recorded/i);
  assert.equal(db.calls.some(call=>/UPDATE activities/.test(call.sql)),false);
});

test('strategic funding follow-up task validates tenant owner and prevents duplicate open work',async()=>{
  const funding={id:'funding_a',roundId:'round_a',projectId:'project_a',programmeName:'Innovation Grant',providerName:'Agency',stage:'APPLYING',status:'APPLYING',amount:100000,ownerUserId:'user_a',deadline:'2026-08-10T10:00:00.000Z',createdAt:'2026-08-01T10:00:00.000Z'};
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT \* FROM activities/.test(call.sql))return activityRow('FUNDRAISING_STRATEGIC_FUNDING',funding);
    if(method==='first'&&/FROM users u/.test(call.sql))return{id:'user_a',full_name:'Muaz',role:'OWNER'};
    if(method==='first'&&/SELECT id FROM tasks/.test(call.sql))return{id:'task_existing'};
    return null;
  });
  const response=await onRequestPost(context({db,body:{action:'create-funding-task',id:'funding_a',ownerUserId:'user_a',dueAt:'2026-08-10T10:00:00.000Z'}}));
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/open follow-up task already exists/i);
  const duplicate=db.calls.find(call=>/SELECT id FROM tasks/.test(call.sql));
  assert.deepEqual(duplicate.bindings,['tenant_a','%[Strategic Funding:funding_a]%']);
  assert.equal(db.calls.some(call=>/INSERT INTO tasks/.test(call.sql)),false);
});
