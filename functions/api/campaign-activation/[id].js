import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking } from '../../lib/campaign-tracking.js';
import { parseCampaignPlanning } from '../../lib/campaign-planning.js';
import {
  parseCampaignActivation,
  buildCampaignActivationSummary,
  assertCampaignActivationReady,
  assertCampaignActivationCompletable,
} from '../../lib/campaign-activation.js';

const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const cause = new Error('Owner, Admin or BD Manager permission is required');
    cause.status = 403;
    throw cause;
  }
}

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,c.project_id,
      c.opportunity_id,c.campaign_owner_id,p.name AS project_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

async function activeMember(db, tenantId, userId) {
  if (!userId) return null;
  return first(db, `
    SELECT u.id,u.full_name,u.email,tm.role
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.user_id = ?
      AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  `, [tenantId, userId]);
}

async function members(db, tenantId) {
  return all(db, `
    SELECT u.id,u.full_name,u.email,tm.role
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    ORDER BY u.full_name COLLATE NOCASE
  `, [tenantId]);
}

async function activationTasks(db, tenantId, campaignId, taskIds = []) {
  const ids = [...new Set((taskIds || []).map((id) => text(id, 120)).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return all(db, `
    SELECT t.id,t.title,t.description,t.owner_user_id,t.status,t.priority,t.due_at,t.activity_type,
      t.created_at,t.updated_at,u.full_name AS owner_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.tenant_id = ? AND t.campaign_id = ? AND t.id IN (${placeholders})
    ORDER BY COALESCE(t.due_at,'9999-12-31') ASC,t.created_at ASC
  `, [tenantId, campaignId, ...ids]);
}

function dateOnly(value, fallback) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return fallback;
}

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0,10);
}

function midpoint(startDay, endDay) {
  const start = new Date(`${startDay}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDay}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return addDays(startDay, 3);
  return new Date(start + ((end - start) / 2)).toISOString().slice(0,10);
}

function dueAt(day, hour = 16) {
  return `${day}T${String(hour).padStart(2,'0')}:00:00.000Z`;
}

function taskBlueprints(row, tracking, ownerUserId) {
  const today = nowIso().slice(0,10);
  const start = dateOnly(row.start_date, today);
  const end = dateOnly(row.end_date, addDays(start, 14));
  const mid = midpoint(start, end);
  const activeTalent = (tracking.creatorAssignments || []).filter((item) => item.active !== false);
  const planFingerprintNote = 'This task is linked to the approved campaign activation snapshot. Activation is internal execution readiness and does not assert Creator/KOL acceptance or consent.';
  const items = [
    {
      slug:'kickoff', phase:'LAUNCH', title:`Campaign kickoff & execution brief — ${row.name}`,
      description:`Confirm owners, final brief, campaign dates, deliverables and escalation path. ${planFingerprintNote}`,
      priority:'HIGH', dueAt:dueAt(start, 10), ownerUserId,
    },
    {
      slug:'measurement-baseline', phase:'LAUNCH', title:'Verify campaign tracking & measurement baseline',
      description:'Confirm platform links, campaign baselines, Approved-only performance rules and reporting ownership before execution begins.',
      priority:'HIGH', dueAt:dueAt(start, 12), ownerUserId,
    },
    {
      slug:'launch-readiness', phase:'LAUNCH', title:'Confirm launch readiness & approved talent basket',
      description:`Verify the approved plan fingerprint, budget reconciliation and active Creator/KOL deliverables. ${planFingerprintNote}`,
      priority:'URGENT', dueAt:dueAt(start, 14), ownerUserId,
    },
    ...activeTalent.map((assignment) => ({
      slug:`talent-${assignment.id}`, phase:'EXECUTION', assignmentId:assignment.id,
      title:`Deliver & monitor ${Number(assignment.expectedPosts || 0)} Approved post${Number(assignment.expectedPosts || 0) === 1 ? '' : 's'} — ${assignment.name || assignment.handle || 'Creator/KOL'}`,
      description:`Platform: ${assignment.platform || 'N/A'}. Expected reach: ${Number(assignment.expectedReach || 0).toLocaleString()}. Record published URLs and performance in Campaign Tracking. Holding/Rejected posts do not count toward delivery performance. Activation does not assert external acceptance or consent.`,
      priority:'HIGH', dueAt:dueAt(end, 12), ownerUserId,
    })),
    {
      slug:'mid-performance', phase:'MONITORING', title:'Run mid-campaign performance review',
      description:'Review Approved posts, reach, engagements, pacing and delivery risk. Escalate blockers without altering the approved basket silently.',
      priority:'MEDIUM', dueAt:dueAt(mid, 16), ownerUserId,
    },
    {
      slug:'final-reconciliation', phase:'CLOSEOUT', title:'Reconcile final delivery & hand off to settlement',
      description:'Confirm planned Approved post commitments, final performance evidence and any unresolved Holding/Rejected items before settlement review.',
      priority:'HIGH', dueAt:dueAt(end, 17), ownerUserId,
    },
  ];
  return items;
}

async function createExecutionTasks(db, auth, tenantId, row, tracking, ownerUserId) {
  const prefix = `SERVICE_CAMPAIGN_ACTIVATION:${row.id}:`;
  const duplicate = await first(db, `
    SELECT id FROM tasks
    WHERE tenant_id = ? AND campaign_id = ? AND activity_type LIKE ?
    LIMIT 1
  `, [tenantId, row.id, `${prefix}%`]);
  if (duplicate) {
    const cause = new Error('A campaign activation task plan already exists for this campaign');
    cause.status = 409;
    throw cause;
  }
  const now = nowIso();
  const plan = [];
  for (const item of taskBlueprints(row, tracking, ownerUserId)) {
    const id = makeId('tsk');
    await run(db, `
      INSERT INTO tasks (
        id,tenant_id,title,description,owner_user_id,created_by,status,priority,due_at,
        project_id,opportunity_id,campaign_id,activity_type,show_on_home,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'TODO', ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      id,tenantId,item.title,item.description,item.ownerUserId,auth.userId,item.priority,item.dueAt,
      row.project_id,row.opportunity_id || null,row.id,`${prefix}${item.slug}`,now,now,
    ]);
    plan.push({ id, slug:item.slug, title:item.title, ownerUserId:item.ownerUserId, dueAt:item.dueAt, phase:item.phase, assignmentId:item.assignmentId || null });
  }
  return plan;
}

