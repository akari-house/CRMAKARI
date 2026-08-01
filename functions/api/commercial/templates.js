import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseFeatureFlags, proposalTemplate } from '../../lib/commercial-hardening.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);

async function loadSettings(db, tenantId) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ?', [tenantId]);
  const flags = parseFeatureFlags(row?.feature_flags_json);
  const templates = Array.isArray(flags.proposalTemplates) ? flags.proposalTemplates : [];
  return { flags, templates };
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const { templates } = await loadSettings(context.env.DB, tenantId);
    const items = templates.filter((item) => item?.active !== false).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return json({ items, total: items.length });
  } catch (cause) {
    return error(cause.message || 'Proposal templates could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = String(body.action || 'save').toLowerCase();
    if (!context.env.DB) return json({ updated: true, demo: true });

    const { flags, templates } = await loadSettings(context.env.DB, tenantId);
    let items = [...templates];
    let changed;
    if (action === 'archive') {
      const id = String(body.id || '').trim();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return error('Proposal template was not found', 404);
      changed = { ...items[index], active: false, updatedAt: nowIso() };
      items[index] = changed;
    } else {
      const existing = body.id ? items.find((item) => item.id === body.id) : null;
      changed = proposalTemplate(body, existing || {});
      const index = items.findIndex((item) => item.id === changed.id);
      if (index >= 0) items[index] = changed;
      else items.push(changed);
    }

    flags.proposalTemplates = items.slice(0, 50);
    const now = nowIso();
    await run(context.env.DB, `
      INSERT INTO tenant_settings (tenant_id, feature_flags_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET feature_flags_json = excluded.feature_flags_json, updated_at = excluded.updated_at
    `, [tenantId, JSON.stringify(flags), now]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, ?, 'PROPOSAL_TEMPLATE', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, action === 'archive' ? 'PROPOSAL_TEMPLATE_ARCHIVED' : 'PROPOSAL_TEMPLATE_SAVED', changed.id, JSON.stringify({ name: changed.name, serviceType: changed.serviceType, active: changed.active }), now]);
    return json({ updated: true, item: changed });
  } catch (cause) {
    console.error('Proposal template action error', cause);
    return error(cause.message || 'Proposal template could not be saved', Number(cause.status || 500));
  }
}
