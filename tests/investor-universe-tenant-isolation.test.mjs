import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/fundraising/universe.js';
import { onRequest as universeBoundary } from '../functions/api/fundraising/_middleware.js';

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
    request:new Request('https://crm.test/api/fundraising/universe', body === undefined ? {} : {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body),
    }),
  };
}

async function post(options) {
  const inner = context(options);
  return universeBoundary({ ...inner, next:() => onRequestPost(inner) });
}

function schemaReady(method, call) {
  return method === 'first' && /SELECT id FROM investor_organisations LIMIT 1/.test(call.sql);
}

test('normalized Investor Universe reads every collection inside the authenticated tenant', async () => {
  const organisation = {
    id:'org_a', tenant_id:'tenant_a', name:'North Star Ventures', investor_type:'VC', website:'https://northstar.example',
    conflict_status:'POSSIBLE', people_count:1, claim_count:2, verified_claim_count:1, portfolio_count:1, target_count:1, best_fit_score:82,
  };
  const db = new FakeDB((method, call) => {
    if (method !== 'all') return null;
    if (/FROM investor_organisations o/.test(call.sql)) return [organisation];
    if (/FROM investor_people p/.test(call.sql)) return [{ id:'person_a', organisation_id:'org_a', full_name:'Alex Partner', is_decision_maker:1 }];
    if (/FROM investor_contact_methods cm/.test(call.sql)) return [{ id:'contact_a', person_id:'person_a', kind:'WORK_EMAIL', value:'alex@northstar.example', visibility:'PRIVATE' }];
    if (/FROM investor_sources/.test(call.sql)) return [{ id:'source_a', title:'Fund page', confidence_status:'VERIFIED', redistribution_status:'UNKNOWN', observed_at:'2026-08-01' }];
    if (/FROM investor_claims c/.test(call.sql)) return [{ id:'claim_a', entity_type:'ORGANISATION', entity_id:'org_a', field:'investment_stages', value_json:'["Seed"]', status:'VERIFIED' }];
    if (/FROM investor_portfolio_evidence pe/.test(call.sql)) return [{ id:'portfolio_a', organisation_id:'org_a', company_name:'Portfolio Co' }];
    if (/FROM fundraising_targets t/.test(call.sql)) return [{ id:'target_a', organisation_id:'org_a', fit_score:82, fit_components_json:'{}', fit_reasons_json:'["Seed fit"]', fit_warnings_json:'[]' }];
    return [];
  });
  const response = await onRequestGet(context({ db }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.storageMode, 'NORMALIZED_D1');
  assert.equal(payload.summary.organisations, 1);
  assert.equal(payload.organisations[0].name, 'North Star Ventures');
  assert.equal(payload.people[0].contacts.length, 1);
  assert.equal(payload.claims[0].value[0], 'Seed');
  assert.ok(payload.reviewQueue.some((item) => item.kind === 'CONFLICT'));
  const businessReads = db.calls.filter((call) => /FROM (investor_|fundraising_)/.test(call.sql));
  assert.ok(businessReads.length >= 7);
  businessReads.forEach((call) => assert.deepEqual(call.bindings, ['tenant_a']));
});

test('missing migration returns a read-only tenant-scoped Capital Room compatibility view', async () => {
  const flags = {
    fundraisingCapitalRooms:[{
      id:'raise_a', projectId:'founder_a', projectName:'Founder A', roundName:'Seed',
      investorPipeline:[{
        id:'target_a', investorProjectId:'fund_a', investorName:'North Star Ventures', decisionMaker:'Alex Partner',
        contactEmail:'alex@northstar.example', fitScore:76, stage:'MEETING', estimatedTicket:250000,
      }],
    }],
  };
  const db = new FakeDB((method, call) => {
    if (method === 'all' && /FROM investor_organisations o/.test(call.sql)) throw new Error('D1_ERROR: no such table: investor_organisations: SQLITE_ERROR');
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    return null;
  });
  const response = await onRequestGet(context({ db }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.storageMode, 'LEGACY_COMPATIBILITY');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.migrationRequired, true);
  assert.equal(payload.organisations[0].name, 'North Star Ventures');
  assert.equal(payload.people[0].contacts[0].value, 'alex@northstar.example');
  assert.equal(payload.permissions.canWrite, false);
  const settings = db.calls.find((call) => /tenant_settings/.test(call.sql));
  assert.deepEqual(settings.bindings, ['tenant_a']);
});

test('Investor Universe writes reject non-manager roles before database access', async () => {
  const db = new FakeDB(() => { throw new Error('database must not be queried'); });
  const response = await post({ db, role:'BD_MEMBER', body:{ action:'upsert-organisation', name:'Fund A' } });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /permission/i);
  assert.equal(db.calls.length, 0);
});

test('Investor Universe writes fail closed until migration 0002 is applied', async () => {
  const db = new FakeDB(() => { throw new Error('D1_ERROR: no such table: investor_organisations: SQLITE_ERROR'); });
  const response = await post({ db, body:{ action:'upsert-organisation', name:'Fund A' } });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /migration 0002/i);
  assert.equal(db.calls.some((call) => /INSERT INTO investor_organisations/.test(call.sql)), false);
});

