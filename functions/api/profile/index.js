import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const text = (value, max = 5000) => value === null || value === undefined ? null : (String(value).trim().slice(0, max) || null);

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({
      user: {
        id: auth.userId,
        fullName: auth.fullName,
        email: auth.email,
        avatarUrl: null,
        role: auth.role,
        financeAccess: Boolean(auth.financeAccess),
        tenantId,
        tenantSlug: auth.tenantSlug,
      },
      demo: true,
    });
    const row = await first(context.env.DB, `
      SELECT u.id, u.full_name, u.email, u.avatar_url, u.status, u.last_login_at,
             tm.role, tm.finance_access, tm.status AS membership_status,
             t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug
      FROM users u
      JOIN tenant_memberships tm ON tm.user_id = u.id
      JOIN tenants t ON t.id = tm.tenant_id
      WHERE u.id = ? AND tm.tenant_id = ?
      LIMIT 1
    `, [auth.userId, tenantId]);
    if (!row) return error('Profile was not found', 404);
    return json({
      user: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        avatarUrl: row.avatar_url,
        status: row.status,
        lastLoginAt: row.last_login_at,
        role: row.role,
        financeAccess: Boolean(row.finance_access),
        membershipStatus: row.membership_status,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        tenantSlug: row.tenant_slug,
      },
    });
  } catch (cause) {
    return error(cause.message || 'Profile could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const fullName = text(body.fullName, 200);
    const avatarUrl = text(body.avatarUrl, 1000);
    if (!fullName) return error('Full name is required', 422);
    if (avatarUrl && !/^https:\/\//i.test(avatarUrl)) return error('Avatar URL must use HTTPS', 422);
    if (!context.env.DB) return json({ user: { ...auth, fullName, avatarUrl }, updated: true, demo: true });

    const now = nowIso();
    await run(context.env.DB, `
      UPDATE users SET full_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?
    `, [fullName, avatarUrl, now, auth.userId]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'USER_PROFILE_UPDATED', 'USER', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, auth.userId, JSON.stringify({ fullName, avatarUrl: Boolean(avatarUrl) }), now]);
    return json({ user: { id: auth.userId, fullName, email: auth.email, avatarUrl }, updated: true });
  } catch (cause) {
    console.error('AKARI profile update error', cause);
    return error(cause.message || 'Profile could not be updated', Number(cause.status || 500));
  }
}
