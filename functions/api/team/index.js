import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';

const ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER', 'FINANCE', 'VIEWER', 'EXTERNAL_COLLABORATOR']);
const text = (value, max = 5000) => value === null || value === undefined ? null : (String(value).trim().slice(0, max) || null);
const cleanEmail = (value) => String(value || '').trim().toLowerCase().slice(0, 320);

function displayNameFromEmail(email) {
  return String(email || 'AKARI User').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 200);
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) {
      const user = context.data.auth;
      return json({
        items: [{
          membershipId: 'demo-membership', userId: user.userId, fullName: user.fullName,
          email: user.email, role: user.role, financeAccess: Boolean(user.financeAccess), status: 'ACTIVE',
        }],
        total: 1,
        userLimit: 3,
        demo: true,
      });
    }
    const [items, tenant] = await Promise.all([
      all(context.env.DB, `
        SELECT
          tm.id AS membership_id,
          tm.user_id,
          u.full_name,
          u.email,
          u.avatar_url,
          tm.role,
          tm.finance_access,
          tm.status,
          tm.joined_at,
          tm.created_at,
          tm.updated_at,
          u.last_login_at
        FROM tenant_memberships tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ? AND tm.status != 'REVOKED' AND u.status != 'DELETED'
        ORDER BY CASE tm.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END, u.full_name
      `, [tenantId]),
      first(context.env.DB, 'SELECT user_limit FROM tenants WHERE id = ?', [tenantId]),
    ]);
    return json({
      items: items.map((item) => ({
        membershipId: item.membership_id,
        userId: item.user_id,
        fullName: item.full_name,
        email: item.email,
        avatarUrl: item.avatar_url,
        role: item.role,
        financeAccess: Boolean(item.finance_access),
        status: item.status,
        joinedAt: item.joined_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        lastLoginAt: item.last_login_at,
      })),
      total: items.length,
      userLimit: Number(tenant?.user_limit || 3),
    });
  } catch (cause) {
    return error(cause.message || 'Team members could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, ['OWNER', 'ADMIN']);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const email = cleanEmail(body.email);
    const fullName = text(body.fullName, 200) || displayNameFromEmail(email);
    const role = String(body.role || 'BD_MEMBER').toUpperCase();
    const financeAccess = Boolean(body.financeAccess || role === 'FINANCE');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return error('A valid email address is required', 422);
    if (!ROLES.has(role)) return error('Role is invalid', 422);
    if (role === 'OWNER' && auth.role !== 'OWNER') return error('Only an Owner can add another Owner', 403);
    if (!context.env.DB) return json({ id: makeId('mem'), created: true, demo: true }, 201);

    const tenant = await first(context.env.DB, 'SELECT user_limit FROM tenants WHERE id = ?', [tenantId]);
    const activeCount = await first(context.env.DB, `
      SELECT COUNT(*) AS value FROM tenant_memberships
      WHERE tenant_id = ? AND status IN ('INVITED', 'ACTIVE', 'SUSPENDED')
    `, [tenantId]);
    const existingUser = await first(context.env.DB, 'SELECT id, status FROM users WHERE lower(email) = lower(?) LIMIT 1', [email]);
    const existingMembership = existingUser ? await first(context.env.DB, `
      SELECT id, status FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? LIMIT 1
    `, [tenantId, existingUser.id]) : null;
    if (existingMembership?.status === 'ACTIVE') return error('This user is already an active team member', 409);
    const consumesNewSeat = !existingMembership || existingMembership.status === 'REVOKED';
    if (consumesNewSeat && Number(activeCount?.value || 0) >= Number(tenant?.user_limit || 3)) {
      return error(`This workspace has reached its ${Number(tenant?.user_limit || 3)} user limit`, 409);
    }

    const now = nowIso();
    const userId = existingUser?.id || makeId('usr');
    if (existingUser) {
      await run(context.env.DB, `
        UPDATE users SET full_name = ?, status = 'ACTIVE', updated_at = ? WHERE id = ?
      `, [fullName, now, userId]);
    } else {
      await run(context.env.DB, `
        INSERT INTO users (id, full_name, email, authentication_provider, status, created_at, updated_at)
        VALUES (?, ?, ?, 'CLOUDFLARE_ACCESS', 'ACTIVE', ?, ?)
      `, [userId, fullName, email, now, now]);
    }

    const membershipId = existingMembership?.id || makeId('mem');
    await run(context.env.DB, `
      INSERT INTO tenant_memberships (
        id, tenant_id, user_id, role, finance_access, status, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      ON CONFLICT(tenant_id, user_id) DO UPDATE SET
        role = excluded.role,
        finance_access = excluded.finance_access,
        status = 'ACTIVE',
        joined_at = COALESCE(tenant_memberships.joined_at, excluded.joined_at),
        updated_at = excluded.updated_at
    `, [membershipId, tenantId, userId, role, financeAccess ? 1 : 0, now, now, now]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'TEAM_MEMBER_ADDED', 'TENANT_MEMBERSHIP', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, membershipId, JSON.stringify({ email, fullName, role, financeAccess }), now]);
    return json({
      membershipId,
      userId,
      created: true,
      accessNote: 'The member can sign in after Cloudflare Access permits this email address.',
    }, 201);
  } catch (cause) {
    console.error('AKARI team member creation error', cause);
    return error(cause.message || 'Team member could not be added', Number(cause.status || 500));
  }
}
