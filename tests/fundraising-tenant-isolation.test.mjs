import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/fundraising/index.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql:String(sql), bindings };
        this.calls.push(call);
        return {
          first: async () => this.resolver('first', call, this.calls.length - 1),
          all: async () => ({ results:await this.resolver('all', call, this.calls.length - 1) || [] }),
          run: async () => this.resolver('run', call, this.calls.length - 1) || { success:true },
        };
      },
    };
  }
}

function context({ db, body, role = 'OWNER', tenantId = 'tenant_a' }) {
  return {
    env:{ DB:db },
    data:{ auth:{ userId:'user_a', tenantId, tenantSlug:'tenant-a', role, financeAccess:true } },
    request:new Request('https://crm.test/api/fundraising', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify(body),
    }),
  };
}

const tenantProjectLookup = /FROM\s+projects\s+WHERE\s+tenant_id\s*=\s*\?\s+AND\s+id\s*=\s*\?/i;

test('capital rooms require manager permission', async () => {
  const db = new FakeDB(() => { throw new Error('database must not be queried'); });
  const response = await onRequestPost(context({ db, role:'BD_MEMBER', body:{ projectId:'project_a' } }));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Owner, Admin or BD Manager/i);
  assert.equal(db.calls.length, 0);
});

test('capital room project lookup is tenant scoped', async () => {
  const db = new FakeDB(() => null);
  const response = await onRequestPost(context({ db, body:{ projectId:'project_b', roundName:'Seed' } }));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /not found in this workspace/i);
  const lookup = db.calls.find((call) => tenantProjectLookup.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a', 'project_b']);
});

test('investor organisation lookup is tenant scoped', async () => {
  const flags = { fundraisingCapitalRooms:[{ id:'raise_a', projectId:'project_a', projectName:'Founder A', investorPipeline:[] }] };
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    if (method === 'first' && tenantProjectLookup.test(call.sql)) return null;
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body:{ action:'upsert-investor', roomId:'raise_a', item:{ investorProjectId:'investor_tenant_b', nextAction:'Request intro' } },
  }));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /investor organisation was not found/i);
  const lookup = db.calls.find((call) => tenantProjectLookup.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a', 'investor_tenant_b']);
});

test('non-investor project cannot enter investor pipeline', async () => {
  const flags = { fundraisingCapitalRooms:[{ id:'raise_a', projectId:'project_a', projectName:'Founder A', investorPipeline:[] }] };
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    if (method === 'first' && tenantProjectLookup.test(call.sql)) {
      return { id:'project_customer', name:'Customer', category:'STARTUP', region:'EU' };
    }
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body:{ action:'upsert-investor', roomId:'raise_a', item:{ investorProjectId:'project_customer', nextAction:'Contact' } },
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /not classified as an investor/i);
  assert.equal(db.calls.some((call) => /UPDATE tenant_settings/.test(call.sql)), false);
});

test('data room access cannot be granted before NDA is signed', async () => {
  const flags = {
    fundraisingCapitalRooms:[{
      id:'raise_a',
      projectId:'project_a',
      projectName:'Founder A',
      investorPipeline:[{ id:'inv_a', investorProjectId:'fund_a', investorName:'Fund A' }],
      investorAccess:[],
    }],
  };
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body:{ action:'upsert-access', roomId:'raise_a', item:{ investorPipelineId:'inv_a', ndaStatus:'PENDING', accessStatus:'GRANTED' } },
  }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /NDA must be signed/i);
  assert.equal(db.calls.some((call) => /UPDATE tenant_settings/.test(call.sql)), false);
});
