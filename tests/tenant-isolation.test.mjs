import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPatch as patchContact } from '../functions/api/contacts/[id].js';
import { onRequestGet as getTimeline } from '../functions/api/projects/[id]/timeline.js';

class FakeDB {
  constructor(resolver) {
    this.resolver = resolver;
    this.calls = [];
  }
  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql: String(sql), bindings };
        this.calls.push(call);
        return {
          first: async () => this.resolver('first', call, this.calls.length - 1),
          all: async () => ({ results: await this.resolver('all', call, this.calls.length - 1) || [] }),
          run: async () => this.resolver('run', call, this.calls.length - 1) || { success: true },
        };
      },
    };
  }
}

function context({ db, tenantId = 'tenant_a', id = 'record_1', body = {} }) {
  return {
    env: { DB: db, AUTH_MODE: 'access' },
    data: { auth: { userId: 'user_a', tenantId, tenantSlug: 'tenant-a', role: 'OWNER', financeAccess: true } },
    params: { id },
    request: new Request('https://crm.example.test/api/test', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'user-agent': 'tenant-test' },
      body: JSON.stringify(body),
    }),
  };
}

async function payload(response) {
  return response.json();
}

test('contact editing never looks up a contact without tenant scope', async () => {
  const db = new FakeDB(() => null);
  const response = await patchContact(context({ db, id: 'contact_from_other_tenant', body: { fullName: 'Blocked' } }));
  assert.equal(response.status, 404);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'contact_from_other_tenant']);
  assert.match(db.calls[0].sql, /WHERE tenant_id = \? AND id = \?/);
});

test('contact editing rejects a project reference outside the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return {
      id: 'contact_1', tenant_id: 'tenant_a', project_id: 'project_a', full_name: 'Alice',
      telegram: '@alice', x_handle: 'https://x.com/alice', is_primary_contact: 1, is_decision_maker: 1,
    };
    if (index === 1) return null;
    return null;
  });
  const response = await patchContact(context({ db, id: 'contact_1', body: { projectId: 'project_b' } }));
  assert.equal(response.status, 422);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'project_b']);
  assert.match((await payload(response)).error, /does not belong to this workspace/i);
});

test('project timeline rejects a project from another tenant before reading related data', async () => {
  const db = new FakeDB(() => null);
  const ctx = context({ db, id: 'project_b' });
  ctx.request = new Request('https://crm.example.test/api/projects/project_b/timeline', { method: 'GET' });
  const response = await getTimeline(ctx);
  assert.equal(response.status, 404);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'project_b']);
});

test('project timeline scopes activities and audits to the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return { id: 'project_a', name: 'Project A' };
    if (method === 'all') return [];
    return null;
  });
  const ctx = context({ db, id: 'project_a' });
  ctx.request = new Request('https://crm.example.test/api/projects/project_a/timeline', { method: 'GET' });
  const response = await getTimeline(ctx);
  assert.equal(response.status, 200);
  assert.ok(db.calls.slice(1).every((call) => call.bindings[0] === 'tenant_a'));
  assert.ok(db.calls.some((call) => /a\.tenant_id = \? AND a\.project_id = \?/.test(call.sql)));
  assert.ok(db.calls.some((call) => /al\.tenant_id = \?/.test(call.sql)));
});
