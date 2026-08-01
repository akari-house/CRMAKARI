import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';

const ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER', 'FINANCE', 'VIEWER', 'EXTERNAL_COLLABORATOR']);
const STATUSES = new Set(['ACTIVE', 'SUSPENDED', 'REVOKED']);

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, ['OWNER', 'ADMIN']);
    const tenantId = requireTenant(auth);
    const membershipId = context.params.id;
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ membershipId, updated: true, demo: true });

    const existing = await first(context.env.DB, `
      SELECT tm.*, u.email, u.full_name
      FROM tenant_memberships tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id = ? AND tm.id = ?
      LIMIT 1
    `, [tenantId, membershipId]);
    if (!existing) return error('Team member was not found', 404);

    const role = body.role ? String(body.role).toUpperCase() : existing.role;
    const status = body.status ? String(body.status).toUpperCase() : existing.status;
    const financeAccess = body.financeAccess === undefined ? Boolean(existing.finance_access) : Boolean(body.financeAccess);
    if (!ROLES.has(role)) return error('Role is invalid', 422);
    if (!STATUSES.has(status)) return error('Membership status is invalid', 422);
    if (role === 'OWNER' && auth.role !== 'OWNER') return error('Only an Owner can assign the Owner role', 403);
    if (existing.user_id === auth.userId && status !== 'ACTIVE') return error('You cannot suspend or revoke your own membership', 422);

    if (existing.role === 'OWNER' && (role !== 'OWNER' || status !== 'ACTIVE')) {
      const owners = await first(context.env.DB, `
        SELECT COUNT(*) AS value FROM tenant_memberships
        WHERE tenant_id = ? AND role = 'OWNER' AND status = 'ACTIVE'
      `, [tenantId]);
      if (Number(owners?.value || 0) <= 1) return error('Add another active Owner before changing the final Owner', 422);
    }

    const now = nowIso();
    await run(context.env.DB, `
      UPDATE tenant_memberships
      SET role = ?, finance_access = ?, status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `, [role, financeAccess || role === 'FINANCE' ? 1 : 0, status, now, tenantId, membershipId]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'TEAM_MEMBER_UPDATED', 'TENANT_MEMBERSHIP', ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, membershipId,
      JSON.stringify({ role: existing.role, financeAccess: Boolean(existing.finance_access), status: existing.status }),
      JSON.stringify({ role, financeAccess: financeAccess || role === 'FINANCE', status }),
      now,
    ]);
    return json({ membershipId, role, financeAccess: financeAccess || role === 'FINANCE', status, updated: true });
  } catch (cause) {
    console.error('AKARI team member update error', cause);
    return error(cause.message || 'Team member could not be updated', Number(cause.status || 500));
  }
}
