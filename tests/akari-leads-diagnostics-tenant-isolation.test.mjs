import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/imports/akari-leads/existing.js';

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

function context(db, role = 'OWNER') {
  return {
    env:{ DB:db },
    data:{ auth:{
      userId:'user_a', email:'owner@example.test', tenantId:'tenant_a', tenantSlug:'tenant-a', role, financeAccess:true,
    } },
    request:new Request('https://crm.test/api/imports/akari-leads/existing'),
  };
}

test('lead diagnostics report tenant-scoped source and import health without changing records', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'all' && /SELECT id, name, website/.test(call.sql)) {
      return [{ id:'lead_a', name:'Lead A', website:null, x_url:null, telegram:null, original_import_source:'AKARI_LEADS' }];
    }
    if (method === 'first' && /COUNT\(\*\) AS total/.test(call.sql)) return { total:895 };
    if (method === 'all' && /TRIM\(source_type\)/.test(call.sql)) {
      return [{ source_type:'AKARI_LEADS', record_count:895 }, { source_type:'CRM', record_count:12 }];
    }
    if (method === 'first' && /AS visible_leads/.test(call.sql)) {
      return { projects:907, contacts:217, tasks:3, visible_leads:895 };
    }
    if (method === 'first' && /FROM tenant_memberships/.test(call.sql)) {
      return {
        tenant_id:'tenant_a', slug:'tenant-a', name:'Tenant A', tenant_status:'ACTIVE',
        email:'owner@example.test', user_status:'ACTIVE', role:'OWNER', membership_status:'ACTIVE', finance_access:1,
      };
    }
    if (method === 'all' && /FROM audit_logs/.test(call.sql)) {
      return [{ action:'AKARI_LEADS_IMPORT_COMPLETE', entity_id:'batch_a', after_data:'{"total":895}', created_at:'2026-08-01T00:00:00.000Z' }];
    }
    return null;
  });

  const response = await onRequestGet(context(db));
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.total, 895);
  assert.equal(payload.lastImport.action, 'AKARI_LEADS_IMPORT_COMPLETE');
  assert.equal(payload.diagnostics.status, 'LEADS_PRESENT_FOR_AUTHENTICATED_TENANT');
  assert.deepEqual(payload.diagnostics.counts, {
    projects:907,
    contacts:217,
    tasks:3,
    akariLeads:895,
    privateTenantImports:0,
    visibleLeads:895,
    otherProjects:12,
  });
  assert.deepEqual(payload.diagnostics.sourceTypes, [
    { sourceType:'AKARI_LEADS', count:895 },
    { sourceType:'CRM', count:12 },
  ]);

  for (const call of db.calls) {
    assert.equal(call.bindings[0], 'tenant_a');
  }
  const membershipLookup = db.calls.find((call) => /FROM tenant_memberships/.test(call.sql));
  assert.deepEqual(membershipLookup.bindings, ['tenant_a', 'user_a']);
  assert.equal(db.calls.some((call) => /INSERT|UPDATE|DELETE/i.test(call.sql)), false);
});

test('lead diagnostics remain owner or admin only', async () => {
  const db = new FakeDB(() => null);
  const response = await onRequestGet(context(db, 'BD_MANAGER'));
  assert.equal(response.status, 403);
  assert.equal(db.calls.length, 0);
});
