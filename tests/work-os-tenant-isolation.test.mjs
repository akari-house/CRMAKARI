import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/work-os/index.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return { bind: (...bindings) => {
      const call = { sql:String(sql), bindings };
      this.calls.push(call);
      const index = this.calls.length - 1;
      return {
        first: async () => this.resolver('first', call, index),
        all: async () => ({ results:await this.resolver('all', call, index) || [] }),
        run: async () => this.resolver('run', call, index) || { success:true },
      };
    } };
  }
}

function context({ db, body, role='OWNER', financeAccess=true }) {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a', tenantId:'tenant_a', tenantSlug:'tenant-a', role, financeAccess } },
    request:new Request('https://crm.example.test/api/work-os', {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body),
    }),
  };
}

async function payload(response) { return response.json(); }

test('viewer cannot create or update Work OS tasks', async () => {
  const db = new FakeDB(() => { throw new Error('Viewer request must not query or mutate task data'); });
  const response = await onRequestPost(context({ db, role:'VIEWER', body:{ action:'create-task', title:'Not allowed' } }));
  assert.equal(response.status, 403);
  assert.match((await payload(response)).error, /task write permission/i);
  assert.equal(db.calls.length, 0);
});

test('task relations reject a project from another tenant', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_memberships/.test(call.sql)) return { id:'user_a', full_name:'Owner A' };
    if (method === 'first' && /FROM projects/.test(call.sql)) return null;
    if (method === 'run') throw new Error('Invalid cross-tenant relation must not be written');
    return null;
  });
  const response = await onRequestPost(context({ db, body:{ action:'create-task', title:'Cross tenant task', ownerUserId:'user_a', projectId:'project_b' } }));
  assert.equal(response.status, 422);
  assert.match((await payload(response)).error, /does not belong to this workspace/i);
  const projectLookup = db.calls.find((call) => /FROM projects/.test(call.sql));
  assert.deepEqual(projectLookup.bindings, ['tenant_a','project_b']);
  assert.equal(db.calls.some((call) => /INSERT INTO tasks/.test(call.sql)), false);
});

test('task update lookup is scoped to the authenticated tenant', async () => {
  const db = new FakeDB((method, call) => method === 'first' && /SELECT \* FROM tasks/.test(call.sql) ? null : []);
  const response = await onRequestPost(context({ db, body:{ action:'update-task', taskId:'task_tenant_b', status:'DONE' } }));
  assert.equal(response.status, 404);
  assert.match((await payload(response)).error, /not found in this workspace/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a','task_tenant_b']);
  assert.match(db.calls[0].sql, /tenant_id = \? AND id = \?/);
});

test('partnership activation is blocked before the opportunity is won', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM opportunities o/.test(call.sql)) return { id:'opp_a', project_id:'project_a', name:'Partnership', stage:'NEGOTIATION', owner_user_id:'user_a', project_name:'Project A' };
    if (method === 'run') throw new Error('Premature activation must not create tasks');
    return null;
  });
  const response = await onRequestPost(context({ db, body:{ action:'start-partnership-activation', opportunityId:'opp_a' } }));
  assert.equal(response.status, 409);
  assert.match((await payload(response)).error, /only after the opportunity is won/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a','opp_a']);
  assert.equal(db.calls.some((call) => /INSERT INTO tasks/.test(call.sql)), false);
});

test('duplicate partnership activation plans are rejected inside the same tenant', async () => {
  const db = new FakeDB((method, call) => {
    if (method !== 'first') return [];
    if (/FROM opportunities o/.test(call.sql)) return { id:'opp_a', project_id:'project_a', name:'Partnership', stage:'WON', owner_user_id:'user_a', project_name:'Project A' };
    if (/FROM campaigns/.test(call.sql)) return { id:'campaign_a', name:'Partnership delivery', campaign_owner_id:'user_a' };
    if (/FROM tasks/.test(call.sql)) return { id:'existing_task' };
    return null;
  });
  const response = await onRequestPost(context({ db, body:{ action:'start-partnership-activation', opportunityId:'opp_a' } }));
  assert.equal(response.status, 409);
  assert.match((await payload(response)).error, /already exists/i);
  const duplicateLookup = db.calls.find((call) => /FROM tasks/.test(call.sql));
  assert.deepEqual(duplicateLookup.bindings, ['tenant_a','PARTNERSHIP_ACTIVATION:opp_a:%']);
  assert.equal(db.calls.some((call) => /INSERT INTO tasks/.test(call.sql)), false);
});

test('fundraising work plan project lookup remains tenant scoped', async () => {
  const flags = { fundraisingCapitalRooms:[{ id:'room_a', projectId:'project_b', projectName:'Project B', roundName:'Seed', stage:'OPEN' }] };
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    if (method === 'first' && /FROM projects/.test(call.sql)) return null;
    if (method === 'run') throw new Error('Missing tenant project must not create fundraising tasks');
    return null;
  });
  const response = await onRequestPost(context({ db, body:{ action:'start-fundraising-workplan', roomId:'room_a' } }));
  assert.equal(response.status, 404);
  assert.match((await payload(response)).error, /project was not found/i);
  const lookup = db.calls.find((call) => /FROM projects/.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a','project_b']);
  assert.equal(db.calls.some((call) => /INSERT INTO tasks/.test(call.sql)), false);
});
