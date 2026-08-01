import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import {
  CLOSE_MARKER,
  ENGAGEMENT_MARKER,
  lifecyclePayload,
  moneyNumber,
  text,
  probabilityForStage,
} from '../../../lib/revenue-lifecycle.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const OUTCOMES = new Set(['WON', 'LOST']);

async function resolveReferralPartner(db, tenantId, requestedId, opportunity) {
  const partnerId = text(requestedId, 120) || opportunity.referral_partner_id || opportunity.project_referral_partner_id || null;
  if (!partnerId) return null;
  const partner = await first(db, `
    SELECT id, name, default_referral_percentage
    FROM partners
    WHERE tenant_id = ? AND id = ? AND status != 'ARCHIVED'
    LIMIT 1
  `, [tenantId, partnerId]);
  if (!partner) {
    const validationError = new Error('Selected referral partner does not belong to this workspace');
    validationError.status = 422;
    throw validationError;
  }
  return partner;
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Manager permission is required to close an opportunity', 403);
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '');
    const body = await readJson(context.request);
    const outcome = String(body.outcome || '').toUpperCase();
    if (!OUTCOMES.has(outcome)) return error('Close outcome must be WON or LOST', 422);
    if (!context.env.DB) return json({ id: opportunityId, outcome, updated: true, demo: true });

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.name AS project_name, p.lifecycle_status AS project_lifecycle_status,
             p.referral_partner_id AS project_referral_partner_id
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND o.id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (!opportunity) return error('Opportunity not found', 404);
    if (['WON', 'LOST'].includes(opportunity.stage)) return error('This opportunity is already closed', 409);

    const now = nowIso();
    let engagement = null;
    let referral = null;
    let closeMetadata;

    if (outcome === 'WON') {
      const finalValue = moneyNumber(body.finalValue ?? opportunity.estimated_value, 'Final contract value', { min: 0.01 });
      const currency = String(body.currency || opportunity.currency || 'USD').toUpperCase().slice(0, 10);
      const engagementName = text(body.engagementName, 500) || `${opportunity.project_name} · ${opportunity.name}`;
      const serviceType = text(body.serviceType, 300) || opportunity.service_type || 'OTHER';
      const commercialModel = text(body.commercialModel, 100) || 'FIXED_FEE';
      const startDate = text(body.startDate, 30);
      const endDate = text(body.endDate, 30);
      const deliverables = text(body.deliverables, 12000);
      if (!startDate || !deliverables) return error('Service start date and engagement deliverables are required', 422);

      const campaignCost = moneyNumber(body.campaignCost ?? 0, 'Campaign cost') || 0;
      const creatorCost = moneyNumber(body.creatorCost ?? 0, 'Creator cost') || 0;
      const otherCost = moneyNumber(body.otherCost ?? 0, 'Other cost') || 0;
      const partner = await resolveReferralPartner(context.env.DB, tenantId, body.referralPartnerId, opportunity);
      const referralPercentage = moneyNumber(
        body.referralPercentage ?? partner?.default_referral_percentage ?? 0,
        'Referral percentage',
        { min: 0, max: 100 },
      ) || 0;
      const revenueBasis = Math.max(0, finalValue - campaignCost - creatorCost - otherCost);
      const referralAmount = Math.round((revenueBasis * referralPercentage / 100 + Number.EPSILON) * 100) / 100;
      const engagementId = makeId('eng');
      const engagementMetadata = {
        recordType: ENGAGEMENT_MARKER,
        version: 1,
        serviceType,
        commercialModel,
        sourceOpportunityId: opportunityId,
        contractReference: text(body.contractReference, 500),
        billingSchedule: text(body.billingSchedule, 5000),
        paymentTerms: text(body.paymentTerms, 5000),
        ownerNotes: text(body.ownerNotes, 8000),
        createdBy: auth.userId,
        createdAt: now,
      };

      await run(context.env.DB, `
        INSERT INTO campaigns (
          id, tenant_id, project_id, opportunity_id, name, campaign_owner_id, status,
          region, start_date, end_date, reporting_due_date, deliverables_summary,
          gross_revenue, currency, gross_revenue_base_currency,
          campaign_cost, creator_cost, other_cost,
          referral_partner_id, referral_percentage,
          amount_invoiced, amount_received, payment_status, next_action, notes,
          created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'ONBOARDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'NOT_INVOICED', ?, ?, ?, ?, ?, ?)
      `, [
        engagementId, tenantId, opportunity.project_id, opportunityId, engagementName, auth.userId,
        text(body.region, 500), startDate, endDate, text(body.reportingDueDate, 30), deliverables,
        finalValue, currency, finalValue, campaignCost, creatorCost, otherCost,
        partner?.id || null, referralPercentage,
        text(body.nextAction, 2000) || 'Complete client onboarding',
        JSON.stringify(engagementMetadata), now, now, auth.userId, auth.userId,
      ]);

      if (partner && referralPercentage > 0) {
        const referralId = makeId('ref');
        await run(context.env.DB, `
          INSERT INTO referrals (
            id, tenant_id, partner_id, project_id, opportunity_id, campaign_id,
            revenue_basis, referral_percentage, referral_amount, currency,
            payment_status, due_date, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', NULL, ?, ?, ?)
        `, [
          referralId, tenantId, partner.id, opportunity.project_id, opportunityId, engagementId,
          revenueBasis, referralPercentage, referralAmount, currency,
          text(body.referralNotes, 5000), now, now,
        ]);
        referral = { id: referralId, partnerId: partner.id, partnerName: partner.name, revenueBasis, referralPercentage, referralAmount, currency, status: 'CONFIRMED' };
      }

      await run(context.env.DB, `
        UPDATE opportunities SET
          stage = 'WON', estimated_value = ?, estimated_value_base_currency = ?, currency = ?,
          probability_percentage = 100, won_at = COALESCE(won_at, ?), lost_at = NULL,
          lost_reason = NULL, competitor = NULL,
          next_action = ?, next_follow_up_at = NULL, updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [
        finalValue, finalValue, currency,
        now, text(body.nextAction, 2000) || 'Complete client onboarding',
        now, auth.userId, tenantId, opportunityId,
      ]);
      await run(context.env.DB, `
        UPDATE projects SET lifecycle_status = 'CLIENT', customer_since = COALESCE(customer_since, ?),
          updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [startDate.slice(0, 10), now, auth.userId, tenantId, opportunity.project_id]);

      engagement = {
        id: engagementId,
        name: engagementName,
        serviceType,
        commercialModel,
        status: 'ONBOARDING',
        grossRevenue: finalValue,
        currency,
        startDate,
        endDate,
        referralPercentage,
        referralAmount,
      };
      closeMetadata = {
        outcome,
        finalValue,
        currency,
        engagementId,
        serviceType,
        commercialModel,
        startDate,
        endDate,
        referralId: referral?.id || null,
        closeNotes: text(body.closeNotes, 8000),
      };
    } else {
      const lostReason = text(body.lostReason, 5000);
      if (!lostReason) return error('A lost reason is required', 422);
      const competitor = text(body.competitor, 1000);
      await run(context.env.DB, `
        UPDATE opportunities SET
          stage = 'LOST', probability_percentage = 0, lost_reason = ?, competitor = ?,
          lost_at = COALESCE(lost_at, ?), won_at = NULL,
          next_action = ?, next_follow_up_at = NULL, updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [
        lostReason, competitor, now,
        text(body.nextAction, 2000) || 'Closed lost',
        now, auth.userId, tenantId, opportunityId,
      ]);
      const activeRow = await first(context.env.DB, `
        SELECT COUNT(*) AS value FROM opportunities
        WHERE tenant_id = ? AND project_id = ? AND id != ?
          AND stage NOT IN ('WON', 'LOST', 'ON_HOLD')
      `, [tenantId, opportunity.project_id, opportunityId]);
      if (Number(activeRow?.value || 0) === 0 && opportunity.project_lifecycle_status === 'ACTIVE_OPPORTUNITY') {
        await run(context.env.DB, `
          UPDATE projects SET lifecycle_status = 'PROSPECT', updated_at = ?, updated_by = ?
          WHERE tenant_id = ? AND id = ?
        `, [now, auth.userId, tenantId, opportunity.project_id]);
      }
      closeMetadata = {
        outcome,
        lostReason,
        competitor,
        closeNotes: text(body.closeNotes, 8000),
      };
    }

    const probability = probabilityForStage(outcome, opportunity.probability_percentage);
    const activityId = makeId('act');
    await run(context.env.DB, `
      INSERT INTO activities (
        id, tenant_id, project_id, contact_id, opportunity_id, user_id, activity_type,
        subject, description, outcome, occurred_at, next_action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'DEAL_CLOSED', ?, ?, ?, ?, ?, ?)
    `, [
      activityId, tenantId, opportunity.project_id, opportunity.primary_contact_id, opportunityId, auth.userId,
      `${opportunity.name} · ${outcome === 'WON' ? 'Won' : 'Lost'}`,
      lifecyclePayload(CLOSE_MARKER, { ...closeMetadata, closedBy: auth.userId, closedAt: now }),
      outcome, now, outcome === 'WON' ? 'Complete client onboarding' : 'Archive learnings and next steps', now,
    ]);

    await run(context.env.DB, `
      INSERT INTO opportunity_stage_history
        (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [makeId('osh'), tenantId, opportunityId, opportunity.stage, outcome, auth.userId, now, outcome === 'WON' ? 'Opportunity won and client engagement created' : closeMetadata.lostReason]);

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'OPPORTUNITY_CLOSED', 'OPPORTUNITY', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, opportunityId,
      JSON.stringify({ stage: opportunity.stage, probabilityPercentage: opportunity.probability_percentage }),
      JSON.stringify({ stage: outcome, probabilityPercentage: probability, engagementId: engagement?.id || null, referralId: referral?.id || null }),
      now,
    ]);

    return json({ id: opportunityId, outcome, stage: outcome, engagement, referral, updated: true });
  } catch (cause) {
    console.error('Opportunity close error', cause);
    return error(cause.message || 'Opportunity could not be closed', Number(cause.status || 500));
  }
}
