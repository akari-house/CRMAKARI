import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/fundraising/targeting.js';
import { onRequest as fundraisingBoundary } from '../functions/api/fundraising/_middleware.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql:String(sql), bindings };
        this.calls.push(call);
        return {
          first: async () => this.resolver('first',call,this.calls.length - 1),
          all: async () => ({ results:await this.resolver('all',call,this.calls.length - 1) || [] }),
          run: async () => this.resolver('run',call,this.calls.length - 1) || { success:true },
        };
      },
    };
  }
}

function context({ db, body, role = 'OWNER', tenantId = 'tenant_a', method }) {
  const resolvedMethod = method || (body === undefined ? 'GET' : 'POST');
  return {
    env:{ DB:db },
    data:{ auth:{ userId:'user_a', tenantId, tenantSlug:'tenant-a', role, financeAccess:true } },
    request:new Request('https://crm.test/api/fundraising/targeting', {
      method:resolvedMethod,
      ...(body === undefined ? {} : { headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) }),
    }),
  };
}

async function post(options) {
  const inner = context(options);
  return fundraisingBoundary({ ...inner, next:() => onRequestPost(inner) });
}

async function get(options) {
  const inner = context(options);
  return fundraisingBoundary({ ...inner, next:() => onRequestGet(inner) });
}

function schemaReady(method,call) {
  if (method !== 'first') return false;
  return /SELECT id FROM fundraising_targets LIMIT 1|SELECT id FROM fundraising_introduction_paths LIMIT 1/.test(call.sql);
}

const target = {
  id:'target_a', tenant_id:'tenant_a', round_id:'round_a', organisation_id:'org_a', primary_person_id:null, stage:'READY', priority:85,
  expected_check:250000, probability_percentage:40, next_follow_up_at:'2026-08-04T10:00:00.000Z', next_action:'Request introduction', notes:'',
  project_id:'project_a', round_name:'Seed', currency:'USD', minimum_ticket:100000, maximum_ticket:500000,
  organisation_name:'North Star Ventures', minimum_check:100000, maximum_check:1000000, typical_check:350000, conflict_status:'NONE',
};

const path = {
  id:'intro_a', tenant_id:'tenant_a', round_id:'round_a', target_id:'target_a', target_person_id:'person_a', connector_contact_id:'contact_a', connector_name:'Connector A',
  relationship_owner_user_id:'user_a', relationship_strength:'STRONG', evidence_source_id:'source_a', verification_status:'VERIFIED', consent_status:'GRANTED', request_status:'PLANNED', notes:'Verified relationship',
};

test('normalized targeting reads rounds targets paths and execution references only inside the authenticated tenant', async () => {
  const db = new FakeDB((method,call) => {
    if (method !== 'all') return null;
    if (/FROM fundraising_rounds r/.test(call.sql)) return [{ id:'round_a',tenant_id:'tenant_a',project_id:'project_a',project_name:'Founder A',round_name:'Seed',stage:'OUTREACH',currency:'USD',target_amount:2000000 }];
    if (/FROM fundraising_targets t/.test(call.sql)) return [{ ...target,fit_score:82,fit_components_json:'{}',fit_reasons_json:'["Seed fit"]',fit_warnings_json:'[]',evidence_count:2,evidence_verified:1,open_task_count:0,investor_type:'VC',primary_person_name:'Alex Partner' }];
    if (/FROM fundraising_introduction_paths ip/.test(call.sql)) return [{ ...path,connector_contact_name:'Connector A',connector_project_name:'Network Co',relationship_owner_name:'Muaz',target_person_name:'Alex Partner',evidence_source_title:'Network page' }];
    if (/FROM investor_people p/.test(call.sql)) return [{ id:'person_a',organisation_id:'org_a',full_name:'Alex Partner',is_decision_maker:1 }];
    if (/FROM contacts c/.test(call.sql)) return [{ id:'contact_a',full_name:'Connector A',project_id:'network_a',project_name:'Network Co',relationship_strength:'STRONG' }];
    if (/FROM tenant_memberships tm/.test(call.sql)) return [{ id:'user_a',full_name:'Muaz',role:'OWNER' }];
    if (/FROM investor_sources/.test(call.sql)) return [{ id:'source_a',title:'Network page',confidence_status:'VERIFIED' }];
    return [];
  });
  const response = await get({ db });
  assert.equal(response.status,200);
  const payload = await response.json();
  assert.equal(payload.storageMode,'NORMALIZED_D1');
  assert.equal(payload.rounds[0].targets[0].introduction_paths[0].consent_status,'GRANTED');
  assert.equal(payload.summary.verifiedPaths,1);
  assert.equal(payload.focusedLists.readyForIntroduction.length,1);
  const reads = db.calls.filter((call) => /FROM (fundraising_|investor_|contacts|tenant_memberships)/.test(call.sql));
  assert.ok(reads.length >= 7);
  reads.forEach((call) => assert.deepEqual(call.bindings,['tenant_a']));
});

