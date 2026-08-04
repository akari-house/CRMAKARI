const INVITE_ONLY_STYLE = `<style id="akari-private-access-state">
.public-access-closed{display:inline-flex;align-items:center;gap:8px;color:#aaa197;font-size:13px;font-weight:650;cursor:default;user-select:none}
.public-access-closed::before{content:"";width:7px;height:7px;border-radius:50%;background:#ffaa32;box-shadow:0 0 10px rgba(255,170,50,.35)}
.button.public-access-closed{pointer-events:none;min-height:46px;padding:0 18px;border:1px solid rgba(255,244,226,.14);border-radius:11px;background:rgba(255,255,255,.025);color:#aaa197;box-shadow:none;transform:none}
.footer .public-access-closed{justify-self:end}
@media (max-width:760px){.nav-actions .public-access-closed{display:none}.footer .public-access-closed{justify-self:start}}
</style>`;

const REPLACEMENTS = [
  [
    '<a class="text-link" href="/enter-crm">AKARI login</a>',
    '<span class="text-link public-access-closed" data-public-access="invite-only" aria-label="Private CRM access is invite only">Private CRM · Invite only</span>',
  ],
  [
    '<a class="button button-quiet" href="/enter-crm">AKARI team login</a>',
    '<span class="button button-quiet public-access-closed" data-public-access="invite-only" aria-disabled="true">Private CRM · Invite only</span>',
  ],
  [
    '<a href="/enter-crm">AKARI login <span aria-hidden="true">↗</span></a>',
    '<span class="public-access-closed" data-public-access="invite-only" aria-label="Private CRM access is invite only">Private CRM · Invite only</span>',
  ],
];

export function renderInviteOnlyPublicEntry(source) {
  let html = String(source || '');
  for (const [from, to] of REPLACEMENTS) html = html.replaceAll(from, to);
  if (!html.includes('id="akari-private-access-state"')) {
    html = html.replace('</head>', `${INVITE_ONLY_STYLE}\n</head>`);
  }
  return html;
}

export async function serveInviteOnlyPublicEntry(context) {
  const assetResponse = await context.env.ASSETS.fetch(context.request);
  if (!assetResponse.ok) return assetResponse;

  const contentType = assetResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetResponse;

  const html = renderInviteOnlyPublicEntry(await assetResponse.text());
  const headers = new Headers(assetResponse.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('x-akari-public-access', 'invite-only');
  headers.delete('content-length');
  headers.delete('etag');

  return new Response(html, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}
