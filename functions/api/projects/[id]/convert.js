import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant, requireRole } from '../../../lib/permissions.js';

const TYPES = new Set(['PARTNER', 'CLIENT', 'BOTH']);
const BILLING_MODELS = new Set(['ONE_TIME', 'MONTHLY_RETAINER', 'MILESTONE', 'SUCCESS_FEE', 'HOURLY', 'CUSTOM']);
const REFERRAL_BASES = new Set(['NET_REVENUE', 'GROSS_REVENUE', 'FIXED']);
const text = (value, max = 5000) => value === null || value === undefined ? null : (String(value).trim().slice(0, max) || null);
const money = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
const percent = (value) => Math.min(100, Math.max(0, money(value, 0)));

async function createOrLoadIntroducer(context, tenantId, auth, body, now) {
  const existingId = text(body.introducerPartnerId, 120);
  if (existingId) {
    const partner = await first(context.env.DB, 'SELECT * FROM partners WHERE tenant_id = ? AND id = ?', [tenantId, existingId]);
    if (!partner) throw Object.assign(new Error('Referral introducer was not found'), { status: 404 });
    return partner;
  }
  const name = text(body.introducerName, 300);
  if (!name) return null;
  const id = makeId('par');
  await run(context.env.DB, `
    INSERT INTO partners (
      id, tenant_id, name, partner_type, status, contact_name, contact_email,
      telegram, default_referral_percentage, agreement_status, notes,
      created_at, updated_at, created_by, updated_by
    ) VALUES (?, ?, ?, 'REFERRAL', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, tenantId, name, text(body.introducerContactName, 300), text(body.introducerEmail, 320),
    text(body.introducerTelegram, 500), percent(body.referralPercentage),
    text(body.referralAgreementStatus, 80) || 'DRAFT', text(body.referralNotes, 5000),
    now, now, auth.userId, auth.userId,
  ]);
  return { id, name, default_referral_percentage: percent(body.referralPercentage) };
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, ['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
    const tenantId = requireTenant(auth);
    const projectId = context.params.id;
    const body = await readJson(context.request);
    const conversionType = String(body.conversionType || '').toUpperCase();
    if (!TYPES.has(conversionType)) return error('Choose Partner, Client or Both', 422);
    if (!context.env.DB) return json({ converted: true, demo: true }, 201);

    const project = await first(context.env.DB, `
      SELECT p.*, c.full_name AS contact_name, c.email AS contact_email,
        c.telegram AS contact_telegram, c.x_handle AS contact_x
      FROM projects p
      LEFT JOIN contacts c ON c.project_id = p.id AND c.tenant_id = p.tenant_id AND c.is_primary_contact = 1
      WHERE p.tenant_id = ? AND p.id = ?
      LIMIT 1
    `, [tenantId, projectId]);
    if (!project) return error('Lead was not found', 404);
    if (!project.x_url || !project.telegram) return error('Add the lead X account and Telegram handle before conversion', 422);
    if (!project.contact_name) return error('Add a primary contact before conversion', 422);
    if (!project.contact_x || !project.contact_telegram) return error('The primary contact requires both an X account and Telegram handle before conversion', 422);

    const now = nowIso();
    const introducer = await createOrLoadIntroducer(context, tenantId, auth, body, now);
    const referralPercentage = percent(body.referralPercentage ?? introducer?.default_referral_percentage ?? 0);
    const referralBasis = REFERRAL_BASES.has(String(body.referralBasis || '').toUpperCase()) ? String(body.referralBasis).toUpperCase() : 'NET_REVENUE';
    let createdPartnerId = null;
    let serviceId = null;
    let referralId = null;

    if (conversionType === 'PARTNER' || conversionType === 'BOTH') {
      const existingPartner = await first(context.env.DB, `SELECT id FROM partners WHERE tenant_id = ? AND lower(name) = lower(?) LIMIT 1`, [tenantId, project.name]);
      createdPartnerId = existingPartner?.id || makeId('par');
      if (existingPartner) {
        await run(context.env.DB, `
          UPDATE partners SET website = COALESCE(?, website), x_url = COALESCE(?, x_url), telegram = COALESCE(?, telegram),
            contact_name = COALESCE(?, contact_name), contact_email = COALESCE(?, contact_email),
            partner_type = COALESCE(?, partner_type), status = 'ACTIVE', updated_at = ?, updated_by = ?
          WHERE tenant_id = ? AND id = ?
        `, [project.website, project.x_url, project.telegram, project.contact_name, project.contact_email,
          text(body.partnerType, 120) || 'STRATEGIC', now, auth.userId, tenantId, createdPartnerId]);
      } else {
        await run(context.env.DB, `
          INSERT INTO partners (
            id, tenant_id, name, partner_type, status, website, x_url, telegram,
            contact_name, contact_email, default_referral_percentage, agreement_status, notes,
            created_at, updated_at, created_by, updated_by
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [createdPartnerId, tenantId, project.name, text(body.partnerType, 120) || 'STRATEGIC',
          project.website, project.x_url, project.telegram, project.contact_name, project.contact_email,
          referralPercentage, text(body.partnerAgreementStatus, 80) || 'DRAFT', text(body.partnerNotes, 5000),
          now, now, auth.userId, auth.userId]);
      }
    }

    if (conversionType === 'CLIENT' || conversionType === 'BOTH') {
      const serviceName = text(body.serviceName, 300);
      const serviceType = text(body.serviceType, 200);
      if (!serviceName || !serviceType) return error('Service name and service type are required for client conversion', 422);
      const billingModel = BILLING_MODELS.has(String(body.billingModel || '').toUpperCase()) ? String(body.billingModel).toUpperCase() : 'ONE_TIME';
      const contractValue = money(body.contractValue, 0);
      const directCost = money(body.directCost, 0);
      const creatorCost = money(body.creatorCost, 0);
      const otherCost = money(body.otherCost, 0);
      const netBasis = Math.max(0, contractValue - directCost - creatorCost - otherCost);
      const referralAmount = referralBasis === 'FIXED' ? money(body.fixedReferralAmount, 0) : (referralBasis === 'GROSS_REVENUE' ? contractValue : netBasis) * referralPercentage / 100;
      serviceId = makeId('cmp');
      const serviceMetadata = JSON.stringify({ recordType: 'SERVICE_ENGAGEMENT_V1', billingModel, serviceType, durationMonths: money(body.durationMonths, 0), renewalDate: text(body.renewalDate, 10), deliverables: text(body.deliverables, 10000), referralBasis, introducerPartnerId: introducer?.id || null });
      await run(context.env.DB, `
        INSERT INTO campaigns (
          id, tenant_id, project_id, name, campaign_owner_id, status, region,
          start_date, end_date, deliverables_summary, gross_revenue, currency,
          campaign_cost, creator_cost, other_cost, referral_partner_id,
          referral_percentage, payment_status, next_action, notes,
          created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, 'ONBOARDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_INVOICED', ?, ?, ?, ?, ?, ?)
      `, [serviceId, tenantId, projectId, serviceName, text(body.ownerUserId, 120) || auth.userId,
        text(body.region, 200) || project.region, text(body.startDate, 10), text(body.endDate, 10),
        text(body.deliverables, 10000), contractValue, text(body.currency, 10) || 'USD', directCost, creatorCost, otherCost,
        introducer?.id || null, referralPercentage, text(body.nextAction, 1000), serviceMetadata, now, now, auth.userId, auth.userId]);
      if (introducer) {
        referralId = makeId('ref');
        await run(context.env.DB, `
          INSERT INTO referrals (id, tenant_id, partner_id, project_id, campaign_id, revenue_basis, referral_percentage, referral_amount, currency, payment_status, due_date, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ESTIMATED', ?, ?, ?, ?)
        `, [referralId, tenantId, introducer.id, projectId, serviceId,
          referralBasis === 'FIXED' ? contractValue : (referralBasis === 'GROSS_REVENUE' ? contractValue : netBasis),
          referralPercentage, referralAmount, text(body.currency, 10) || 'USD', text(body.referralDueDate, 10), text(body.referralNotes, 5000), now, now]);
      }
    }

    const lifecycle = conversionType === 'PARTNER' ? 'PARTNER' : 'CLIENT';
    await run(context.env.DB, `
      UPDATE projects SET lifecycle_status = ?, customer_since = CASE WHEN ? = 'CLIENT' THEN COALESCE(customer_since, ?) ELSE customer_since END,
        referral_partner_id = COALESCE(?, referral_partner_id), next_follow_up_at = COALESCE(?, next_follow_up_at), updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [lifecycle, lifecycle, text(body.startDate, 10) || now.slice(0, 10), introducer?.id || null, text(body.nextFollowUpAt, 100), now, auth.userId, tenantId, projectId]);
    await run(context.env.DB, `
      INSERT INTO activities (id, tenant_id, project_id, user_id, activity_type, subject, description, outcome, occurred_at, next_action, follow_up_at, created_at)
      VALUES (?, ?, ?, ?, 'LIFECYCLE_CONVERSION', ?, ?, ?, ?, ?, ?, ?)
    `, [makeId('act'), tenantId, projectId, auth.userId, `Converted to ${conversionType}`, text(body.conversionNotes, 10000), introducer ? `Introduced by ${introducer.name}; ${referralPercentage}% on ${referralBasis}` : 'No referral introducer recorded', now, text(body.nextAction, 1000), text(body.nextFollowUpAt, 100), now]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'LEAD_CONVERTED', 'PROJECT', ?, ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, projectId, JSON.stringify({ lifecycleStatus: project.lifecycle_status }), JSON.stringify({ conversionType, lifecycle, createdPartnerId, serviceId, referralId, introducerPartnerId: introducer?.id || null, referralPercentage, referralBasis }), now]);
    return json({ converted: true, projectId, lifecycle, partnerId: createdPartnerId, serviceId, referralId, introducer: introducer ? { id: introducer.id, name: introducer.name } : null, referralPercentage, referralBasis }, 201);
  } catch (cause) {
    console.error('AKARI lead conversion error', cause);
    return error(cause.message || 'Lead could not be converted', Number(cause.status || 500));
  }
}