test('legacy targeting stays read only and normalizes old investor pipeline stages at the response boundary', async () => {
  const flags = { fundraisingCapitalRooms:[{ id:'raise_a',projectId:'project_a',projectName:'Founder A',roundName:'Seed',currency:'USD',investorPipeline:[{ id:'target_a',investorProjectId:'org_a',investorName:'Fund A',stage:'SOFT_COMMITMENT',fitScore:75,estimatedTicket:200000,warmIntroSource:'Connector A' }] }] };
  const db = new FakeDB((method,call) => {
    if (method === 'all' && /FROM fundraising_rounds r/.test(call.sql)) throw new Error('D1_ERROR: no such table: fundraising_rounds: SQLITE_ERROR');
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    return null;
  });
  const response = await get({ db });
  assert.equal(response.status,200);
  const payload = await response.json();
  assert.equal(payload.storageMode,'LEGACY_COMPATIBILITY');
  assert.equal(payload.readOnly,true);
  assert.equal(payload.rounds[0].targets[0].stage,'SOFT_CIRCLE');
  assert.equal(payload.permissions.canWrite,false);
  const settings = db.calls.find((call) => /tenant_settings/.test(call.sql));
  assert.deepEqual(settings.bindings,['tenant_a']);
});

test('targeting writes reject non-manager roles before database access', async () => {
  const db = new FakeDB(() => { throw new Error('database must not be queried'); });
  const response = await post({ db,role:'BD_MEMBER',body:{ action:'update-target',id:'target_a' } });
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test('targeting writes fail closed until migration 0002 is applied', async () => {
  const db = new FakeDB(() => { throw new Error('D1_ERROR: no such table: fundraising_targets: SQLITE_ERROR'); });
  const response = await post({ db,body:{ action:'update-target',id:'target_a' } });
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/migration 0002/i);
  assert.equal(db.calls.some((call) => /UPDATE fundraising_targets/.test(call.sql)),false);
});

test('target primary person must belong to the same investor organisation and tenant', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM fundraising_targets t/.test(call.sql)) return target;
    if (method === 'first' && /FROM investor_people WHERE tenant_id/.test(call.sql)) return { id:'person_b',organisation_id:'org_b' };
    return null;
  });
  const response = await post({ db,body:{ action:'update-target',id:'target_a',primaryPersonId:'person_b' } });
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/belong to this target organisation/i);
  const lookup = db.calls.find((call) => /FROM investor_people WHERE tenant_id/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','person_b']);
  assert.equal(db.calls.some((call) => /UPDATE fundraising_targets\s+SET/.test(call.sql)),false);
});

test('Intro requested stage requires a verified path with granted consent', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM fundraising_targets t/.test(call.sql)) return { ...target,stage:'READY' };
    if (method === 'first' && /verification_status='VERIFIED'/.test(call.sql)) return null;
    return null;
  });
  const response = await post({ db,body:{ action:'move-target',id:'target_a',stage:'INTRO_REQUESTED' } });
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/verified introduction path with granted consent/i);
  assert.equal(db.calls.some((call) => /UPDATE fundraising_targets SET stage/.test(call.sql)),false);
});

