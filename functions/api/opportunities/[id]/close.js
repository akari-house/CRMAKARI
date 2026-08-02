import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import {
  CLOSE_MARKER,
  ENGAGEMENT_MARKER,
  lifecyclePayload,
  moneyNumber,
  text,
  booleanValue,
  probabilityForStage,
} from '../../../lib/revenue-lifecycle.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const OUTCOMES = new Set(['WON', 'LOST']);
const DEAL_MODELS = new Set(['PARTNERSHIP', 'SERVICE', 'HYBRID']);

const dateOnly = (value) => text(value, 30)?.slice(0, 10) || null;

function normalizeDealModel(value) {
  const requested = String(value || 'SERVICE').toUpperCase();
  return DEAL_MODELS.has(requested) ? requested : 'SERVICE';
}

function addDays(value, days) {
  const parsed = value ? new Date(`${String(value).slice(0, 10)}T12:00:00.000Z`) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function dueAt(day, hour = 16) {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`).toISOString();
}

function defaultNextAction({ dealModel, announcementRequested }) {
  if (dealModel === 'PARTNERSHIP') {
    return announcementRequested ? 'Prepare partnership announcement' : 'Plan the first partnership activation';
  }
  if (dealModel === 'HYBRID') {
    return announcementRequested ? 'Complete client onboarding and partnership announcement' : 'Complete client onboarding and partnership activation';
  }
  return announcementRequested ? 'Complete client onboarding and announcement plan' : 'Complete client onboarding';
}

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

async function validateAnnouncementOwner(db, tenantId, requestedId, fallbackId) {
  const userId = text(requestedId, 120) || fallbackId;
  const member = await first(db, `
    SELECT u.id
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.user_id = ?
      AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  `, [tenantId, userId]);
  if (!member) {
    const validationError = new Error('Selected announcement owner is not an active member of this workspace');
    validationError.status = 422;
    throw validationError;
  }
  return userId;
}

async function createAnnouncementPlan(db, auth, tenantId, request, {
  opportunity,
  engagementId,
  launchDate,
  relationshipOwnerId,
  marketingOwnerId,
  designOwnerId,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const launchMinusOne = addDays(launchDate, -1);
  const launchPlusOne = addDays(launchDate, 1);
  const launchPlusSeven = addDays(launchDate, 7);
  const tasks = [
    {
      slug: 'confirm-scope',
      title: 'Confirm partnership scope and announcement details',
      description: 'Confirm the value exchange, approved claims, announcement channels and partner contacts.',
      workstream: 'BD',
      ownerUserId: relationshipOwnerId,
      dueAt: dueAt(today, 15),
      priority: 'URGENT',
    },
    {
      slug: 'collect-assets',
      title: 'Collect partner logo, brand kit and official links',
      description: 'Required before design and scheduling.',
      workstream: 'OPERATIONS',
      ownerUserId: relationshipOwnerId,
      dueAt: dueAt(addDays(today, 1), 16),
      priority: 'HIGH',
    },
    {
      slug: 'draft-copy',
      title: 'Draft partnership announcement copy and quotes',
      description: 'Prepare the main post, partner quote and approved supporting language.',
      workstream: 'CONTENT',
      ownerUserId: marketingOwnerId,
      dueAt: dueAt(addDays(today, 2), 15),
      priority: 'HIGH',
    },
    {
      slug: 'create-design',
      title: 'Create partnership announcement graphics',
      description: 'Use approved AKARI and partner brand assets.',
      workstream: 'DESIGN',
      ownerUserId: designOwnerId,
      dueAt: dueAt(addDays(today, 2), 17),
      priority: 'HIGH',
    },
    {
      slug: 'internal-review',
      title: 'Review announcement copy and design internally',
      description: 'Review scope accuracy, claims, logos, links and posting order.',
      workstream: 'BD',
      ownerUserId: relationshipOwnerId,
      dueAt: dueAt(addDays(today, 3), 14),
      priority: 'HIGH',
    },
    {
      slug: 'partner-approval',
      title: 'Send announcement materials for partner approval',
      description: 'Record requested changes and final approval.',
      workstream: 'ACCOUNT',
      ownerUserId: relationshipOwnerId,
      dueAt: dueAt(addDays(today, 3), 17),
      priority: 'HIGH',
    },
    {
      slug: 'confirm-launch',
      title: 'Confirm announcement date, channels and posting order',
      workstream: 'MARKETING',
      ownerUserId: marketingOwnerId,
      dueAt: dueAt(addDays(today, 4), 16),
      priority: 'MEDIUM',
    },
    {
      slug: 'schedule',
      title: 'Schedule partnership announcement',
      description: `Target launch: ${launchDate}. Confirm final partner approval before scheduling.`,
      workstream: 'SOCIAL',
      ownerUserId: marketingOwnerId,
      dueAt: dueAt(launchMinusOne, 16),
      priority: 'HIGH',
    },
    {
      slug: 'publish',
      title: 'Publish partnership announcement and record links',
      description: 'Publish through approved channels and add the final URLs to the relationship timeline.',
      workstream: 'MARKETING',
      ownerUserId: marketingOwnerId,
      dueAt: dueAt(launchDate, 12),
      priority: 'URGENT',
    },
    {
      slug: 'engagement',
      title: 'Complete community engagement and partner follow-up',
      workstream: 'COMMUNITY',
      ownerUserId: marketingOwnerId,
      dueAt: dueAt(launchPlusOne, 16),
      priority: 'MEDIUM',
    },
    {
      slug: 'next-activation',
      title: 'Review results and plan the next joint activation',
      workstream: 'ACCOUNT',
      ownerUserId: relationshipOwnerId,
      dueAt: dueAt(launchPlusSeven, 16),
      priority: 'MEDIUM',
    },
  ];

  const created = [];
  const now = nowIso();
  for (const item of tasks) {
    const id = makeId('tsk');
    await run(db, `
      INSERT INTO tasks (
        id, tenant_id, title, description, owner_user_id, created_by, status, priority, due_at,
        project_id, opportunity_id, campaign_id, activity_type, show_on_home, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'TODO', ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      id,
      tenantId,
      item.title,
      item.description || null,
      item.ownerUserId,
      auth.userId,
      item.priority,
      item.dueAt,
      opportunity.project_id,
      opportunity.id,
      engagementId,
      `PARTNERSHIP_ACTIVATION:${opportunity.id}:${item.workstream}:${item.slug}`,
      now,
      now,
    ]);
    created.push({ id, title: item.title, ownerUserId: item.ownerUserId, workstream: item.workstream, dueAt: item.dueAt });
  }

  await run(db, `
    INSERT INTO audit_logs (
      id, tenant_id, user_id, action, entity_type, entity_id, after_data,
      ip_address, user_agent, created_at
    ) VALUES (?, ?, ?, 'PARTNERSHIP_ANNOUNCEMENT_PLAN_CREATED', 'OPPORTUNITY', ?, ?, ?, ?, ?)
  `, [
    makeId('aud'),
    tenantId,
    auth.userId,
    opportunity.id,
    JSON.stringify({ engagementId, launchDate, taskCount: created.length, tasks: created }),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('user-agent'),
    now,
  ]);

  return { requested: true, launchDate, taskCount: created.length, tasks: created };
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
    let announcementPlan = null;
    let closeMetadata;

    if (outcome === 'WON') {
      const dealModel = normalizeDealModel(body.dealModel);
      const invoiceEligible = dealModel === 'SERVICE' || dealModel === 'HYBRID';
      const partnershipIncluded = dealModel === 'PARTNERSHIP' || dealModel === 'HYBRID';
      const announcementRequested = booleanValue(body.createAnnouncementPlan ?? body.announcementRequested);
      const strategicValue = moneyNumber(body.strategicValue, 'Strategic value', { min: 0 }) || 0;
      const finalValue = invoiceEligible
        ? moneyNumber(body.finalValue ?? opportunity.estimated_value, 'Final contract value', { min: 0.01 })
        : 0;
      const currency = String(body.currency || opportunity.currency || 'USD').toUpperCase().slice(0, 10);
      const engagementName = text(body.engagementName, 500) || `${opportunity.project_name} · ${opportunity.name}`;
      const serviceType = dealModel === 'PARTNERSHIP'
        ? (text(body.serviceType, 300) || 'STRATEGIC_PARTNERSHIP')
        : (text(body.serviceType, 300) || opportunity.service_type || 'OTHER');
      const commercialModel = dealModel === 'PARTNERSHIP'
        ? 'NON_BILLABLE'
        : (text(body.commercialModel, 100) || 'FIXED_FEE');
      const startDate = dateOnly(body.startDate);
      const endDate = dateOnly(body.endDate);
      const deliverables = text(body.deliverables ?? body.partnershipScope, 12000);
      const valueContribution = text(body.valueContribution, 8000);
      if (!startDate) return error(`${partnershipIncluded && !invoiceEligible ? 'Partnership' : 'Service'} start date is required`, 422);
      if (!deliverables) return error(`${partnershipIncluded && !invoiceEligible ? 'Partnership scope' : 'Engagement deliverables'} are required`, 422);

      const campaignCost = invoiceEligible ? (moneyNumber(body.campaignCost ?? 0, 'Campaign cost') || 0) : 0;
      const creatorCost = invoiceEligible ? (moneyNumber(body.creatorCost ?? 0, 'Creator cost') || 0) : 0;
      const otherCost = invoiceEligible ? (moneyNumber(body.otherCost ?? 0, 'Other cost') || 0) : 0;
      const partner = invoiceEligible
        ? await resolveReferralPartner(context.env.DB, tenantId, body.referralPartnerId, opportunity)
        : null;
      const referralPercentage = invoiceEligible
        ? (moneyNumber(
          body.referralPercentage ?? partner?.default_referral_percentage ?? 0,
          'Referral percentage',
          { min: 0, max: 100 },
        ) || 0)
        : 0;
      const revenueBasis = invoiceEligible ? Math.max(0, finalValue - campaignCost - creatorCost - otherCost) : 0;
      const referralAmount = invoiceEligible
        ? Math.round((revenueBasis * referralPercentage / 100 + Number.EPSILON) * 100) / 100
        : 0;
      const engagementId = makeId('eng');
      const announcementDate = announcementRequested ? (dateOnly(body.announcementDate) || addDays(startDate, 7)) : null;
      const nextAction = text(body.nextAction, 2000) || defaultNextAction({ dealModel, announcementRequested });
      const engagementMetadata = {
        recordType: ENGAGEMENT_MARKER,
        version: 2,
        dealModel,
        invoiceEligible,
        partnershipIncluded,
        announcementRequested,
        announcementDate,
        valueContribution,
        strategicValue,
        serviceType,
        commercialModel,
        sourceOpportunityId: opportunityId,
        contractReference: text(body.contractReference, 500),
        billingSchedule: invoiceEligible ? text(body.billingSchedule, 5000) : null,
        paymentTerms: invoiceEligible ? text(body.paymentTerms, 5000) : null,
        ownerNotes: text(body.ownerNotes, 8000),
        createdBy: auth.userId,
        createdAt: now,
      };

      let announcementOwners = null;
      if (announcementRequested) {
        const relationshipOwnerId = await validateAnnouncementOwner(
          context.env.DB,
          tenantId,
          body.relationshipOwnerId,
          opportunity.owner_user_id || auth.userId,
        );
        const marketingOwnerId = await validateAnnouncementOwner(
          context.env.DB,
          tenantId,
          body.marketingOwnerId,
          relationshipOwnerId,
        );
        const designOwnerId = await validateAnnouncementOwner(
          context.env.DB,
          tenantId,
          body.designOwnerId,
          marketingOwnerId,
        );
        announcementOwners = { relationshipOwnerId, marketingOwnerId, designOwnerId };
      }

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
        engagementId,
        tenantId,
        opportunity.project_id,
        opportunityId,
        engagementName,
        auth.userId,
        text(body.region, 500),
        startDate,
        endDate,
        dateOnly(body.reportingDueDate),
        deliverables,
        finalValue,
        currency,
        finalValue,
        campaignCost,
        creatorCost,
        otherCost,
        partner?.id || null,
        referralPercentage,
        nextAction,
        JSON.stringify(engagementMetadata),
        now,
        now,
        auth.userId,
        auth.userId,
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
          referralId,
          tenantId,
          partner.id,
          opportunity.project_id,
          opportunityId,
          engagementId,
          revenueBasis,
          referralPercentage,
          referralAmount,
          currency,
          text(body.referralNotes, 5000),
          now,
          now,
        ]);
        referral = {
          id: referralId,
          partnerId: partner.id,
          partnerName: partner.name,
          revenueBasis,
          referralPercentage,
          referralAmount,
          currency,
          status: 'CONFIRMED',
        };
      }

      await run(context.env.DB, `
        UPDATE opportunities SET
          stage = 'WON', estimated_value = ?, estimated_value_base_currency = ?, currency = ?,
          probability_percentage = 100, won_at = COALESCE(won_at, ?), lost_at = NULL,
          lost_reason = NULL, competitor = NULL,
          next_action = ?, next_follow_up_at = NULL, updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [
        finalValue,
        finalValue,
        currency,
        now,
        nextAction,
        now,
        auth.userId,
        tenantId,
        opportunityId,
      ]);

      const projectLifecycle = invoiceEligible ? 'CLIENT' : 'PARTNER';
      await run(context.env.DB, `
        UPDATE projects SET
          lifecycle_status = ?,
          customer_since = CASE WHEN ? = 'CLIENT' THEN COALESCE(customer_since, ?) ELSE customer_since END,
          updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [
        projectLifecycle,
        projectLifecycle,
        startDate,
        now,
        auth.userId,
        tenantId,
        opportunity.project_id,
      ]);

      if (announcementRequested && announcementOwners) {
        announcementPlan = await createAnnouncementPlan(context.env.DB, auth, tenantId, context.request, {
          opportunity,
          engagementId,
          launchDate: announcementDate,
          ...announcementOwners,
        });
      }

      engagement = {
        id: engagementId,
        name: engagementName,
        dealModel,
        invoiceEligible,
        partnershipIncluded,
        announcementRequested,
        announcementDate,
        valueContribution,
        strategicValue,
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
        dealModel,
        invoiceEligible,
        partnershipIncluded,
        announcementRequested,
        announcementDate,
        finalValue,
        strategicValue,
        valueContribution,
        currency,
        engagementId,
        serviceType,
        commercialModel,
        startDate,
        endDate,
        referralId: referral?.id || null,
        announcementTaskCount: announcementPlan?.taskCount || 0,
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
        lostReason,
        competitor,
        now,
        text(body.nextAction, 2000) || 'Closed lost',
        now,
        auth.userId,
        tenantId,
        opportunityId,
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
    const wonNextAction = outcome === 'WON'
      ? (engagement?.dealModel === 'PARTNERSHIP'
        ? (engagement.announcementRequested ? 'Prepare partnership announcement' : 'Plan the first partnership activation')
        : 'Complete client onboarding')
      : 'Archive learnings and next steps';
    await run(context.env.DB, `
      INSERT INTO activities (
        id, tenant_id, project_id, contact_id, opportunity_id, user_id, activity_type,
        subject, description, outcome, occurred_at, next_action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'DEAL_CLOSED', ?, ?, ?, ?, ?, ?)
    `, [
      activityId,
      tenantId,
      opportunity.project_id,
      opportunity.primary_contact_id,
      opportunityId,
      auth.userId,
      `${opportunity.name} · ${outcome === 'WON' ? 'Won' : 'Lost'}`,
      lifecyclePayload(CLOSE_MARKER, { ...closeMetadata, closedBy: auth.userId, closedAt: now }),
      outcome,
      now,
      wonNextAction,
      now,
    ]);

    await run(context.env.DB, `
      INSERT INTO opportunity_stage_history
        (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      makeId('osh'),
      tenantId,
      opportunityId,
      opportunity.stage,
      outcome,
      auth.userId,
      now,
      outcome === 'WON'
        ? `Opportunity won as ${String(engagement?.dealModel || 'SERVICE').toLowerCase()} and engagement created`
        : closeMetadata.lostReason,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs
        (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'OPPORTUNITY_CLOSED', 'OPPORTUNITY', ?, ?, ?, ?)
    `, [
      makeId('aud'),
      tenantId,
      auth.userId,
      opportunityId,
      JSON.stringify({ stage: opportunity.stage, probabilityPercentage: opportunity.probability_percentage }),
      JSON.stringify({
        stage: outcome,
        probabilityPercentage: probability,
        dealModel: engagement?.dealModel || null,
        invoiceEligible: engagement?.invoiceEligible ?? null,
        engagementId: engagement?.id || null,
        referralId: referral?.id || null,
        announcementTaskCount: announcementPlan?.taskCount || 0,
      }),
      now,
    ]);

    return json({
      id: opportunityId,
      outcome,
      stage: outcome,
      engagement,
      referral,
      announcementPlan,
      updated: true,
    });
  } catch (cause) {
    console.error('Opportunity close error', cause);
    return error(cause.message || 'Opportunity could not be closed', Number(cause.status || 500));
  }
}
