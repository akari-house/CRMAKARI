import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPatch } from '../functions/api/service-delivery/[id].js';

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

function context({ db, body, role='OWNER', financeAccess=true, id='eng_a' }) {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a', tenantId:'tenant_a', tenantSlug:'tenant-a', role, financeAccess } },
    params:{ id },
    request:new Request(`https://crm.example.test/api/service-delivery/${id}`, { method:'PATCH', headers:{ 'content-type':'application/json' }, body:JSON.stringify(body) }),
  };
}

const campaign = {
  id:'eng_a', tenant_id:'tenant_a', project_id:'project_a', opportunity_id:'opp_a',
  name:'Creator campaign', campaign_owner_id:'user_a', campaign_owner_name:'Owner A', status:'ONBOARDING',
  project_name:'Project A', opportunity_name:'Opportunity A', start_date:'2026-08-01', end_date:'2026-08-31',
  gross_revenue:10000, currency:'USD', campaign_cost:1000, creator_cost:2000, other_cost:0,
  referral_percentage:5, amount_invoiced:10000, amount_received:5000, payment_status:'PARTIALLY_PAID',
  next_action:'Complete onboarding', notes:JSON.stringify({ recordType:'AKARI_ENGAGEMENT_V1', serviceDelivery:{ recordType:'AKARI_SERVICE_DELIVERY_V1', onboarding:[], milestones:[], deliverables:[], creators:[] } }),
  created_at:'2026-08-01T00:00:00Z', updated_at:'2026-08-01T00:00:00Z',
};

async function payload(response) { return response.json(); }

test('service delivery lookup is scoped to the authenticated tenant', async () => {
  const db = new FakeDB(() => null);
  const response = await onRequestPatch(context({ db, id:'eng_tenant_b', body:{ action:'update-overview', status:'LIVE' } }));
  assert.equal(response.status, 404);
  assert.match((await payload(response)).error, /service engagement not found/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a','eng_tenant_b']);
  assert.match(db.calls[0].sql, /c\.tenant_id = \? AND c\.id = \?/);
});

test('delivery owner must be an active member of the same tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return campaign;
    if (method === 'first' && index === 1) return null;
    if (method === 'run') throw new Error('Invalid owner must not update the campaign');
    return [];
  });
  const response = await onRequestPatch(context({ db, body:{ action:'update-overview', status:'LIVE', ownerUserId:'user_tenant_b' } }));
  assert.equal(response.status, 422);
  assert.match((await payload(response)).error, /not an active member of this workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a','user_tenant_b']);
  assert.equal(db.calls.some((call) => /UPDATE campaigns/.test(call.sql)), false);
});

test('non-finance members cannot change service profitability values', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return campaign;
    if (method === 'first' && index === 1) return { id:'user_a' };
    if (method === 'run') throw new Error('Finance-restricted update must not be written');
    return [];
  });
  const response = await onRequestPatch(context({ db, role:'BD_MEMBER', financeAccess:false, body:{ action:'update-overview', ownerUserId:'user_a', grossRevenue:25000 } }));
  assert.equal(response.status, 403);
  assert.match((await payload(response)).error, /finance permission/i);
  assert.equal(db.calls.some((call) => /UPDATE campaigns/.test(call.sql)), false);
});

test('only the governed completion action can mark an engagement completed', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return campaign;
    if (method === 'run') throw new Error('Direct completion must not be written');
    return [];
  });
  const response = await onRequestPatch(context({ db, body:{ action:'update-overview', status:'COMPLETED', ownerUserId:'user_a' } }));
  assert.equal(response.status, 409);
  assert.match((await payload(response)).error, /governed completion action/i);
  assert.equal(db.calls.some((call) => /UPDATE campaigns/.test(call.sql)), false);
});

test('non-finance members cannot change creator rewards or payment status', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return campaign;
    if (method === 'run') throw new Error('Creator finance update must not be written');
    return [];
  });
  const response = await onRequestPatch(context({
    db,
    role:'BD_MEMBER',
    financeAccess:false,
    body:{ action:'upsert-creator', item:{ id:'creator_a', name:'Creator A', paymentStatus:'PAID' } },
  }));
  assert.equal(response.status, 403);
  assert.match((await payload(response)).error, /finance permission/i);
  assert.equal(db.calls.some((call) => /UPDATE campaigns/.test(call.sql)), false);
});

test('engagement completion is blocked while required delivery work remains open', async () => {
  const blocked = {
    ...campaign,
    notes:JSON.stringify({ recordType:'AKARI_ENGAGEMENT_V1', serviceDelivery:{ recordType:'AKARI_SERVICE_DELIVERY_V1', onboarding:[{ id:'onb_1', label:'Kickoff', required:true, status:'IN_PROGRESS' }], milestones:[], deliverables:[], creators:[], report:{} } }),
  };
  const db = new FakeDB((method, call, index) => method === 'first' && index === 0 ? blocked : []);
  const response = await onRequestPatch(context({ db, body:{ action:'complete', outcome:'Campaign delivered' } }));
  assert.equal(response.status, 409);
  assert.match((await payload(response)).error, /required onboarding item/i);
  assert.equal(db.calls.some((call) => /UPDATE campaigns/.test(call.sql)), false);
});
