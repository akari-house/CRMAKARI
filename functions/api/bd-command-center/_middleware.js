import { json, error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { rankCommandActions } from './index.js';

const BD_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const LEAD_SOURCE = "p.source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')";

function requireBdRole(auth) {
  if (!BD_ROLES.has(auth?.role)) {
    const permissionError = new Error('Business Development permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function queueSummary(actions) {
  const count = (category) => actions.filter((item) => item.category === category).length;
  return {
    dueToday: count('DUE_TODAY'),
    overdueFollowUps: count('OVERDUE_FOLLOW_UP') + count('OPPORTUNITY_OVERDUE'),
    unassigned: count('UNASSIGNED'),
    staleLeads: count('STALE_LEAD'),
    opportunityRisks: count('OPPORTUNITY_RISK'),
    proposalFollowUps: count('PROPOSAL_FOLLOW_UP'),
    closingThisWeek: count('CLOSING_THIS_WEEK'),
    commercialHandoffs: count('CLIENT_BILLING') + count('ENGAGEMENT_HANDOFF') + count('INVOICE_HANDOFF'),
    totalActions: actions.length,
  };
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return context.next();

  try {
    const auth = context.data.auth;
    requireBdRole(auth);
    const tenantId = requireTenant(auth);
    const canManage = MANAGER_ROLES.has(auth?.role);
    const requestedScope = new URL(context.request.url).searchParams.get('scope');
    const scope = canManage && requestedScope === 'team' ? 'TEAM' : 'MINE';

    if (!context.env.DB) {
      return json({
        generatedAt: new Date().toISOString(),
        scope,
        canManage,
        canFinance: Boolean(auth?.financeAccess),
        summary: queueSummary([]),
        rankedActions: [],
        queues: {},
        demo: true,
      });
    }

    const leadOwnerClause = scope === 'MINE' ? 'AND p.owner_user_id = ?' : '';
    const opportunityOwnerClause = scope === 'MINE' ? 'AND o.owner_user_id = ?' : '';
    const leadBindings = scope === 'MINE' ? [tenantId, auth.userId] : [tenantId];
    const opportunityBindings = scope === 'MINE' ? [tenantId, auth.userId] : [tenantId];

    const [leadRows, opportunityRows] = await Promise.all([
      all(context.env.DB, `
        SELECT p.id, p.name, p.lifecycle_status, p.priority, p.owner_user_id,
               p.next_follow_up_at, p.last_activity_at, p.created_at, p.updated_at,
               u.full_name AS owner_name,
               (SELECT MAX(a.occurred_at) FROM activities a
                 WHERE a.tenant_id = p.tenant_id AND a.project_id = p.id) AS latest_activity_at,
               (SELECT COUNT(*) FROM contacts c
                 WHERE c.tenant_id = p.tenant_id AND c.project_id = p.id) AS contact_count
        FROM projects p
        LEFT JOIN users u ON u.id = p.owner_user_id
        WHERE p.tenant_id = ?
          AND ${LEAD_SOURCE}
          AND p.lifecycle_status != 'ARCHIVED'
          ${leadOwnerClause}
        ORDER BY CASE p.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                 COALESCE(p.next_follow_up_at, p.updated_at) ASC
        LIMIT 600
      `, leadBindings),
      all(context.env.DB, `
        SELECT o.id, o.project_id, o.primary_contact_id, o.name, o.service_type,
               o.owner_user_id, o.stage, o.estimated_value, o.currency,
               o.probability_percentage, o.expected_close_date, o.next_action,
               o.next_follow_up_at, o.budget_status, o.need_confirmed,
               o.decision_maker_confirmed, o.timeline_confirmed,
               p.name AS project_name, p.priority AS project_priority,
               p.lifecycle_status AS project_lifecycle_status,
               u.full_name AS owner_name,
               (SELECT COUNT(*) FROM activities pa
                 WHERE pa.tenant_id = o.tenant_id AND pa.opportunity_id = o.id
                   AND pa.activity_type = 'PROPOSAL') AS proposal_count,
               (SELECT pa.outcome FROM activities pa
                 WHERE pa.tenant_id = o.tenant_id AND pa.opportunity_id = o.id
                   AND pa.activity_type = 'PROPOSAL'
                 ORDER BY pa.occurred_at DESC, pa.created_at DESC LIMIT 1) AS latest_proposal_outcome,
               (SELECT COUNT(*) FROM campaigns c
                 WHERE c.tenant_id = o.tenant_id AND c.opportunity_id = o.id
                   AND c.status != 'CANCELLED') AS engagement_count,
               (SELECT COUNT(*) FROM campaigns c
                 WHERE c.tenant_id = o.tenant_id AND c.opportunity_id = o.id
                   AND c.status != 'CANCELLED'
                   AND (c.notes IS NULL OR instr(c.notes, '"invoiceEligible":false') = 0)) AS billable_engagement_count,
               (SELECT COUNT(*) FROM payments pay
                 WHERE pay.tenant_id = o.tenant_id
                   AND pay.payment_type = 'INVOICE'
                   AND pay.status != 'CANCELLED'
                   AND (instr(COALESCE(pay.notes, ''), '"opportunityId":"' || o.id || '"') > 0
                     OR pay.campaign_id IN (SELECT c2.id FROM campaigns c2
                       WHERE c2.tenant_id = o.tenant_id AND c2.opportunity_id = o.id))) AS invoice_count,
               (SELECT cb.description FROM activities cb
                 WHERE cb.tenant_id = o.tenant_id AND cb.project_id = o.project_id
                   AND cb.activity_type = 'CLIENT_BILLING_PROFILE'
                   AND instr(COALESCE(cb.description, ''), '"recordType":"AKARI_CLIENT_BILLING_PROFILE_V1"') > 0
                 ORDER BY cb.occurred_at DESC, cb.created_at DESC LIMIT 1) AS client_billing_description
        FROM opportunities o
        JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
        LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.tenant_id = ?
          AND instr(UPPER(COALESCE(o.service_type, '')), 'FUNDRAISING') = 0
          ${opportunityOwnerClause}
        ORDER BY CASE o.stage WHEN 'NEGOTIATION' THEN 1 WHEN 'VERBAL_CONFIRMATION' THEN 2 WHEN 'PROPOSAL' THEN 3 ELSE 4 END,
                 COALESCE(o.next_follow_up_at, o.expected_close_date, o.updated_at) ASC
        LIMIT 400
      `, opportunityBindings),
    ]);

    const rankedActions = rankCommandActions({
      leads: leadRows,
      opportunities: opportunityRows,
      now: new Date(),
      canManage,
      canFinance: Boolean(auth?.financeAccess),
    });
    const categories = [...new Set(rankedActions.map((item) => item.category))];
    const queues = Object.fromEntries(categories.map((category) => [
      category,
      rankedActions.filter((item) => item.category === category).slice(0, 20),
    ]));

    return json({
      generatedAt: new Date().toISOString(),
      scope,
      canManage,
      canFinance: Boolean(auth?.financeAccess),
      summary: queueSummary(rankedActions),
      rankedActions: rankedActions.slice(0, 30),
      queues,
      evidence: {
        leadRecordsReviewed: leadRows.length,
        opportunityRecordsReviewed: opportunityRows.length,
      },
    });
  } catch (cause) {
    console.error('AKARI BD command centre D1-safe middleware error', cause);
    return error(cause.message || 'BD command centre could not be loaded', Number(cause.status || 500));
  }
}
