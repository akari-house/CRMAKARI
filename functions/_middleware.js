import { DEMO_AUTH } from './lib/demo-data.js';
import { json } from './lib/response.js';

/**
 * Cloudflare Pages authentication and tenant resolution.
 *
 * - demo: sanitized local-development identity only.
 * - access: Cloudflare Access authenticates the email, then D1 resolves the
 *   active user, tenant, role and finance permission.
 *
 * The frontend is a normal static module application. Authentication middleware
 * does not rewrite HTML or inject scripts, which keeps the UI deterministic and
 * prevents stale placeholder modules from being loaded.
 */
export async function onRequest(context) {
  const mode = context.env.AUTH_MODE || 'demo';

  if (mode === 'demo') {
    context.data.auth = DEMO_AUTH;
    return context.next();
  }

  if (mode !== 'access') {
    return json({ error: `Unsupported AUTH_MODE: ${mode}` }, 500);
  }

  const email = context.request.headers.get('cf-access-authenticated-user-email');
  if (!email) return json({ error: 'Authentication required' }, 401);
  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);

  const membership = await context.env.DB.prepare(`
    SELECT
      u.id AS user_id,
      u.email,
      u.full_name,
      tm.tenant_id,
      tm.role,
      tm.finance_access,
      t.slug AS tenant_slug
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    JOIN tenants t ON t.id = tm.tenant_id
    WHERE lower(u.email) = lower(?)
      AND u.status = 'ACTIVE'
      AND tm.status = 'ACTIVE'
      AND t.status = 'ACTIVE'
    ORDER BY tm.joined_at ASC
    LIMIT 1
  `).bind(email).first();

  if (!membership) return json({ error: 'Your account is not assigned to an active CRM workspace' }, 403);

  context.data.auth = {
    userId: membership.user_id,
    tenantId: membership.tenant_id,
    tenantSlug: membership.tenant_slug,
    email: membership.email,
    fullName: membership.full_name,
    role: membership.role,
    financeAccess: Boolean(membership.finance_access),
  };

  return context.next();
}
