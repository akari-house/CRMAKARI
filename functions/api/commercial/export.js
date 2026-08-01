import { error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { csvEscape, parseInvoice, parseJson } from '../../lib/commercial-hardening.js';

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    if (!canViewFinance(auth)) return error('Finance permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const url = new URL(context.request.url);
    const type = String(url.searchParams.get('type') || 'invoices').toLowerCase();
    let rows = [];
    let filename = '';

    if (type === 'referrals') {
      const items = await all(context.env.DB, `
        SELECT r.*, pt.name AS partner_name, pr.name AS project_name, c.name AS engagement_name
        FROM referrals r
        JOIN partners pt ON pt.id = r.partner_id AND pt.tenant_id = r.tenant_id
        JOIN projects pr ON pr.id = r.project_id AND pr.tenant_id = r.tenant_id
        LEFT JOIN campaigns c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
        WHERE r.tenant_id = ? ORDER BY r.updated_at DESC
      `, [tenantId]);
      rows.push(['Partner','Project','Engagement','Revenue basis','Referral %','Reward','Currency','Status','Due date','Paid date','Transaction reference']);
      items.forEach((item) => rows.push([item.partner_name,item.project_name,item.engagement_name,item.revenue_basis,item.referral_percentage,item.referral_amount,item.currency,item.payment_status,item.due_date,item.paid_date,item.transaction_reference]));
      filename = `akari-referral-statements-${new Date().toISOString().slice(0,10)}.csv`;
    } else {
      const [invoiceRows, relatedRows] = await Promise.all([
        all(context.env.DB, `
          SELECT pay.*, p.name AS project_name FROM payments pay
          JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
          WHERE pay.tenant_id = ? AND pay.payment_type = 'INVOICE'
            AND pay.notes LIKE '%\"recordType\":\"INVOICE_V1\"%'
          ORDER BY pay.created_at DESC
        `, [tenantId]),
        all(context.env.DB, `SELECT * FROM payments WHERE tenant_id = ? AND payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')`, [tenantId]),
      ]);
      const receipts = relatedRows.filter((item) => item.payment_type === 'INVOICE_RECEIPT');
      const credits = relatedRows.filter((item) => item.payment_type === 'CREDIT_NOTE');
      rows.push(['Invoice','Client','Issue date','Due date','Status','Currency','Subtotal','Tax','Total','Credited','Received','Outstanding','Engagement ID','Opportunity ID']);
      invoiceRows.map((row) => parseInvoice(row, receipts, credits)).forEach((item) => rows.push([item.invoiceNumber,item.projectName,item.invoiceDate,item.dueDate,item.status,item.currency,item.subtotal,item.taxAmount,item.total,item.credited,item.received,item.outstanding,item.engagementId,item.opportunityId]));
      rows.push([]);
      rows.push(['Receipt reference','Invoice','Client','Received date','Method','Amount','Currency']);
      receipts.forEach((item) => rows.push([item.wallet_or_bank_reference,item.invoice_reference,invoiceRows.find((row) => row.invoice_reference === item.invoice_reference)?.project_name || '',item.received_date,item.payment_method,item.amount,item.currency]));
      rows.push([]);
      rows.push(['Credit note','Invoice','Reason','Issue date','Amount','Currency']);
      credits.forEach((item) => { const meta = parseJson(item.notes, {}); rows.push([item.invoice_reference,meta.invoiceNumber,meta.reason,meta.issuedAt,item.amount,item.currency]); });
      filename = `akari-invoice-ledger-${new Date().toISOString().slice(0,10)}.csv`;
    }

    const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`;
    return new Response(csv, { headers: { 'content-type':'text/csv; charset=utf-8', 'content-disposition':`attachment; filename="${filename}"`, 'cache-control':'private, no-store', 'x-content-type-options':'nosniff' } });
  } catch (cause) {
    return error(cause.message || 'Commercial export could not be generated', Number(cause.status || 500));
  }
}
