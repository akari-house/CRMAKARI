import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInviteOnlyPublicEntry } from '../functions/lib/public-entry.js';

const source = `<!doctype html><html><head><title>CRM by AKARI</title></head><body>
<a class="text-link" href="/enter-crm">AKARI login</a>
<a class="button button-quiet" href="/enter-crm">AKARI team login</a>
<a href="/enter-crm">AKARI login <span aria-hidden="true">↗</span></a>
<a class="button button-primary" href="#waitlist">Request access</a>
</body></html>`;

test('public entry removes every clickable CRM login while preserving request access', () => {
  const html = renderInviteOnlyPublicEntry(source);
  assert.equal(html.includes('href="/enter-crm"'), false);
  assert.equal((html.match(/data-public-access="invite-only"/g) || []).length, 3);
  assert.equal(html.includes('Private CRM · Invite only'), true);
  assert.equal(html.includes('aria-disabled="true"'), true);
  assert.equal(html.includes('href="#waitlist"'), true);
  assert.equal(html.includes('id="akari-private-access-state"'), true);
});

test('invite-only rendering is idempotent', () => {
  const once = renderInviteOnlyPublicEntry(source);
  const twice = renderInviteOnlyPublicEntry(once);
  assert.equal(twice, once);
  assert.equal((twice.match(/id="akari-private-access-state"/g) || []).length, 1);
});
