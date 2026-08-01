import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseEngagement, parseJson, text, moneyNumber, ENGAGEMENT_MARKER } from '../../lib/revenue-lifecycle.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const STATUSES = new Set(['CONFIRMED', 'ONBOARDING', 'PLANNING', 'CREATOR_SELECTION', 'LIVE', 'REPORTING', 'COMPLETED', 'PAUSED', 'CANCELLED']);

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('Service engagement not found', 404);
    const row = await first(context.env.DB, `
      SELECT c.*, p.name AS project_name, o.name AS opportunity_name
      FROM campaigns c
      JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
      LEFT JOIN opportunities o ON o.id = c.opportunity_id AND o.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? AND c.id = ?
      LIMIT 1
    `, [tenantId, context.params.id]);
    if (!row) return error('Service engagement not found', 404);
    const item = parseEngagement(row);
    if (!canViewFinance(auth)) {
      Object.assign(item, {
        grossRevenue: null, directCosts: null, marginBeforeReferral: null,
        referralPercentage: null, referralReward: null, akariNetRevenue: null,
        amountInvoiced: null, amountReceived: null, outstandingAmount: null,
      });
    }
    return json({ ...item, projectName: row.project_name, opportunityName: row.opportunity_name });
  } catch (cause) {
    return error(cause.message || 'Service engagement could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Manager permission is required to update an engagement', 403);
    const tenantId = requireTenant(auth);
    const id = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id, updated: true, demo: true });
    const existing = await first(context.env.DB, 'SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    if (!existing) return error('Service engagement not found', 404);

    const status = body.status ? String(body.status).toUpperCase() : existing.status;
    if (!STATUSES.has(status)) return error('Engagement status is invalid', 422);
    const finance = canViewFinance(auth);
    const hasFinancialChanges = ['grossRevenue', 'campaignCost', 'creatorCost', 'otherCost', 'referralPercentage', 'referralPartnerId']
      .some((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (hasFinancialChanges && !finance) return error('Finance permission is required to update commercial values', 403);

    let referralPartnerId = body.referralPartnerId === undefined ? existing.referral_partner_id : text(body.referralPartnerId, 120);
    if (referralPartnerId) {
      const partner = await first(context.env.DB, 'SELECT id FROM partners WHERE tenant_id = ? AND id = ? AND status != ?', [tenantId, referralPartnerId, 'ARCHIVED']);
      if (!partner) return error('Selected referral partner does not belong to this workspace', 422);
    }

    const grossRevenue = body.grossRevenue === undefined ? Number(existing.gross_revenue || 0) : moneyNumber(body.grossRevenue, 'Gross revenue') || 0;
    const campaignCost = body.campaignCost === undefined ? Number(existing.campaign_cost || 0) : moneyNumber(body.campaignCost, 'Campaign cost') || 0;
    const creatorCost = body.creatorCost === undefined ? Number(existing.creator_cost || 0) : moneyNumber(body.creatorCost, 'Creator cost') || 0;
    const otherCost = body.otherCost === undefined ? Number(existing.other_cost || 0) : moneyNumber(body.otherCost, 'Other cost') || 0;
    const referralPercentage = body.referralPercentage === undefined
      ? Number(existing.referral_percentage || 0)
      : moneyNumber(body.referralPercentage, 'Referral percentage', { min: 0, max: 100 }) || 0;
    if (!referralPartnerId) referralPartnerId = null;

    const existingMetadata = parseJson(existing.notes, {});
    const metadata = {
      ...existingMetadata,
      recordType: existingMetadata.recordType || ENGAGEMENT_MARKER,
      version: 1,
      serviceType: text(body.serviceType, 300) || existingMetadata.serviceType || 'OTHER',
      commercialModel: text(body.commercialModel, 100) || existingMetadata.commercialModel || 'FIXED_FEE',
      contractReference: body.contractReference === undefined ? existingMetadata.contractReference : text(body.contractReference, 500),
      billingSchedule: body.billingSchedule === undefined ? existingMetadata.billingSchedule : text(body.billingSchedule, 5000),
      paymentTerms: body.paymentTerms === undefined ? existingMetadata.paymentTerms : text(body.paymentTerms, 5000),
      ownerNotes: body.ownerNotes === undefined ? existingMetadata.ownerNotes : text(body.ownerNotes, 8000),
      updatedBy: auth.userId,
      updatedAt: nowIso(),
    };
    const now = metadata.updatedAt;

    await run(context.env.DB, `
      UPDATE campaigns SET
        name = COALESCE(?, name), status = ?, start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date), deliverables_summary = COALESCE(?, deliverables_summary),
        gross_revenue = ?, gross_revenue_base_currency = ?, campaign_cost = ?, creator_cost = ?, other_cost = ?,
        referral_partner_id = ?, referral_percentage = ?, next_action = COALESCE(?, next_action),
        notes = ?, updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      text(body.name, 500), status, text(body.startDate, 30), text(body.endDate, 30), text(body.deliverables, 12000),
      grossRevenue, grossRevenue, campaignCost, creatorCost, otherCost,
      referralPartnerId, referralPercentage, text(body.nextAction, 2000),
      JSON.stringify(metadata), now, auth.userId, tenantId, id,
    ]);

    const updated = await first(context.env.DB, 'SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    const engagement = parseEngagement(updated);
    const referralRow = await first(context.env.DB, 'SELECT * FROM referrals WHERE tenant_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1', [tenantId, id]);
    if (referralPartnerId && referralPercentage > 0) {
      if (referralRow) {
        await run(context.env.DB, `
          UPDATE referrals SET partner_id = ?, revenue_basis = ?, referral_percentage = ?, referral_amount = ?, currency = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ? AND payment_status != 'PAID'
        `, [referralPartnerId, engagement.marginBeforeReferral, referralPercentage, engagement.referralReward, engagement.currency, now, tenantId, referralRow.id]);
      } else {
        await run(context.env.DB, `
          INSERT INTO referrals
            (id, tenant_id, partner_id, project_id, opportunity_id, campaign_id, revenue_basis,
             referral_percentage, referral_amount, currency, payment_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)
        `, [makeId('ref'), tenantId, referralPartnerId, existing.project_id, existing.opportunity_id, id, engagement.marginBeforeReferral, referralPercentage, engagement.referralReward, engagement.currency, now, now]);
      }
    } else if (referralRow && referralRow.payment_status !== 'PAID') {
      await run(context.env.DB, `UPDATE referrals SET payment_status = 'CANCELLED', updated_at = ? WHERE tenant_id = ? AND id = ?`, [now, tenantId, referralRow.id]);
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'ENGAGEMENT_UPDATED', 'ENGAGEMENT', ?, ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, id, JSON.stringify(parseEngagement(existing)), JSON.stringify(engagement), now]);

    return json({ ...engagement, updated: true });
  } catch (cause) {
    console.error('Service engagement update error', cause);
    return error(cause.message || 'Service engagement could not be updated', Number(cause.status || 500));
  }
}
