import { json, error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseJson } from '../../lib/revenue-lifecycle.js';

const BD_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const LEAD_SOURCE = "p.source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')";
const CLOSED_STAGES = new Set(['WON', 'LOST']);
const PRIORITY_WEIGHT = { URGENT: 18, HIGH: 12, MEDIUM: 6, LOW: 0 };
const CLIENT_BILLING_MARKER = 'AKARI_CLIENT_BILLING_PROFILE_V1';
const REQUIRED_BILLING_FIELDS = ['legalName', 'billingEmail', 'addressLine1', 'city', 'country'];

function requireBdRole(auth) {
  if (!BD_ROLES.has(auth?.role)) {
    const permissionError = new Error('Business Development permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date = new Date()) {
  const value = startOfDay(date);
  value.setDate(value.getDate() + 1);
  value.setMilliseconds(-1);
  return value;
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function daysBetween(later, earlier) {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 86400000));
}

function priorityWeight(priority) {
  return PRIORITY_WEIGHT[String(priority || 'MEDIUM').toUpperCase()] || 0;
}

function urgencyFromScore(score) {
  if (score >= 110) return 'CRITICAL';
  if (score >= 95) return 'HIGH';
  if (score >= 80) return 'MEDIUM';
  return 'NORMAL';
}

function billingReadiness(description) {
  const metadata = parseJson(description, {});
  if (metadata.recordType !== CLIENT_BILLING_MARKER) {
    return { complete: false, missing: [...REQUIRED_BILLING_FIELDS], saved: false };
  }
  const profile = metadata.profile || {};
  const missing = REQUIRED_BILLING_FIELDS.filter((field) => !String(profile[field] || '').trim());
  return { complete: missing.length === 0, missing, saved: true };
}

function makeAction({
  id,
  entityType,
  entityId,
  projectId,
  opportunityId,
  projectName,
  title,
  reason,
  evidence = [],
  score,
  route,
  actionLabel,
  dueAt = null,
  ownerName = null,
  priority = 'MEDIUM',
  category,
}) {
  const safeScore = Math.max(0, Math.round(Number(score || 0)));
  return {
    id,
    entityType,
    entityId,
    projectId: projectId || null,
    opportunityId: opportunityId || null,
    projectName: projectName || null,
    title,
    reason,
    evidence: evidence.filter(Boolean).slice(0, 4),
    score: safeScore,
    urgency: urgencyFromScore(safeScore),
    route,
    actionLabel,
    dueAt,
    ownerName,
    priority: String(priority || 'MEDIUM').toUpperCase(),
    category,
  };
}

export function rankCommandActions({ leads = [], opportunities = [], now = new Date(), canManage = false, canFinance = false }) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const sevenDays = endOfDay(addDays(now, 7));
  const actions = [];

  for (const lead of leads) {
    const priority = String(lead.priority || 'MEDIUM').toUpperCase();
    const weight = priorityWeight(priority);
    const followUp = dateValue(lead.next_follow_up_at);
    const lastActivity = dateValue(lead.last_activity_at || lead.latest_activity_at);
    const createdAt = dateValue(lead.created_at);
    const staleAnchor = lastActivity || createdAt;
    const staleDays = staleAnchor ? daysBetween(now, staleAnchor) : 999;

    if (!lead.owner_user_id && canManage) {
      actions.push(makeAction({
        id: `lead:${lead.id}:assign`,
        entityType: 'PROJECT',
        entityId: lead.id,
        projectId: lead.id,
        projectName: lead.name,
        title: `Assign ${lead.name}`,
        reason: 'No accountable owner is assigned to this active lead.',
        evidence: [`Priority: ${priority}`, lead.next_follow_up_at ? `Follow-up: ${lead.next_follow_up_at}` : 'No follow-up scheduled'],
        score: 102 + weight,
        route: 'leads',
        actionLabel: 'Open lead',
        ownerName: null,
        priority,
        category: 'UNASSIGNED',
      }));
    }

    if (followUp && followUp < todayStart) {
      const overdueDays = Math.max(1, daysBetween(todayStart, followUp));
      actions.push(makeAction({
        id: `lead:${lead.id}:overdue`,
        entityType: 'PROJECT',
        entityId: lead.id,
        projectId: lead.id,
        projectName: lead.name,
        title: `Follow up with ${lead.name}`,
        reason: `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue.`,
        evidence: [`Priority: ${priority}`, `Owner: ${lead.owner_name || 'Unassigned'}`, `Lifecycle: ${lead.lifecycle_status || 'LEAD'}`],
        score: 100 + Math.min(overdueDays, 14) + weight,
        route: 'leads',
        actionLabel: 'Open lead',
        dueAt: lead.next_follow_up_at,
        ownerName: lead.owner_name,
        priority,
        category: 'OVERDUE_FOLLOW_UP',
      }));
    } else if (followUp && followUp <= todayEnd) {
      actions.push(makeAction({
        id: `lead:${lead.id}:today`,
        entityType: 'PROJECT',
        entityId: lead.id,
        projectId: lead.id,
        projectName: lead.name,
        title: `Follow up with ${lead.name} today`,
        reason: 'The next relationship action is due today.',
        evidence: [`Priority: ${priority}`, `Owner: ${lead.owner_name || 'Unassigned'}`],
        score: 86 + weight,
        route: 'leads',
        actionLabel: 'Open lead',
        dueAt: lead.next_follow_up_at,
        ownerName: lead.owner_name,
        priority,
        category: 'DUE_TODAY',
      }));
    } else if (!followUp && lead.lifecycle_status !== 'ARCHIVED') {
      actions.push(makeAction({
        id: `lead:${lead.id}:schedule`,
        entityType: 'PROJECT',
        entityId: lead.id,
        projectId: lead.id,
        projectName: lead.name,
        title: `Schedule the next action for ${lead.name}`,
        reason: 'This active lead has no follow-up date.',
        evidence: [`Priority: ${priority}`, `Last activity: ${lead.last_activity_at || lead.latest_activity_at || 'Never'}`],
        score: 76 + weight + Math.min(staleDays, 12),
        route: 'leads',
        actionLabel: 'Open lead',
        ownerName: lead.owner_name,
        priority,
        category: 'MISSING_FOLLOW_UP',
      }));
    }

    if (staleDays >= 14 && lead.lifecycle_status !== 'ARCHIVED') {
      actions.push(makeAction({
        id: `lead:${lead.id}:stale`,
        entityType: 'PROJECT',
        entityId: lead.id,
        projectId: lead.id,
        projectName: lead.name,
        title: `Review stale lead ${lead.name}`,
        reason: `No recorded activity for ${staleDays} days.`,
        evidence: [`Priority: ${priority}`, `Lifecycle: ${lead.lifecycle_status || 'LEAD'}`, `Owner: ${lead.owner_name || 'Unassigned'}`],
        score: 70 + Math.min(staleDays - 14, 20) + weight,
        route: 'leads',
        actionLabel: 'Review lead',
        ownerName: lead.owner_name,
        priority,
        category: 'STALE_LEAD',
      }));
    }
  }

  for (const opportunity of opportunities) {
    const stage = String(opportunity.stage || 'NEW').toUpperCase();
    const priority = String(opportunity.project_priority || 'MEDIUM').toUpperCase();
    const weight = priorityWeight(priority);
    const followUp = dateValue(opportunity.next_follow_up_at);
    const closeDate = dateValue(opportunity.expected_close_date);
    const isClosed = CLOSED_STAGES.has(stage);
    const missing = [];
    if (!opportunity.owner_user_id) missing.push('owner');
    if (!opportunity.primary_contact_id) missing.push('primary contact');
    if (!String(opportunity.next_action || '').trim() && !isClosed) missing.push('next action');
    if (!opportunity.expected_close_date && !isClosed) missing.push('expected close');

    if (missing.length && !isClosed) {
      actions.push(makeAction({
        id: `opportunity:${opportunity.id}:risk`,
        entityType: 'OPPORTUNITY',
        entityId: opportunity.id,
        projectId: opportunity.project_id,
        opportunityId: opportunity.id,
        projectName: opportunity.project_name,
        title: `Protect ${opportunity.name}`,
        reason: `Missing ${missing.join(', ')}.`,
        evidence: [`Stage: ${stage.replaceAll('_', ' ')}`, `Value: ${opportunity.currency || 'USD'} ${Number(opportunity.estimated_value || 0).toLocaleString('en-US')}`],
        score: 90 + missing.length * 4 + weight + (!opportunity.owner_user_id && canManage ? 5 : 0),
        route: 'opportunities',
        actionLabel: 'Manage deal',
        dueAt: opportunity.next_follow_up_at,
        ownerName: opportunity.owner_name,
        priority,
        category: 'OPPORTUNITY_RISK',
      }));
    }

    if (!isClosed && followUp && followUp < todayStart) {
      const overdueDays = Math.max(1, daysBetween(todayStart, followUp));
      actions.push(makeAction({
        id: `opportunity:${opportunity.id}:overdue`,
        entityType: 'OPPORTUNITY',
        entityId: opportunity.id,
        projectId: opportunity.project_id,
        opportunityId: opportunity.id,
        projectName: opportunity.project_name,
        title: `Progress ${opportunity.name}`,
        reason: `Opportunity follow-up is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue.`,
        evidence: [`Stage: ${stage.replaceAll('_', ' ')}`, `Next action: ${opportunity.next_action || 'Not set'}`, `Owner: ${opportunity.owner_name || 'Unassigned'}`],
        score: 101 + Math.min(overdueDays, 14) + weight,
        route: 'opportunities',
        actionLabel: 'Manage deal',
        dueAt: opportunity.next_follow_up_at,
        ownerName: opportunity.owner_name,
        priority,
        category: 'OPPORTUNITY_OVERDUE',
      }));
    }

    if (!isClosed && closeDate && closeDate >= todayStart && closeDate <= sevenDays) {
      const days = Math.max(0, daysBetween(closeDate, todayStart));
      actions.push(makeAction({
        id: `opportunity:${opportunity.id}:closing`,
        entityType: 'OPPORTUNITY',
        entityId: opportunity.id,
        projectId: opportunity.project_id,
        opportunityId: opportunity.id,
        projectName: opportunity.project_name,
        title: `Close ${opportunity.name}`,
        reason: days === 0 ? 'Expected to close today.' : `Expected to close within ${days} day${days === 1 ? '' : 's'}.`,
        evidence: [`Stage: ${stage.replaceAll('_', ' ')}`, `Value: ${opportunity.currency || 'USD'} ${Number(opportunity.estimated_value || 0).toLocaleString('en-US')}`, `Next action: ${opportunity.next_action || 'Not set'}`],
        score: 94 + Math.max(0, 7 - days) + weight,
        route: 'opportunities',
        actionLabel: 'Manage close',
        dueAt: opportunity.expected_close_date,
        ownerName: opportunity.owner_name,
        priority,
        category: 'CLOSING_THIS_WEEK',
      }));
    }

    if (!isClosed && ['PROPOSAL', 'NEGOTIATION', 'VERBAL_CONFIRMATION'].includes(stage)) {
      actions.push(makeAction({
        id: `opportunity:${opportunity.id}:proposal`,
        entityType: 'OPPORTUNITY',
        entityId: opportunity.id,
        projectId: opportunity.project_id,
        opportunityId: opportunity.id,
        projectName: opportunity.project_name,
        title: `Advance ${opportunity.name}`,
        reason: stage === 'PROPOSAL' ? 'A proposal is awaiting a recorded response.' : stage === 'NEGOTIATION' ? 'Commercial terms are still being negotiated.' : 'Final verbal confirmation needs a controlled close.',
        evidence: [`Stage: ${stage.replaceAll('_', ' ')}`, `Proposal records: ${Number(opportunity.proposal_count || 0)}`, `Latest proposal outcome: ${opportunity.latest_proposal_outcome || 'Not recorded'}`],
        score: 92 + weight + (followUp && followUp < todayStart ? 8 : 0),
        route: 'opportunities',
        actionLabel: 'Open commercial workspace',
        dueAt: opportunity.next_follow_up_at,
        ownerName: opportunity.owner_name,
        priority,
        category: 'PROPOSAL_FOLLOW_UP',
      }));
    }

    if (stage === 'WON') {
      const billing = billingReadiness(opportunity.client_billing_description);
      if (!billing.complete) {
        actions.push(makeAction({
          id: `opportunity:${opportunity.id}:billing`,
          entityType: 'OPPORTUNITY',
          entityId: opportunity.id,
          projectId: opportunity.project_id,
          opportunityId: opportunity.id,
          projectName: opportunity.project_name,
          title: `Complete billing for ${opportunity.project_name}`,
          reason: 'The won deal cannot be safely invoiced until the client billing identity is complete.',
          evidence: [`Missing: ${billing.missing.map((field) => field.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}`, `Engagements: ${Number(opportunity.engagement_count || 0)}`, `Invoices: ${Number(opportunity.invoice_count || 0)}`],
          score: 104 + weight,
          route: 'opportunities',
          actionLabel: 'Complete billing',
          ownerName: opportunity.owner_name,
          priority,
          category: 'CLIENT_BILLING',
        }));
      } else if (Number(opportunity.engagement_count || 0) === 0) {
        actions.push(makeAction({
          id: `opportunity:${opportunity.id}:engagement`,
          entityType: 'OPPORTUNITY',
          entityId: opportunity.id,
          projectId: opportunity.project_id,
          opportunityId: opportunity.id,
          projectName: opportunity.project_name,
          title: `Create the engagement for ${opportunity.project_name}`,
          reason: 'The deal is won, but delivery and commercial economics are not connected.',
          evidence: ['Client billing profile: Complete', `Invoices: ${Number(opportunity.invoice_count || 0)}`],
          score: 102 + weight,
          route: 'opportunities',
          actionLabel: 'Open won deal',
          ownerName: opportunity.owner_name,
          priority,
          category: 'ENGAGEMENT_HANDOFF',
        }));
      } else if (Number(opportunity.invoice_count || 0) === 0) {
        actions.push(makeAction({
          id: `opportunity:${opportunity.id}:invoice`,
          entityType: 'OPPORTUNITY',
          entityId: opportunity.id,
          projectId: opportunity.project_id,
          opportunityId: opportunity.id,
          projectName: opportunity.project_name,
          title: `Issue the first invoice for ${opportunity.project_name}`,
          reason: canFinance ? 'The won deal, client identity and engagement are ready for invoicing.' : 'The won deal is ready for a Finance handoff.',
          evidence: ['Client billing profile: Complete', `Billable engagements: ${Number(opportunity.billable_engagement_count || 0)}`, `Invoices: ${Number(opportunity.invoice_count || 0)}`],
          score: 99 + weight,
          route: canFinance ? 'opportunities' : 'finance',
          actionLabel: canFinance ? 'Create invoice' : 'Handoff to Finance',
          ownerName: opportunity.owner_name,
          priority,
          category: 'INVOICE_HANDOFF',
        }));
      }
    }
  }

  const deduped = new Map();
  for (const action of actions) {
    const existing = deduped.get(action.id);
    if (!existing || action.score > existing.score) deduped.set(action.id, action);
  }
  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || String(a.dueAt || '').localeCompare(String(b.dueAt || '')) || a.title.localeCompare(b.title))
    .slice(0, 100);
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

