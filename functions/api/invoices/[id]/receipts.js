import { json, error, readJson } from '../../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant, canViewFinance } from '../../../lib/permissions.js';
import {
  RECEIPT_MARKER,
  lifecyclePayload,
  moneyNumber,
  text,
  addDays,
} from '../../../lib/revenue-lifecycle.js';
import { parseInvoice, parseJson, roundMoney } from '../../../lib/commercial-hardening.js';

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const permissionError = new Error('Finance permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

async function loadInvoice(db, tenantId, id) {
  return first(db, `
    SELECT pay.*, p.name AS project_name
    FROM payments pay
    JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
    WHERE pay.tenant_id = ? AND pay.id = ? AND pay.payment_type = 'INVOICE'
    LIMIT 1
  `, [tenantId, id]);
}

async function loadRelated(db, tenantId, invoice) {
  const rows = await all(db, `
    SELECT * FROM payments
    WHERE tenant_id = ? AND project_id = ? AND payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')
    ORDER BY COALESCE(received_date, created_at) DESC
  `, [tenantId, invoice.project_id]);
  const receipts = rows.filter((row) => row.payment_type === 'INVOICE_RECEIPT' && row.invoice_reference === invoice.invoice_reference);
  const credits = rows.filter((row) => {
    if (row.payment_type !== 'CREDIT_NOTE') return false;
    const metadata = parseJson(row.notes, {});
    return metadata.invoiceId === invoice.id || metadata.invoiceNumber === invoice.invoice_reference;
  });
  return { receipts, credits };
}

function publicReceipt(row) {
  const metadata = parseJson(row.notes, {});
  return {
    id: row.id,
    invoiceId: metadata.invoiceId,
    invoiceNumber: row.invoice_reference,
    amount: Number(row.amount || 0),
    currency: row.currency || 'USD',
    receivedDate: row.received_date,
    paymentMethod: row.payment_method,
    reference: row.wallet_or_bank_reference,
    notes: metadata.notes || null,
    createdAt: row.created_at,
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({ items: [], total: 0, received: 0, credited:0, outstanding: 0, demo: true });
    const invoice = await loadInvoice(context.env.DB, tenantId, context.params.id);
    if (!invoice) return error('Invoice not found', 404);
    const { receipts, credits } = await loadRelated(context.env.DB, tenantId, invoice);
    const parsed = parseInvoice(invoice, receipts, credits);
    return json({ items: receipts.map(publicReceipt), total: receipts.length, received:parsed.received, credited:parsed.credited, outstanding:parsed.outstanding, invoiceTotal:parsed.total });
  } catch (cause) {
    return error(cause.message || 'Invoice receipts could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    const invoiceId = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id: makeId('rcp'), created: true, demo: true }, 201);

    const invoice = await loadInvoice(context.env.DB, tenantId, invoiceId);
    if (!invoice) return error('Invoice not found', 404);
    if (['CANCELLED', 'DRAFT', 'CREDITED'].includes(invoice.status)) return error('This invoice cannot receive a payment', 409);
    const related = await loadRelated(context.env.DB, tenantId, invoice);
    const parsed = parseInvoice(invoice, related.receipts, related.credits);
    if (parsed.outstanding <= 0) return error('This invoice has no outstanding balance', 409);
    const amount = moneyNumber(body.amount, 'Payment amount', { min: 0.01 });
    if (amount > parsed.outstanding + 0.005) return error('Payment amount exceeds the invoice outstanding balance', 422);

    const receivedDate = text(body.receivedDate, 10) || new Date().toISOString().slice(0, 10);
    const now = nowIso();
    const receiptId = makeId('rcp');
    await run(context.env.DB, `
      INSERT INTO payments (
        id, tenant_id, project_id, campaign_id, invoice_reference, payment_type,
        amount, currency, amount_base_currency, due_date, received_date, status,
        payment_method, wallet_or_bank_reference, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'INVOICE_RECEIPT', ?, ?, ?, NULL, ?, 'PAID', ?, ?, ?, ?, ?)
    `, [
      receiptId, tenantId, invoice.project_id, invoice.campaign_id, invoice.invoice_reference,
      amount, invoice.currency || 'USD', amount, receivedDate,
      text(body.paymentMethod, 200), text(body.reference, 1000),
      lifecyclePayload(RECEIPT_MARKER, { invoiceId, notes: text(body.notes, 5000), recordedBy: auth.userId, recordedAt: now }),
      now, now,
    ]);

    const totalReceived = roundMoney(parsed.received + amount);
    const outstanding = Math.max(0, roundMoney(parsed.total - totalReceived - parsed.credited));
    const fullySettled = outstanding <= 0.005;
    const invoiceStatus = fullySettled ? 'PAID' : parsed.credited > 0 ? 'PARTIALLY_CREDITED' : 'PARTIALLY_PAID';
    await run(context.env.DB, `
      UPDATE payments SET status = ?, received_date = CASE WHEN ? = 1 THEN ? ELSE received_date END,
        payment_method = COALESCE(?, payment_method), wallet_or_bank_reference = COALESCE(?, wallet_or_bank_reference),
        updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `, [invoiceStatus, fullySettled ? 1 : 0, receivedDate, text(body.paymentMethod, 200), text(body.reference, 1000), now, tenantId, invoiceId]);

    if (invoice.campaign_id) {
      const campaignTotals = await first(context.env.DB, `
        SELECT
          COALESCE(SUM(CASE WHEN payment_type = 'INVOICE' AND status NOT IN ('DRAFT','CANCELLED') THEN amount ELSE 0 END), 0) AS invoice_total,
          COALESCE(SUM(CASE WHEN payment_type = 'CREDIT_NOTE' THEN amount ELSE 0 END), 0) AS credit_total,
          COALESCE(SUM(CASE WHEN payment_type = 'INVOICE_RECEIPT' THEN amount ELSE 0 END), 0) AS received
        FROM payments
        WHERE tenant_id = ? AND campaign_id = ?
      `, [tenantId, invoice.campaign_id]);
      const invoiced = Math.max(0, roundMoney(Number(campaignTotals?.invoice_total || 0) - Number(campaignTotals?.credit_total || 0)));
      const received = roundMoney(campaignTotals?.received || 0);
      const paymentStatus = invoiced <= 0 ? 'NOT_INVOICED' : received <= 0 ? 'INVOICED' : received + 0.005 >= invoiced ? 'PAID' : 'PARTIALLY_PAID';
      await run(context.env.DB, `
        UPDATE campaigns SET amount_invoiced = ?, amount_received = ?, payment_status = ?, updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [invoiced, received, paymentStatus, now, auth.userId, tenantId, invoice.campaign_id]);
      if (fullySettled) {
        const referralDueInDays = Math.min(Math.max(Number(body.referralDueInDays ?? 7), 0), 365);
        await run(context.env.DB, `
          UPDATE referrals SET payment_status = 'DUE', due_date = COALESCE(due_date, ?), updated_at = ?
          WHERE tenant_id = ? AND campaign_id = ? AND payment_status IN ('ESTIMATED', 'CONFIRMED')
        `, [addDays(receivedDate, referralDueInDays), now, tenantId, invoice.campaign_id]);
      }
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'INVOICE_PAYMENT_RECORDED', 'INVOICE', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, invoiceId,
      JSON.stringify({ status: invoice.status, received: parsed.received, credited:parsed.credited }),
      JSON.stringify({ status: invoiceStatus, received: totalReceived, credited:parsed.credited, receiptId, amount }),
      now,
    ]);

    return json({ id: receiptId, invoiceId, invoiceStatus, amount, totalReceived, credited:parsed.credited, outstanding, referralStatus: fullySettled && invoice.campaign_id ? 'DUE' : null, created: true }, 201);
  } catch (cause) {
    console.error('Invoice payment allocation error', cause);
    return error(cause.message || 'Invoice payment could not be recorded', Number(cause.status || 500));
  }
}
