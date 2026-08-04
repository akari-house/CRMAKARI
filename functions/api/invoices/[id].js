import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { lifecyclePayload, text } from '../../lib/revenue-lifecycle.js';
import { CREDIT_NOTE_MARKER, INVOICE_MARKER, parseInvoice, parseJson, roundMoney } from '../../lib/commercial-hardening.js';

const RECEIPT_MARKER = 'AKARI_INVOICE_RECEIPT_V1';

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
      AND pay.notes LIKE '%\"recordType\":\"INVOICE_V1\"%'
    LIMIT 1
  `, [tenantId, id]);
}

async function relatedRows(db, tenantId, invoice) {
  const rows = await all(db, `
    SELECT * FROM payments
    WHERE tenant_id = ? AND project_id = ? AND payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')
    ORDER BY created_at DESC
  `, [tenantId, invoice.project_id]);
  const receipts = rows.filter((row) => row.payment_type === 'INVOICE_RECEIPT' && row.invoice_reference === invoice.invoice_reference);
  const credits = rows.filter((row) => {
    if (row.payment_type !== 'CREDIT_NOTE') return false;
    const metadata = parseJson(row.notes, {});
    return metadata.invoiceId === invoice.id || metadata.invoiceNumber === invoice.invoice_reference;
  });
  return { receipts, credits };
}

async function syncEngagement(db, tenantId, campaignId, auth, now) {
  if (!campaignId) return { invoiced: 0, received: 0, status: 'NOT_INVOICED' };
  const totals = await first(db, `
    SELECT
      COALESCE(SUM(CASE WHEN payment_type = 'INVOICE' AND status != 'CANCELLED' THEN amount ELSE 0 END), 0) AS invoice_total,
      COALESCE(SUM(CASE WHEN payment_type = 'CREDIT_NOTE' THEN amount ELSE 0 END), 0) AS credit_total,
      COALESCE(SUM(CASE WHEN payment_type = 'INVOICE_RECEIPT' THEN amount ELSE 0 END), 0) AS received_total
    FROM payments
    WHERE tenant_id = ? AND campaign_id = ?
  `, [tenantId, campaignId]);
  const invoiced = Math.max(0, roundMoney(Number(totals?.invoice_total || 0) - Number(totals?.credit_total || 0)));
  const received = roundMoney(totals?.received_total || 0);
  const status = invoiced <= 0 ? 'NOT_INVOICED' : received <= 0 ? 'INVOICED' : received + 0.005 >= invoiced ? 'PAID' : 'PARTIALLY_PAID';
  await run(db, `
    UPDATE campaigns SET amount_invoiced = ?, amount_received = ?, payment_status = ?, updated_at = ?, updated_by = ?
    WHERE tenant_id = ? AND id = ?
  `, [invoiced, received, status, now, auth.userId, tenantId, campaignId]);
  return { invoiced, received, status };
}

async function releaseReferralRewards(db, tenantId, campaignId, received, auth, now) {
  if (!campaignId || received <= 0) return [];
  const rewards = await all(db, `
    SELECT id, payment_status, due_date
    FROM referrals
    WHERE tenant_id = ? AND campaign_id = ?
      AND payment_status IN ('ESTIMATED','CONFIRMED')
  `, [tenantId, campaignId]);
  const released = [];
  for (const reward of rewards) {
    const dueDate = reward.due_date || now.slice(0, 10);
    await run(db, `
      UPDATE referrals
      SET payment_status = 'DUE', due_date = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ? AND payment_status IN ('ESTIMATED','CONFIRMED')
    `, [dueDate, now, tenantId, reward.id]);
    await run(db, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'REFERRAL_REWARD_DUE', 'REFERRAL', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, reward.id,
      JSON.stringify({ status: reward.payment_status, dueDate: reward.due_date }),
      JSON.stringify({ status: 'DUE', dueDate, trigger: 'CLIENT_PAYMENT_RECEIVED', campaignId }),
      now,
    ]);
    released.push(reward.id);
  }
  return released;
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadInvoice(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Invoice not found', 404);
    const { receipts, credits } = await relatedRows(context.env.DB, tenantId, row);
    return json({
      item: parseInvoice(row, receipts, credits),
      receipts: receipts.map((item) => {
        const meta = parseJson(item.notes, {});
        return {
          id: item.id,
          amount: Number(item.amount || 0),
          receivedDate: item.received_date,
          paymentMethod: item.payment_method,
          reference: item.wallet_or_bank_reference,
          transactionHash: meta.transactionHash || null,
          notes: meta.notes || null,
          createdAt: item.created_at,
        };
      }),
      credits: credits.map((item) => {
        const meta = parseJson(item.notes, {});
        return {
          id: item.id,
          reference: item.invoice_reference,
          amount: Number(item.amount || 0),
          reason: meta.reason || null,
          issuedAt: meta.issuedAt || item.created_at,
          transactionReference: item.wallet_or_bank_reference || null,
        };
      }),
    });
  } catch (cause) {
    return error(cause.message || 'Invoice could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = String(body.action || '').toLowerCase();
    if (!context.env.DB) return json({ updated: true, action, demo: true });
    const row = await loadInvoice(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Invoice not found', 404);
    const { receipts, credits } = await relatedRows(context.env.DB, tenantId, row);
    const invoice = parseInvoice(row, receipts, credits);
    const now = nowIso();
    let result = {};

    if (action === 'issue') {
      if (row.status !== 'DRAFT') return error('Only a draft invoice can be issued', 409);
      const dueDate = text(body.dueDate, 10) || row.due_date;
      if (!dueDate) return error('Due date is required before issuing an invoice', 422);
      await run(context.env.DB, `UPDATE payments SET status = 'INVOICED', due_date = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`, [dueDate, now, tenantId, row.id]);
      result = { status: 'INVOICED', dueDate };
    } else if (action === 'receipt') {
      if (['DRAFT', 'CANCELLED', 'CREDITED'].includes(String(row.status || '').toUpperCase())) {
        return error('This invoice cannot receive a payment', 409);
      }
      const amount = roundMoney(body.amount);
      const receivedDate = text(body.receivedDate, 10) || now.slice(0, 10);
      const paymentMethod = text(body.paymentMethod, 200);
      const reference = text(body.reference, 1000);
      const transactionHash = text(body.transactionHash, 1000);
      const receiptNotes = text(body.notes, 5000);
      if (!Number.isFinite(amount) || amount <= 0) return error('Payment amount must be greater than zero', 422);
      if (!paymentMethod) return error('Payment method is required', 422);
      if (!reference && !transactionHash) return error('Payment reference or transaction hash is required', 422);
      if (amount > invoice.outstanding + 0.005) return error('Payment exceeds the outstanding invoice balance', 422);

      const receiptId = makeId('rcp');
      await run(context.env.DB, `
        INSERT INTO payments (
          id, tenant_id, project_id, campaign_id, invoice_reference, payment_type,
          amount, currency, amount_base_currency, received_date, status,
          payment_method, wallet_or_bank_reference, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'INVOICE_RECEIPT', ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?)
      `, [
        receiptId, tenantId, row.project_id, row.campaign_id, row.invoice_reference,
        amount, row.currency || 'USD', amount, receivedDate,
        paymentMethod, reference || transactionHash,
        lifecyclePayload(RECEIPT_MARKER, {
          invoiceId: row.id,
          invoiceNumber: row.invoice_reference,
          transactionHash,
          notes: receiptNotes,
          recordedBy: auth.userId,
          recordedAt: now,
        }),
        now, now,
      ]);

      const received = roundMoney(invoice.received + amount);
      const outstanding = Math.max(0, roundMoney(invoice.total - invoice.credited - received));
      const status = outstanding <= 0.005 ? 'PAID' : 'PARTIALLY_PAID';
      await run(context.env.DB, `
        UPDATE payments
        SET status = ?, received_date = CASE WHEN ? = 'PAID' THEN ? ELSE received_date END, updated_at = ?
        WHERE tenant_id = ? AND id = ?
      `, [status, status, receivedDate, now, tenantId, row.id]);
      result = { status, receiptId, received, outstanding, receivedDate };
    } else if (action === 'cancel') {
      const reason = text(body.reason, 2000);
      if (!reason) return error('Cancellation reason is required', 422);
      if (invoice.received > 0 || invoice.credited > 0) return error('An invoice with receipts or credit notes cannot be cancelled', 409);
      if (row.status === 'PAID' || row.status === 'CANCELLED') return error('This invoice cannot be cancelled', 409);
      const metadata = { ...parseJson(row.notes, {}), recordType: INVOICE_MARKER, cancellationReason: reason, cancelledAt: now, cancelledBy: auth.userId };
      await run(context.env.DB, `UPDATE payments SET status = 'CANCELLED', notes = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`, [JSON.stringify(metadata), now, tenantId, row.id]);
      result = { status: 'CANCELLED', reason };
    } else if (action === 'credit') {
      const amount = roundMoney(body.amount);
      const reason = text(body.reason, 2000);
      if (!reason) return error('Credit-note reason is required', 422);
      if (!Number.isFinite(amount) || amount <= 0) return error('Credit-note amount must be greater than zero', 422);
      if (['DRAFT', 'CANCELLED'].includes(row.status)) return error('This invoice cannot receive a credit note', 409);
      const available = roundMoney(invoice.total - invoice.credited - invoice.received);
      if (amount > available + 0.005) return error('Credit-note amount exceeds the remaining creditable balance', 422);
      const count = await first(context.env.DB, `SELECT COUNT(*) AS value FROM payments WHERE tenant_id = ? AND payment_type = 'CREDIT_NOTE' AND notes LIKE ?`, [tenantId, `%\"invoiceId\":\"${row.id}\"%`]);
      const reference = `CN-${row.invoice_reference}-${String(Number(count?.value || 0) + 1).padStart(2, '0')}`;
      const creditId = makeId('crn');
      await run(context.env.DB, `
        INSERT INTO payments (
          id, tenant_id, project_id, campaign_id, invoice_reference, payment_type,
          amount, currency, amount_base_currency, received_date, status,
          wallet_or_bank_reference, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'CREDIT_NOTE', ?, ?, ?, ?, 'CREDITED', ?, ?, ?, ?)
      `, [
        creditId, tenantId, row.project_id, row.campaign_id, reference,
        amount, row.currency || 'USD', amount, text(body.issuedDate, 10) || now.slice(0, 10),
        text(body.reference, 1000), lifecyclePayload(CREDIT_NOTE_MARKER, { invoiceId: row.id, invoiceNumber: row.invoice_reference, reason, issuedAt: now, issuedBy: auth.userId }), now, now,
      ]);
      const credited = roundMoney(invoice.credited + amount);
      const remaining = Math.max(0, roundMoney(invoice.total - invoice.received - credited));
      const status = remaining <= 0.005 ? 'CREDITED' : 'PARTIALLY_CREDITED';
      await run(context.env.DB, `UPDATE payments SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`, [status, now, tenantId, row.id]);
      result = { status, creditId, creditReference: reference, credited, outstanding: remaining };
    } else if (action === 'reminder') {
      if (invoice.outstanding <= 0 || ['CANCELLED', 'CREDITED'].includes(row.status)) return error('This invoice has no collectible outstanding balance', 409);
      const dueAt = text(body.dueAt, 100) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const taskId = makeId('tsk');
      await run(context.env.DB, `
        INSERT INTO tasks (id, tenant_id, title, description, owner_user_id, created_by, status, priority, due_at, project_id, campaign_id, activity_type, show_on_home, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'TODO', ?, ?, ?, ?, 'PAYMENT_FOLLOW_UP', 1, ?, ?)
      `, [
        taskId, tenantId, `Follow up ${row.invoice_reference}`, text(body.notes, 5000) || `${invoice.projectName || 'Client'} has ${invoice.outstanding} ${invoice.currency} outstanding.`,
        text(body.ownerUserId, 120) || auth.userId, auth.userId, String(body.priority || 'HIGH').toUpperCase(), dueAt, row.project_id, row.campaign_id, now, now,
      ]);
      result = { taskId, reminderCreated: true };
    } else {
      return error('Invoice action is not supported', 404);
    }

    const engagement = await syncEngagement(context.env.DB, tenantId, row.campaign_id, auth, now);
    if (action === 'receipt') {
      result.referralRewardsDue = await releaseReferralRewards(context.env.DB, tenantId, row.campaign_id, engagement.received, auth, now);
    }
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, ?, 'INVOICE', ?, ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, `INVOICE_${action.toUpperCase()}`, row.id, JSON.stringify({ status: row.status, outstanding: invoice.outstanding }), JSON.stringify(result), now]);
    return json({ updated: true, action, ...result });
  } catch (cause) {
    console.error('Invoice action error', cause);
    return error(cause.message || 'Invoice action failed', Number(cause.status || 500));
  }
}
