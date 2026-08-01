import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const MANAGER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);
const MEMBER_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER', 'FINANCE', 'VIEWER']);
const MEMBER_STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const LIFECYCLES = new Set(['LEAD', 'PROSPECT', 'ACTIVE_OPPORTUNITY', 'DORMANT_CLIENT', 'FORMER_CLIENT', 'ARCHIVED']);
const PROJECT_SOURCE = "p.source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')";
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const permissionError = new Error('Owner, Admin or BD Manager permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function requireAdmin(auth) {
  if (!ADMIN_ROLES.has(auth?.role)) {
    const permissionError = new Error('Owner or Admin permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function normalizedIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 100);
}

async function validateOwner(db, tenantId, ownerUserId) {
  if (!ownerUserId) return null;
  const member = await first(db, `
    SELECT u.id
    FROM users u
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

async function summary(db, tenantId) {
  return first(db, `
    SELECT
      COUNT(*) AS total_leads,
      SUM(CASE WHEN p.owner_user_id IS NULL THEN 1 ELSE 0 END) AS unassigned_leads,
      SUM(CASE WHEN p.next_follow_up_at IS NULL AND p.lifecycle_status != 'ARCHIVED' THEN 1 ELSE 0 END) AS missing_follow_up,
      SUM(CASE WHEN p.next_follow_up_at IS NOT NULL AND datetime(p.next_follow_up_at) < datetime('now') AND p.lifecycle_status != 'ARCHIVED' THEN 1 ELSE 0 END) AS overdue_follow_up,
      SUM(CASE WHEN p.x_url IS NULL OR p.telegram IS NULL THEN 1 ELSE 0 END) AS missing_project_identity,
      SUM(CASE WHEN NOT EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.tenant_id = p.tenant_id AND c.project_id = p.id
          AND c.full_name IS NOT NULL AND c.x_handle IS NOT NULL AND c.telegram IS NOT NULL
      ) THEN 1 ELSE 0 END) AS missing_primary_contact,
      SUM(CASE WHEN p.lifecycle_status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived_leads
    FROM projects p
    WHERE p.tenant_id = ? AND ${PROJECT_SOURCE}
  `, [tenantId]);
}

async function members(db, tenantId) {
  return all(db, `
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.status AS user_status,
      tm.role,
      tm.finance_access,
      tm.status AS membership_status,
      tm.joined_at,
      (SELECT COUNT(*) FROM projects p
        WHERE p.tenant_id = tm.tenant_id AND p.owner_user_id = u.id AND ${PROJECT_SOURCE}) AS assigned_leads,
      (SELECT COUNT(*) FROM projects p
        WHERE p.tenant_id = tm.tenant_id AND p.owner_user_id = u.id AND ${PROJECT_SOURCE}
          AND p.next_follow_up_at IS NULL AND p.lifecycle_status != 'ARCHIVED') AS missing_follow_up,
      (SELECT COUNT(*) FROM projects p
        WHERE p.tenant_id = tm.tenant_id AND p.owner_user_id = u.id AND ${PROJECT_SOURCE}
          AND p.next_follow_up_at IS NOT NULL AND datetime(p.next_follow_up_at) < datetime('now')
          AND p.lifecycle_status != 'ARCHIVED') AS overdue_follow_up,
      (SELECT COUNT(*) FROM opportunities o
        WHERE o.tenant_id = tm.tenant_id AND o.owner_user_id = u.id AND o.stage NOT IN ('WON','LOST')) AS active_opportunities,
      (SELECT COUNT(*) FROM tasks t
        WHERE t.tenant_id = tm.tenant_id AND t.owner_user_id = u.id
          AND t.status NOT IN ('DONE','CANCELLED','ARCHIVED')) AS open_tasks
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ?
    ORDER BY CASE tm.status WHEN 'ACTIVE' THEN 1 ELSE 2 END,
      CASE tm.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 WHEN 'BD_MANAGER' THEN 3 WHEN 'BD_MEMBER' THEN 4 ELSE 5 END,
      u.full_name COLLATE NOCASE ASC
  `, [tenantId]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) {
      return json({
        summary: { totalLeads: 0, unassignedLeads: 0, missingFollowUp: 0, overdueFollowUp: 0, missingProjectIdentity: 0, missingPrimaryContact: 0, archivedLeads: 0 },
        members: [], canManage: MANAGER_ROLES.has(auth?.role), canAdmin: ADMIN_ROLES.has(auth?.role),
        actor: { userId: auth?.userId, tenantId, role: auth?.role }, demo: true,
      });
    }

    const [totals, team] = await Promise.all([summary(context.env.DB, tenantId), members(context.env.DB, tenantId)]);
    return json({
      summary: {
        totalLeads: Number(totals?.total_leads || 0),
        unassignedLeads: Number(totals?.unassigned_leads || 0),
        missingFollowUp: Number(totals?.missing_follow_up || 0),
        overdueFollowUp: Number(totals?.overdue_follow_up || 0),
        missingProjectIdentity: Number(totals?.missing_project_identity || 0),
        missingPrimaryContact: Number(totals?.missing_primary_contact || 0),
        archivedLeads: Number(totals?.archived_leads || 0),
      },
      members: team.map((member) => ({
        id: member.id,
        fullName: member.full_name,
        email: member.email,
        userStatus: member.user_status,
        role: member.role,
        financeAccess: Boolean(member.finance_access),
        membershipStatus: member.membership_status,
        joinedAt: member.joined_at,
        assignedLeads: Number(member.assigned_leads || 0),
        missingFollowUp: Number(member.missing_follow_up || 0),
        overdueFollowUp: Number(member.overdue_follow_up || 0),
        activeOpportunities: Number(member.active_opportunities || 0),
        openTasks: Number(member.open_tasks || 0),
      })),
      canManage: MANAGER_ROLES.has(auth?.role),
      canAdmin: ADMIN_ROLES.has(auth?.role),
      actor: { userId: auth?.userId, tenantId, role: auth?.role },
    });
  } catch (cause) {
    console.error('BD operations overview error', cause);
    return error(cause.message || 'BD operations could not be loaded', Number(cause.status || 500));
  }
}

async function bulkUpdate(context, body) {
  const auth = context.data.auth;
  requireManager(auth);
  const tenantId = requireTenant(auth);
  const projectIds = normalizedIds(body.projectIds);
  if (!projectIds.length) return error('Select at least one lead', 422);

  const placeholders = projectIds.map(() => '?').join(',');
  const selected = await all(context.env.DB, `
    SELECT p.id FROM projects p
    WHERE p.tenant_id = ? AND ${PROJECT_SOURCE} AND p.id IN (${placeholders})
  `, [tenantId, ...projectIds]);
  if (selected.length !== projectIds.length) return error('One or more selected leads do not belong to this workspace', 422);

  const updates = [];
  const bindings = [];
  const changed = {};

  if (hasOwn(body, 'ownerUserId')) {
    const ownerUserId = body.ownerUserId ? String(body.ownerUserId).trim() : null;
    await validateOwner(context.env.DB, tenantId, ownerUserId);
    updates.push('owner_user_id = ?');
    bindings.push(ownerUserId);
    changed.ownerUserId = ownerUserId;
  }

  if (hasOwn(body, 'priority')) {
    const priority = String(body.priority || '').toUpperCase();
    if (!PRIORITIES.has(priority)) return error('Priority is invalid', 422);
    updates.push('priority = ?');
    bindings.push(priority);
    changed.priority = priority;
  }

  if (hasOwn(body, 'lifecycleStatus')) {
    const lifecycleStatus = String(body.lifecycleStatus || '').toUpperCase();
    if (!LIFECYCLES.has(lifecycleStatus)) return error('Lifecycle status is invalid for bulk editing', 422);
    updates.push('lifecycle_status = ?');
    bindings.push(lifecycleStatus);
    changed.lifecycleStatus = lifecycleStatus;
  }

  if (hasOwn(body, 'nextFollowUpAt')) {
    let nextFollowUpAt = body.nextFollowUpAt ? String(body.nextFollowUpAt).trim() : null;
    if (nextFollowUpAt && Number.isNaN(new Date(nextFollowUpAt).getTime())) return error('Next follow-up date is invalid', 422);
    if (nextFollowUpAt) nextFollowUpAt = new Date(nextFollowUpAt).toISOString();
    updates.push('next_follow_up_at = ?');
    bindings.push(nextFollowUpAt);
    changed.nextFollowUpAt = nextFollowUpAt;
  }

  if (!updates.length) return error('Choose an owner, priority, lifecycle or next follow-up update', 422);

  const now = nowIso();
  updates.push('updated_at = ?', 'updated_by = ?');
  bindings.push(now, auth.userId, tenantId, ...projectIds);
  await run(context.env.DB, `
    UPDATE projects SET ${updates.join(', ')}
    WHERE tenant_id = ? AND id IN (${placeholders})
  `, bindings);

  await run(context.env.DB, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, 'BD_LEADS_BULK_UPDATED', 'PROJECT_BATCH', ?, NULL, ?, ?, ?, ?)
  `, [
    makeId('aud'), tenantId, auth.userId, `batch:${now}`,
    JSON.stringify({ projectIds, changed, count: projectIds.length }),
    context.request.headers.get('cf-connecting-ip'), context.request.headers.get('user-agent'), now,
  ]);

  return json({ updated: true, count: projectIds.length, projectIds, changed });
}

async function updateMember(context, body) {
  const auth = context.data.auth;
  requireAdmin(auth);
  const tenantId = requireTenant(auth);
  const userId = String(body.userId || '').trim();
  if (!userId) return error('Team member is required', 422);

  const existing = await first(context.env.DB, `
    SELECT tm.user_id, tm.role, tm.finance_access, tm.status, u.full_name, u.email
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.user_id = ?
    LIMIT 1
  `, [tenantId, userId]);
  if (!existing) return error('Team member was not found in this workspace', 404);

  const role = hasOwn(body, 'role') ? String(body.role || '').toUpperCase() : existing.role;
  const status = hasOwn(body, 'status') ? String(body.status || '').toUpperCase() : existing.status;
  const financeAccess = hasOwn(body, 'financeAccess') ? Boolean(body.financeAccess) : Boolean(existing.finance_access);
  if (!MEMBER_ROLES.has(role)) return error('Team role is invalid', 422);
  if (!MEMBER_STATUSES.has(status)) return error('Membership status is invalid', 422);

  const removesOwner = existing.role === 'OWNER' && (role !== 'OWNER' || status !== 'ACTIVE');
  if (removesOwner) {
    const owners = await first(context.env.DB, `
      SELECT COUNT(*) AS count FROM tenant_memberships
      WHERE tenant_id = ? AND role = 'OWNER' AND status = 'ACTIVE'
    `, [tenantId]);
    if (Number(owners?.count || 0) <= 1) return error('The workspace must retain at least one active Owner', 422);
  }

  await run(context.env.DB, `
    UPDATE tenant_memberships SET role = ?, finance_access = ?, status = ?
    WHERE tenant_id = ? AND user_id = ?
  `, [role, financeAccess ? 1 : 0, status, tenantId, userId]);

  const now = nowIso();
  await run(context.env.DB, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, 'TEAM_MEMBER_UPDATED', 'TENANT_MEMBERSHIP', ?, ?, ?, ?, ?, ?)
  `, [
    makeId('aud'), tenantId, auth.userId, userId,
    JSON.stringify({ role: existing.role, financeAccess: Boolean(existing.finance_access), status: existing.status }),
    JSON.stringify({ role, financeAccess, status }),
    context.request.headers.get('cf-connecting-ip'), context.request.headers.get('user-agent'), now,
  ]);

  return json({ updated: true, member: { id: userId, role, financeAccess, status } });
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const action = String(body.action || '').toLowerCase();
    if (action === 'bulk-update') return await bulkUpdate(context, body);
    if (action === 'update-member') return await updateMember(context, body);
    return error('BD operations action is not supported', 404);
  } catch (cause) {
    console.error('BD operations action error', cause);
    return error(cause.message || 'BD operations action failed', Number(cause.status || 500));
  }
}
