import { DEMO_AUTH } from './lib/demo-data.js';
import { json } from './lib/response.js';

const DEFAULT_ACCESS_TEAM_DOMAIN = 'crimson-wildflower-0f8d.cloudflareaccess.com';
const DEFAULT_ACCESS_AUD = 'c588ec31c2f28826d192548846f060dd7fa9355b3bd20ddff59600c5d3596eaf';

function accessLoginResponse(request, env) {
  const url = new URL(request.url);
  const accept = request.headers.get('accept') || '';
  const isBrowserPage = request.method === 'GET' && accept.includes('text/html') && !url.pathname.startsWith('/api/');

  if (!isBrowserPage) return json({ error: 'Authentication required' }, 401);

  const teamDomain = env.ACCESS_TEAM_DOMAIN || DEFAULT_ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD || DEFAULT_ACCESS_AUD;
  const login = new URL(`https://${teamDomain}/cdn-cgi/access/login/${url.host}`);
  login.searchParams.set('kid', audience);
  login.searchParams.set('redirect_url', `${url.pathname}${url.search}` || '/');
  login.searchParams.set('meta', '{}');
  return Response.redirect(login.toString(), 302);
}

/**
 * Cloudflare Pages authentication and tenant resolution.
 *
 * - demo: sanitized local-development identity only.
 * - access: Cloudflare Access authenticates the email, then D1 resolves the
 *   active user, tenant, role and finance permission.
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
  if (!email) return accessLoginResponse(context.request, context.env);
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
