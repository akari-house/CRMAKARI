import { parseJson, text } from './revenue-lifecycle.js';

export { parseJson };
export const INVOICE_MARKER = 'INVOICE_V1';
export const CREDIT_NOTE_MARKER = 'AKARI_CREDIT_NOTE_V1';
export const PROPOSAL_STATUSES = new Set(['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']);
export const INVOICE_STATUSES = new Set(['DRAFT', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'PARTIALLY_CREDITED', 'CREDITED']);

export const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function parseProposal(row) {
  const metadata = parseJson(row?.description, {});
  return {
    id: row?.id,
    opportunityId: row?.opportunity_id,
    projectId: row?.project_id,
    subject: row?.subject,
    status: String(metadata.status || row?.outcome || 'DRAFT').toUpperCase(),
    version: Number(metadata.version || 1),
    title: metadata.title || row?.subject || 'Proposal',
    serviceType: metadata.serviceType || null,
    commercialModel: metadata.commercialModel || 'FIXED_FEE',
    amount: Number(metadata.amount || 0),
    currency: metadata.currency || 'USD',
    scope: metadata.scope || null,
    deliverables: metadata.deliverables || null,
    timeline: metadata.timeline || null,
    paymentTerms: metadata.paymentTerms || null,
    validityDate: metadata.validityDate || null,
    assumptions: metadata.assumptions || null,
    documentUrl: metadata.documentUrl || null,
    templateId: metadata.templateId || null,
    approvedBy: metadata.approvedBy || null,
    approvedAt: metadata.approvedAt || null,
    sentAt: metadata.sentAt || null,
    acceptedBy: metadata.acceptedBy || null,
    acceptedAt: metadata.acceptedAt || null,
    rejectedReason: metadata.rejectedReason || null,
    expiredAt: metadata.expiredAt || null,
    nextAction: row?.next_action || null,
    followUpAt: row?.follow_up_at || null,
    occurredAt: row?.occurred_at || null,
    createdAt: row?.created_at || null,
    metadata,
  };
}

export function parseInvoice(row, receipts = [], credits = []) {
  const metadata = parseJson(row?.notes, {});
  const total = roundMoney(metadata.total ?? row?.amount ?? 0);
  const received = roundMoney(receipts
    .filter((item) => item.invoice_reference === row?.invoice_reference)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const credited = roundMoney(credits
    .filter((item) => {
      const credit = parseJson(item.notes, {});
      return credit.invoiceId === row?.id || credit.invoiceNumber === row?.invoice_reference;
    })
    .reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const outstanding = Math.max(0, roundMoney(total - received - credited));
  return {
    id: row?.id,
    projectId: row?.project_id,
    projectName: row?.project_name,
    engagementId: metadata.engagementId || row?.campaign_id || null,
    opportunityId: metadata.opportunityId || null,
    invoiceNumber: row?.invoice_reference,
    invoiceDate: metadata.invoiceDate || row?.created_at?.slice(0, 10),
    dueDate: row?.due_date,
    receivedDate: row?.received_date,
    status: row?.status,
    currency: row?.currency || 'USD',
    subtotal: Number(metadata.subtotal ?? row?.amount ?? 0),
    taxRate: Number(metadata.taxRate || 0),
    taxAmount: Number(metadata.taxAmount || 0),
    total,
    received,
    credited,
    outstanding,
    recipient: metadata.recipient || { name: row?.project_name },
    issuer: metadata.issuer || {},
    lineItems: Array.isArray(metadata.lineItems) ? metadata.lineItems : [],
    paymentSchedule: Array.isArray(metadata.paymentSchedule) ? metadata.paymentSchedule : [],
    taxLabel: metadata.taxLabel || null,
    notes: metadata.notes || null,
    paymentInstructions: metadata.paymentInstructions || null,
    cancellationReason: metadata.cancellationReason || null,
    cancelledAt: metadata.cancelledAt || null,
    createdAt: row?.created_at,
    updatedAt: row?.updated_at,
  };
}

export function sanitizePaymentSchedule(input, total) {
  if (!Array.isArray(input) || input.length === 0) return [];
  if (input.length > 12) {
    const validationError = new Error('Payment schedule cannot contain more than 12 milestones');
    validationError.status = 422;
    throw validationError;
  }
  const schedule = input.map((item, index) => {
    const label = text(item?.label, 300);
    const dueDate = text(item?.dueDate, 10);
    const amount = roundMoney(item?.amount);
    if (!label || !dueDate || Number.isNaN(new Date(`${dueDate}T12:00:00Z`).getTime()) || amount <= 0) {
      const validationError = new Error(`Payment milestone ${index + 1} is invalid`);
      validationError.status = 422;
      throw validationError;
    }
    return { label, dueDate, amount };
  });
  const scheduled = roundMoney(schedule.reduce((sum, item) => sum + item.amount, 0));
  if (Math.abs(scheduled - roundMoney(total)) > 0.01) {
    const validationError = new Error('Payment schedule amounts must equal the invoice total');
    validationError.status = 422;
    throw validationError;
  }
  return schedule;
}

export function parseFeatureFlags(value) {
  return parseJson(value, {});
}

export function proposalTemplate(input, existing = {}) {
  const name = text(input?.name ?? existing.name, 300);
  if (!name) {
    const validationError = new Error('Template name is required');
    validationError.status = 422;
    throw validationError;
  }
  return {
    id: text(input?.id ?? existing.id, 120) || `tpl_${crypto.randomUUID().replaceAll('-', '')}`,
    name,
    serviceType: text(input?.serviceType ?? existing.serviceType, 300) || 'OTHER',
    commercialModel: text(input?.commercialModel ?? existing.commercialModel, 100) || 'FIXED_FEE',
    scope: text(input?.scope ?? existing.scope, 12000),
    deliverables: text(input?.deliverables ?? existing.deliverables, 12000),
    timeline: text(input?.timeline ?? existing.timeline, 5000),
    paymentTerms: text(input?.paymentTerms ?? existing.paymentTerms, 5000),
    assumptions: text(input?.assumptions ?? existing.assumptions, 8000),
    defaultValidityDays: Math.min(Math.max(Number(input?.defaultValidityDays ?? existing.defaultValidityDays ?? 14), 1), 365),
    active: input?.active === undefined ? existing.active !== false : Boolean(input.active),
    updatedAt: new Date().toISOString(),
  };
}

export function csvEscape(value) {
  const normalized = value === null || value === undefined ? '' : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}
