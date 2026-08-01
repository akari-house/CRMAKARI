import { json, error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseInvoice, parseJson, parseProposal, roundMoney } from '../../lib/commercial-hardening.js';

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    if (!canViewFinance(auth)) return error('Finance permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({ metrics:{}, invoices:[], referrals:[], proposals:[], demo:true });
    const url = new URL(context.request.url);
    const opportunityId = String(url.searchParams.get('opportunityId') || '').trim();
    const projectId = String(url.searchParams.get('projectId') || '').trim();
    const invoiceConditions = ['pay.tenant_id = ?', "pay.payment_type = 'INVOICE'", "pay.notes LIKE '%\"recordType\":\"INVOICE_V1\"%'"];
    const invoiceBindings = [tenantId];
    if (projectId) { invoiceConditions.push('pay.project_id = ?'); invoiceBindings.push(projectId); }
    if (opportunityId) { invoiceConditions.push('pay.notes LIKE ?'); invoiceBindings.push(`%\"opportunityId\":\"${opportunityId}\"%`); }

    const [invoiceRows, relatedRows, referralRows, proposalRows] = await Promise.all([
      all(context.env.DB, `
        SELECT pay.*, p.name AS project_name
        FROM payments pay
        JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
        WHERE ${invoiceConditions.join(' AND ')}
        ORDER BY COALESCE(pay.due_date, pay.created_at) ASC
        LIMIT 500
      `, invoiceBindings),
      all(context.env.DB, `
        SELECT * FROM payments
        WHERE tenant_id = ? AND payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')
        ORDER BY created_at DESC LIMIT 2000
      `, [tenantId]),
      all(context.env.DB, `
        SELECT r.*, pt.name AS partner_name, pr.name AS project_name, c.name AS engagement_name
        FROM referrals r
        JOIN partners pt ON pt.id = r.partner_id AND pt.tenant_id = r.tenant_id
        JOIN projects pr ON pr.id = r.project_id AND pr.tenant_id = r.tenant_id
        LEFT JOIN campaigns c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
        WHERE r.tenant_id = ?
          ${projectId ? 'AND r.project_id = ?' : ''}
          ${opportunityId ? 'AND r.opportunity_id = ?' : ''}
        ORDER BY CASE r.payment_status WHEN 'DUE' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'PAID' THEN 3 ELSE 4 END, r.updated_at DESC
        LIMIT 500
      `, [tenantId, ...(projectId ? [projectId] : []), ...(opportunityId ? [opportunityId] : [])]),
      all(context.env.DB, `
        SELECT a.* FROM activities a
        WHERE a.tenant_id = ? AND a.activity_type = 'PROPOSAL'
          AND a.description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
          ${opportunityId ? 'AND a.opportunity_id = ?' : ''}
          ${projectId ? 'AND a.project_id = ?' : ''}
        ORDER BY a.occurred_at DESC LIMIT 500
      `, [tenantId, ...(opportunityId ? [opportunityId] : []), ...(projectId ? [projectId] : [])]),
    ]);
    const receipts = relatedRows.filter((row) => row.payment_type === 'INVOICE_RECEIPT');
    const credits = relatedRows.filter((row) => row.payment_type === 'CREDIT_NOTE');
    const today = new Date().toISOString().slice(0, 10);
    const invoices = invoiceRows.map((row) => {
      const item = parseInvoice(row, receipts, credits);
      item.isOverdue = item.outstanding > 0 && Boolean(item.dueDate && item.dueDate < today) && !['DRAFT','CANCELLED','CREDITED'].includes(item.status);
      item.displayStatus = item.isOverdue ? 'OVERDUE' : item.status;
      return item;
    });
    const referrals = referralRows.map((row) => ({
      id:row.id,
      partnerId:row.partner_id,
      partnerName:row.partner_name,
      projectName:row.project_name,
      engagementName:row.engagement_name,
      revenueBasis:Number(row.revenue_basis || 0),
      percentage:Number(row.referral_percentage || 0),
      amount:Number(row.referral_amount || 0),
      currency:row.currency || 'USD',
      status:row.payment_status,
      dueDate:row.due_date,
      paidDate:row.paid_date,
      transactionReference:row.transaction_reference,
    }));
    const proposals = proposalRows.map(parseProposal);
    const billable = invoices.filter((item) => !['DRAFT','CANCELLED'].includes(item.status));
    const metrics = {
      invoiced:roundMoney(billable.reduce((sum, item) => sum + item.total - item.credited, 0)),
      collected:roundMoney(invoices.reduce((sum, item) => sum + item.received, 0)),
      outstanding:roundMoney(invoices.reduce((sum, item) => sum + item.outstanding, 0)),
      overdue:roundMoney(invoices.filter((item) => item.isOverdue).reduce((sum, item) => sum + item.outstanding, 0)),
      draftInvoices:invoices.filter((item) => item.status === 'DRAFT').length,
      overdueInvoices:invoices.filter((item) => item.isOverdue).length,
      referralDue:roundMoney(referrals.filter((item) => item.status === 'DUE').reduce((sum, item) => sum + item.amount, 0)),
      proposalReview:proposals.filter((item) => item.status === 'INTERNAL_REVIEW').length,
      proposalApproved:proposals.filter((item) => item.status === 'APPROVED').length,
    };
    return json({ metrics, invoices, referrals, proposals, currency:'USD' });
  } catch (cause) {
    console.error('Commercial overview error', cause);
    return error(cause.message || 'Commercial overview could not be loaded', Number(cause.status || 500));
  }
}
