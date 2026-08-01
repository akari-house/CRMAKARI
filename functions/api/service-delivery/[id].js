import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseEngagement, text, moneyNumber } from '../../lib/revenue-lifecycle.js';
import { parseFeatureFlags } from '../../lib/commercial-hardening.js';
import {
  DELIVERY_STAGES,
  SYSTEM_DELIVERY_TEMPLATES,
  parseDeliveryRoot,
  serializeDelivery,
  deliverySummary,
  completionBlockers,
  instantiateTemplate,
  sanitizeOnboarding,
  sanitizeMilestone,
  sanitizeDeliverable,
  sanitizeCreator,
  itemDone,
} from '../../lib/service-delivery.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function requireWrite(auth) {
  if (!WRITE_ROLES.has(auth?.role)) {
    const permissionError = new Error('Campaign delivery write permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const permissionError = new Error('Owner, Admin or BD Manager permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.*, p.name AS project_name, p.website AS project_website,
      o.name AS opportunity_name, o.owner_user_id AS opportunity_owner_id,
      cu.full_name AS campaign_owner_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    LEFT JOIN opportunities o ON o.id = c.opportunity_id AND o.tenant_id = c.tenant_id
    LEFT JOIN users cu ON cu.id = c.campaign_owner_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

async function loadMembers(db, tenantId) {
  return all(db, `
    SELECT u.id, u.full_name, u.email, tm.role, tm.finance_access
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    ORDER BY u.full_name COLLATE NOCASE ASC
  `, [tenantId]);
}

async function validateOwner(db, tenantId, ownerUserId) {
  if (!ownerUserId) return null;
  const member = await first(db, `
    SELECT u.id FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.id = ?
    LIMIT 1
  `, [tenantId, ownerUserId]);
  if (!member) {
    const validationError = new Error('Selected owner is not an active member of this workspace');
    validationError.status = 422;
    throw validationError;
  }
  return ownerUserId;
}

function taskStatus(item) {
  if (itemDone(item)) return 'DONE';
  const status = String(item.status || 'NOT_STARTED').toUpperCase();
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (['WAITING','BLOCKED'].includes(status)) return 'WAITING';
  return 'TODO';
}

async function syncTask(db, auth, tenantId, campaign, item, kind) {
  const ownerUserId = item.ownerUserId || campaign.campaign_owner_id || auth.userId;
  await validateOwner(db, tenantId, ownerUserId);
  const now = nowIso();
  const title = kind === 'ONBOARDING' ? `Onboarding: ${item.label}` : kind === 'MILESTONE' ? `Milestone: ${item.title}` : `Deliverable: ${item.title}`;
  const description = [campaign.name, item.notes || item.internalNotes || null, item.evidenceUrl || item.publishedUrl || item.draftUrl || null].filter(Boolean).join('\n');
  const status = taskStatus(item);
  const priority = item.required === false ? 'MEDIUM' : item.dueDate && item.dueDate < now.slice(0, 10) && !itemDone(item) ? 'URGENT' : 'HIGH';
  const dueAt = item.dueDate ? `${item.dueDate}T17:00:00.000Z` : null;
  if (item.taskId) {
    const existing = await first(db, 'SELECT id FROM tasks WHERE tenant_id = ? AND id = ? AND campaign_id = ?', [tenantId, item.taskId, campaign.id]);
    if (existing) {
      await run(db, `
        UPDATE tasks SET title = ?, description = ?, owner_user_id = ?, status = ?, priority = ?, due_at = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ? AND campaign_id = ?
      `, [title, description, ownerUserId, status, priority, dueAt, now, tenantId, item.taskId, campaign.id]);
      return item.taskId;
    }
  }
  const taskId = makeId('tsk');
  await run(db, `
    INSERT INTO tasks (
      id, tenant_id, title, description, owner_user_id, created_by, status, priority,
      due_at, project_id, campaign_id, activity_type, show_on_home, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `, [taskId, tenantId, title, description, ownerUserId, auth.userId, status, priority, dueAt, campaign.project_id, campaign.id, `SERVICE_${kind}`, now, now]);
  return taskId;
}

async function loadTemplates(db, tenantId) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ?', [tenantId]);
  const flags = parseFeatureFlags(row?.feature_flags_json);
  const custom = Array.isArray(flags.serviceDeliveryTemplates) ? flags.serviceDeliveryTemplates.filter((item) => item?.active !== false) : [];
  return [...SYSTEM_DELIVERY_TEMPLATES, ...custom];
}

function publicItem(row, members, financeVisible) {
  const engagement = parseEngagement(row);
  const { delivery } = parseDeliveryRoot(row.notes);
  const summary = deliverySummary(delivery);
  const item = {
    id:row.id,
    projectId:row.project_id,
    projectName:row.project_name,
    projectWebsite:row.project_website,
    opportunityId:row.opportunity_id,
    opportunityName:row.opportunity_name,
    name:row.name,
    status:row.status,
    region:row.region,
    startDate:row.start_date,
    endDate:row.end_date,
    reportingDueDate:row.reporting_due_date,
    nextAction:row.next_action,
    ownerId:delivery.deliveryOwnerId || row.campaign_owner_id,
    ownerName:members.find((member) => member.id === (delivery.deliveryOwnerId || row.campaign_owner_id))?.full_name || row.campaign_owner_name,
    serviceType:delivery.serviceType || engagement.serviceType,
    templateId:delivery.templateId,
    templateName:delivery.templateName,
    onboarding:delivery.onboarding,
    milestones:delivery.milestones,
    deliverables:delivery.deliverables,
    creators:financeVisible ? delivery.creators : delivery.creators.map((creator) => ({ ...creator, reward:null, paymentStatus:null })),
    report:delivery.report,
    completion:delivery.completion,
    renewalOpportunityId:delivery.renewalOpportunityId,
    summary,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  };
  if (financeVisible) {
    Object.assign(item, {
      grossRevenue:engagement.grossRevenue,
      campaignCost:engagement.campaignCost,
      creatorCost:engagement.creatorCost,
      otherCost:engagement.otherCost,
      directCosts:engagement.directCosts,
      marginBeforeReferral:engagement.marginBeforeReferral,
      referralPercentage:engagement.referralPercentage,
      referralReward:engagement.referralReward,
      akariNetRevenue:engagement.akariNetRevenue,
      amountInvoiced:engagement.amountInvoiced,
      amountReceived:engagement.amountReceived,
      outstandingAmount:engagement.outstandingAmount,
      paymentStatus:engagement.paymentStatus,
      currency:engagement.currency,
    });
  }
  return item;
}

async function persist(db, auth, tenantId, row, root, delivery, action, before, extraUpdates = {}) {
  const now = nowIso();
  delivery.updatedAt = now;
  delivery.updatedBy = auth.userId;
  delivery.createdAt ||= now;
  const updates = ['notes = ?', 'updated_at = ?', 'updated_by = ?'];
  const bindings = [serializeDelivery(root, delivery), now, auth.userId];
  const allowed = {
    status:'status', name:'name', startDate:'start_date', endDate:'end_date', reportingDueDate:'reporting_due_date',
    nextAction:'next_action', campaignCost:'campaign_cost', creatorCost:'creator_cost', otherCost:'other_cost',
  };
  Object.entries(extraUpdates).forEach(([key, value]) => {
    if (key === 'grossRevenue') {
      updates.push('gross_revenue = ?', 'gross_revenue_base_currency = ?');
      bindings.push(value, value);
      return;
    }
    if (!allowed[key]) return;
    updates.push(`${allowed[key]} = ?`);
    bindings.push(value);
  });
  bindings.push(tenantId, row.id);
  await run(db, `UPDATE campaigns SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`, bindings);
  await run(db, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'SERVICE_DELIVERY', ?, ?, ?, ?)
  `, [makeId('aud'), tenantId, auth.userId, action, row.id, JSON.stringify(before || {}), JSON.stringify({ summary:deliverySummary(delivery), status:extraUpdates.status || row.status }), now]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Service engagement not found', 404);
    const members = await loadMembers(context.env.DB, tenantId);
    return json({
      item:publicItem(row, members, canViewFinance(auth)),
      members:members.map((member) => ({ id:member.id, fullName:member.full_name, email:member.email, role:member.role })),
      permissions:{ canWrite:WRITE_ROLES.has(auth?.role), canManage:MANAGER_ROLES.has(auth?.role), canFinance:canViewFinance(auth) },
    });
  } catch (cause) {
    return error(cause.message || 'Service delivery workspace could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireWrite(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = String(body.action || '').toLowerCase();
    if (!context.env.DB) return json({ updated:true, action, demo:true });
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Service engagement not found', 404);
    const parsed = parseDeliveryRoot(row.notes);
    const root = parsed.root;
    const delivery = parsed.delivery;
    const before = { status:row.status, summary:deliverySummary(delivery) };
    let response = {};
    let extraUpdates = {};

    if (action === 'apply-template') {
      requireManager(auth);
      const templateId = text(body.templateId, 120);
      const templates = await loadTemplates(context.env.DB, tenantId);
      const template = templates.find((item) => item.id === templateId && item.active !== false);
      if (!template) return error('Service template was not found in this workspace', 404);
      const ownerUserId = await validateOwner(context.env.DB, tenantId, text(body.ownerUserId, 120) || delivery.deliveryOwnerId || row.campaign_owner_id || auth.userId);
      const instantiated = instantiateTemplate(template, body.startDate || row.start_date, ownerUserId);
      if ((delivery.onboarding.length || delivery.milestones.length || delivery.deliverables.length) && !body.replaceExisting) {
        return error('This engagement already has delivery items. Confirm replacement before applying another template.', 409);
      }
      delivery.templateId = template.id;
      delivery.templateName = template.name;
      delivery.serviceType = template.serviceType;
      delivery.deliveryOwnerId = ownerUserId;
      delivery.onboarding = instantiated.onboarding;
      delivery.milestones = instantiated.milestones;
      delivery.deliverables = instantiated.deliverables;
      for (const item of delivery.onboarding) item.taskId = await syncTask(context.env.DB, auth, tenantId, row, item, 'ONBOARDING');
      for (const item of delivery.milestones) item.taskId = await syncTask(context.env.DB, auth, tenantId, row, item, 'MILESTONE');
      for (const item of delivery.deliverables) item.taskId = await syncTask(context.env.DB, auth, tenantId, row, item, 'DELIVERABLE');
      extraUpdates = { status:'ONBOARDING', startDate:body.startDate || row.start_date, nextAction:'Complete client onboarding' };
      response = { templateId:template.id, templateName:template.name };
    } else if (action === 'update-overview') {
      const status = String(body.status || row.status).toUpperCase();
      if (!DELIVERY_STAGES.includes(status)) return error('Engagement status is invalid', 422);
      const ownerUserId = await validateOwner(context.env.DB, tenantId, text(body.ownerUserId, 120) || delivery.deliveryOwnerId || row.campaign_owner_id || auth.userId);
      const financialKeys = ['grossRevenue','campaignCost','creatorCost','otherCost'];
      if (financialKeys.some((key) => hasOwn(body, key)) && !canViewFinance(auth)) return error('Finance permission is required to update commercial values', 403);
      delivery.deliveryOwnerId = ownerUserId;
      delivery.serviceType = text(body.serviceType, 300) || delivery.serviceType;
      extraUpdates = {
        status,
        name:text(body.name, 500) || row.name,
        startDate:text(body.startDate, 30) || row.start_date,
        endDate:hasOwn(body, 'endDate') ? text(body.endDate, 30) : row.end_date,
        reportingDueDate:hasOwn(body, 'reportingDueDate') ? text(body.reportingDueDate, 30) : row.reporting_due_date,
        nextAction:text(body.nextAction, 2000) || row.next_action,
      };
      if (canViewFinance(auth)) {
        if (hasOwn(body, 'grossRevenue')) extraUpdates.grossRevenue = moneyNumber(body.grossRevenue, 'Contract value') || 0;
        if (hasOwn(body, 'campaignCost')) extraUpdates.campaignCost = moneyNumber(body.campaignCost, 'Campaign cost') || 0;
        if (hasOwn(body, 'creatorCost')) extraUpdates.creatorCost = moneyNumber(body.creatorCost, 'Creator cost') || 0;
        if (hasOwn(body, 'otherCost')) extraUpdates.otherCost = moneyNumber(body.otherCost, 'Other cost') || 0;
      }
      response = { status, ownerUserId };
    } else if (['upsert-onboarding','upsert-milestone','upsert-deliverable'].includes(action)) {
      const config = action === 'upsert-onboarding'
        ? { key:'onboarding', kind:'ONBOARDING', sanitize:sanitizeOnboarding }
        : action === 'upsert-milestone'
          ? { key:'milestones', kind:'MILESTONE', sanitize:sanitizeMilestone }
          : { key:'deliverables', kind:'DELIVERABLE', sanitize:sanitizeDeliverable };
      const list = Array.isArray(delivery[config.key]) ? [...delivery[config.key]] : [];
      const index = body.item?.id ? list.findIndex((item) => item.id === body.item.id) : -1;
      const item = config.sanitize(body.item || {}, index >= 0 ? list[index] : {});
      item.ownerUserId = await validateOwner(context.env.DB, tenantId, item.ownerUserId || delivery.deliveryOwnerId || row.campaign_owner_id || auth.userId);
      item.taskId = await syncTask(context.env.DB, auth, tenantId, row, item, config.kind);
      if (index >= 0) list[index] = item;
      else list.push(item);
      delivery[config.key] = list.slice(0, config.key === 'deliverables' ? 250 : 100);
      response = { item, section:config.key };
    } else if (action === 'upsert-creator') {
      const list = Array.isArray(delivery.creators) ? [...delivery.creators] : [];
      const index = body.item?.id ? list.findIndex((item) => item.id === body.item.id) : -1;
      const item = sanitizeCreator(body.item || {}, index >= 0 ? list[index] : {});
      if (hasOwn(body.item || {}, 'reward') && !canViewFinance(auth)) return error('Finance permission is required to update creator rewards', 403);
      if (index >= 0) list[index] = item;
      else list.push(item);
      delivery.creators = list.slice(0, 500);
      response = { item, section:'creators' };
    } else if (action === 'save-report') {
      delivery.report = {
        executiveSummary:text(body.executiveSummary, 12000),
        workCompleted:text(body.workCompleted, 12000),
        results:text(body.results, 12000),
        clientVisibleNotes:text(body.clientVisibleNotes, 12000),
        recommendations:text(body.recommendations, 12000),
        approvedAt:body.approved ? (delivery.report?.approvedAt || nowIso()) : null,
        updatedAt:nowIso(),
        updatedBy:auth.userId,
      };
      extraUpdates = { status:row.status === 'COMPLETED' ? 'COMPLETED' : 'REPORTING', nextAction:body.nextAction ? text(body.nextAction, 2000) : 'Review and approve client report' };
      response = { report:delivery.report };
    } else if (action === 'complete') {
      requireManager(auth);
      const blockers = completionBlockers(delivery);
      if (blockers.length) return error(`Engagement cannot be completed until these are resolved: ${blockers.join(', ')}`, 409);
      delivery.completion = {
        outcome:text(body.outcome, 8000),
        internalLearning:text(body.internalLearning, 8000),
        testimonialStatus:String(body.testimonialStatus || 'NOT_REQUESTED').toUpperCase().slice(0, 50),
        caseStudyPermission:String(body.caseStudyPermission || 'NOT_REQUESTED').toUpperCase().slice(0, 50),
        completedAt:nowIso(),
        completedBy:auth.userId,
      };
      extraUpdates = { status:'COMPLETED', endDate:text(body.endDate, 30) || new Date().toISOString().slice(0, 10), nextAction:'Review renewal and case-study opportunities' };
      response = { completed:true, completion:delivery.completion };
    } else if (action === 'create-renewal') {
      requireManager(auth);
      if (delivery.renewalOpportunityId) return error('A renewal opportunity already exists for this engagement', 409);
      const opportunityId = makeId('opp');
      const now = nowIso();
      const estimatedValue = hasOwn(body, 'estimatedValue') ? moneyNumber(body.estimatedValue, 'Renewal value') || 0 : Number(row.gross_revenue || 0);
      const expectedCloseDate = text(body.expectedCloseDate, 30);
      const name = text(body.name, 500) || `${row.name} renewal`;
      await run(context.env.DB, `
        INSERT INTO opportunities (
          id, tenant_id, project_id, name, service_type, description, owner_user_id,
          stage, estimated_value, currency, estimated_value_base_currency,
          probability_percentage, expected_close_date, next_action, next_follow_up_at,
          created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, 10, ?, ?, ?, ?, ?, ?, ?)
      `, [opportunityId, tenantId, row.project_id, name, delivery.serviceType, text(body.description, 10000) || `Renewal or upsell created from ${row.name}`, delivery.deliveryOwnerId || row.campaign_owner_id || auth.userId, estimatedValue, row.currency || 'USD', estimatedValue, expectedCloseDate, text(body.nextAction, 2000) || 'Confirm renewal scope with client', text(body.nextFollowUpAt, 100), now, now, auth.userId, auth.userId]);
      await run(context.env.DB, `
        INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes)
        VALUES (?, ?, ?, NULL, 'NEW', ?, ?, ?)
      `, [makeId('osh'), tenantId, opportunityId, auth.userId, now, `Created from completed engagement ${row.id}`]);
      delivery.renewalOpportunityId = opportunityId;
      response = { renewalOpportunityId:opportunityId, created:true };
    } else {
      return error('Service delivery action is not supported', 404);
    }

    await persist(context.env.DB, auth, tenantId, row, root, delivery, `SERVICE_DELIVERY_${action.toUpperCase().replaceAll('-', '_')}`, before, extraUpdates);
    const updated = await loadCampaign(context.env.DB, tenantId, row.id);
    const members = await loadMembers(context.env.DB, tenantId);
    return json({ updated:true, action, ...response, item:publicItem(updated, members, canViewFinance(auth)) });
  } catch (cause) {
    console.error('Service delivery action error', cause);
    return error(cause.message || 'Service delivery action failed', Number(cause.status || 500));
  }
}
