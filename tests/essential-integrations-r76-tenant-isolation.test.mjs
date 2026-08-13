import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret,decryptSecret,sha256 } from '../functions/lib/integration-crypto.js';
import { authenticateApiKey,createApiKey,validateWebhookUrl } from '../functions/lib/api-webhooks.js';
import { parseCsv,toCsv,previewCsvImport } from '../functions/lib/csv-portability.js';
import { googleDriveFileId } from '../functions/lib/google-integration.js';
import { onRequest as apiScopeMiddleware } from '../functions/api/v1/_middleware.js';
import { onRequestGet as getProjects,onRequestPost as postProject } from '../functions/api/v1/projects.js';

class FakeDB{
  constructor(resolver){this.resolver=resolver;this.calls=[];}
  prepare(sql){return{bind:(...bindings)=>{const call={sql:String(sql),bindings};this.calls.push(call);return{first:async()=>this.resolver('first',call,this.calls.length-1),all:async()=>({results:await this.resolver('all',call,this.calls.length-1)||[]}),run:async()=>this.resolver('run',call,this.calls.length-1)||{success:true}}}};}
}

test('R76 integration secrets encrypt and decrypt without storing plaintext',async()=>{
  const key='a-very-long-random-integration-key-1234567890',secret='google-refresh-token-value';
  const encrypted=await encryptSecret(key,secret);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.iv);
  assert.equal(encrypted.ciphertext.includes(secret),false);
  assert.equal(await decryptSecret(key,encrypted.ciphertext,encrypted.iv),secret);
});

test('R76 API key creation stores only a hash and tenant id',async()=>{
  const db=new FakeDB(()=>null);
  const created=await createApiKey(db,'tenant_a','user_a',{name:'Reporting',scopes:['read']});
  const insert=db.calls.find(call=>/INSERT INTO workspace_api_keys/i.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.bindings[1],'tenant_a');
  assert.notEqual(insert.bindings[4],created.key);
  assert.equal(insert.bindings[4],await sha256(created.key));
});

test('R76 API key authentication resolves only the tenant bound to the key',async()=>{
  const raw='ak_live_'+('b'.repeat(64)),hash=await sha256(raw);
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/FROM workspace_api_keys k JOIN tenants/i.test(call.sql)&&call.bindings[0]===hash)return{id:'key_1',tenant_id:'tenant_b',tenant_slug:'tenant-b',tenant_name:'Tenant B',tenant_status:'ACTIVE',status:'ACTIVE',scopes_json:'["read"]',expires_at:null};
    return null;
  });
  const auth=await authenticateApiKey(db,raw);
  assert.equal(auth.tenantId,'tenant_b');
  assert.deepEqual(auth.scopes,['read']);
  assert.equal(db.calls.some(call=>/tenant_a/i.test(JSON.stringify(call.bindings))),false);
});

test('R76 external API write requires write scope before handler execution',async()=>{
  let nextCalled=false;
  const response=await apiScopeMiddleware({data:{auth:{role:'API',tenantId:'tenant_a',scopes:['read']}},request:new Request('https://crm.test/api/v1/projects',{method:'POST'}),next:async()=>{nextCalled=true;return new Response(null,{status:204});}});
  assert.equal(response.status,403);
  assert.equal(nextCalled,false);
  assert.match((await response.json()).error,/write scope/i);
});

test('R76 external projects read binds query to API key tenant only',async()=>{
  const db=new FakeDB((method,call)=>method==='all'&&/FROM projects WHERE/i.test(call.sql)?[{id:'project_b',name:'Tenant B Project'}]:null);
  const response=await getProjects({env:{DB:db},data:{auth:{role:'API',apiKeyId:'key_b',tenantId:'tenant_b',scopes:['read']}},request:new Request('https://crm.test/api/v1/projects?limit=10')});
  assert.equal(response.status,200);
  const query=db.calls.find(call=>/FROM projects WHERE/i.test(call.sql));
  assert.ok(query);
  assert.equal(query.bindings[0],'tenant_b');
  assert.equal(query.bindings.includes('tenant_a'),false);
});

test('R76 external project creation is tenant scoped and audited to the API key',async()=>{
  const db=new FakeDB((method,call)=>{
    if(method==='first'&&/SELECT id FROM projects WHERE tenant_id=\?/i.test(call.sql))return null;
    return null;
  });
  const response=await postProject({env:{DB:db},data:{auth:{role:'API',apiKeyId:'key_b',tenantId:'tenant_b',scopes:['read','write']}},request:new Request('https://crm.test/api/v1/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'New Client',website:'https://new.example'})})});
  assert.equal(response.status,201);
  const insert=db.calls.find(call=>/INSERT INTO projects/i.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.bindings[1],'tenant_b');
  const audit=db.calls.find(call=>/EXTERNAL_API_PROJECT_CREATED/i.test(JSON.stringify(call.bindings)));
  assert.ok(audit);
  assert.equal(audit.bindings[1],'tenant_b');
  assert.match(String(audit.bindings[5]),/key_b/);
});

test('R76 webhook targets reject HTTP, localhost and IP literals',()=>{
  assert.throws(()=>validateWebhookUrl('http://example.com/hook'),/HTTPS/i);
  assert.throws(()=>validateWebhookUrl('https://localhost/hook'),/public DNS/i);
  assert.throws(()=>validateWebhookUrl('https://127.0.0.1/hook'),/public DNS/i);
  assert.equal(validateWebhookUrl('https://hooks.example.com/akari'),'https://hooks.example.com/akari');
});

test('R76 CSV parser handles quoted cells and export neutralizes spreadsheet formulas',()=>{
  const parsed=parseCsv('name,notes\r\n"Acme, Inc","hello ""world"""\r\n');
  assert.equal(parsed.records[0].name,'Acme, Inc');
  assert.equal(parsed.records[0].notes,'hello "world"');
  const csv=toCsv([{name:'=HYPERLINK("https://bad")'}],[{key:'name'}]);
  assert.match(csv,/'=HYPERLINK/);
});

test('R76 project CSV validation rejects invalid lifecycle before writes',async()=>{
  const db=new FakeDB(()=>null);
  const preview=await previewCsvImport(db,'tenant_a','projects','name,lifecycle_status\r\nAcme,INVALID_STATE\r\n');
  assert.equal(preview.acceptedCount,0);
  assert.equal(preview.errorCount,1);
  assert.match(preview.errors[0].error,/lifecycle_status/i);
  assert.equal(db.calls.some(call=>/^INSERT/i.test(call.sql)),false);
});

test('R76 Drive link parser supports Google Drive and Docs URL forms',()=>{
  assert.equal(googleDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view'),'1AbCdEfGhIjKlMnOp');
  assert.equal(googleDriveFileId('https://docs.google.com/document/d/1ZyXwVuTsRqPoNmLk/edit'),'1ZyXwVuTsRqPoNmLk');
});
