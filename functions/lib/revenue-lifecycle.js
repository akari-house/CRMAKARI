export const PROPOSAL_MARKER = 'AKARI_PROPOSAL_V1';
export const NEGOTIATION_MARKER = 'AKARI_NEGOTIATION_V1';
export const CLOSE_MARKER = 'AKARI_DEAL_CLOSE_V1';
export const ENGAGEMENT_MARKER = 'AKARI_ENGAGEMENT_V1';
export const RECEIPT_MARKER = 'AKARI_INVOICE_RECEIPT_V1';

export const text = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};

export const moneyNumber = (value, label = 'Amount', { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    const validationError = new Error(`${label} must be a valid number`);
    validationError.status = 422;
    throw validationError;
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
};

export const booleanValue = (value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on';

export function parseJson(value, fallback = {}) {
  if (!value) return structuredClone(fallback);
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

export function lifecyclePayload(marker, payload = {}) {
  return JSON.stringify({ recordType: marker, version: 1, ...payload });
}

export function parseLifecycleActivity(row) {
  const metadata = parseJson(row?.description, {});
  return {
    id: row.id,
    activityType: row.activity_type,
    subject: row.subject,
    outcome: row.outcome,
    occurredAt: row.occurred_at,
    nextAction: row.next_action,
    followUpAt: row.follow_up_at,
    createdAt: row.created_at,
    metadata,
  };
}

export function parseEngagement(row) {
  const metadata = parseJson(row?.notes, {});
  const campaignCost = Number(row.campaign_cost || 0);
  const creatorCost = Number(row.creator_cost || 0);
  const otherCost = Number(row.other_cost || 0);
  return {
    id: row.id,
    projectId: row.project_id,
    opportunityId: row.opportunity_id,
    name: row.name,
    status: row.status,
    serviceType: metadata.serviceType || 'OTHER',
    commercialModel: metadata.commercialModel || 'FIXED_FEE',
    startDate: row.start_date,
    endDate: row.end_date,
    deliverables: row.deliverables_summary,
    grossRevenue: Number(row.gross_revenue || 0),
    currency: row.currency || 'USD',
    campaignCost,
    creatorCost,
    otherCost,
    directCosts: campaignCost + creatorCost + otherCost,
    marginBeforeReferral: Number(row.margin_before_referral || 0),
    referralPartnerId: row.referral_partner_id,
    referralPercentage: Number(row.referral_percentage || 0),
    referralReward: Number(row.referral_reward || 0),
    akariNetRevenue: Number(row.akari_net_revenue || 0),
    amountInvoiced: Number(row.amount_invoiced || 0),
    amountReceived: Number(row.amount_received || 0),
    outstandingAmount: Number(row.outstanding_amount || 0),
    paymentStatus: row.payment_status,
    nextAction: row.next_action,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addDays(dateValue, days) {
  const base = dateValue ? new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

export function qualificationComplete(opportunity = {}) {
  return Boolean(
    opportunity.need_confirmed &&
    opportunity.decision_maker_confirmed &&
    opportunity.timeline_confirmed &&
    opportunity.budget_status &&
    !['UNKNOWN', 'NOT_QUALIFIED'].includes(String(opportunity.budget_status).toUpperCase())
  );
}

export function probabilityForStage(stage, current = 10) {
  const defaults = {
    NEW: 10,
    RESEARCH: 10,
    CONTACTED: 20,
    REPLIED: 30,
    DISCOVERY: 40,
    QUALIFIED: 50,
    PROPOSAL: 60,
    NEGOTIATION: 75,
    VERBAL_CONFIRMATION: 90,
    WON: 100,
    LOST: 0,
    ON_HOLD: Math.min(Number(current || 10), 30),
  };
  return defaults[String(stage || '').toUpperCase()] ?? Number(current || 10);
}
