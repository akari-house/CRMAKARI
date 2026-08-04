import test from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet as getCommandCentre,
  rankCommandActions,
} from '../functions/api/bd-command-center/index.js';

class FakeDB {
  constructor(results = []) {
    this.results = [...results];
    this.calls = [];
  }

  prepare(sql) {
    return {
      bind: (...bindings) => {
        const call = { sql: String(sql), bindings };
        this.calls.push(call);
        return {
          all: async () => ({ results: this.results.shift() || [] }),
          first: async () => null,
          run: async () => ({ success: true }),
        };
      },
    };
  }
}

function context({ db, role = 'BD_MEMBER', financeAccess = false, scope = 'mine' }) {
  return {
    env: { DB: db, AUTH_MODE: 'access' },
    data: {
      auth: {
        userId: 'user_a',
        tenantId: 'tenant_a',
        tenantSlug: 'tenant-a',
        role,
        financeAccess,
      },
    },
    request: new Request(`https://crm.example.test/api/bd-command-center?scope=${scope}`, {
      headers: { accept: 'application/json' },
    }),
  };
}

async function body(response) {
  return response.json();
}

test('Finance and Viewer roles cannot load private BD execution queues', async () => {
  for (const role of ['FINANCE', 'VIEWER']) {
    const db = new FakeDB();
    const response = await getCommandCentre(context({ db, role }));
    assert.equal(response.status, 403);
    assert.match((await body(response)).error, /business development permission/i);
    assert.equal(db.calls.length, 0);
  }
});

test('BD members receive only their tenant-scoped owned records', async () => {
  const db = new FakeDB([[], []]);
  const response = await getCommandCentre(context({ db, role: 'BD_MEMBER', scope: 'team' }));
  const payload = await body(response);

  assert.equal(response.status, 200);
  assert.equal(payload.scope, 'MINE');
  assert.equal(payload.canManage, false);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'user_a']);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a', 'user_a']);
  assert.match(db.calls[0].sql, /p\.tenant_id = \?/);
  assert.match(db.calls[0].sql, /p\.owner_user_id = \?/);
  assert.match(db.calls[1].sql, /o\.tenant_id = \?/);
  assert.match(db.calls[1].sql, /o\.owner_user_id = \?/);
  assert.match(db.calls[1].sql, /NOT LIKE '%FUNDRAISING%'/);
});

test('BD managers can explicitly review the team queue without removing tenant scope', async () => {
  const db = new FakeDB([[], []]);
  const response = await getCommandCentre(context({ db, role: 'BD_MANAGER', scope: 'team' }));
  const payload = await body(response);

  assert.equal(response.status, 200);
  assert.equal(payload.scope, 'TEAM');
  assert.equal(payload.canManage, true);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a']);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a']);
  assert.doesNotMatch(db.calls[0].sql, /p\.owner_user_id = \?/);
  assert.doesNotMatch(db.calls[1].sql, /o\.owner_user_id = \?/);
  assert.match(db.calls[0].sql, /p\.tenant_id = \?/);
  assert.match(db.calls[1].sql, /o\.tenant_id = \?/);
});

test('ranking is evidence-led and prioritises incomplete deal control before secondary symptoms', () => {
  const now = new Date('2026-08-04T12:00:00Z');
  const actions = rankCommandActions({
    now,
    canManage: true,
    canFinance: true,
    leads: [
      {
        id: 'lead_overdue', name: 'Overdue Project', lifecycle_status: 'PROSPECT', priority: 'URGENT',
        owner_user_id: 'user_a', owner_name: 'Muaz', next_follow_up_at: '2026-07-30T09:00:00Z',
        last_activity_at: '2026-07-30T09:00:00Z', created_at: '2026-07-01T09:00:00Z',
      },
      {
        id: 'lead_unassigned', name: 'Unassigned Project', lifecycle_status: 'LEAD', priority: 'HIGH',
        owner_user_id: null, owner_name: null, next_follow_up_at: null,
        last_activity_at: null, created_at: '2026-07-01T09:00:00Z',
      },
    ],
    opportunities: [
      {
        id: 'opp_risk', project_id: 'project_risk', project_name: 'Risk Project', project_priority: 'HIGH',
        name: 'Risk Project campaign', owner_user_id: null, owner_name: null, primary_contact_id: null,
        stage: 'NEGOTIATION', estimated_value: 25000, currency: 'USD', expected_close_date: null,
        next_action: null, next_follow_up_at: '2026-08-01T09:00:00Z', proposal_count: 1,
        latest_proposal_outcome: 'SENT', engagement_count: 0, invoice_count: 0,
      },
      {
        id: 'opp_won', project_id: 'project_won', project_name: 'Won Client', project_priority: 'MEDIUM',
        name: 'Won Client advisory', owner_user_id: 'user_a', owner_name: 'Muaz', primary_contact_id: 'contact_a',
        stage: 'WON', estimated_value: 10000, currency: 'USD', expected_close_date: '2026-08-03',
        next_action: 'Issue invoice', engagement_count: 1, billable_engagement_count: 1, invoice_count: 0,
        client_billing_description: JSON.stringify({
          recordType: 'AKARI_CLIENT_BILLING_PROFILE_V1',
          profile: {
            legalName: 'Won Client Ltd', billingEmail: 'billing@example.com', addressLine1: 'Street 1',
            city: 'Berlin', country: 'Germany',
          },
        }),
      },
    ],
  });

  assert.ok(actions.length >= 5);
  assert.equal(actions[0].category, 'OPPORTUNITY_RISK');
  assert.equal(actions[0].entityId, 'opp_risk');
  assert.ok(actions[0].score >= 120);
  assert.match(actions[0].reason, /owner, primary contact, next action, expected close/i);
  assert.ok(actions.some((item) => item.category === 'UNASSIGNED' && item.entityId === 'lead_unassigned'));
  assert.ok(actions.some((item) => item.category === 'OPPORTUNITY_OVERDUE' && item.entityId === 'opp_risk'));
  assert.ok(actions.some((item) => item.category === 'PROPOSAL_FOLLOW_UP' && item.entityId === 'opp_risk'));
  const invoice = actions.find((item) => item.category === 'INVOICE_HANDOFF');
  assert.equal(invoice.entityId, 'opp_won');
  assert.equal(invoice.actionLabel, 'Create invoice');
  assert.deepEqual(invoice.evidence, ['Client billing profile: Complete', 'Billable engagements: 1', 'Invoices: 0']);
});

test('won deals with incomplete billing identity rank before invoice handoff', () => {
  const actions = rankCommandActions({
    now: new Date('2026-08-04T12:00:00Z'),
    canManage: true,
    canFinance: true,
    opportunities: [{
      id: 'opp_won', project_id: 'project_won', project_name: 'Won Client', project_priority: 'HIGH',
      name: 'Won Client campaign', owner_user_id: 'user_a', owner_name: 'Muaz', primary_contact_id: 'contact_a',
      stage: 'WON', estimated_value: 10000, currency: 'USD', engagement_count: 1,
      billable_engagement_count: 1, invoice_count: 0,
      client_billing_description: JSON.stringify({
        recordType: 'AKARI_CLIENT_BILLING_PROFILE_V1',
        profile: { legalName: 'Won Client Ltd', billingEmail: '', addressLine1: '', city: '', country: 'Germany' },
      }),
    }],
  });

  assert.equal(actions[0].category, 'CLIENT_BILLING');
  assert.match(actions[0].reason, /cannot be safely invoiced/i);
  assert.match(actions[0].evidence[0], /billing Email/i);
});
