import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';

const ALLOWED_STATUSES = new Set(['DRAFT', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']);
const text = (value, max = 5000) => value === null || value === undefined ? null : (String(value).trim().slice(0, max) || null);

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const permissionError = new Error('Finance permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function parseNotes(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function publicInvoice(row) {
  const metadata = parseNotes(row.notes);
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectWebsite: row.project_website,
    invoiceNumber: row.invoice_reference,
    invoiceDate: metadata.invoiceDate || row.created_at?.slice(0, 10),
    dueDate: row.due_date,
    receivedDate: row.received_date,
    status: row.status,
    currency: row.currency || 'USD',
    subtotal: Number(metadata.subtotal ?? row.amount ?? 0),
    taxRate: Number(metadata.taxRate || 0),
    taxAmount: Number(metadata.taxAmount || 0),
    total: Number(metadata.total ?? row.amount ?? 0),
    recipient: metadata.recipient || { name: row.project_name },
    issuer: metadata.issuer || {},
    lineItems: metadata.lineItems || [],
    taxLabel: metadata.taxLabel || null,
    notes: metadata.notes || null,
    paymentInstructions: metadata.paymentInstructions || null,
    paymentMethod: row.payment_method,
    paymentReference: row.wallet_or_bank_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadInvoice(context, tenantId, id) {
  return first(context.env.DB, `
    SELECT pay.*, p.name AS project_name, p.website AS project_website
    FROM payments pay
    JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
    WHERE pay.tenant_id = ? AND pay.id = ?
      AND (pay.payment_type = 'INVOICE' OR pay.notes LIKE '%\"recordType\":\"INVOICE_V1\"%')
    LIMIT 1
  `, [tenantId, id]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('Invoice not found', 404);
    const row = await loadInvoice(context, tenantId, context.params.id);
    if (!row) return error('Invoice not found', 404);
    return json(publicInvoice(row));
  } catch (cause) {
    return error(cause.message || 'Invoice could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    const id = context.params.id;
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id, updated: true, demo: true });
    const existing = await loadInvoice(context, tenantId, id);
    if (!existing) return error('Invoice not found', 404);

    const status = body.status ? String(body.status).toUpperCase() : existing.status;
    if (!ALLOWED_STATUSES.has(status)) return error('Invoice status is invalid', 422);
    const dueDate = body.dueDate === undefined ? existing.due_date : text(body.dueDate, 10);
    let receivedDate = body.receivedDate === undefined ? existing.received_date : text(body.receivedDate, 10);
    if (status === 'PAID' && !receivedDate) receivedDate = new Date().toISOString().slice(0, 10);
    if (status !== 'PAID' && body.receivedDate === null) receivedDate = null;
    const now = nowIso();

    await run(context.env.DB, `
      UPDATE payments SET
        status = ?, due_date = ?, received_date = ?,
        payment_method = COALESCE(?, payment_method),
        wallet_or_bank_reference = COALESCE(?, wallet_or_bank_reference),
        updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      status, dueDate, receivedDate,
      text(body.paymentMethod, 200), text(body.reference, 1000),
      now, tenantId, id,
    ]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'INVOICE_STATUS_UPDATED', 'INVOICE', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, id,
      JSON.stringify({ status: existing.status, dueDate: existing.due_date, receivedDate: existing.received_date }),
      JSON.stringify({ status, dueDate, receivedDate }),
      now,
    ]);
    return json({ id, status, dueDate, receivedDate, updated: true });
  } catch (cause) {
    console.error('AKARI invoice update error', cause);
    return error(cause.message || 'Invoice could not be updated', Number(cause.status || 500));
  }
}
