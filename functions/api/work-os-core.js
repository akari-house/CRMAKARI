import { json, error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant, canViewFinance } from '../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER', 'FINANCE']);
const MANAGER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);

function workstreamFromActivity(activityType) {
  const value = String(activityType || '');
  if (value.startsWith('WORKSTREAM:')) return value.split(':')[1] || 'GENERAL';
  if (value.startsWith('PARTNERSHIP_ACTIVATION:')) return value.split(':')[2] || 'BD';
  if (value.startsWith('FUNDRAISING_WORKPLAN:')) return value.split(':')[2] || 'FUNDRAISING';
  if (value.startsWith('SERVICE_')) return 'DELIVERY';
  return 'GENERAL';
}

function day(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
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

function taskCalendarEvent(task) {
  if (!task.dueAt) return null;
  return {
    id: `TASK:${task.id}:${task.dueAt}`,
    sourceId: task.id,
    type: 'TASK',
    title: task.title,
    startsAt: task.dueAt,
    date: day(task.dueAt),
    projectId: task.projectId || null,
    projectName: task.projectName || null,
    relation: task.opportunityName || task.campaignName || task.projectName || null,
    status: task.status,
    priority: task.priority,
    workstream: task.workstream,
    readOnly: false,
  };
}

export async function onRequestGet(context) {
  const startedAt = Date.now();
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const url = new URL(context.request.url);
    const scope = url.searchParams.get('scope') === 'team' ? 'team' : 'mine';
    const ownerClause = scope === 'mine' ? 'AND t.owner_user_id = ?' : '';
    const taskBindings = scope === 'mine' ? [tenantId, auth.userId] : [tenantId];

    const [tasks, members] = await Promise.all([
      all(context.env.DB, `
        SELECT t.*, p.name AS project_name, c.full_name AS contact_name,
          o.name AS opportunity_name, ca.name AS campaign_name, u.full_name AS owner_name
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
        LEFT JOIN contacts c ON c.id = t.contact_id AND c.tenant_id = t.tenant_id
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        LEFT JOIN campaigns ca ON ca.id = t.campaign_id AND ca.tenant_id = t.tenant_id
        LEFT JOIN users u ON u.id = t.owner_user_id
        WHERE t.tenant_id = ? ${ownerClause} AND t.status NOT IN ('CANCELLED','ARCHIVED')
        ORDER BY CASE t.status WHEN 'TODO' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'WAITING' THEN 3 ELSE 4 END,
          CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
          COALESCE(t.due_at, '9999-12-31') ASC
        LIMIT 300
      `, taskBindings),
      all(context.env.DB, `
        SELECT u.id, u.full_name, u.email, tm.role
        FROM tenant_memberships tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
        ORDER BY u.full_name COLLATE NOCASE ASC
      `, [tenantId]),
    ]);

    const publicTasks = tasks.map(publicTask);
    return json({
      partial: true,
      scope,
      tasks: publicTasks,
      members: members.map((member) => ({
        id: member.id,
        fullName: member.full_name,
        email: member.email,
        role: member.role,
      })),
      projects: [],
      opportunities: [],
      campaigns: [],
      calendarEvents: publicTasks.map(taskCalendarEvent).filter(Boolean),
      partnershipCandidates: [],
      fundraisingPlans: [],
      permissions: {
        canWrite: WRITE_ROLES.has(auth?.role),
        canManage: MANAGER_ROLES.has(auth?.role),
        canFinance: canViewFinance(auth),
      },
      performance: {
        mode: 'core',
        durationMs: Date.now() - startedAt,
      },
    }, 200, { 'server-timing': `work-os-core;dur=${Date.now() - startedAt}` });
  } catch (cause) {
    return error(cause.message || 'Tasks could not be loaded', Number(cause.status || 500));
  }
}