test('introduction connectors and relationship owners are resolved inside the authenticated tenant', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM fundraising_targets t/.test(call.sql)) return target;
    if (method === 'first' && /fundraising_introduction_paths WHERE tenant_id/.test(call.sql)) return null;
    if (method === 'first' && /FROM contacts c/.test(call.sql)) return null;
    return null;
  });
  const response = await post({ db,body:{ action:'upsert-introduction',targetId:'target_a',connectorContactId:'contact_tenant_b',relationshipOwnerUserId:'user_a' } });
  assert.equal(response.status,404);
  assert.match((await response.json()).error,/connector contact was not found/i);
  const lookup = db.calls.find((call) => /FROM contacts c/.test(call.sql));
  assert.deepEqual(lookup.bindings,['tenant_a','contact_tenant_b']);
  assert.equal(db.calls.some((call) => /INSERT INTO fundraising_introduction_paths/.test(call.sql)),false);
});

test('verified introduction paths require evidence or an explicit verification note', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM fundraising_targets t/.test(call.sql)) return target;
    if (method === 'first' && /fundraising_introduction_paths WHERE tenant_id/.test(call.sql)) return null;
    if (method === 'first' && /FROM users u/.test(call.sql)) return { id:'user_a',full_name:'Muaz' };
    return null;
  });
  const response = await post({ db,body:{ action:'upsert-introduction',targetId:'target_a',connectorName:'Connector A',relationshipOwnerUserId:'user_a',verificationStatus:'VERIFIED',notes:'' } });
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/require evidence or a verification note/i);
  assert.equal(db.calls.some((call) => /INSERT INTO fundraising_introduction_paths/.test(call.sql)),false);
});

test('final consent decisions require Owner/Admin authority and a written note', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /fundraising_introduction_paths WHERE tenant_id/.test(call.sql)) return path;
    return null;
  });
  const manager = await post({ db,role:'BD_MANAGER',body:{ action:'set-consent',id:'intro_a',consentStatus:'GRANTED',note:'Founder approved' } });
  assert.equal(manager.status,403);
  assert.equal(db.calls.some((call) => /UPDATE fundraising_introduction_paths SET consent_status/.test(call.sql)),false);

  const ownerWithoutNote = await post({ db,role:'OWNER',body:{ action:'set-consent',id:'intro_a',consentStatus:'REVOKED',note:'' } });
  assert.equal(ownerWithoutNote.status,422);
  assert.match((await ownerWithoutNote.json()).error,/decision note/i);
});

test('introduction request status cannot bypass verification and consent', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /fundraising_introduction_paths WHERE tenant_id/.test(call.sql)) return { ...path,verification_status:'UNVERIFIED',consent_status:'REQUESTED' };
    return null;
  });
  const response = await post({ db,body:{ action:'set-request-status',id:'intro_a',requestStatus:'REQUESTED' } });
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/Verification and granted consent/i);
  assert.equal(db.calls.some((call) => /UPDATE fundraising_introduction_paths\s+SET request_status/.test(call.sql)),false);
});

test('follow-up tasks validate tenant owner and prevent duplicate open work by default', async () => {
  const db = new FakeDB((method,call) => {
    if (schemaReady(method,call)) return { id:'schema_probe' };
    if (method === 'first' && /FROM fundraising_targets t/.test(call.sql)) return target;
    if (method === 'first' && /FROM users u/.test(call.sql)) return { id:'user_a',full_name:'Muaz' };
    if (method === 'first' && /SELECT id FROM tasks/.test(call.sql)) return { id:'task_existing' };
    return null;
  });
  const response = await post({ db,body:{ action:'create-follow-up-task',targetId:'target_a',ownerUserId:'user_a',dueAt:'2026-08-05T10:00:00.000Z' } });
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/open follow-up task already exists/i);
  const taskLookup = db.calls.find((call) => /SELECT id FROM tasks/.test(call.sql));
  assert.deepEqual(taskLookup.bindings,['tenant_a','%[Fundraising Target:target_a]%']);
  assert.equal(db.calls.some((call) => /INSERT INTO tasks/.test(call.sql)),false);
});
