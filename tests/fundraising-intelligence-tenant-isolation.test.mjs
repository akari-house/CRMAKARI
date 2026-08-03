import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/fundraising/intelligence.js';
import { assessInvestorFit, calculateRoundEconomics } from '../functions/lib/fundraising-intelligence.js';

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

function getContext(db, role = 'OWNER', tenantId = 'tenant_a') {
  return {
    env:{ DB:db },
    data:{ auth:{ userId:'user_a', tenantId, tenantSlug:'tenant-a', role, financeAccess:true } },
    request:new Request('https://crm.test/api/fundraising/intelligence'),
  };
}

function postContext(db, body, role = 'OWNER', tenantId = 'tenant_a') {
  return {
    ...getContext(db, role, tenantId),
    request:new Request('https://crm.test/api/fundraising/intelligence', {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body),
    }),
  };
}

test('legacy compatibility reads only the authenticated tenant when migration 0002 is unavailable', async () => {
  const flags = {
    fundraisingCapitalRooms:[{
      id:'raise_a', projectId:'project_a', projectName:'Founder A', roundName:'Seed',
      targetAmount:2000000, stage:'OUTREACH',
      investorPipeline:[{ id:'target_a', investorProjectId:'fund_a', investorName:'Fund A', stage:'MEETING', estimatedTicket:250000, probability:50 }],
    }],
  };
  const db = new FakeDB((method, call) => {
    if (/fundraising_rounds|fundraising_targets|fundraising_commitments|investor_people|investor_claims|investor_sources/.test(call.sql)) {
      throw new Error('D1_ERROR: no such table: fundraising_rounds: SQLITE_ERROR');
    }
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    return null;
  });
  const response = await onRequestGet(getContext(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.storageMode, 'LEGACY_COMPATIBILITY');
  assert.equal(payload.migrationRequired, true);
  assert.equal(payload.rounds[0].economics.weightedPipeline, 125000);
  const settingsCall = db.calls.find((call) => /tenant_settings/.test(call.sql));
  assert.deepEqual(settingsCall.bindings, ['tenant_a']);
});

test('normalized fundraising writes reject non-manager roles before database access', async () => {
  const db = new FakeDB(() => { throw new Error('database must not be queried'); });
  const response = await onRequestPost(postContext(db, { action:'upsert-organisation', name:'Fund A' }, 'BD_MEMBER'));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /permission/i);
  assert.equal(db.calls.length, 0);
});

test('normalized writes fail closed until migration 0002 is applied', async () => {
  const db = new FakeDB(() => { throw new Error('D1_ERROR: no such table: fundraising_rounds: SQLITE_ERROR'); });
  const response = await onRequestPost(postContext(db, { action:'upsert-organisation', name:'Fund A' }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /migration 0002/i);
  assert.equal(db.calls.some((call) => /INSERT INTO investor_organisations/.test(call.sql)), false);
});

test('investor organisation creation keeps duplicate checks and writes inside the authenticated tenant', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /SELECT id FROM fundraising_rounds LIMIT 1/.test(call.sql)) return null;
    if (method === 'first' && /FROM investor_organisations WHERE tenant_id = \? AND id = \?/.test(call.sql)) return null;
    if (method === 'first' && /normalized_name = \? AND id != \?/.test(call.sql)) return null;
    return null;
  });
  const response = await onRequestPost(postContext(db, {
    action:'upsert-organisation', name:'North Star Ventures', investorType:'VC', minimumCheck:100000, maximumCheck:1000000,
  }));
  assert.equal(response.status, 200);
  const duplicate = db.calls.find((call) => /normalized_name = \? AND id != \?/.test(call.sql));
  assert.equal(duplicate.bindings[0], 'tenant_a');
  const insert = db.calls.find((call) => /INSERT INTO investor_organisations/.test(call.sql));
  assert.equal(insert.bindings[1], 'tenant_a');
  const audit = db.calls.find((call) => /INSERT INTO audit_logs/.test(call.sql));
  assert.equal(audit.bindings[1], 'tenant_a');
});

test('explainable fit scoring returns reasons, warnings and a conflict adjustment', () => {
  const assessment = assessInvestorFit({
    fundingStage:'Seed', minimumTicket:250000, sectors:['AI','Web3'], geographies:['Europe'],
  }, {
    investmentStages:['Seed'], minimumCheck:100000, maximumCheck:1000000,
    sectors:['AI infrastructure'], geographies:['Europe'], fundVintageYear:new Date().getUTCFullYear() - 2,
    leadBehavior:'Lead and co-lead', conflictStatus:'POSSIBLE',
  }, {
    portfolioMatchCount:2, warmPathStatus:'VERIFIED', evidenceConfidence:90, conflictStatus:'POSSIBLE',
  });
  assert.equal(assessment.score, 90);
  assert.ok(assessment.reasons.some((reason) => /cheque range/i.test(reason)));
  assert.ok(assessment.warnings.some((warning) => /possible portfolio conflict/i.test(warning)));
  assert.equal(assessment.components.conflict.points, -10);
});

test('round economics separates pipeline, soft circle, commitments and funds received', () => {
  const economics = calculateRoundEconomics({ targetAmount:2000000 }, [
    { stage:'MEETING', expectedCheck:500000, probability:40 },
    { stage:'SOFT_CIRCLE', expectedCheck:300000, probability:80 },
    { stage:'PASSED', expectedCheck:900000, probability:100 },
  ], [
    { status:'CONFIRMED', committedAmount:250000, allocatedAmount:200000, receivedAmount:100000 },
    { status:'SOFT', committedAmount:100000, allocatedAmount:0, receivedAmount:0 },
  ]);
  assert.equal(economics.qualifiedPipeline, 800000);
  assert.equal(economics.weightedPipeline, 440000);
  assert.equal(economics.softCircled, 300000);
  assert.equal(economics.confirmedCommitments, 250000);
  assert.equal(economics.fundsReceived, 100000);
  assert.equal(economics.remaining, 1750000);
  assert.equal(economics.coverageRatio, 0.4);
});
