import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPatch as updateProposal } from '../functions/api/proposals/[id].js';
import { onRequestPatch as updateInvoice } from '../functions/api/invoices/[id].js';
import { onRequestPost as createInvoice } from '../functions/api/invoices/index.js';

class FakeDB {
  constructor(resolver) { this.resolver = resolver; this.calls = []; }
  prepare(sql) {
    return { bind: (...bindings) => {
      const call = { sql:String(sql), bindings };
      this.calls.push(call);
      return {
        first: async () => this.resolver('first', call, this.calls.length - 1),
        all: async () => ({ results: await this.resolver('all', call, this.calls.length - 1) || [] }),
        run: async () => this.resolver('run', call, this.calls.length - 1) || { success:true },
      };
    } };
  }
}

function context({ db, path, method = 'PATCH', body = {}, role = 'OWNER', financeAccess = true, params = {} }) {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a', tenantId:'tenant_a', tenantSlug:'tenant-a', role, financeAccess } },
    params,
    request:new Request(`https://crm.example.test${path}`, { method, headers:{ 'content-type':'application/json' }, body:method === 'GET' ? undefined : JSON.stringify(body) }),
  };
}

const proposalRow = {
  id:'proposal_a', tenant_id:'tenant_a', project_id:'project_a', opportunity_id:'opportunity_a',
  activity_type:'PROPOSAL', subject:'Proposal v1', outcome:'DRAFT', next_action:'Review',
  description:JSON.stringify({ recordType:'AKARI_PROPOSAL_V1', version:1, status:'DRAFT', title:'Proposal', scope:'Scope', deliverables:'Deliverables', amount:1000, currency:'USD' }),
  opportunity_stage:'QUALIFIED', need_confirmed:1, decision_maker_confirmed:1, timeline_confirmed:1,
  budget_status:'CONFIRMED', probability_percentage:50, project_name:'Project A', primary_contact_name:'Alice',
};

const invoiceRow = {
  id:'invoice_a', tenant_id:'tenant_a', project_id:'project_a', campaign_id:'campaign_a',
  payment_type:'INVOICE', invoice_reference:'AKARI-2026-0001', amount:100, currency:'USD', status:'INVOICED',
  notes:JSON.stringify({ recordType:'INVOICE_V1', total:100, subtotal:100, lineItems:[{ description:'Service', quantity:1, unitPrice:100, amount:100 }] }),
  project_name:'Project A', created_at:'2026-08-01T00:00:00Z', updated_at:'2026-08-01T00:00:00Z',
};

async function body(response) { return response.json(); }

test('proposal status lookup is scoped to the authenticated tenant', async () => {
  const db = new FakeDB(() => null);
  const response = await updateProposal(context({ db, path:'/api/proposals/proposal_b', body:{ status:'APPROVED' }, params:{ id:'proposal_b' } }));
  assert.equal(response.status, 404);
  assert.match((await body(response)).error, /proposal not found/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'proposal_b']);
  assert.match(db.calls[0].sql, /a\.tenant_id = \? AND a\.id = \?/);
});

test('BD members cannot self-approve a proposal', async () => {
  const db = new FakeDB((method) => method === 'first' ? proposalRow : []);
  const response = await updateProposal(context({ db, path:'/api/proposals/proposal_a', role:'BD_MEMBER', body:{ status:'APPROVED' }, params:{ id:'proposal_a' } }));
  assert.equal(response.status, 403);
  assert.match((await body(response)).error, /manager approval/i);
  assert.equal(db.calls.filter((call) => /UPDATE activities/i.test(call.sql)).length, 0);
});

test('invoice control lookup never crosses the authenticated tenant', async () => {
  const db = new FakeDB(() => null);
  const response = await updateInvoice(context({ db, path:'/api/invoices/invoice_b', body:{ action:'cancel', reason:'Duplicate' }, params:{ id:'invoice_b' } }));
  assert.equal(response.status, 404);
  assert.match((await body(response)).error, /invoice not found/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a', 'invoice_b']);
  assert.match(db.calls[0].sql, /pay\.tenant_id = \? AND pay\.id = \?/);
});

test('credit notes cannot exceed the tenant invoice amount available for credit', async () => {
  const db = new FakeDB((method, call) => {
    if (method === 'first' && /FROM payments pay/i.test(call.sql)) return invoiceRow;
    if (method === 'all') return [];
    return null;
  });
  const response = await updateInvoice(context({ db, path:'/api/invoices/invoice_a', body:{ action:'credit', amount:120, reason:'Scope reduced' }, params:{ id:'invoice_a' } }));
  assert.equal(response.status, 422);
  assert.match((await body(response)).error, /exceeds the invoice total/i);
  assert.equal(db.calls.filter((call) => /INSERT INTO payments/i.test(call.sql)).length, 0);
});

test('invoice payment schedules must reconcile exactly to the invoice total', async () => {
  const db = new FakeDB(() => null);
  const response = await createInvoice(context({
    db,
    path:'/api/invoices',
    method:'POST',
    body:{
      projectId:'project_a', status:'DRAFT', currency:'USD', taxRate:0,
      lineItems:[{ description:'Service', quantity:1, unitPrice:100 }],
      paymentSchedule:[{ label:'Deposit', dueDate:'2026-08-15', amount:60 }],
    },
    params:{},
  }));
  assert.equal(response.status, 422);
  assert.match((await body(response)).error, /must equal the invoice total/i);
  assert.equal(db.calls.length, 0);
});
