import { error } from '../../lib/response.js';

const TECHNICAL_DB_ERROR = /(D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY|at offset \d+)/i;

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname.replace(/\/+$/, '');
  try {
    return await context.next();
  } catch (cause) {
    if (pathname !== '/api/fundraising/universe') throw cause;
    console.error('Investor Universe response boundary caught an unhandled action error', cause);
    const message = String(cause?.message || '');
    return error(
      TECHNICAL_DB_ERROR.test(message) ? 'Investor Universe action failed' : (message || 'Investor Universe action failed'),
      Number(cause?.status || 500),
    );
  }
}