test('investor organisation duplicate checks, writes and audits remain tenant scoped', async () => {
  const db = new FakeDB((method, call) => {
    if (schemaReady(method, call)) return { id:'schema_probe' };
    if (method === 'first' && /WHERE tenant_id = \? AND id = \?/.test(call.sql)) return null;
    if (method === 'first' && /normalized_name = \? AND id != \?/.test(call.sql)) return null;
    return null;
  });
  const response = await post({ db, body:{
    action:'upsert-organisation', name:'North Star Ventures', investorType:'VC', website:'https://northstar.example', minimumCheck:100000, maximumCheck:1000000,
  } });
  assert.equal(response.status, 200);
  const duplicate = db.calls.find((call) => /normalized_name = \? AND id != \?/.test(call.sql));
  assert.equal(duplicate.bindings[0], 'tenant_a');
  const insert = db.calls.find((call) => /INSERT INTO investor_organisations/.test(call.sql));
  assert.equal(insert.bindings[1], 'tenant_a');
  const audit = db.calls.find((call) => /INSERT INTO audit_logs/.test(call.sql));
  assert.equal(audit.bindings[1], 'tenant_a');
});

test('investor people and contacts reject references outside the authenticated tenant', async () => {
  const db = new FakeDB((method, call) => {
    if (schemaReady(method, call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM investor_people WHERE tenant_id = \? AND id = \?/.test(call.sql)) return null;
    return null;
  });
  const response = await post({ db, body:{ action:'upsert-contact', personId:'person_tenant_b', kind:'WORK_EMAIL', value:'person@example.test' } });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /not found in this workspace/i);
  const lookup = db.calls.find((call) => /FROM investor_people WHERE tenant_id = \? AND id = \?/.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a', 'person_tenant_b']);
  assert.equal(db.calls.some((call) => /INSERT INTO investor_contact_methods/.test(call.sql)), false);
});

test('source and claim references are validated inside the authenticated tenant', async () => {
  const db = new FakeDB((method, call) => {
    if (schemaReady(method, call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM investor_organisations WHERE tenant_id = \? AND id = \?/.test(call.sql)) return { id:'org_a', name:'Fund A' };
    if (method === 'first' && /FROM investor_sources WHERE tenant_id = \? AND id = \?/.test(call.sql)) return null;
    return null;
  });
  const response = await post({ db, body:{ action:'upsert-claim', entityType:'ORGANISATION', entityId:'org_a', field:'investment_stages', value:['Seed'], sourceId:'source_tenant_b' } });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /source was not found/i);
  const sourceLookup = db.calls.find((call) => /FROM investor_sources WHERE tenant_id = \? AND id = \?/.test(call.sql));
  assert.deepEqual(sourceLookup.bindings, ['tenant_a', 'source_tenant_b']);
  assert.equal(db.calls.some((call) => /INSERT INTO investor_claims/.test(call.sql)), false);
});

test('evidence and conflict review actions remain Owner/Admin controlled', async () => {
  const db = new FakeDB((method, call) => {
    if (schemaReady(method, call)) return { id:'schema_probe' };
    return null;
  });
  const response = await post({ db, role:'BD_MANAGER', body:{ action:'review-source', id:'source_a', confidenceStatus:'VERIFIED', redistributionStatus:'ALLOWED' } });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /permission/i);
  assert.equal(db.calls.some((call) => /UPDATE investor_sources/.test(call.sql)), false);
});

test('private contact values are redacted from the general audit record', async () => {
  const existing = {
    id:'contact_a', tenant_id:'tenant_a', person_id:'person_a', kind:'WORK_EMAIL', value:'old-private@example.test', normalized_value:'old-private@example.test',
    visibility:'PRIVATE', contribution_eligible:0, is_primary:1,
  };
  const db = new FakeDB((method, call) => {
    if (schemaReady(method, call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM investor_people WHERE tenant_id = \? AND id = \?/.test(call.sql)) return { id:'person_a' };
    if (method === 'first' && /FROM investor_contact_methods WHERE tenant_id = \? AND id = \?/.test(call.sql)) return existing;
    if (method === 'first' && /FROM investor_sources WHERE tenant_id/.test(call.sql)) return null;
    if (method === 'first' && /person_id = \? AND kind = \? AND normalized_value/.test(call.sql)) return null;
    return null;
  });
  const response = await post({ db, body:{ action:'upsert-contact', id:'contact_a', personId:'person_a', kind:'WORK_EMAIL', value:'new-private@example.test', visibility:'PRIVATE', isPrimary:true } });
  assert.equal(response.status, 200);
  const audit = db.calls.find((call) => /INSERT INTO audit_logs/.test(call.sql));
  assert.ok(audit);
  const serializedAudit = JSON.stringify(audit.bindings);
  assert.equal(serializedAudit.includes('old-private@example.test'), false);
  assert.equal(serializedAudit.includes('new-private@example.test'), false);
  assert.ok(serializedAudit.includes('[REDACTED]'));
});

test('final portfolio conflict decisions require a review note', async () => {
  const db = new FakeDB((method, call) => {
    if (schemaReady(method, call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM investor_organisations WHERE tenant_id = \? AND id = \?/.test(call.sql)) return { id:'org_a', conflict_status:'POSSIBLE' };
    return null;
  });
  const response = await post({ db, body:{ action:'set-conflict', id:'org_a', conflictStatus:'NONE', note:'' } });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /review note/i);
  assert.equal(db.calls.some((call) => /UPDATE investor_organisations SET conflict_status/.test(call.sql)), false);
});
