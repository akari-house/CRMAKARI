import { error } from '../../lib/response.js';

const TECHNICAL_DB_ERROR = /(D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY|at offset \d+)/i;
const HANDLED_PATHS = new Set(['/api/fundraising/universe','/api/fundraising/targeting']);
const LEGACY_STAGE_MAP = {
  TARGET:'RESEARCHING',
  INTRO_REQUESTED:'INTRO_REQUESTED',
  INTRO_MADE:'CONTACTED',
  CONTACTED:'CONTACTED',
  REPLIED:'CONTACTED',
  MEETING:'MEETING',
  FOLLOW_UP:'MEETING',
  DILIGENCE:'DILIGENCE',
  SOFT_COMMITMENT:'SOFT_CIRCLE',
  CONFIRMED:'COMMITTED',
  PASSED:'PASSED',
  DECLINED:'PASSED',
};

async function normalizeLegacyTargeting(response, pathname, method) {
  if (pathname !== '/api/fundraising/targeting' || method !== 'GET' || !response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || payload.storageMode !== 'LEGACY_COMPATIBILITY' || !Array.isArray(payload.rounds)) return response;
  payload.rounds = payload.rounds.map((round) => ({
    ...round,
    targets:Array.isArray(round.targets) ? round.targets.map((target) => ({
      ...target,
      stage:LEGACY_STAGE_MAP[String(target.stage || 'TARGET').toUpperCase()] || 'RESEARCHING',
    })) : [],
  }));
  return new Response(JSON.stringify(payload), {
    status:response.status,
    headers:{ ...Object.fromEntries(response.headers), 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname.replace(/\/+$/, '');
  try {
    const response = await context.next();
    return normalizeLegacyTargeting(response, pathname, context.request.method);
  } catch (cause) {
    if (!HANDLED_PATHS.has(pathname)) throw cause;
    const product = pathname.endsWith('/universe') ? 'Investor Universe' : 'Fundraising targeting';
    console.error(`${product} response boundary caught an unhandled action error`, cause);
    const message = String(cause?.message || '');
    return error(
      TECHNICAL_DB_ERROR.test(message) ? `${product} action failed` : (message || `${product} action failed`),
      Number(cause?.status || 500),
    );
  }
}