export async function onRequestGet(context) {
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
                   AND (c.notes NOT LIKE '%\"invoiceEligible\":false%' OR c.notes IS NULL)) AS billable_engagement_count,
               (SELECT COUNT(*) FROM payments pay
                 WHERE pay.tenant_id = o.tenant_id
                   AND pay.payment_type = 'INVOICE'
                   AND pay.status != 'CANCELLED'
                   AND (pay.notes LIKE '%\"opportunityId\":\"' || o.id || '\"%'
                     OR pay.campaign_id IN (SELECT c2.id FROM campaigns c2
                       WHERE c2.tenant_id = o.tenant_id AND c2.opportunity_id = o.id))) AS invoice_count,
               (SELECT cb.description FROM activities cb
                 WHERE cb.tenant_id = o.tenant_id AND cb.project_id = o.project_id
                   AND cb.activity_type = 'CLIENT_BILLING_PROFILE'
                   AND cb.description LIKE '%\"recordType\":\"AKARI_CLIENT_BILLING_PROFILE_V1\"%'
                 ORDER BY cb.occurred_at DESC, cb.created_at DESC LIMIT 1) AS client_billing_description
        FROM opportunities o
        JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
        LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.tenant_id = ?
          AND UPPER(COALESCE(o.service_type, '')) NOT LIKE '%FUNDRAISING%'
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
    console.error('AKARI BD command centre error', cause);
    return error(cause.message || 'BD command centre could not be loaded', Number(cause.status || 500));
  }
}
