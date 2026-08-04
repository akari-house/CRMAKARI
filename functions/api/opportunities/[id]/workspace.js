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
const CLIENT_BILLING_MARKER = 'AKARI_CLIENT_BILLING_PROFILE_V1';
const CLIENT_REQUIRED_FIELDS = ['legalName', 'billingEmail', 'addressLine1', 'city', 'country'];
const ISSUER_REQUIRED_FIELDS = ['legalName', 'addressLine1', 'country'];

function fieldReadiness(profile = {}, requiredFields = []) {
  const missing = requiredFields.filter((field) => !String(profile?.[field] || '').trim());
  return { complete: missing.length === 0, missing };
}

function storedClientProfile(row, opportunity) {
  const metadata = parseJson(row?.description, {});
  const saved = metadata.recordType === CLIENT_BILLING_MARKER;
  const profile = saved ? (metadata.profile || {}) : {
    legalName: opportunity.project_name || null,
    billingEmail: opportunity.primary_contact_email || null,
    contactName: opportunity.primary_contact_name || null,
    country: opportunity.project_country || null,
    preferredCurrency: opportunity.currency || 'USD',
    defaultTaxMode: 'NONE',
    defaultTaxRate: 0,
    paymentTermsDays: 14,
  };
  return {
    profile,
    saved,
    updatedAt: saved ? (metadata.updatedAt || row?.occurred_at || row?.created_at || null) : null,
    readiness: fieldReadiness(profile, CLIENT_REQUIRED_FIELDS),
  };
}

function issuerProfile(row) {
  const flags = parseJson(row?.feature_flags_json, {});
  const profile = flags.billingProfile || {};
  return { profile, readiness: fieldReadiness(profile, ISSUER_REQUIRED_FIELDS) };
}

