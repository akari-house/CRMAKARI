import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const publicContext = (request) => ({
  request,
  env: {},
  data: {},
  next: async () => new Response(request.method === 'HEAD' ? null : '<!doctype html><html><body>AKARI</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }),
});

test('V1 public Pages Function HEAD response carries production security headers', async () => {
  const response = await onRequest(publicContext(new Request('https://crm.akarihouse.com/', { method: 'HEAD' })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
});

test('V1 public Pages Function GET response preserves security headers after homepage rendering', async () => {
  const response = await onRequest(publicContext(new Request('https://crm.akarihouse.com/')));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-akari-public-access'), 'invite-only');
});
