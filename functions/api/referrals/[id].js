import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { text } from '../../lib/revenue-lifecycle.js';

const STATUSES = new Set(['ESTIMATED', 'CONFIRMED', 'DUE', 'PAID', 'DISPUTED', 'CANCELLED']);

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const permissionError = new Error('Finance permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    const id = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id, updated: true, demo: true });
    const existing = await first(context.env.DB, `
      SELECT r.*, p.name AS partner_name
      FROM referrals r
      JOIN partners p ON p.id = r.partner_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.id = ?
      LIMIT 1
    `, [tenantId, id]);
    if (!existing) return error('Referral reward not found', 404);

    const status = body.status ? String(body.status).toUpperCase() : existing.payment_status;
    if (!STATUSES.has(status)) return error('Referral reward status is invalid', 422);
    const transactionReference = body.transactionReference === undefined
      ? existing.transaction_reference
      : text(body.transactionReference, 1000);
    let paidDate = body.paidDate === undefined ? existing.paid_date : text(body.paidDate, 10);
    if (status === 'PAID' && !transactionReference) return error('Transaction or payment reference is required when a referral reward is paid', 422);
    if (status === 'PAID' && !paidDate) paidDate = new Date().toISOString().slice(0, 10);
    if (status !== 'PAID' && body.paidDate === null) paidDate = null;
    const dueDate = body.dueDate === undefined ? existing.due_date : text(body.dueDate, 10);
    const notes = body.notes === undefined ? existing.notes : text(body.notes, 5000);
    const now = nowIso();

    await run(context.env.DB, `
      UPDATE referrals SET payment_status = ?, due_date = ?, paid_date = ?,
        transaction_reference = ?, notes = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `, [status, dueDate, paidDate, transactionReference, notes, now, tenantId, id]);

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'REFERRAL_REWARD_UPDATED', 'REFERRAL', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, id,
      JSON.stringify({ status: existing.payment_status, dueDate: existing.due_date, paidDate: existing.paid_date, transactionReference: existing.transaction_reference }),
      JSON.stringify({ status, dueDate, paidDate, transactionReference }),
      now,
    ]);

    return json({
      id,
      partnerName: existing.partner_name,
      amount: Number(existing.referral_amount || 0),
      currency: existing.currency || 'USD',
      status,
      dueDate,
      paidDate,
      transactionReference,
      updated: true,
    });
  } catch (cause) {
    console.error('Referral reward update error', cause);
    return error(cause.message || 'Referral reward could not be updated', Number(cause.status || 500));
  }
}
