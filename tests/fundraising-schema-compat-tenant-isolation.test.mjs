import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/fundraising/index.js';

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

function context(db) {
  return {
    env:{ DB:db },
    data:{ auth:{ userId:'user_a', tenantId:'tenant_a', tenantSlug:'tenant-a', role:'OWNER', financeAccess:true } },
    request:new Request('https://crm.test/api/fundraising'),
  };
}

test('fundraising reads the existing project schema and derives funding fields from BD metadata', async () => {
  const flags = {
    fundraisingCapitalRooms:[{
      id:'room_a', projectId:'project_a', projectName:'Founder A', roundName:'Seed', stage:'OPEN',
      targetAmount:500000, committedAmount:100000, currency:'USD', investorPipeline:[],
    }],
  };
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:JSON.stringify(flags) };
    if (method === 'all' && /FROM projects/.test(call.sql)) {
      assert.equal(call.sql.includes('funding_stage'), false);
      assert.equal(call.sql.includes('total_funds_raised'), false);
      return [{
        id:'project_a', name:'Founder A', category:'AI', region:'EU', website:'https://example.test',
        funding_status:null, funding_amount:null, valuation:null, owner_user_id:'user_a',
        legacy_import_data:JSON.stringify({ bdProfile:{
          entityType:'PROJECT',
          funding:{ stage:'SEED', amountRaised:250000, currency:'EUR', valuation:4000000 },
        } }),
      }];
    }
    return null;
  });

  const response = await onRequestGet(context(db));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projects.length, 1);
  assert.equal(payload.projects[0].funding_stage, 'SEED');
  assert.equal(payload.projects[0].total_funds_raised, 250000);
  assert.equal(payload.projects[0].currency, 'EUR');
  assert.equal(payload.projects[0].valuation, 4000000);
  assert.equal(payload.items[0].project.id, 'project_a');
  const lookup = db.calls.find((call) => /FROM projects/.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a']);
});

test('fundraising hides raw D1 and SQLite errors from the browser response', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /tenant_settings/.test(call.sql)) return { feature_flags_json:'{}' };
    if (method === 'all' && /FROM projects/.test(call.sql)) throw new Error('D1_ERROR: no such column: funding_stage at offset 39: SQLITE_ERROR');
    return null;
  });

  const response = await onRequestGet(context(db));
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.error, 'Fundraising workspace could not be loaded');
  assert.equal(/D1_ERROR|SQLITE_ERROR|no such column/i.test(payload.error), false);
});