async function persist(db, auth, tenantId, row, root, tracking, planning, activation, action, beforeSummary, request) {
  const now = nowIso();
  activation.lastModifiedAt = now;
  activation.lastModifiedBy = auth.userId;
  const notes = JSON.stringify({ ...root, campaignTracking:tracking, campaignPlanning:planning, campaignActivation:activation });
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [notes, now, auth.userId, tenantId, row.id]);
  const taskRows = await activationTasks(db, tenantId, row.id, activation.taskIds);
  const afterSummary = buildCampaignActivationSummary(tracking, planning, activation, taskRows);
  await run(db, `
    INSERT INTO audit_logs (
      id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,ip_address,user_agent,created_at
    ) VALUES (?, ?, ?, ?, 'CAMPAIGN_ACTIVATION', ?, ?, ?, ?, ?, ?)
  `, [
    makeId('aud'),tenantId,auth.userId,action,row.id,JSON.stringify(beforeSummary || {}),JSON.stringify(afterSummary),
    request.headers.get('cf-connecting-ip'),request.headers.get('user-agent'),now,
  ]);
  return taskRows;
}

function publicTask(row, activation) {
  const meta = (activation.taskPlan || []).find((item) => item.id === row.id) || {};
  return {
    id:row.id,
    slug:meta.slug || null,
    phase:meta.phase || 'EXECUTION',
    assignmentId:meta.assignmentId || null,
    title:row.title,
    description:row.description,
    ownerUserId:row.owner_user_id,
    ownerName:row.owner_name || null,
    status:row.status,
    priority:row.priority,
    dueAt:row.due_at,
    activityType:row.activity_type,
  };
}

