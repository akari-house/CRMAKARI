import test from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet as getClientBilling,
  onRequestPatch as updateClientBilling,
} from '../functions/api/projects/[id]/billing-profile.js';
import { onRequestPost as createInvoice } from '../functions/api/invoices/index.js';

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

function context({
  db,
  path,
  method = 'GET',
  body = {},
  role = 'OWNER',
  financeAccess = true,
  params = {},
}) {
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
    params,
    request: new Request(`https://crm.example.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    }),
  };
}

async function responseBody(response) {
  return response.json();
}

const project = {
  id: 'project_a',
  name: 'TRAVLS',
  country: 'Germany',
  lifecycle_status: 'CLIENT',
  primary_contact_name: 'Alice',
  primary_contact_email: 'billing@travls.example',
  contact_name: 'Alice',
  contact_email: 'billing@travls.example',
};

const issuerFlags = JSON.stringify({
  billingProfile: {
    legalName: 'AKARI House',
    addressLine1: 'Issuer Street 1',
    city: 'Frankfurt',
    postalCode: '60311',
    country: 'Germany',
    invoicePrefix: 'AKARI',
  },
});

const completeClientProfile = {
  legalName: 'TRAVLS Ltd',
  billingEmail: 'billing@travls.example',
  contactName: 'Alice',
  addressLine1: 'Client Street 2',
  addressLine2: null,
  city: 'Berlin',
  postalCode: '10115',
  country: 'Germany',
  vatId: 'DE123456789',
  registrationNumber: 'HRB 12345',
  preferredCurrency: 'EUR',
  defaultTaxMode: 'EXCLUSIVE',
  defaultTaxRate: 19,
  paymentTermsDays: 14,
};

test('client billing profile lookup is scoped to the authenticated tenant', async () => {
  const db = new FakeDB(() => null);
  const response = await getClientBilling(context({
    db,
    path: '/api/projects/project_b/billing-profile',
    params: { id: 'project_b' },
  }));

  assert.equal(response.status, 404);
  assert.match((await responseBody(response)).error, /client project was not found/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'project_b']);
  assert.match(db.calls[0].sql, /WHERE p\.tenant_id = \? AND p\.id = \?/);
});

test('BD members cannot modify client billing identity', async () => {
  const db = new FakeDB(() => null);
  const response = await updateClientBilling(context({
    db,
    path: '/api/projects/project_a/billing-profile',
    method: 'PATCH',
    role: 'BD_MEMBER',
    params: { id: 'project_a' },
    body: completeClientProfile,
  }));

  assert.equal(response.status, 403);
  assert.match((await responseBody(response)).error, /role does not allow/i);
  assert.equal(db.calls.length, 0);
});

test('client billing profile writes an audited snapshot and confirms it in the same tenant', async () => {
  let savedId = null;
  let savedDescription = null;
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM projects p/i.test(call.sql)) return project;
    if (method === 'run' && /INSERT INTO activities/i.test(call.sql)) {
      savedId = call.bindings[0];
      savedDescription = call.bindings[4];
      return { success: true };
    }
    if (method === 'first' && /FROM activities/i.test(call.sql)) {
      return {
        id: savedId,
        user_id: 'user_a',
        description: savedDescription,
        outcome: 'COMPLETE',
        occurred_at: '2026-08-04T10:00:00Z',
        created_at: '2026-08-04T10:00:00Z',
      };
    }
    return null;
  });

  const response = await updateClientBilling(context({
    db,
    path: '/api/projects/project_a/billing-profile',
    method: 'PATCH',
    params: { id: 'project_a' },
    body: completeClientProfile,
  }));
  const payload = await responseBody(response);

  assert.equal(response.status, 200);
  assert.equal(payload.readiness.complete, true);
  assert.equal(payload.profile.legalName, 'TRAVLS Ltd');
  assert.ok(savedId?.startsWith('act_'));
  assert.ok(db.calls.some((call) => /CLIENT_BILLING_PROFILE_UPDATED/.test(call.sql)));
  const lookup = db.calls.find((call) => /FROM activities/i.test(call.sql));
  assert.deepEqual(lookup.bindings, ['tenant_a', 'project_a']);
});

test('issued engagement invoices fail closed until the linked opportunity is won', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM projects p/i.test(call.sql)) return project;
    if (method === 'first' && /FROM campaigns c/i.test(call.sql)) {
      return {
        id: 'campaign_a',
        opportunity_id: 'opportunity_a',
        status: 'CONFIRMED',
        notes: '{}',
        opportunity_stage: 'QUALIFIED',
      };
    }
    return null;
  });

  const response = await createInvoice(context({
    db,
    path: '/api/invoices',
    method: 'POST',
    body: {
      projectId: 'project_a',
      campaignId: 'campaign_a',
      opportunityId: 'opportunity_a',
      invoiceDate: '2026-08-04',
      dueDate: '2026-08-18',
      status: 'INVOICED',
      currency: 'USD',
      taxMode: 'NONE',
      taxRate: 0,
      recipient: completeClientProfile,
      lineItems: [{ description: 'Creator campaign', quantity: 1, unitPrice: 100 }],
    },
  }));

  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /won opportunity and active engagement/i);
  assert.equal(db.calls.filter((call) => /INSERT INTO payments/i.test(call.sql)).length, 0);
});

test('issued invoices require complete client billing identity', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM projects p/i.test(call.sql)) return project;
    if (method === 'first' && /FROM campaigns c/i.test(call.sql)) {
      return {
        id: 'campaign_a',
        opportunity_id: 'opportunity_a',
        status: 'CONFIRMED',
        notes: '{}',
        opportunity_stage: 'WON',
      };
    }
    if (method === 'first' && /FROM tenants t/i.test(call.sql)) {
      return { name: 'AKARI House', base_currency: 'USD', feature_flags_json: issuerFlags };
    }
    if (method === 'first' && /activity_type = 'CLIENT_BILLING_PROFILE'/i.test(call.sql)) return null;
    return null;
  });

  const response = await createInvoice(context({
    db,
    path: '/api/invoices',
    method: 'POST',
    body: {
      projectId: 'project_a',
      campaignId: 'campaign_a',
      opportunityId: 'opportunity_a',
      invoiceDate: '2026-08-04',
      dueDate: '2026-08-18',
      status: 'INVOICED',
      currency: 'USD',
      taxMode: 'NONE',
      taxRate: 0,
      lineItems: [{ description: 'Creator campaign', quantity: 1, unitPrice: 100 }],
    },
  }));

  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /complete the client billing profile/i);
  assert.equal(db.calls.filter((call) => /INSERT INTO payments/i.test(call.sql)).length, 0);
});

test('issued invoice uses the saved client profile and writes the connected won deal', async () => {
  let invoiceInsert = null;
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM projects p/i.test(call.sql)) return project;
    if (method === 'first' && /FROM campaigns c/i.test(call.sql)) {
      return {
        id: 'campaign_a',
        opportunity_id: 'opportunity_a',
        status: 'CONFIRMED',
        notes: JSON.stringify({ invoiceEligible: true, dealModel: 'SERVICE' }),
        opportunity_stage: 'WON',
      };
    }
    if (method === 'first' && /FROM tenants t/i.test(call.sql)) {
      return { name: 'AKARI House', base_currency: 'USD', feature_flags_json: issuerFlags };
    }
    if (method === 'first' && /activity_type = 'CLIENT_BILLING_PROFILE'/i.test(call.sql)) {
      return { description: JSON.stringify({ recordType: 'AKARI_CLIENT_BILLING_PROFILE_V1', profile: completeClientProfile }) };
    }
    if (method === 'first' && /COUNT\(\*\) AS value/i.test(call.sql)) return { value: 0 };
    if (method === 'first' && /invoice_reference = \? LIMIT 1/i.test(call.sql)) return null;
    if (method === 'run' && /INSERT INTO payments/i.test(call.sql)) {
      invoiceInsert = call;
      return { success: true };
    }
    if (method === 'first' && /COALESCE\(SUM/i.test(call.sql)) return { value: 119 };
    return null;
  });

  const response = await createInvoice(context({
    db,
    path: '/api/invoices',
    method: 'POST',
    body: {
      projectId: 'project_a',
      campaignId: 'campaign_a',
      opportunityId: 'opportunity_a',
      invoiceDate: '2026-08-04',
      dueDate: '2026-08-18',
      status: 'INVOICED',
      currency: 'EUR',
      taxMode: 'EXCLUSIVE',
      taxRate: 19,
      lineItems: [{ description: 'Creator campaign', quantity: 1, unitPrice: 100 }],
    },
  }));
  const payload = await responseBody(response);

  assert.equal(response.status, 201);
  assert.equal(payload.total, 119);
  assert.equal(payload.opportunityId, 'opportunity_a');
  assert.ok(invoiceInsert);
  const metadata = JSON.parse(invoiceInsert.bindings[13]);
  assert.equal(metadata.recipient.name, 'TRAVLS Ltd');
  assert.equal(metadata.recipient.addressLine1, 'Client Street 2');
  assert.equal(metadata.recipient.vatId, 'DE123456789');
  assert.equal(metadata.opportunityId, 'opportunity_a');
  assert.equal(metadata.engagementId, 'campaign_a');
});
