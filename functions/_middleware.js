import { DEMO_AUTH } from './lib/demo-data.js';
import { renderInviteOnlyPublicEntry } from './lib/public-entry.js';
import { json } from './lib/response.js';

const DEFAULT_ACCESS_TEAM_DOMAIN = 'crimson-wildflower-0f8d.cloudflareaccess.com';
const DEFAULT_ACCESS_AUD = 'c588ec31c2f28826d192548846f060dd7fa9355b3bd20ddff59600c5d3596eaf';
const JWKS_TTL_MS = 5 * 60 * 1000;
let jwksCache = null;
let jwksExpiresAt = 0;
let jwksTeamDomain = null;

const isPublicRequest = (request) => {
  const { pathname } = new URL(request.url);
  return pathname === '/'
    || pathname === '/index.html'
    || pathname === '/api/waitlist'
    || pathname === '/favicon.ico'
    || pathname === '/manifest.webmanifest'
    || pathname.startsWith('/assets/public-home-r6.')
    || pathname.startsWith('/assets/brand/');
};

const isPublicHomepage = (request) => {
  const { pathname } = new URL(request.url);
  return request.method === 'GET' && (pathname === '/' || pathname === '/index.html');
};

async function publicResponse(context) {
  const response = await context.next();
  if (!isPublicHomepage(context.request) || !response.ok) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = renderInviteOnlyPublicEntry(await response.text());
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('x-akari-public-access', 'invite-only');
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const requestedTenant = (request) => {
  const url = new URL(request.url);
  const pathMatch = url.pathname.match(/^\/app\/([^/]+)/);
  return String(request.headers.get('x-akari-tenant') || pathMatch?.[1] || '').trim().toLowerCase();
};

function accessLoginResponse(request, env) {
  const url = new URL(request.url);
  const accept = request.headers.get('accept') || '';
  const isBrowserPage = request.method === 'GET' && accept.includes('text/html') && !url.pathname.startsWith('/api/');
  if (!isBrowserPage) return json({ error: 'Authentication required' }, 401);
  const teamDomain = env.ACCESS_TEAM_DOMAIN || DEFAULT_ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD || DEFAULT_ACCESS_AUD;
  const login = new URL(`https://${teamDomain}/cdn-cgi/access/login/${url.host}`);
  login.searchParams.set('kid', audience);
  login.searchParams.set('redirect_url', `${url.pathname}${url.search}` || '/app/');
  login.searchParams.set('meta', '{}');
  return Response.redirect(login.toString(), 302);
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const decodeJwtJson = (segment) => JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));

async function getAccessJwks(teamDomain) {
  if (jwksCache && jwksTeamDomain === teamDomain && Date.now() < jwksExpiresAt) return jwksCache;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Unable to load Cloudflare Access signing keys (${response.status})`);
  const payload = await response.json();
  if (!Array.isArray(payload.keys) || !payload.keys.length) throw new Error('Cloudflare Access signing keys are unavailable');
  jwksCache = payload.keys;
  jwksTeamDomain = teamDomain;
  jwksExpiresAt = Date.now() + JWKS_TTL_MS;
  return jwksCache;
}

async function verifyJwtSignature(jwk, encodedHeader, encodedPayload, encodedSignature, payload, teamDomain, expectedAudience) {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new Error('Invalid Cloudflare Access token signature');
  const now = Math.floor(Date.now() / 1000);
  const issuer = String(payload.iss || '').replace(/\/$/, '');
  const expectedIssuer = `https://${teamDomain}`.replace(/\/$/, '');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (issuer !== expectedIssuer) throw new Error('Invalid Cloudflare Access token issuer');
  if (!audiences.includes(expectedAudience)) throw new Error('Invalid Cloudflare Access token audience');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('Cloudflare Access token has expired');
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 60) throw new Error('Cloudflare Access token is not active');
  if (!payload.email || typeof payload.email !== 'string') throw new Error('Cloudflare Access token does not contain an email');
  return payload;
}

async function verifyAccessAssertion(assertion, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN || DEFAULT_ACCESS_TEAM_DOMAIN;
  const expectedAudience = env.ACCESS_AUD || DEFAULT_ACCESS_AUD;
  const parts = assertion.split('.');
  if (parts.length !== 3) throw new Error('Malformed Cloudflare Access token');
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = decodeJwtJson(headerSegment);
  const payload = decodeJwtJson(payloadSegment);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Cloudflare Access token');
  let keys = await getAccessJwks(teamDomain);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    jwksExpiresAt = 0;
    keys = await getAccessJwks(teamDomain);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new Error('Cloudflare Access signing key was not found');
  return verifyJwtSignature(
    jwk,
    headerSegment,
    payloadSegment,
    signatureSegment,
    payload,
    teamDomain,
    expectedAudience,
  );
}

export async function onRequest(context) {
  if (isPublicRequest(context.request)) return publicResponse(context);

  const mode = context.env.AUTH_MODE || 'demo';
  if (mode === 'demo') {
    const slug = requestedTenant(context.request) || DEMO_AUTH.tenantSlug;
    if (slug !== DEMO_AUTH.tenantSlug) return json({ error: 'You do not have access to this CRM workspace' }, 403);
    context.data.auth = {
      ...DEMO_AUTH,
      tenantName: 'AKARI House',
      workspaces: [{
        tenantId: DEMO_AUTH.tenantId,
        tenantSlug: DEMO_AUTH.tenantSlug,
        tenantName: 'AKARI House',
        role: DEMO_AUTH.role,
        financeAccess: Boolean(DEMO_AUTH.financeAccess),
      }],
    };
    return context.next();
  }

  if (mode !== 'access') return json({ error: `Unsupported AUTH_MODE: ${mode}` }, 500);
  const assertion = context.request.headers.get('cf-access-jwt-assertion');
  if (!assertion) return accessLoginResponse(context.request, context.env);

  let identity;
  try {
    identity = await verifyAccessAssertion(assertion, context.env);
  } catch (cause) {
    console.error('Cloudflare Access JWT validation failed', cause);
    return json({ error: 'Authentication token is invalid or expired' }, 401);
  }

  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);
  const result = await context.env.DB.prepare(`
    SELECT
      u.id AS user_id,
      u.email,
      u.full_name,
      tm.tenant_id,
      tm.role,
      tm.finance_access,
      t.slug AS tenant_slug,
      t.name AS tenant_name,
      tm.joined_at
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    JOIN tenants t ON t.id = tm.tenant_id
    WHERE lower(u.email) = lower(?)
      AND u.status = 'ACTIVE'
      AND tm.status = 'ACTIVE'
      AND t.status = 'ACTIVE'
    ORDER BY tm.joined_at ASC
  `).bind(identity.email).all();

  const rows = result?.results || [];
  if (!rows.length) return json({ error: 'Your account is not assigned to an active CRM workspace' }, 403);
  const slug = requestedTenant(context.request);
  const membership = slug
    ? rows.find((row) => String(row.tenant_slug).toLowerCase() === slug)
    : rows[0];
  if (!membership) return json({ error: 'You do not have access to this CRM workspace' }, 403);

  const workspaces = rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name || row.tenant_slug,
    role: row.role,
    financeAccess: Boolean(row.finance_access),
  }));
  context.data.auth = {
    userId: membership.user_id,
    tenantId: membership.tenant_id,
    tenantSlug: membership.tenant_slug,
    tenantName: membership.tenant_name || membership.tenant_slug,
    email: membership.email,
    fullName: membership.full_name,
    role: membership.role,
    financeAccess: Boolean(membership.finance_access),
    workspaces,
  };
  return context.next();
}
