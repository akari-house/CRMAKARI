import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet,onRequestPost } from '../functions/api/workspace-admin/index.js';
import { acceptInvitation,createInvitation,hashInviteToken,normalizeModules,normalizeWorkspaceSlug } from '../functions/lib/workspace-admin.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}}}};}
}
function auth(role='OWNER',tenantSlug='tenant-a'){return{userId:'user_a',tenantId:'tenant_a',tenantSlug,role,financeAccess:role==='OWNER'};}

test('R75 viewer cannot enter workspace administration before database access',async()=>{
  const db=new FakeDB(()=>null);
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('VIEWER')},request:new Request('https://crm.test/api/workspace-admin')});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('R75 workspace admin reads are tenant scoped',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM platform_admins LIMIT 1/i.test(call.sql))return{id:'schema'};
    if(method==='first'&&/SELECT id FROM platform_admins WHERE user_id/i.test(call.sql))return{id:'padmin'};
    if(method==='first'&&/FROM tenants t LEFT JOIN tenant_settings/i.test(call.sql))return{id:'tenant_a',name:'Tenant A',slug:'tenant-a',status:'ACTIVE',base_currency:'USD',timezone:'UTC',plan_code:'FOUNDING',user_limit:3,storage_limit_mb:500,enabled_modules_json:'["BD"]'};
    if(method==='first'&&/FROM tenant_memberships WHERE tenant_id/i.test(call.sql))return{active_seats:1,invited_seats:0};
    if(method==='first'&&/FROM invitations WHERE tenant_id/i.test(call.sql))return{count:0};
    if(method==='first'&&/storage_used_bytes/i.test(call.sql))return{storage_used_bytes:0};
    if(method==='first'&&/FROM projects WHERE tenant_id/i.test(call.sql))return{count:0};
    if(method==='first'&&/FROM campaigns WHERE tenant_id/i.test(call.sql))return{count:0};
    if(method==='first'&&/FROM fundraising_rounds WHERE tenant_id/i.test(call.sql))return{count:0};
    if(method==='all')return[];
    return null;
  });
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('OWNER')},request:new Request('https://crm.test/api/workspace-admin')});
  assert.equal(response.status,200);
  const tenantReads=db.calls.filter(call=>/tenant_id\s*=\s*\?/i.test(call.sql));
  assert.ok(tenantReads.length>=4);
  for(const call of tenantReads)assert.ok(call.bindings.includes('tenant_a'));
});

test('R75 platform scope is denied to non-platform tenant owner',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM platform_admins LIMIT 1/i.test(call.sql))return{id:'schema'};
    if(method==='first'&&/SELECT id FROM platform_admins WHERE user_id/i.test(call.sql))return null;
    if(method==='first'&&/SELECT COUNT\(\*\) count FROM platform_admins/i.test(call.sql))return{count:1};
    return null;
  });
  const response=await onRequestGet({env:{DB:db},data:{auth:auth('OWNER','client-two')},request:new Request('https://crm.test/api/workspace-admin?scope=platform')});
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/platform administrator/i);
  assert.equal(db.calls.some(call=>/SELECT t\.id,t\.name,t\.slug/i.test(call.sql)),false);
});

test('R75 invitation stores a hash rather than the raw token',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id,slug,user_limit,status FROM tenants/i.test(call.sql))return{id:'tenant_a',slug:'tenant-a',user_limit:5,status:'ACTIVE'};
    if(method==='first'&&/FROM users u JOIN tenant_memberships/i.test(call.sql))return null;
    if(method==='first'&&/SELECT id FROM invitations/i.test(call.sql))return null;
    if(method==='first'&&/FROM tenant_memberships WHERE tenant_id/i.test(call.sql))return{active_seats:1,invited_seats:0};
    if(method==='first'&&/FROM invitations WHERE tenant_id/i.test(call.sql))return{count:0};
    if(method==='first')return{count:0};
    return null;
  });
  const invitation=await createInvitation(db,'tenant_a','user_a',{email:'new@example.com',role:'BD_MEMBER'},{origin:'https://crm.test'});
  assert.ok(invitation.token.length>=64);
  assert.ok(invitation.inviteUrl.includes(invitation.token));
  const insert=db.calls.find(call=>/INSERT INTO invitations/i.test(call.sql));
  assert.ok(insert);
  assert.notEqual(insert.bindings[5],invitation.token);
  assert.equal(insert.bindings[5],await hashInviteToken(invitation.token));
});

test('R75 invitation cannot be accepted by a different Cloudflare identity',async()=>{
  const token='a'.repeat(64),hash=await hashInviteToken(token);
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM invitations i JOIN tenants/i.test(call.sql)&&call.bindings[0]===hash)return{id:'invite_1',tenant_id:'tenant_a',tenant_slug:'tenant-a',tenant_status:'ACTIVE',email:'owner@example.com',role:'OWNER',finance_access:1,expires_at:'2099-01-01T00:00:00.000Z',accepted_at:null,revoked_at:null};
    return null;
  });
  await assert.rejects(()=>acceptInvitation(db,{email:'attacker@example.com'},{token}),error=>error.status===403&&/different email/i.test(error.message));
  assert.equal(db.calls.some(call=>/^INSERT INTO tenant_memberships/i.test(call.sql)),false);
});

test('R75 workspace identifiers and modules are controlled',()=>{
  assert.equal(normalizeWorkspaceSlug('Client Two GmbH'),'client-two-gmbh');
  assert.throws(()=>normalizeWorkspaceSlug('api'),/reserved/i);
  assert.deepEqual(normalizeModules(['BD','BD','FUNDRAISING','UNKNOWN']),['BD','FUNDRAISING']);
});
