import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as createOpportunity } from '../functions/api/opportunities/index.js';

class FakeDB {
  constructor(resolver, { batch = true } = {}) {
    this.resolver = resolver;
    this.calls = [];
    this.batchUsed = false;
    if (batch) {
      this.batch = async (statements) => {
        this.batchUsed = true;
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      };
    }
  }

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

function context({ db, body = {}, role = 'OWNER' }) {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess:true } },
    request:new Request('https://crm.example.test/api/opportunities', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        projectId:'project_a',
        name:'Launch campaign',
        serviceType:'MARKETING_CAMPAIGN',
        stage:'NEW',
        estimatedValue:'25000',
        currency:'USD',
        probabilityPercentage:'10',
        nextAction:'Book discovery call',
        ...body,
      }),
    }),
  };
}

async function responseBody(response) { return response.json(); }

function savedRow(call) {
  const id = call.bindings[1];
  return {
    id,
    tenant_id:'tenant_a',
    project_id:'project_a',
    project_name:'Project A',
    name:'Launch campaign',
    service_type:'MARKETING_CAMPAIGN',
    stage:'NEW',
    estimated_value:25000,
    estimated_value_base_currency:25000,
    currency:'USD',
    probability_percentage:10,
    next_action:'Book discovery call',
    owner_user_id:'user_a',
    owner_name:'Owner A',
  };
}

test('opportunity creation is tenant scoped, atomic when available and returns the confirmed row', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /SELECT id FROM projects/.test(call.sql)) return { id:'project_a' };
    if (method === 'first' && /SELECT o\.\*/.test(call.sql)) return savedRow(call);
    return null;
  });

  const response = await createOpportunity(context({ db }));
  const payload = await responseBody(response);

  assert.equal(response.status, 201);
  assert.equal(payload.created, true);
  assert.equal(payload.item.id, payload.id);
  assert.equal(payload.item.project_name, 'Project A');
  assert.equal(payload.item.stage, 'NEW');
  assert.equal(db.batchUsed, true);

  const insert = db.calls.find((call) => /INSERT INTO opportunities/.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.bindings[1], 'tenant_a');
  assert.equal(insert.bindings[2], 'project_a');
  assert.equal(insert.bindings[6], 'user_a');

  const readBack = db.calls.find((call) => /SELECT o\.\*/.test(call.sql));
  assert.deepEqual(readBack.bindings, ['tenant_a', payload.id]);
  assert.match(readBack.sql, /p\.tenant_id = o\.tenant_id/);
});

test('opportunity creation never reports success when the D1 read-back cannot find the row', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /SELECT id FROM projects/.test(call.sql)) return { id:'project_a' };
    if (method === 'first' && /SELECT o\.\*/.test(call.sql)) return null;
    return null;
  });

  const response = await createOpportunity(context({ db }));
  const payload = await responseBody(response);

  assert.equal(response.status, 500);
  assert.match(payload.error, /not confirmed in the CRM database/i);
  assert.equal(db.batchUsed, true);
});

test('opportunity creation rejects a project outside the authenticated tenant before any write', async () => {
  const db = new FakeDB(() => null);
  const response = await createOpportunity(context({ db, body:{ projectId:'project_tenant_b' } }));
  const payload = await responseBody(response);

  assert.equal(response.status, 404);
  assert.match(payload.error, /project not found in this workspace/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a','project_tenant_b']);
  assert.equal(db.calls.some((call) => /INSERT INTO opportunities/.test(call.sql)), false);
  assert.equal(db.batchUsed, false);
});
