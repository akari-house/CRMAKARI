import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/bd-operations/index.js';

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
        const index = this.calls.length - 1;
        return {
          first: async () => this.resolver('first', call, index),
          all: async () => ({ results: await this.resolver('all', call, index) || [] }),
          run: async () => this.resolver('run', call, index) || { success: true },
        };
      },
    };
  }
}

function context({ db, body, role = 'OWNER', tenantId = 'tenant_a' }) {
  return {
    env: { DB: db, AUTH_MODE: 'access' },
    data: { auth: { userId: 'user_a', tenantId, tenantSlug: 'tenant-a', role, financeAccess: true } },
    params: {},
    request: new Request('https://crm.example.test/api/bd-operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'bd-operations-test' },
      body: JSON.stringify(body),
    }),
  };
}

async function responseBody(response) {
  return response.json();
}

test('bulk editing rejects any selected lead outside the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'all' && index === 0) return [{ id: 'project_a' }];
    if (method === 'run') throw new Error('Cross-tenant selection must not be updated');
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body: { action: 'bulk-update', projectIds: ['project_a', 'project_from_tenant_b'], priority: 'HIGH' },
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /do not belong to this workspace/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'project_a', 'project_from_tenant_b']);
  assert.match(db.calls[0].sql, /p\.tenant_id = \?/);
});

test('bulk assignment validates the owner inside the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'all' && index === 0) return [{ id: 'project_a' }];
    if (method === 'first' && index === 1) return null;
    if (method === 'run') throw new Error('Invalid owner must not reach an update');
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body: { action: 'bulk-update', projectIds: ['project_a'], ownerUserId: 'user_from_tenant_b' },
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /not an active member of this workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'user_from_tenant_b']);
  assert.match(db.calls[1].sql, /tm\.tenant_id = \?/);
});

test('team controls never resolve a membership without tenant scope', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return null;
    if (method === 'run') throw new Error('Unknown cross-tenant member must not be updated');
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body: { action: 'update-member', userId: 'user_from_tenant_b', role: 'BD_MEMBER' },
  }));
  assert.equal(response.status, 404);
  assert.match((await responseBody(response)).error, /not found in this workspace/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'user_from_tenant_b']);
  assert.match(db.calls[0].sql, /tm\.tenant_id = \? AND tm\.user_id = \?/);
});

test('team controls preserve at least one active workspace owner', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return {
      user_id: 'user_a', role: 'OWNER', finance_access: 1, status: 'ACTIVE', full_name: 'Owner A', email: 'owner@example.com',
    };
    if (method === 'first' && index === 1) return { count: 1 };
    if (method === 'run') throw new Error('Last owner must not be demoted');
    return null;
  });
  const response = await onRequestPost(context({
    db,
    body: { action: 'update-member', userId: 'user_a', role: 'BD_MANAGER', status: 'ACTIVE' },
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /retain at least one active Owner/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a']);
  assert.match(db.calls[1].sql, /role = 'OWNER' AND status = 'ACTIVE'/);
});
