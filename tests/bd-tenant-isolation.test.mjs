import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPatch as patchLead } from '../functions/api/akari-leads/[id].js';
import { onRequestPost as createLead } from '../functions/api/akari-leads/index.js';
import { onRequestPost as createActivity } from '../functions/api/activities/index.js';

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
  async batch() {
    throw new Error('A rejected cross-tenant request must not reach DB.batch');
  }
}

function context({ db, method = 'PATCH', id = 'project_a', body = {}, tenantId = 'tenant_a' }) {
  return {
    env: { DB: db, AUTH_MODE: 'access' },
    data: { auth: { userId: 'user_a', tenantId, tenantSlug: 'tenant-a', role: 'OWNER', financeAccess: true } },
    params: { id },
    request: new Request(`https://crm.example.test/api/akari-leads/${id}`, {
      method,
      headers: { 'content-type': 'application/json', 'user-agent': 'bd-tenant-test' },
      body: JSON.stringify(body),
    }),
  };
}

async function responseBody(response) {
  return response.json();
}

test('lead editing rejects an owner who is not an active member of the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return {
      id: 'project_a', tenant_id: 'tenant_a', name: 'Project A', lifecycle_status: 'LEAD',
      x_url: 'https://x.com/projecta', telegram: '@projecta', priority: 'HIGH',
      owner_user_id: 'user_a', legacy_import_data: null,
    };
    if (index === 1) return null;
    return null;
  });
  const response = await patchLead(context({
    db,
    body: { ownerUserId: 'user_from_tenant_b' },
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /not an active member of this workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'user_from_tenant_b']);
  assert.match(db.calls[1].sql, /tm\.tenant_id = \?/);
});

test('lead creation rejects a referral partner outside the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return { id: 'user_a' };
    if (index === 1) return null;
    return null;
  });
  const response = await createLead(context({
    db,
    method: 'POST',
    id: '',
    body: {
      name: 'Project A',
      xUrl: '@projecta',
      telegram: '@projecta',
      assignToMe: true,
      referralPartnerId: 'partner_from_tenant_b',
    },
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /does not belong to this workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'partner_from_tenant_b', 'ARCHIVED']);
  assert.match(db.calls[1].sql, /tenant_id = \? AND id = \?/);
});

test('meeting booking rejects a contact outside the selected project and tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return {
      id: 'project_a', tenant_id: 'tenant_a', name: 'Project A', legacy_import_data: null,
    };
    if (index === 1) return null;
    return null;
  });
  const ctx = context({
    db,
    method: 'POST',
    id: '',
    body: {
      projectId: 'project_a',
      contactId: 'contact_from_tenant_b',
      activityType: 'MEETING',
      outcome: 'BOOKED',
      subject: 'Discovery call',
      meetingScheduledAt: '2030-02-15T14:30:00Z',
    },
  });
  ctx.params = {};
  ctx.request = new Request('https://crm.example.test/api/activities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: 'project_a', contactId: 'contact_from_tenant_b', activityType: 'MEETING',
      outcome: 'BOOKED', subject: 'Discovery call', meetingScheduledAt: '2030-02-15T14:30:00Z',
    }),
  });
  const response = await createActivity(ctx);
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /does not belong to this project and workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'contact_from_tenant_b', 'project_a']);
  assert.match(db.calls[1].sql, /tenant_id = \? AND id = \? AND project_id = \?/);
});
