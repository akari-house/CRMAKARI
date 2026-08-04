import { json, error } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';

const ALLOWED_ROLES = new Set(['OWNER', 'ADMIN']);

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!ALLOWED_ROLES.has(auth?.role)) return error('Owner or Admin permission is required', 403);
    const tenantId = requireTenant(auth);
    const opportunityId = String(context.params.id || '').trim();
    if (!opportunityId) return error('Opportunity is required', 422);
    if (!context.env.DB) return json({ recovered:false, demo:true });

    const opportunity = await first(context.env.DB, `
      SELECT o.*, p.name AS project_name
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND o.id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (!opportunity) return error('Opportunity not found', 404);
    if (String(opportunity.stage || '').toUpperCase() !== 'WON') return error('Only won opportunities can be recovered', 409);

    const existing = await first(context.env.DB, `
      SELECT id FROM campaigns
      WHERE tenant_id = ? AND opportunity_id = ?
      LIMIT 1
    `, [tenantId, opportunityId]);
    if (existing) return json({ recovered:false, engagementId:existing.id, alreadyExists:true });

    const now = nowIso();
    const engagementId = makeId('eng');
    const value = Number(opportunity.estimated_value || 0);
    const currency = String(opportunity.currency || 'USD').toUpperCase().slice(0, 10);
    const name = `${opportunity.project_name} · ${opportunity.name}`;
    const notes = JSON.stringify({
      recordType:'AKARI_ENGAGEMENT_V2',
      version:2,
      recoveredFromLegacyWon:true,
      sourceOpportunityId:opportunityId,
      invoiceEligible:true,
      dealModel:'SERVICE',
      createdBy:auth.userId,
      createdAt:now,
    });

    await run(context.env.DB, `
      INSERT INTO campaigns (
        id, tenant_id, project_id, opportunity_id, name, campaign_owner_id, status,
        region, start_date, end_date, reporting_due_date, deliverables_summary,
        gross_revenue, currency, gross_revenue_base_currency,
        campaign_cost, creator_cost, other_cost,
        referral_partner_id, referral_percentage,
        amount_invoiced, amount_received, payment_status, next_action, notes,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'ONBOARDING', NULL, ?, NULL, NULL, ?, ?, ?, ?, 0, 0, 0, NULL, 0, 0, 0, 'NOT_INVOICED', ?, ?, ?, ?, ?, ?)
    `, [
      engagementId,
      tenantId,
      opportunity.project_id,
      opportunityId,
      name,
      opportunity.owner_user_id || auth.userId,
      now.slice(0, 10),
      'Recovered engagement for legacy won opportunity',
      value,
      currency,
      value,
      'Complete client onboarding',
      notes,
      now,
      now,
      auth.userId,
      auth.userId,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs (
        id, tenant_id, user_id, action, entity_type, entity_id, after_data,
        ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, 'WON_ENGAGEMENT_RECOVERED', 'OPPORTUNITY', ?, ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, opportunityId,
      JSON.stringify({ engagementId, projectId:opportunity.project_id, value, currency }),
      context.request.headers.get('cf-connecting-ip'),
      context.request.headers.get('user-agent'),
      now,
    ]);

    return json({ recovered:true, engagementId });
  } catch (cause) {
    console.error('AKARI won engagement recovery failed', cause);
    return error(cause.message || 'Engagement recovery failed', Number(cause.status || 500));
  }
}
