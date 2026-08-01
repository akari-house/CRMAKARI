import { json, error } from '../../../lib/response.js';
import { all, first } from '../../../lib/db.js';
import { requireTenant, canViewFinance } from '../../../lib/permissions.js';
import {
  PROPOSAL_MARKER,
  NEGOTIATION_MARKER,
  CLOSE_MARKER,
  parseLifecycleActivity,
  parseEngagement,
  qualificationComplete,
  parseJson,
} from '../../../lib/revenue-lifecycle.js';
import { parseInvoice } from '../../../lib/commercial-hardening.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '');
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.name AS project_name, p.lifecycle_status AS project_lifecycle_status,
             p.customer_since, p.referral_partner_id AS project_referral_partner_id,
             p.owner_user_id AS project_owner_user_id,
             c.full_name AS primary_contact_name, c.email AS primary_contact_email,
             u.full_name AS owner_name,
             rp.name AS referral_partner_name,
             rp.default_referral_percentage
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      LEFT JOIN contacts c ON c.id = o.primary_contact_id AND c.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = o.owner_user_id
      LEFT JOIN partners rp ON rp.id = COALESCE(o.referral_partner_id, p.referral_partner_id)
                           AND rp.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND o.id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (!opportunity) return error('Opportunity not found', 404);

    const [activityRows, engagementRows] = await Promise.all([
      all(context.env.DB, `
        SELECT * FROM activities
        WHERE tenant_id = ? AND opportunity_id = ?
          AND activity_type IN ('PROPOSAL', 'NEGOTIATION', 'DEAL_CLOSED')
        ORDER BY occurred_at DESC, created_at DESC
      `, [tenantId, opportunityId]),
      all(context.env.DB, `
        SELECT * FROM campaigns
        WHERE tenant_id = ? AND opportunity_id = ?
        ORDER BY created_at DESC
      `, [tenantId, opportunityId]),
    ]);

    const activities = activityRows.map(parseLifecycleActivity);
    const proposals = activities.filter((item) => item.metadata?.recordType === PROPOSAL_MARKER);
    const negotiations = activities.filter((item) => item.metadata?.recordType === NEGOTIATION_MARKER);
    const closures = activities.filter((item) => item.metadata?.recordType === CLOSE_MARKER);
    const engagements = engagementRows.map(parseEngagement);

    let finance = null;
    if (canViewFinance(auth)) {
      const [invoiceRows, relatedRows, referralRows] = await Promise.all([
        all(context.env.DB, `
          SELECT pay.*, p.name AS project_name
          FROM payments pay
          JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
          WHERE pay.tenant_id = ? AND pay.project_id = ?
            AND pay.payment_type = 'INVOICE'
            AND (pay.campaign_id IN (SELECT id FROM campaigns WHERE tenant_id = ? AND opportunity_id = ?)
                 OR pay.notes LIKE ?)
          ORDER BY pay.created_at DESC
        `, [tenantId, opportunity.project_id, tenantId, opportunityId, `%\"opportunityId\":\"${opportunityId}\"%`]),
        all(context.env.DB, `
          SELECT * FROM payments
          WHERE tenant_id = ? AND project_id = ? AND payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')
          ORDER BY COALESCE(received_date, created_at) DESC
        `, [tenantId, opportunity.project_id]),
        all(context.env.DB, `
          SELECT r.*, p.name AS partner_name
          FROM referrals r
          JOIN partners p ON p.id = r.partner_id AND p.tenant_id = r.tenant_id
          WHERE r.tenant_id = ? AND r.opportunity_id = ?
          ORDER BY r.created_at DESC
        `, [tenantId, opportunityId]),
      ]);
      const receipts = relatedRows.filter((row) => row.payment_type === 'INVOICE_RECEIPT');
      const credits = relatedRows.filter((row) => row.payment_type === 'CREDIT_NOTE');
      finance = {
        invoices: invoiceRows.map((row) => parseInvoice(row, receipts, credits)),
        receipts: receipts.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoice_reference,
          amount: Number(row.amount || 0),
          currency: row.currency || 'USD',
          receivedDate: row.received_date,
          method: row.payment_method,
          reference: row.wallet_or_bank_reference,
          createdAt: row.created_at,
        })),
        credits: credits.map((row) => {
          const metadata = parseJson(row.notes, {});
          return {
            id:row.id,
            invoiceId:metadata.invoiceId,
            invoiceNumber:metadata.invoiceNumber,
            creditNumber:row.invoice_reference,
            amount:Number(row.amount || 0),
            currency:row.currency || 'USD',
            reason:metadata.reason || null,
            issuedAt:metadata.issuedAt || row.created_at,
          };
        }),
        referrals: referralRows.map((row) => ({
          id: row.id,
          partnerId: row.partner_id,
          partnerName: row.partner_name,
          engagementId: row.campaign_id,
          revenueBasis: Number(row.revenue_basis || 0),
          percentage: Number(row.referral_percentage || 0),
          amount: Number(row.referral_amount || 0),
          currency: row.currency || 'USD',
          status: row.payment_status,
          dueDate: row.due_date,
          paidDate: row.paid_date,
          transactionReference: row.transaction_reference,
        })),
      };
    }

    return json({
      opportunity: {
        ...opportunity,
        qualificationComplete: qualificationComplete(opportunity),
      },
      proposals,
      negotiations,
      closures,
      engagements,
      finance,
      permissions: {
        canWrite: WRITE_ROLES.has(auth?.role),
        canFinance: canViewFinance(auth),
        canApproveProposal: ['OWNER','ADMIN','BD_MANAGER'].includes(auth?.role),
      },
    });
  } catch (cause) {
    console.error('Revenue lifecycle workspace error', cause);
    return error(cause.message || 'Revenue lifecycle could not be loaded', Number(cause.status || 500));
  }
}
