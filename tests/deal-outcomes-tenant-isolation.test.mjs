import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as closeOpportunity } from '../functions/api/opportunities/[id]/close.js';
import { onRequest as enforceInvoiceEligibility } from '../functions/api/invoices/_middleware.js';

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

function opportunityRow(overrides = {}) {
  return {
    id: 'opp_a',
    tenant_id: 'tenant_a',
    project_id: 'project_a',
    project_name: 'Project A',
    project_lifecycle_status: 'ACTIVE_OPPORTUNITY',
    stage: 'NEGOTIATION',
    name: 'Strategic relationship',
    estimated_value: 10000,
    currency: 'USD',
    service_type: 'MARKETING',
    referral_partner_id: null,
    project_referral_partner_id: null,
    primary_contact_id: null,
    owner_user_id: 'user_a',
    probability_percentage: 75,
    ...overrides,
  };
}

function closeContext({ db, body }) {
  return {
    env: { DB: db, AUTH_MODE: 'access' },
    data: { auth: { userId: 'user_a', tenantId: 'tenant_a', tenantSlug: 'tenant-a', role: 'OWNER', financeAccess: true } },
    params: { id: 'opp_a' },
    request: new Request('https://crm.example.test/api/opportunities/opp_a/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'test' },
      body: JSON.stringify(body),
    }),
  };
}

test('partnership close creates a non-billable engagement and promotes the project to Partner', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return opportunityRow();
    return null;
  });

  const response = await closeOpportunity(closeContext({
    db,
    body: {
      outcome: 'WON',
      dealModel: 'PARTNERSHIP',
      startDate: '2030-04-01',
      deliverables: 'Joint ecosystem introductions and shared distribution',
      valueContribution: 'Access to regional founders and partner distribution',
      strategicValue: 25000,
      createAnnouncementPlan: false,
    },
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.engagement.dealModel, 'PARTNERSHIP');
  assert.equal(payload.engagement.invoiceEligible, false);
  assert.equal(payload.engagement.grossRevenue, 0);
  assert.equal(payload.referral, null);
  assert.equal(payload.announcementPlan, null);

  const campaignInsert = db.calls.find((call) => /INSERT INTO campaigns/.test(call.sql));
  assert.ok(campaignInsert);
  assert.equal(campaignInsert.bindings[11], 0);
  const metadata = JSON.parse(campaignInsert.bindings[20]);
  assert.equal(metadata.dealModel, 'PARTNERSHIP');
  assert.equal(metadata.invoiceEligible, false);
  assert.equal(metadata.commercialModel, 'NON_BILLABLE');
  assert.match(metadata.valueContribution, /regional founders/i);

  const projectUpdate = db.calls.find((call) => /UPDATE projects SET/.test(call.sql));
  assert.ok(projectUpdate);
  assert.equal(projectUpdate.bindings[0], 'PARTNER');
  assert.equal(db.calls.some((call) => /INSERT INTO referrals/.test(call.sql)), false);
});

test('paid service close stays invoice eligible and promotes the project to Client', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method === 'first' && index === 0) return opportunityRow();
    return null;
  });

  const response = await closeOpportunity(closeContext({
    db,
    body: {
      outcome: 'WON',
      dealModel: 'SERVICE',
      finalValue: 12000,
      currency: 'USD',
      serviceType: 'KOL_CAMPAIGN',
      commercialModel: 'FIXED_FEE',
      startDate: '2030-04-01',
      deliverables: 'KOL campaign strategy, activation and reporting',
    },
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.engagement.dealModel, 'SERVICE');
  assert.equal(payload.engagement.invoiceEligible, true);
  assert.equal(payload.engagement.grossRevenue, 12000);

  const projectUpdate = db.calls.find((call) => /UPDATE projects SET/.test(call.sql));
  assert.ok(projectUpdate);
  assert.equal(projectUpdate.bindings[0], 'CLIENT');
});

test('optional announcement plan creates connected BD, content, design and social tasks', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return opportunityRow();
    if ([1, 2, 3].includes(index)) return { id: 'user_a' };
    return null;
  });

  const response = await closeOpportunity(closeContext({
    db,
    body: {
      outcome: 'WON',
      dealModel: 'PARTNERSHIP',
      startDate: '2030-04-01',
      deliverables: 'Joint partnership and community activation',
      createAnnouncementPlan: true,
      announcementDate: '2030-04-10',
    },
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.announcementPlan.requested, true);
  assert.equal(payload.announcementPlan.launchDate, '2030-04-10');
  assert.equal(payload.announcementPlan.taskCount, 11);

  const taskCalls = db.calls.filter((call) => /INSERT INTO tasks/.test(call.sql));
  assert.equal(taskCalls.length, 11);
  assert.ok(taskCalls.some((call) => String(call.bindings[11]).includes(':CONTENT:')));
  assert.ok(taskCalls.some((call) => String(call.bindings[11]).includes(':DESIGN:')));
  assert.ok(taskCalls.some((call) => String(call.bindings[11]).includes(':SOCIAL:')));
  assert.ok(taskCalls.every((call) => call.bindings[8] === 'project_a' && call.bindings[9] === 'opp_a'));
});

test('invoice middleware blocks the non-billable partnership engagement', async () => {
  const db = new FakeDB((method) => method === 'first'
    ? { id: 'eng_partner', notes: JSON.stringify({ dealModel: 'PARTNERSHIP', invoiceEligible: false, commercialModel: 'NON_BILLABLE' }) }
    : null);
  let nextCalls = 0;
  const response = await enforceInvoiceEligibility({
    env: { DB: db },
    data: { auth: { tenantId: 'tenant_a', role: 'OWNER', financeAccess: true } },
    request: new Request('https://crm.example.test/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'project_a', campaignId: 'eng_partner', lineItems: [] }),
    }),
    next: async () => {
      nextCalls += 1;
      return new Response('next');
    },
  });

  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /non-billable/i);
  assert.equal(nextCalls, 0);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'eng_partner']);
});
