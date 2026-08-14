import { DEMO_AUTH } from './lib/demo-data.js';
import { renderInviteOnlyPublicEntry } from './lib/public-entry.js';
import { json } from './lib/response.js';
import { authenticateApiKey } from './lib/api-webhooks.js';

const DEFAULT_ACCESS_TEAM_DOMAIN = 'crimson-wildflower-0f8d.cloudflareaccess.com';
const DEFAULT_ACCESS_AUD = 'c588ec31c2f28826d192548846f060dd7fa9355b3bd20ddff59600c5d3596eaf';
const JWKS_TTL_MS = 5 * 60 * 1000;
const ALL_MODULES=['BD','REVENUE','DELIVERY','CAMPAIGNS','FUNDRAISING','RELATIONSHIPS','PORTAL','REPORTING'];
let jwksCache = null;
let jwksExpiresAt = 0;
let jwksTeamDomain = null;

const isPublicRequest = (request) => {
  const { pathname } = new URL(request.url);
  return pathname === '/'
    || pathname === '/index.html'
    || pathname === '/release.json'
    || pathname === '/api/waitlist'
    || pathname === '/favicon.ico'
    || pathname === '/manifest.webmanifest'
    || pathname.startsWith('/assets/public-home-r6.')
    || pathname.startsWith('/assets/brand/');
};

const isExternalApiRequest=(request)=>new URL(request.url).pathname.startsWith('/api/v1/');

const isInvitationBootstrapRequest=(request)=>{
  const {pathname}=new URL(request.url);
  return pathname==='/accept-invite.html'||pathname==='/api/invitations/accept';
};

const isPublicHomepage = (request) => {
  const { pathname } = new URL(request.url);
  return request.method === 'GET' && (pathname === '/' || pathname === '/index.html');
};

function functionSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('x-frame-options', 'DENY');
  headers.set('content-security-policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  return headers;
}

function responseWithHeaders(response, headers) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function publicResponse(context) {
  const response = await context.next();
  const headers = functionSecurityHeaders(response);
  if (!isPublicHomepage(context.request) || !response.ok) return responseWithHeaders(response, headers);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return responseWithHeaders(response, headers);

  const html = renderInviteOnlyPublicEntry(await response.text());
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
  const pathMatch = url.pathname.match(/^\/(?:app|portal)\/([^/]+)/);
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
  return verifyJwtSignature(jwk,headerSegment,payloadSegment,signatureSegment,payload,teamDomain,expectedAudience);
}

function externalPortalAllowed(request,tenantSlug){
  const path=new URL(request.url).pathname;
  const portalPrefix=`/portal/${String(tenantSlug||'').toLowerCase()}`;
  return path=== '/enter-crm'
    || path===portalPrefix
    || path.startsWith(`${portalPrefix}/`)
    || path==='/api/portal'
    || path.startsWith('/api/portal/')
    || path.startsWith('/assets/external-portal-r68.');
}

function parseEnabledModules(raw){
  if(raw===null||raw===undefined||String(raw).trim()==='')return [...ALL_MODULES];
  try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(parsed))return [...ALL_MODULES];return [...new Set(parsed.map(v=>String(v||'').toUpperCase()).filter(v=>ALL_MODULES.includes(v)))];}
  catch{return [...ALL_MODULES];}
}

function moduleForRequest(request){
  const path=new URL(request.url).pathname.toLowerCase();
  const appSection=path.match(/^\/app\/[^/]+\/([^/]+)/)?.[1]||'';
  const appMap={leads:'BD',contacts:'BD',opportunities:'BD',partners:'BD',revenue:'REVENUE',finance:'REVENUE',campaigns:'CAMPAIGNS',fundraising:'FUNDRAISING',reports:'REPORTING'};
  if(appMap[appSection])return appMap[appSection];
  if(path.startsWith('/portal/')||path==='/api/portal'||path.startsWith('/api/portal/'))return 'PORTAL';
  if(path.startsWith('/api/fundraising'))return 'FUNDRAISING';
  if(path.startsWith('/api/campaign'))return 'CAMPAIGNS';
  if(path.startsWith('/api/service-delivery')||path.startsWith('/api/engagements'))return 'DELIVERY';
  if(path.startsWith('/api/relationships'))return 'RELATIONSHIPS';
  if(path.startsWith('/api/operating-rhythm'))return 'REPORTING';
  if(path.startsWith('/api/invoices')||path.startsWith('/api/payments')||path.startsWith('/api/referrals')||path.startsWith('/api/commercial')||path.startsWith('/api/billing-profile'))return 'REVENUE';
  if(path.startsWith('/api/akari-leads')||path.startsWith('/api/bd-')||path.startsWith('/api/opportunities')||path.startsWith('/api/projects')||path.startsWith('/api/contacts')||path.startsWith('/api/partners'))return 'BD';
  return '';
}

