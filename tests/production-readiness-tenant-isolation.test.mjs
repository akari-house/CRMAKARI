import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as getReadiness, onRequestPost as updateReadiness } from '../functions/api/production-readiness/index.js';
import { onRequestGet as exportTenant } from '../functions/api/tenant-export/index.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql:String(sql), bindings };
        this.calls.push(call);
        const index = this.calls.length - 1;
        return {
          first: async () => this.resolver('first', call, index),
          all: async () => ({ results:await this.resolver('all', call, index) || [] }),
          run: async () => this.resolver('run', call, index) || { success:true },
        };
      },
    };
  }
}

function context(db, role = 'OWNER', request = new Request('https://crm.test/api/production-readiness')) {
  return {
    env:{ DB:db },
    data:{ auth:{ userId:'user_a', email:'owner@example.test', tenantId:'tenant_a', tenantSlug:'tenant-a', role, financeAccess:true } },
    request,
  };
}

test('production readiness reads only the authenticated tenant and calculates launch signals', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM tenants/.test(call.sql)) {
      return { id:'tenant_a', name:'Tenant A', slug:'tenant-a', status:'ACTIVE', base_currency:'USD', timezone:'Europe/Berlin', plan_code:'FOUNDING', user_limit:3, storage_limit_mb:500 };
    }
    if (method === 'first' && /AS projects/.test(call.sql)) {
      return {
        projects:895, leads:895, leads_with_owner:800, leads_with_follow_up:500, contacts:217,
        open_tasks:10, overdue_tasks:2, open_opportunities:4, won_opportunities:1, active_campaigns:1,
        payment_records:1, active_members:3, active_owners:1,
      };
    }
    if (method === 'all' && /GROUP BY role/.test(call.sql)) return [{ role:'OWNER', member_count:1 }, { role:'BD_MEMBER', member_count:2 }];
    if (method === 'first' && /feature_flags_json/.test(call.sql)) {
      return { feature_flags_json:JSON.stringify({ productionReadinessV1:{ signoff:{ mobile:{ completed:true, note:'Checked', checkedAt:'2026-08-03T00:00:00.000Z', checkedBy:'owner@example.test' } } } }) };
    }
    if (method === 'first' && /TENANT_BACKUP_EXPORTED/.test(call.sql)) return { created_at:'2026-08-02T00:00:00.000Z', user_id:'user_a' };
    if (method === 'first' && /ORDER BY created_at DESC/.test(call.sql)) return { action:'LEAD_UPDATED', entity_type:'PROJECT', entity_id:'project_a', created_at:'2026-08-03T00:00:00.000Z' };
    return null;
  });

  const response = await getReadiness(context(db));
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.tenant.id, 'tenant_a');
  assert.equal(payload.counts.projects, 895);
  assert.equal(payload.counts.activeOwners, 1);
  assert.equal(payload.canManage, true);
  assert.equal(payload.manualChecks.find((item) => item.key === 'mobile').completed, true);
  assert.equal(payload.automaticChecks.find((item) => item.key === 'owner').status, 'PASS');
  assert.ok(payload.readinessScore > 0);

  for (const call of db.calls) assert.equal(call.bindings[0], 'tenant_a');
  assert.equal(db.calls.some((call) => /INSERT|UPDATE|DELETE/i.test(call.sql)), false);
});

test('production sign-off is owner/admin controlled, tenant scoped and audited', async () => {
  const viewerDb = new FakeDB(() => null);
  const viewerRequest = new Request('https://crm.test/api/production-readiness', {
    method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ key:'mobile', completed:true }),
  });
  const denied = await updateReadiness(context(viewerDb, 'BD_MEMBER', viewerRequest));
  assert.equal(denied.status, 403);
  assert.equal(viewerDb.calls.length, 0);

  const db = new FakeDB((method, call) => {
    if (method === 'first' && /feature_flags_json/.test(call.sql)) return { feature_flags_json:'{}' };
    return null;
  });
  const request = new Request('https://crm.test/api/production-readiness', {
    method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ key:'leadToCash', completed:true, note:'Completed with a controlled production record' }),
  });
  const response = await updateReadiness(context(db, 'OWNER', request));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.key, 'leadToCash');
  assert.equal(payload.completed, true);

  const update = db.calls.find((call) => /UPDATE tenant_settings/.test(call.sql));
  assert.ok(update);
  assert.equal(update.bindings.at(-1), 'tenant_a');
  const audit = db.calls.find((call) => /PRODUCTION_SIGNOFF_UPDATED/.test(call.sql));
  assert.ok(audit);
  assert.equal(audit.bindings[1], 'tenant_a');
});

test('tenant backup exports only tenant-scoped data and records the export event', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM tenants/.test(call.sql)) return { id:'tenant_a', name:'Tenant A', slug:'tenant-a', status:'ACTIVE' };
    if (method === 'all' && /FROM projects/.test(call.sql)) return [{ id:'project_a', tenant_id:'tenant_a', name:'Project A' }];
    if (method === 'all' && /FROM contacts/.test(call.sql)) return [{ id:'contact_a', tenant_id:'tenant_a', project_id:'project_a', full_name:'Contact A' }];
    if (method === 'all') return [];
    return null;
  });
  const request = new Request('https://crm.test/api/tenant-export');
  const response = await exportTenant(context(db, 'OWNER', request));

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /akari-tenant-a-backup/);
  const payload = await response.json();
  assert.equal(payload.format, 'AKARI_TENANT_BACKUP_V1');
  assert.equal(payload.tenant.id, 'tenant_a');
  assert.equal(payload.datasets.projects.length, 1);
  assert.equal(payload.datasets.contacts.length, 1);
  assert.equal(payload.counts.projects, 1);

  for (const call of db.calls.filter((item) => /SELECT/.test(item.sql))) assert.equal(call.bindings[0], 'tenant_a');
  const audit = db.calls.find((call) => /TENANT_BACKUP_EXPORTED/.test(call.sql));
  assert.ok(audit);
  assert.equal(audit.bindings[1], 'tenant_a');
});

test('tenant backup rejects non-admin roles before reading data', async () => {
  const db = new FakeDB(() => null);
  const response = await exportTenant(context(db, 'FINANCE', new Request('https://crm.test/api/tenant-export')));
  assert.equal(response.status, 403);
  assert.equal(db.calls.length, 0);
});