function buildCommercialReadiness({ opportunity, proposals, negotiations, engagements, finance, clientBilling, issuerBilling, canFinance }) {
  const acceptedProposal = proposals.some((item) => String(item.metadata?.status || item.outcome || '').toUpperCase() === 'ACCEPTED');
  const latestProposal = proposals[0] || null;
  const activeEngagement = engagements.find((item) => !['CANCELLED'].includes(String(item.status || '').toUpperCase())) || null;
  const invoiceEligibleEngagement = engagements.find((item) => item.invoiceEligible && !['CANCELLED'].includes(String(item.status || '').toUpperCase())) || null;
  const invoices = finance?.invoices || [];
  const outstanding = invoices.reduce((sum, item) => sum + Number(item.outstanding || 0), 0);
  const received = invoices.reduce((sum, item) => sum + Number(item.received || 0), 0);
  const won = String(opportunity.stage || '').toUpperCase() === 'WON';
  const lost = String(opportunity.stage || '').toUpperCase() === 'LOST';
  const qualified = qualificationComplete(opportunity);
  const clientReady = clientBilling.readiness.complete;
  const issuerReady = issuerBilling.readiness.complete;
  const invoiceReady = Boolean(
    canFinance &&
    won &&
    opportunity.project_lifecycle_status === 'CLIENT' &&
    invoiceEligibleEngagement &&
    clientReady &&
    issuerReady
  );

  let nextAction = 'Keep the opportunity moving with one clear next action.';
  let nextActionCode = 'UPDATE_NEXT_ACTION';
  if (!qualified && !lost) {
    nextAction = 'Complete qualification: need, decision-maker, timeline and budget.';
    nextActionCode = 'COMPLETE_QUALIFICATION';
  } else if (!proposals.length && !lost) {
    nextAction = 'Create the first commercial proposal.';
    nextActionCode = 'CREATE_PROPOSAL';
  } else if (!acceptedProposal && !won && !lost) {
    nextAction = latestProposal
      ? 'Record the proposal response and progress the commercial decision.'
      : 'Create and send the commercial proposal.';
    nextActionCode = 'PROGRESS_PROPOSAL';
  } else if (!won && !lost) {
    nextAction = negotiations.length ? 'Record the final decision or next negotiation step.' : 'Confirm final terms and close the deal.';
    nextActionCode = negotiations.length ? 'PROGRESS_NEGOTIATION' : 'CLOSE_DEAL';
  } else if (won && !clientReady) {
    nextAction = 'Complete the client billing profile before issuing an invoice.';
    nextActionCode = 'COMPLETE_CLIENT_BILLING';
  } else if (won && !activeEngagement) {
    nextAction = 'Create or restore the client engagement.';
    nextActionCode = 'CREATE_ENGAGEMENT';
  } else if (won && !issuerReady) {
    nextAction = 'Complete AKARI organisation billing details in Settings.';
    nextActionCode = 'COMPLETE_ISSUER_BILLING';
  } else if (won && invoiceEligibleEngagement && !invoices.length) {
    nextAction = 'Issue the first invoice from the won engagement.';
    nextActionCode = 'CREATE_INVOICE';
  } else if (won && outstanding > 0) {
    nextAction = 'Collect or reconcile the outstanding invoice balance.';
    nextActionCode = 'COLLECT_PAYMENT';
  } else if (won && invoices.length && outstanding <= 0) {
    nextAction = 'Confirm delivery, referral obligations and renewal follow-up.';
    nextActionCode = 'COMPLETE_COMMERCIAL_CYCLE';
  } else if (lost) {
    nextAction = 'Preserve the loss reason and future relationship action.';
    nextActionCode = 'REVIEW_LOSS';
  }

  return {
    qualified,
    proposalRecorded: proposals.length > 0,
    proposalAccepted: acceptedProposal,
    negotiationRecorded: negotiations.length > 0,
    won,
    lost,
    clientConverted: opportunity.project_lifecycle_status === 'CLIENT',
    engagementReady: Boolean(activeEngagement),
    invoiceEligible: Boolean(invoiceEligibleEngagement),
    clientBillingReady: clientReady,
    clientBillingMissing: clientBilling.readiness.missing,
    issuerBillingReady: issuerReady,
    issuerBillingMissing: issuerBilling.readiness.missing,
    invoiceReady,
    invoiceCount: invoices.length,
    received,
    outstanding,
    nextAction,
    nextActionCode,
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '');
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.name AS project_name, p.lifecycle_status AS project_lifecycle_status,
             p.customer_since, p.country AS project_country,
             p.referral_partner_id AS project_referral_partner_id,
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

    const [activityRows, engagementRows, clientBillingRow, tenantSettingsRow] = await Promise.all([
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
      first(context.env.DB, `
        SELECT id, user_id, description, outcome, occurred_at, created_at
        FROM activities
        WHERE tenant_id = ?
          AND project_id = ?
          AND activity_type = 'CLIENT_BILLING_PROFILE'
          AND description LIKE '%\"recordType\":\"AKARI_CLIENT_BILLING_PROFILE_V1\"%'
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 1
      `, [tenantId, opportunity.project_id]),
      first(context.env.DB, `
        SELECT feature_flags_json
        FROM tenant_settings
        WHERE tenant_id = ?
        LIMIT 1
      `, [tenantId]),
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

    const clientBilling = storedClientProfile(clientBillingRow, opportunity);
    const issuerBilling = issuerProfile(tenantSettingsRow);
    const commercialReadiness = buildCommercialReadiness({
      opportunity,
      proposals,
      negotiations,
      engagements,
      finance,
      clientBilling,
      issuerBilling,
      canFinance: canViewFinance(auth),
    });

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
      clientBilling,
      issuerBilling: {
        readiness: issuerBilling.readiness,
      },
      commercialReadiness,
      permissions: {
        canWrite: WRITE_ROLES.has(auth?.role),
        canFinance: canViewFinance(auth),
        canApproveProposal: ['OWNER','ADMIN','BD_MANAGER'].includes(auth?.role),
        canEditClientBilling: ['OWNER','ADMIN','BD_MANAGER','FINANCE'].includes(auth?.role),
      },
    });
  } catch (cause) {
    console.error('Revenue lifecycle workspace error', cause);
    return error(cause.message || 'Revenue lifecycle could not be loaded', Number(cause.status || 500));
  }
}
