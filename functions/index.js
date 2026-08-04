import { serveInviteOnlyPublicEntry } from './lib/public-entry.js';

export async function onRequestGet(context) {
  return serveInviteOnlyPublicEntry(context);
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'HEAD') {
    const response = await onRequestGet(context);
    return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
}