export async function onRequest(context) {
  if (isPublicRequest(context.request)) return publicResponse(context);

  if(isExternalApiRequest(context.request)){
    if(!context.env.DB)return json({error:'D1 binding DB is not configured'},500);
    const authorization=String(context.request.headers.get('authorization')||''),bearer=authorization.match(/^Bearer\s+(.+)$/i)?.[1]||'',rawKey=String(context.request.headers.get('x-akari-api-key')||bearer||'').trim();
    let apiAuth=null;try{apiAuth=await authenticateApiKey(context.env.DB,rawKey);}catch(cause){console.error('AKARI API key authentication failed',cause);return json({error:'API authentication failed'},500);}
    if(!apiAuth)return json({error:'A valid AKARI API key is required'},401);
    context.data.auth=apiAuth;
    return context.next();
  }

  const mode = context.env.AUTH_MODE || 'demo';
  if (mode === 'demo') {
    const slug = requestedTenant(context.request) || DEMO_AUTH.tenantSlug;
    if (slug !== DEMO_AUTH.tenantSlug) return json({ error: 'You do not have access to this CRM workspace' }, 403);
    context.data.auth = {
      ...DEMO_AUTH,
      tenantName: 'AKARI House',
      modules:[...ALL_MODULES],
      workspaces: [{tenantId:DEMO_AUTH.tenantId,tenantSlug:DEMO_AUTH.tenantSlug,tenantName:'AKARI House',role:DEMO_AUTH.role,financeAccess:Boolean(DEMO_AUTH.financeAccess),modules:[...ALL_MODULES]}],
    };
    return context.next();
  }

  if (mode !== 'access') return json({ error: `Unsupported AUTH_MODE: ${mode}` }, 500);
  const assertion = context.request.headers.get('cf-access-jwt-assertion');
  if (!assertion) return accessLoginResponse(context.request, context.env);

  let identity;
  try { identity = await verifyAccessAssertion(assertion, context.env); }
  catch (cause) { console.error('Cloudflare Access JWT validation failed', cause); return json({ error: 'Authentication token is invalid or expired' }, 401); }

  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);
  if(isInvitationBootstrapRequest(context.request)){
    context.data.preAuthIdentity={email:String(identity.email||'').toLowerCase(),name:String(identity.name||identity.common_name||identity.email||'')};
    return context.next();
  }

  const result = await context.env.DB.prepare(`
    SELECT u.id AS user_id,u.email,u.full_name,tm.tenant_id,tm.role,tm.finance_access,t.slug AS tenant_slug,t.name AS tenant_name,t.status AS tenant_status,tm.joined_at,ts.enabled_modules_json
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    JOIN tenants t ON t.id = tm.tenant_id
    LEFT JOIN tenant_settings ts ON ts.tenant_id=t.id
    WHERE lower(u.email)=lower(?) AND u.status='ACTIVE' AND tm.status='ACTIVE' AND t.status IN ('ACTIVE','TRIAL')
    ORDER BY tm.joined_at ASC
  `).bind(identity.email).all();

  const rows=result?.results||[];
  if(!rows.length)return json({error:'Your account is not assigned to an active CRM workspace'},403);
  const slug=requestedTenant(context.request);
  const membership=slug?rows.find(row=>String(row.tenant_slug).toLowerCase()===slug):rows[0];
  if(!membership)return json({error:'You do not have access to this CRM workspace'},403);

  const workspaces=rows.map(row=>({tenantId:row.tenant_id,tenantSlug:row.tenant_slug,tenantName:row.tenant_name||row.tenant_slug,tenantStatus:row.tenant_status,role:row.role,financeAccess:Boolean(row.finance_access),modules:parseEnabledModules(row.enabled_modules_json)}));
  const modules=parseEnabledModules(membership.enabled_modules_json);
  context.data.auth={userId:membership.user_id,tenantId:membership.tenant_id,tenantSlug:membership.tenant_slug,tenantName:membership.tenant_name||membership.tenant_slug,tenantStatus:membership.tenant_status,email:membership.email,fullName:membership.full_name,role:membership.role,financeAccess:Boolean(membership.finance_access),modules,workspaces};

  if(membership.role==='EXTERNAL_COLLABORATOR'&&!externalPortalAllowed(context.request,membership.tenant_slug)){
    return json({error:'External collaborator access is limited to the AKARI client/founder portal'},403);
  }
  const requiredModule=moduleForRequest(context.request);
  if(requiredModule&&!modules.includes(requiredModule))return json({error:`${requiredModule} module is not enabled for this workspace`,module:requiredModule},403);
  return context.next();
}
