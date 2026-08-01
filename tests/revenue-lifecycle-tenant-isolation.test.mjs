import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as closeOpportunity } from '../functions/api/opportunities/[id]/close.js';
import { onRequestPatch as patchEngagement } from '../functions/api/engagements/[id].js';
import { onRequestPost as recordInvoiceReceipt } from '../functions/api/invoices/[id]/receipts.js';

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

function context({ db, id = 'opp_a', method = 'POST', body = {}, role = 'OWNER', financeAccess = true }) {
  return {
    env:{ DB:db, AUTH_MODE:'access' },
    data:{ auth:{ userId:'user_a',tenantId:'tenant_a',tenantSlug:'tenant-a',role,financeAccess } },
    params:{ id },
    request:new Request(`https://crm.example.test/api/test/${id}`, { method, headers:{'content-type':'application/json'}, body:JSON.stringify(body) }),
  };
}

async function responseBody(response) { return response.json(); }

test('won workflow rejects a referral partner from another tenant before creating an engagement', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return {
      id:'opp_a',tenant_id:'tenant_a',project_id:'project_a',project_name:'Project A',project_lifecycle_status:'ACTIVE_OPPORTUNITY',
      stage:'NEGOTIATION',name:'GTM mandate',estimated_value:10000,currency:'USD',service_type:'GTM',
      referral_partner_id:null,project_referral_partner_id:null,primary_contact_id:null,probability_percentage:75,
    };
    if (index === 1) return null;
    return null;
  });
  const response = await closeOpportunity(context({
    db,
    body:{ outcome:'WON',finalValue:10000,currency:'USD',startDate:'2030-03-01',deliverables:'GTM delivery',referralPartnerId:'partner_tenant_b',referralPercentage:5 },
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /does not belong to this workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a','partner_tenant_b','ARCHIVED']);
  assert.match(db.calls[1].sql, /tenant_id = \? AND id = \?/);
  assert.equal(db.calls.some((call) => /INSERT INTO campaigns/.test(call.sql)), false);
});

test('engagement update rejects a referral partner outside the authenticated tenant', async () => {
  const db = new FakeDB((method, call, index) => {
    if (method !== 'first') return null;
    if (index === 0) return {
      id:'eng_a',tenant_id:'tenant_a',project_id:'project_a',opportunity_id:'opp_a',name:'Engagement A',status:'ONBOARDING',
      gross_revenue:10000,currency:'USD',campaign_cost:0,creator_cost:0,other_cost:0,referral_partner_id:null,referral_percentage:0,notes:'{}',
    };
    if (index === 1) return null;
    return null;
  });
  const response = await patchEngagement(context({
    db,id:'eng_a',method:'PATCH',body:{referralPartnerId:'partner_tenant_b',referralPercentage:5},
  }));
  assert.equal(response.status, 422);
  assert.match((await responseBody(response)).error, /does not belong to this workspace/i);
  assert.deepEqual(db.calls[1].bindings, ['tenant_a','partner_tenant_b','ARCHIVED']);
  assert.equal(db.calls.some((call) => /UPDATE campaigns/.test(call.sql)), false);
});

test('invoice receipt endpoint never reads or writes an invoice outside the authenticated tenant', async () => {
  const db = new FakeDB((method) => method === 'first' ? null : []);
  const response = await recordInvoiceReceipt(context({
    db,id:'invoice_tenant_b',method:'POST',body:{amount:500,receivedDate:'2030-03-02',paymentMethod:'BANK_TRANSFER',reference:'REF-1'},
  }));
  assert.equal(response.status, 404);
  assert.match((await responseBody(response)).error, /invoice not found/i);
  assert.deepEqual(db.calls[0].bindings, ['tenant_a','invoice_tenant_b']);
  assert.match(db.calls[0].sql, /pay\.tenant_id = \? AND pay\.id = \?/);
  assert.equal(db.calls.some((call) => /INSERT INTO payments/.test(call.sql)), false);
});
