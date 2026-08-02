import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseFundraisingFlags } from '../../lib/fundraising-os.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER', 'FINANCE']);
const MANAGER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const STATUSES = new Set(['TODO', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED', 'ARCHIVED']);
const PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const WORKSTREAMS = new Set(['BD', 'ACCOUNT', 'DESIGN', 'CONTENT', 'MARKETING', 'SOCIAL', 'COMMUNITY', 'FUNDRAISING', 'DELIVERY', 'FINANCE', 'OPERATIONS', 'GENERAL']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

function requireWrite(auth) {
  if (!WRITE_ROLES.has(auth?.role)) {
    const permissionError = new Error('Task write permission is required');
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

function iso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const validationError = new Error('Date or time is invalid');
    validationError.status = 422;
    throw validationError;
  }
  return parsed.toISOString();
}

function day(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = value ? new Date(value) : new Date();
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date;
}

function dueAtFromDay(value, hour = 16) {
  const date = new Date(`${value}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  return date.toISOString();
}

function workstreamFromActivity(activityType) {
  const value = String(activityType || '');
  if (value.startsWith('WORKSTREAM:')) return value.split(':')[1] || 'GENERAL';
  if (value.startsWith('PARTNERSHIP_ACTIVATION:')) return value.split(':')[2] || 'BD';
  if (value.startsWith('FUNDRAISING_WORKPLAN:')) return value.split(':')[2] || 'FUNDRAISING';
  if (value.startsWith('SERVICE_')) return 'DELIVERY';
  return 'GENERAL';
}

function activityForWorkstream(existing, requested) {
  const workstream = WORKSTREAMS.has(String(requested || '').toUpperCase()) ? String(requested).toUpperCase() : 'GENERAL';
  const current = String(existing || '');
  if (current.startsWith('PARTNERSHIP_ACTIVATION:')) {
    const parts = current.split(':');
    parts[2] = workstream;
    return parts.join(':');
  }
  if (current.startsWith('FUNDRAISING_WORKPLAN:')) {
    const parts = current.split(':');
    parts[2] = workstream;
    return parts.join(':');
  }
  return `WORKSTREAM:${workstream}`;
}

async function activeMember(db, tenantId, userId) {
  if (!userId) return null;
  return first(db, `
    SELECT u.id, u.full_name, u.email, tm.role
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.user_id = ?
      AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  `, [tenantId, userId]);
}

async function validateOwner(db, tenantId, userId) {
  const member = await activeMember(db, tenantId, userId);
  if (!member) {
    const validationError = new Error('Selected task owner is not an active member of this workspace');
    validationError.status = 422;
    throw validationError;
  }
  return member;
}

async function validateRelations(db, tenantId, input, existing = {}) {
  const requested = {
    projectId: hasOwn(input, 'projectId') ? text(input.projectId, 120) || null : existing.project_id || null,
    contactId: hasOwn(input, 'contactId') ? text(input.contactId, 120) || null : existing.contact_id || null,
    opportunityId: hasOwn(input, 'opportunityId') ? text(input.opportunityId, 120) || null : existing.opportunity_id || null,
    campaignId: hasOwn(input, 'campaignId') ? text(input.campaignId, 120) || null : existing.campaign_id || null,
  };
  let project = null;
  let contact = null;
  let opportunity = null;
  let campaign = null;
  if (requested.projectId) {
    project = await first(db, 'SELECT id, name FROM projects WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, requested.projectId]);
    if (!project) {
      const validationError = new Error('Selected project does not belong to this workspace');
      validationError.status = 422;
      throw validationError;
    }
  }
  if (requested.contactId) {
    contact = await first(db, 'SELECT id, project_id, full_name FROM contacts WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, requested.contactId]);
    if (!contact) {
      const validationError = new Error('Selected contact does not belong to this workspace');
      validationError.status = 422;
      throw validationError;
    }
    requested.projectId ||= contact.project_id;
  }
  if (requested.opportunityId) {
    opportunity = await first(db, 'SELECT id, project_id, name, stage FROM opportunities WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, requested.opportunityId]);
    if (!opportunity) {
      const validationError = new Error('Selected opportunity does not belong to this workspace');
      validationError.status = 422;
      throw validationError;
    }
    requested.projectId ||= opportunity.project_id;
  }
  if (requested.campaignId) {
    campaign = await first(db, 'SELECT id, project_id, opportunity_id, name FROM campaigns WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, requested.campaignId]);
    if (!campaign) {
      const validationError = new Error('Selected campaign does not belong to this workspace');
      validationError.status = 422;
      throw validationError;
    }
    requested.projectId ||= campaign.project_id;
    requested.opportunityId ||= campaign.opportunity_id || null;
  }
  const relatedProjectIds = [contact?.project_id, opportunity?.project_id, campaign?.project_id].filter(Boolean);
  if (requested.projectId && relatedProjectIds.some((id) => id !== requested.projectId)) {
    const validationError = new Error('Selected task relations must belong to the same project');
    validationError.status = 422;
    throw validationError;
  }
  if (requested.opportunityId && campaign?.opportunity_id && campaign.opportunity_id !== requested.opportunityId) {
    const validationError = new Error('Selected campaign and opportunity are not related');
    validationError.status = 422;
    throw validationError;
  }
  return requested;
}

function publicTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    projectId: row.project_id,
    projectName: row.project_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    opportunityId: row.opportunity_id,
    opportunityName: row.opportunity_name,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    activityType: row.activity_type,
    workstream: workstreamFromActivity(row.activity_type),
    recurrenceRule: row.recurrence_rule,
    showOnHome: Boolean(row.show_on_home),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function calendarEvent(type, id, title, startsAt, options = {}) {
  if (!startsAt) return null;
  return {
    id: `${type}:${id}:${startsAt}`,
    sourceId: id,
    type,
    title,
    startsAt,
    date: day(startsAt),
    projectId: options.projectId || null,
    projectName: options.projectName || null,
    relation: options.relation || null,
    status: options.status || null,
    priority: options.priority || null,
    workstream: options.workstream || null,
    readOnly: options.readOnly !== false,
  };
}

async function audit(db, auth, tenantId, action, entityType, entityId, before, after, request) {
  await run(db, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    makeId('aud'), tenantId, auth.userId, action, entityType, entityId,
    JSON.stringify(before || {}), JSON.stringify(after || {}),
    request.headers.get('cf-connecting-ip'), request.headers.get('user-agent'), nowIso(),
  ]);
}

async function taskRows(db, tenantId, auth, scope) {
  const mine = scope === 'mine' ? 'AND t.owner_user_id = ?' : '';
  const bindings = scope === 'mine' ? [tenantId, auth.userId] : [tenantId];
  return all(db, `
    SELECT t.*, p.name AS project_name, c.full_name AS contact_name,
      o.name AS opportunity_name, ca.name AS campaign_name, u.full_name AS owner_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
    LEFT JOIN contacts c ON c.id = t.contact_id AND c.tenant_id = t.tenant_id
    LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
    LEFT JOIN campaigns ca ON ca.id = t.campaign_id AND ca.tenant_id = t.tenant_id
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.tenant_id = ? ${mine} AND t.status NOT IN ('CANCELLED','ARCHIVED')
    ORDER BY CASE t.status WHEN 'TODO' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'WAITING' THEN 3 ELSE 4 END,
      CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
      COALESCE(t.due_at, '9999-12-31') ASC
    LIMIT 500
  `, bindings);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const url = new URL(context.request.url);
    const scope = url.searchParams.get('scope') === 'team' ? 'team' : 'mine';
    const [tasks, members, projects, opportunities, campaigns, projectFollowUps, payments, settingRow] = await Promise.all([
      taskRows(context.env.DB, tenantId, auth, scope),
      all(context.env.DB, `
        SELECT u.id, u.full_name, u.email, tm.role
        FROM tenant_memberships tm JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
        ORDER BY u.full_name COLLATE NOCASE ASC
      `, [tenantId]),
      all(context.env.DB, `
        SELECT id, name, owner_user_id, lifecycle_status, next_follow_up_at
        FROM projects WHERE tenant_id = ? AND lifecycle_status != 'ARCHIVED'
        ORDER BY name COLLATE NOCASE ASC LIMIT 500
      `, [tenantId]),
      all(context.env.DB, `
        SELECT o.id, o.project_id, o.name, o.owner_user_id, o.stage, o.next_follow_up_at,
          o.expected_close_date, p.name AS project_name
        FROM opportunities o JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
        WHERE o.tenant_id = ? ORDER BY o.updated_at DESC LIMIT 500
      `, [tenantId]),
      all(context.env.DB, `
        SELECT c.id, c.project_id, c.opportunity_id, c.name, c.campaign_owner_id, c.status,
          c.start_date, c.end_date, c.reporting_due_date, p.name AS project_name
        FROM campaigns c JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? ORDER BY c.updated_at DESC LIMIT 500
      `, [tenantId]),
      all(context.env.DB, `
        SELECT id, name, next_follow_up_at FROM projects
        WHERE tenant_id = ? AND next_follow_up_at IS NOT NULL AND lifecycle_status != 'ARCHIVED'
        ORDER BY next_follow_up_at ASC LIMIT 300
      `, [tenantId]),
      canViewFinance(auth) ? all(context.env.DB, `
        SELECT pay.id, pay.project_id, pay.campaign_id, pay.invoice_reference, pay.due_date,
          pay.status, p.name AS project_name
        FROM payments pay JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
        WHERE pay.tenant_id = ? AND pay.due_date IS NOT NULL AND pay.status NOT IN ('PAID','CANCELLED')
        ORDER BY pay.due_date ASC LIMIT 200
      `, [tenantId]) : [],
      first(context.env.DB, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]),
    ]);
    const publicTasks = tasks.map(publicTask);
    const events = [];
    for (const task of publicTasks) {
      const event = calendarEvent('TASK', task.id, task.title, task.dueAt, {
        projectId: task.projectId, projectName: task.projectName,
        relation: task.opportunityName || task.campaignName || task.projectName,
        status: task.status, priority: task.priority, workstream: task.workstream, readOnly: false,
      });
      if (event) events.push(event);
    }
    for (const project of projectFollowUps) {
      const event = calendarEvent('PROJECT_FOLLOW_UP', project.id, `Follow up: ${project.name}`, project.next_follow_up_at, {
        projectId: project.id, projectName: project.name, relation: 'Project follow-up', workstream: 'BD',
      });
      if (event) events.push(event);
    }
    for (const opportunity of opportunities) {
      if (opportunity.next_follow_up_at) events.push(calendarEvent('OPPORTUNITY_FOLLOW_UP', opportunity.id, `Opportunity follow-up: ${opportunity.name}`, opportunity.next_follow_up_at, {
        projectId: opportunity.project_id, projectName: opportunity.project_name, relation: opportunity.stage, workstream: 'BD',
      }));
      if (opportunity.expected_close_date && !['WON','LOST'].includes(opportunity.stage)) events.push(calendarEvent('OPPORTUNITY_CLOSE', opportunity.id, `Expected close: ${opportunity.name}`, opportunity.expected_close_date, {
        projectId: opportunity.project_id, projectName: opportunity.project_name, relation: opportunity.stage, workstream: 'BD',
      }));
    }
    for (const campaign of campaigns) {
      const base = { projectId:campaign.project_id, projectName:campaign.project_name, relation:campaign.name, workstream:'DELIVERY' };
      if (campaign.start_date) events.push(calendarEvent('CAMPAIGN_START', campaign.id, `Start: ${campaign.name}`, campaign.start_date, base));
      if (campaign.end_date) events.push(calendarEvent('CAMPAIGN_END', campaign.id, `Target completion: ${campaign.name}`, campaign.end_date, base));
      if (campaign.reporting_due_date) events.push(calendarEvent('REPORT_DUE', campaign.id, `Report due: ${campaign.name}`, campaign.reporting_due_date, base));
    }
    for (const payment of payments) {
      events.push(calendarEvent('PAYMENT_DUE', payment.id, `Payment due: ${payment.invoice_reference || payment.project_name}`, payment.due_date, {
        projectId:payment.project_id, projectName:payment.project_name, relation:payment.status, workstream:'FINANCE',
      }));
    }
    const { rooms } = parseFundraisingFlags(settingRow?.feature_flags_json);
    const roomPlans = [];
    for (const room of rooms) {
      const project = projects.find((item) => item.id === room.projectId);
      if (room.targetCloseDate) events.push(calendarEvent('FUNDRAISING_CLOSE', room.id, `Target close: ${room.projectName || project?.name || room.roundName}`, room.targetCloseDate, {
        projectId:room.projectId, projectName:room.projectName || project?.name, relation:room.roundName, workstream:'FUNDRAISING',
      }));
      for (const investor of room.investorPipeline || []) {
        if (investor.nextFollowUpAt) events.push(calendarEvent('INVESTOR_FOLLOW_UP', investor.id, `Investor follow-up: ${investor.investorName}`, investor.nextFollowUpAt, {
          projectId:room.projectId, projectName:room.projectName || project?.name, relation:room.roundName, workstream:'FUNDRAISING',
        }));
      }
      for (const request of room.diligenceRequests || []) {
        if (request.dueDate) events.push(calendarEvent('DILIGENCE_DUE', request.id, `Diligence due: ${request.title}`, request.dueDate, {
          projectId:room.projectId, projectName:room.projectName || project?.name, relation:room.roundName, workstream:'FUNDRAISING',
        }));
      }
      const prefix = `FUNDRAISING_WORKPLAN:${room.id}:`;
      const hasPlan = tasks.some((task) => String(task.activity_type || '').startsWith(prefix));
      if (!hasPlan && !['CLOSED', 'PAUSED'].includes(String(room.stage || '').toUpperCase())) {
        roomPlans.push({ id:room.id, projectId:room.projectId, projectName:room.projectName || project?.name, roundName:room.roundName, stage:room.stage, targetCloseDate:room.targetCloseDate });
      }
    }
    const partnershipCandidates = opportunities.filter((opportunity) => {
      if (opportunity.stage !== 'WON') return false;
      const prefix = `PARTNERSHIP_ACTIVATION:${opportunity.id}:`;
      return !tasks.some((task) => String(task.activity_type || '').startsWith(prefix));
    }).map((opportunity) => {
      const campaign = campaigns.find((item) => item.opportunity_id === opportunity.id);
      return {
        opportunityId:opportunity.id,
        opportunityName:opportunity.name,
        projectId:opportunity.project_id,
        projectName:opportunity.project_name,
        campaignId:campaign?.id || null,
        campaignName:campaign?.name || null,
        ownerUserId:opportunity.owner_user_id || campaign?.campaign_owner_id || null,
      };
    });
    return json({
      scope,
      tasks:publicTasks,
      members:members.map((member) => ({ id:member.id, fullName:member.full_name, email:member.email, role:member.role })),
      projects:projects.map((project) => ({ id:project.id, name:project.name, ownerUserId:project.owner_user_id, lifecycleStatus:project.lifecycle_status })),
      opportunities:opportunities.map((item) => ({ id:item.id, projectId:item.project_id, name:item.name, projectName:item.project_name, stage:item.stage, ownerUserId:item.owner_user_id })),
      campaigns:campaigns.map((item) => ({ id:item.id, projectId:item.project_id, opportunityId:item.opportunity_id, name:item.name, projectName:item.project_name, status:item.status, ownerUserId:item.campaign_owner_id })),
      calendarEvents:events.filter(Boolean).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
      partnershipCandidates,
      fundraisingPlans:roomPlans,
      permissions:{ canWrite:WRITE_ROLES.has(auth?.role), canManage:MANAGER_ROLES.has(auth?.role), canFinance:canViewFinance(auth) },
    });
  } catch (cause) {
    return error(cause.message || 'Work OS could not be loaded', Number(cause.status || 500));
  }
}

async function createTask(context, body) {
  const auth = context.data.auth;
  requireWrite(auth);
  const tenantId = requireTenant(auth);
  const title = text(body.title, 500);
  if (!title) return error('Task title is required', 422);
  const ownerUserId = text(body.ownerUserId, 120) || auth.userId;
  await validateOwner(context.env.DB, tenantId, ownerUserId);
  const relations = await validateRelations(context.env.DB, tenantId, body);
  const status = String(body.status || 'TODO').toUpperCase();
  const priority = String(body.priority || 'MEDIUM').toUpperCase();
  if (!STATUSES.has(status)) return error('Task status is invalid', 422);
  if (!PRIORITIES.has(priority)) return error('Task priority is invalid', 422);
  const id = makeId('tsk');
  const now = nowIso();
  const activityType = activityForWorkstream(null, body.workstream);
  await run(context.env.DB, `
    INSERT INTO tasks (
      id, tenant_id, title, description, owner_user_id, created_by, status, priority, due_at,
      completed_at, project_id, contact_id, opportunity_id, campaign_id, activity_type,
      recurrence_rule, show_on_home, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, tenantId, title, text(body.description, 12000) || null, ownerUserId, auth.userId,
    status, priority, iso(body.dueAt), status === 'DONE' ? now : null,
    relations.projectId, relations.contactId, relations.opportunityId, relations.campaignId,
    activityType, text(body.recurrenceRule, 500) || null, body.showOnHome === false ? 0 : 1, now, now,
  ]);
  await audit(context.env.DB, auth, tenantId, 'WORK_OS_TASK_CREATED', 'TASK', id, null, { title, ownerUserId, ...relations, activityType }, context.request);
  return json({ created:true, id }, 201);
}

async function updateTask(context, body) {
  const auth = context.data.auth;
  requireWrite(auth);
  const tenantId = requireTenant(auth);
  const taskId = text(body.taskId, 120);
  const existing = await first(context.env.DB, 'SELECT * FROM tasks WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, taskId]);
  if (!existing) return error('Task was not found in this workspace', 404);
  const updates = [];
  const bindings = [];
  const after = {};
  if (hasOwn(body, 'title')) {
    const title = text(body.title, 500);
    if (!title) return error('Task title is required', 422);
    updates.push('title = ?'); bindings.push(title); after.title = title;
  }
  if (hasOwn(body, 'description')) { const value = text(body.description, 12000) || null; updates.push('description = ?'); bindings.push(value); after.description = value; }
  if (hasOwn(body, 'status')) {
    const status = String(body.status || '').toUpperCase();
    if (!STATUSES.has(status)) return error('Task status is invalid', 422);
    updates.push('status = ?', 'completed_at = ?'); bindings.push(status, status === 'DONE' ? nowIso() : null); after.status = status;
  }
  if (hasOwn(body, 'priority')) {
    const priority = String(body.priority || '').toUpperCase();
    if (!PRIORITIES.has(priority)) return error('Task priority is invalid', 422);
    updates.push('priority = ?'); bindings.push(priority); after.priority = priority;
  }
  if (hasOwn(body, 'dueAt')) { const value = iso(body.dueAt); updates.push('due_at = ?'); bindings.push(value); after.dueAt = value; }
  if (hasOwn(body, 'ownerUserId')) {
    const ownerUserId = text(body.ownerUserId, 120);
    await validateOwner(context.env.DB, tenantId, ownerUserId);
    updates.push('owner_user_id = ?'); bindings.push(ownerUserId); after.ownerUserId = ownerUserId;
  }
  if (['projectId','contactId','opportunityId','campaignId'].some((key) => hasOwn(body, key))) {
    const relations = await validateRelations(context.env.DB, tenantId, body, existing);
    updates.push('project_id = ?', 'contact_id = ?', 'opportunity_id = ?', 'campaign_id = ?');
    bindings.push(relations.projectId, relations.contactId, relations.opportunityId, relations.campaignId);
    Object.assign(after, relations);
  }
  if (hasOwn(body, 'workstream')) {
    const activityType = activityForWorkstream(existing.activity_type, body.workstream);
    updates.push('activity_type = ?'); bindings.push(activityType); after.activityType = activityType;
  }
  if (hasOwn(body, 'recurrenceRule')) { const value = text(body.recurrenceRule, 500) || null; updates.push('recurrence_rule = ?'); bindings.push(value); after.recurrenceRule = value; }
  if (hasOwn(body, 'showOnHome')) { const value = body.showOnHome === false ? 0 : 1; updates.push('show_on_home = ?'); bindings.push(value); after.showOnHome = Boolean(value); }
  if (!updates.length) return error('No task changes were provided', 422);
  const now = nowIso();
  updates.push('updated_at = ?'); bindings.push(now, tenantId, taskId);
  await run(context.env.DB, `UPDATE tasks SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`, bindings);
  await audit(context.env.DB, auth, tenantId, 'WORK_OS_TASK_UPDATED', 'TASK', taskId, publicTask(existing), after, context.request);
  return json({ updated:true, id:taskId });
}

async function createTemplateTasks(db, auth, tenantId, request, contextData, items, markerPrefix) {
  const now = nowIso();
  const created = [];
  for (const item of items) {
    const id = makeId('tsk');
    await run(db, `
      INSERT INTO tasks (
        id, tenant_id, title, description, owner_user_id, created_by, status, priority, due_at,
        project_id, opportunity_id, campaign_id, activity_type, show_on_home, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'TODO', ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      id, tenantId, item.title, item.description || null, item.ownerUserId, auth.userId,
      item.priority || 'HIGH', item.dueAt || null, contextData.projectId,
      contextData.opportunityId || null, contextData.campaignId || null,
      `${markerPrefix}:${item.workstream}:${item.slug}`, now, now,
    ]);
    created.push({ id, title:item.title, ownerUserId:item.ownerUserId, dueAt:item.dueAt, workstream:item.workstream });
  }
  await audit(db, auth, tenantId, 'WORK_OS_TEMPLATE_STARTED', 'WORKFLOW_TEMPLATE', markerPrefix, null, { ...contextData, tasks:created }, request);
  return created;
}

async function startPartnershipActivation(context, body) {
  const auth = context.data.auth;
  requireManager(auth);
  const tenantId = requireTenant(auth);
  const opportunityId = text(body.opportunityId, 120);
  const opportunity = await first(context.env.DB, `
    SELECT o.id, o.project_id, o.name, o.stage, o.owner_user_id, p.name AS project_name
    FROM opportunities o JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
    WHERE o.tenant_id = ? AND o.id = ? LIMIT 1
  `, [tenantId, opportunityId]);
  if (!opportunity) return error('Opportunity was not found in this workspace', 404);
  if (opportunity.stage !== 'WON') return error('Partnership activation can start only after the opportunity is won', 409);
  const campaign = await first(context.env.DB, `
    SELECT id, name, campaign_owner_id FROM campaigns
    WHERE tenant_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1
  `, [tenantId, opportunityId]);
  const duplicate = await first(context.env.DB, `
    SELECT id FROM tasks WHERE tenant_id = ? AND activity_type LIKE ? LIMIT 1
  `, [tenantId, `PARTNERSHIP_ACTIVATION:${opportunityId}:%`]);
  if (duplicate) return error('A partnership activation plan already exists for this opportunity', 409);
  const relationshipOwnerId = text(body.relationshipOwnerId, 120) || opportunity.owner_user_id || campaign?.campaign_owner_id || auth.userId;
  const marketingOwnerId = text(body.marketingOwnerId, 120) || relationshipOwnerId;
  const designOwnerId = text(body.designOwnerId, 120) || marketingOwnerId;
  await Promise.all([
    validateOwner(context.env.DB, tenantId, relationshipOwnerId),
    validateOwner(context.env.DB, tenantId, marketingOwnerId),
    validateOwner(context.env.DB, tenantId, designOwnerId),
  ]);
  const launchDay = day(body.launchDate) || addDays(new Date(), 7).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const launchMinusOne = addDays(`${launchDay}T00:00:00Z`, -1).toISOString().slice(0, 10);
  const launchPlusOne = addDays(`${launchDay}T00:00:00Z`, 1).toISOString().slice(0, 10);
  const launchPlusSeven = addDays(`${launchDay}T00:00:00Z`, 7).toISOString().slice(0, 10);
  const tasks = [
    { slug:'confirm-scope', title:'Confirm partnership scope and announcement details', workstream:'BD', ownerUserId:relationshipOwnerId, dueAt:dueAtFromDay(today, 15), priority:'URGENT' },
    { slug:'collect-assets', title:'Collect partner logo, brand kit and official links', workstream:'OPERATIONS', ownerUserId:relationshipOwnerId, dueAt:dueAtFromDay(addDays(new Date(), 1).toISOString().slice(0,10), 16), description:'Required before design and scheduling.' },
    { slug:'draft-copy', title:'Draft partnership announcement copy and quotes', workstream:'CONTENT', ownerUserId:marketingOwnerId, dueAt:dueAtFromDay(addDays(new Date(), 2).toISOString().slice(0,10), 15), description:'Depends on confirmed scope and partner messaging.' },
    { slug:'create-design', title:'Create partnership announcement graphics', workstream:'DESIGN', ownerUserId:designOwnerId, dueAt:dueAtFromDay(addDays(new Date(), 2).toISOString().slice(0,10), 17), description:'Use the approved AKARI and partner brand assets.' },
    { slug:'internal-review', title:'Review announcement copy and design internally', workstream:'BD', ownerUserId:relationshipOwnerId, dueAt:dueAtFromDay(addDays(new Date(), 3).toISOString().slice(0,10), 14), description:'Review scope accuracy, logos, links and claims.' },
    { slug:'partner-approval', title:'Send announcement materials for partner approval', workstream:'ACCOUNT', ownerUserId:relationshipOwnerId, dueAt:dueAtFromDay(addDays(new Date(), 3).toISOString().slice(0,10), 17), description:'Record requested changes and final approval.' },
    { slug:'confirm-launch', title:'Confirm announcement date, channels and posting order', workstream:'MARKETING', ownerUserId:marketingOwnerId, dueAt:dueAtFromDay(addDays(new Date(), 4).toISOString().slice(0,10), 16) },
    { slug:'schedule', title:'Schedule partnership announcement', workstream:'SOCIAL', ownerUserId:marketingOwnerId, dueAt:dueAtFromDay(launchMinusOne, 16), description:`Target launch: ${launchDay}. Confirm final partner approval before scheduling.` },
    { slug:'publish', title:'Publish partnership announcement and record links', workstream:'MARKETING', ownerUserId:marketingOwnerId, dueAt:dueAtFromDay(launchDay, 12), priority:'URGENT' },
    { slug:'engagement', title:'Complete community engagement and partner follow-up', workstream:'COMMUNITY', ownerUserId:marketingOwnerId, dueAt:dueAtFromDay(launchPlusOne, 16) },
    { slug:'next-activation', title:'Review results and plan the next joint activation', workstream:'ACCOUNT', ownerUserId:relationshipOwnerId, dueAt:dueAtFromDay(launchPlusSeven, 16) },
  ];
  const created = await createTemplateTasks(context.env.DB, auth, tenantId, context.request, {
    projectId:opportunity.project_id, projectName:opportunity.project_name,
    opportunityId, opportunityName:opportunity.name, campaignId:campaign?.id || null, launchDate:launchDay,
  }, tasks, `PARTNERSHIP_ACTIVATION:${opportunityId}`);
  await run(context.env.DB, `
    UPDATE opportunities SET next_action = ?, next_follow_up_at = ?, updated_at = ?, updated_by = ?
    WHERE tenant_id = ? AND id = ?
  `, ['Complete partnership activation plan', tasks[0].dueAt, nowIso(), auth.userId, tenantId, opportunityId]);
  if (campaign?.id) await run(context.env.DB, `
    UPDATE campaigns SET next_action = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?
  `, ['Prepare and launch partnership announcement', nowIso(), auth.userId, tenantId, campaign.id]);
  return json({ started:true, created:created.length, tasks:created, launchDate:launchDay });
}

async function startFundraisingWorkplan(context, body) {
  const auth = context.data.auth;
  requireManager(auth);
  const tenantId = requireTenant(auth);
  const roomId = text(body.roomId, 120);
  const settingRow = await first(context.env.DB, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const { rooms } = parseFundraisingFlags(settingRow?.feature_flags_json);
  const room = rooms.find((item) => item.id === roomId);
  if (!room) return error('Capital Room was not found in this workspace', 404);
  const project = await first(context.env.DB, 'SELECT id, name FROM projects WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, room.projectId]);
  if (!project) return error('Capital Room project was not found in this workspace', 404);
  const duplicate = await first(context.env.DB, 'SELECT id FROM tasks WHERE tenant_id = ? AND activity_type LIKE ? LIMIT 1', [tenantId, `FUNDRAISING_WORKPLAN:${roomId}:%`]);
  if (duplicate) return error('A fundraising work plan already exists for this Capital Room', 409);
  const fundraisingOwnerId = text(body.fundraisingOwnerId, 120) || room.ownerUserId || auth.userId;
  const contentOwnerId = text(body.contentOwnerId, 120) || fundraisingOwnerId;
  const designOwnerId = text(body.designOwnerId, 120) || contentOwnerId;
  await Promise.all([
    validateOwner(context.env.DB, tenantId, fundraisingOwnerId),
    validateOwner(context.env.DB, tenantId, contentOwnerId),
    validateOwner(context.env.DB, tenantId, designOwnerId),
  ]);
  const base = new Date();
  const tasks = [
    { slug:'mandate-brief', title:'Confirm fundraising mandate, round structure and close target', workstream:'FUNDRAISING', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,0).toISOString(), priority:'URGENT' },
    { slug:'readiness-gaps', title:'Complete fundraising readiness gaps and owner assignments', workstream:'FUNDRAISING', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,2).toISOString() },
    { slug:'data-room-index', title:'Prepare secure fundraising data-room index', workstream:'OPERATIONS', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,3).toISOString() },
    { slug:'pitch-narrative', title:'Draft pitch narrative, investor summary and outreach messages', workstream:'CONTENT', ownerUserId:contentOwnerId, dueAt:addDays(base,4).toISOString() },
    { slug:'pitch-design', title:'Review pitch deck and fundraising visual materials', workstream:'DESIGN', ownerUserId:designOwnerId, dueAt:addDays(base,5).toISOString() },
    { slug:'investor-list', title:'Build and score the first investor target list', workstream:'FUNDRAISING', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,5).toISOString() },
    { slug:'founder-approval', title:'Obtain founder approval for investor targets and introductions', workstream:'FUNDRAISING', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,6).toISOString(), description:'No introduction should proceed before founder approval is recorded.' },
    { slug:'outreach-start', title:'Start approved investor introductions and outreach', workstream:'FUNDRAISING', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,7).toISOString(), priority:'HIGH' },
    { slug:'update-cadence', title:'Set investor follow-up and reporting cadence', workstream:'FUNDRAISING', ownerUserId:fundraisingOwnerId, dueAt:addDays(base,8).toISOString() },
  ];
  const created = await createTemplateTasks(context.env.DB, auth, tenantId, context.request, {
    projectId:room.projectId, projectName:room.projectName || project.name, roomId, roundName:room.roundName,
  }, tasks, `FUNDRAISING_WORKPLAN:${roomId}`);
  return json({ started:true, created:created.length, tasks:created });
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const action = String(body.action || '').toLowerCase();
    if (action === 'create-task') return await createTask(context, body);
    if (action === 'update-task') return await updateTask(context, body);
    if (action === 'start-partnership-activation') return await startPartnershipActivation(context, body);
    if (action === 'start-fundraising-workplan') return await startFundraisingWorkplan(context, body);
    return error('Work OS action is not supported', 404);
  } catch (cause) {
    return error(cause.message || 'Work OS action failed', Number(cause.status || 500));
  }
}
