import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as createInvoice } from '../functions/api/invoices/index.js';
import {
  calculateInvoiceTax,
  parseInvoice,
} from '../functions/lib/commercial-hardening.js';

function requestContext(body) {
  return {
    env: { AUTH_MODE: 'access' },
    data: {
      auth: {
        userId: 'user_owner',
        tenantId: 'tenant_akari_house',
        tenantSlug: 'akari-house',
        role: 'OWNER',
        financeAccess: true,
      },
    },
    params: {},
    request: new Request('https://crm.example.test/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}

const lineItems = [{ description: 'Campaign service', quantity: 1, unitPrice: 100, amount: 100 }];

test('exclusive tax adds tax on top of entered line-item prices', () => {
  const result = calculateInvoiceTax(lineItems, 19, 'EXCLUSIVE');
  assert.deepEqual(result, {
    taxMode: 'EXCLUSIVE',
    pricesIncludeTax: false,
    enteredSubtotal: 100,
    subtotal: 100,
    taxRate: 19,
    taxAmount: 19,
    total: 119,
  });
});

test('inclusive tax extracts tax without increasing the entered total', () => {
  const result = calculateInvoiceTax(lineItems, 19, 'INCLUSIVE');
  assert.equal(result.taxMode, 'INCLUSIVE');
  assert.equal(result.pricesIncludeTax, true);
  assert.equal(result.enteredSubtotal, 100);
  assert.equal(result.subtotal, 84.03);
  assert.equal(result.taxAmount, 15.97);
  assert.equal(result.total, 100);
});

test('no-tax mode ignores a supplied rate and keeps the total unchanged', () => {
  const result = calculateInvoiceTax(lineItems, 19, 'NONE');
  assert.equal(result.taxMode, 'NONE');
  assert.equal(result.taxRate, 0);
  assert.equal(result.subtotal, 100);
  assert.equal(result.taxAmount, 0);
  assert.equal(result.total, 100);
});

test('legacy invoices with a rate and no mode remain tax exclusive', () => {
  const result = calculateInvoiceTax(lineItems, 19);
  assert.equal(result.taxMode, 'EXCLUSIVE');
  assert.equal(result.total, 119);
});

test('invoice parser exposes stored tax treatment to finance and print views', () => {
  const row = {
    id: 'invoice_a',
    project_id: 'project_a',
    project_name: 'Client A',
    invoice_reference: 'AKARI-2026-0001',
    amount: 100,
    currency: 'EUR',
    status: 'INVOICED',
    notes: JSON.stringify({
      recordType: 'INVOICE_V1',
      taxMode: 'INCLUSIVE',
      pricesIncludeTax: true,
      enteredSubtotal: 100,
      subtotal: 84.03,
      taxRate: 19,
      taxAmount: 15.97,
      total: 100,
      lineItems,
    }),
  };
  const invoice = parseInvoice(row);
  assert.equal(invoice.taxMode, 'INCLUSIVE');
  assert.equal(invoice.pricesIncludeTax, true);
  assert.equal(invoice.enteredSubtotal, 100);
  assert.equal(invoice.subtotal, 84.03);
  assert.equal(invoice.taxAmount, 15.97);
  assert.equal(invoice.total, 100);
});

test('invoice API calculates inclusive tax before any database write', async () => {
  const response = await createInvoice(requestContext({
    projectId: 'project_a',
    status: 'DRAFT',
    currency: 'EUR',
    taxMode: 'INCLUSIVE',
    taxRate: 19,
    lineItems: [{ description: 'Campaign service', quantity: 1, unitPrice: 100 }],
  }));
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.taxMode, 'INCLUSIVE');
  assert.equal(payload.subtotal, 84.03);
  assert.equal(payload.taxAmount, 15.97);
  assert.equal(payload.total, 100);
});

test('invoice API rejects an unknown tax treatment', async () => {
  const response = await createInvoice(requestContext({
    projectId: 'project_a',
    status: 'DRAFT',
    currency: 'USD',
    taxMode: 'SOMETIMES',
    taxRate: 19,
    lineItems: [{ description: 'Campaign service', quantity: 1, unitPrice: 100 }],
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /tax treatment/i);
});