async function payload(db, tenantId, row, root, tracking, auth) {
  const planning = parseCampaignPlanning(root);
  const activation = parseCampaignActivation(root);
  const [taskRows, memberRows] = await Promise.all([
    activationTasks(db, tenantId, row.id, activation.taskIds),
    members(db, tenantId),
  ]);
  const summary = buildCampaignActivationSummary(tracking, planning, activation, taskRows);
  const owner = activation.executionOwnerId ? memberRows.find((item) => item.id === activation.executionOwnerId) : null;
  return {
    item:{
      id:row.id,
      name:row.name,
      projectId:row.project_id,
      projectName:row.project_name,
      campaignStatus:row.status,
      startDate:row.start_date,
      endDate:row.end_date,
      planningStatus:planning.status,
      activation:{ ...activation, executionOwnerName:owner?.full_name || null },
      summary,
      tasks:taskRows.map((task) => publicTask(task, activation)),
    },
    members:memberRows,
    permissions:{ canManage:MANAGER_ROLES.has(auth?.role) },
    methodology:{ version:'R8.5I-1', canonicalTasks:true, approvedPlanSnapshot:true, creatorAcceptanceSeparate:true },
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    return json(await payload(context.env.DB, tenantId, row, root, tracking, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign activation workspace could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireManager(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = text(body.action, 100).toLowerCase();
    if (!context.env.DB) return json({ updated:true, action, demo:true });
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    const planning = parseCampaignPlanning(root);
    let activation = parseCampaignActivation(root);
    let taskRows = await activationTasks(context.env.DB, tenantId, row.id, activation.taskIds);
    const beforeSummary = buildCampaignActivationSummary(tracking, planning, activation, taskRows);

    if (action === 'activate') {
      if (activation.status !== 'NOT_ACTIVATED') return error('Campaign execution has already been activated', 409);
      assertCampaignActivationReady(beforeSummary);
      const executionOwnerId = text(body.executionOwnerId, 120) || row.campaign_owner_id || auth.userId;
      const owner = await activeMember(context.env.DB, tenantId, executionOwnerId);
      if (!owner) return error('Selected execution owner is not an active member of this workspace', 422);
      const plan = await createExecutionTasks(context.env.DB, auth, tenantId, row, tracking, executionOwnerId);
      const now = nowIso();
      activation = {
        ...activation,
        status:'ACTIVE',
        executionOwnerId,
        activationNote:text(body.note, 5000),
        approvedPlanFingerprint:beforeSummary.currentPlanFingerprint,
        taskIds:plan.map((item) => item.id),
        taskPlan:plan,
        activatedAt:now,
        activatedBy:auth.userId,
        pausedAt:null,
        pausedBy:null,
        pauseReason:'',
        resumedAt:null,
        resumedBy:null,
        completedAt:null,
        completedBy:null,
        completionNote:'',
      };
      taskRows = await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, activation, 'CAMPAIGN_EXECUTION_ACTIVATED', beforeSummary, context.request);
    } else if (action === 'pause') {
      if (activation.status !== 'ACTIVE') return error('Only active campaign execution can be paused', 409);
      const reason = text(body.reason, 1500);
      if (!reason) return error('A pause reason is required', 422);
      activation = { ...activation, status:'PAUSED', pausedAt:nowIso(), pausedBy:auth.userId, pauseReason:reason };
      taskRows = await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, activation, 'CAMPAIGN_EXECUTION_PAUSED', beforeSummary, context.request);
    } else if (action === 'resume') {
      if (activation.status !== 'PAUSED') return error('Only paused campaign execution can be resumed', 409);
      assertCampaignActivationReady(beforeSummary);
      if (beforeSummary.activationDrift) return error('The campaign plan changed after activation and must be resolved before resuming', 409);
      activation = { ...activation, status:'ACTIVE', resumedAt:nowIso(), resumedBy:auth.userId, pausedAt:null, pausedBy:null, pauseReason:'' };
      taskRows = await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, activation, 'CAMPAIGN_EXECUTION_RESUMED', beforeSummary, context.request);
    } else if (action === 'complete') {
      assertCampaignActivationCompletable(beforeSummary);
      activation = {
        ...activation,
        status:'COMPLETED',
        completedAt:nowIso(),
        completedBy:auth.userId,
        completionNote:text(body.note, 3000),
      };
      taskRows = await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, activation, 'CAMPAIGN_EXECUTION_COMPLETED', beforeSummary, context.request);
    } else {
      return error('Campaign activation action is not supported', 404);
    }

    const nextRoot = { ...root, campaignActivation:activation };
    return json(await payload(context.env.DB, tenantId, row, nextRoot, tracking, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign activation action failed', Number(cause.status || 500));
  }
}
