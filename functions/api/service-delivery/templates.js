import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseFeatureFlags } from '../../lib/commercial-hardening.js';
import { SYSTEM_DELIVERY_TEMPLATES, sanitizeCustomTemplate } from '../../lib/service-delivery.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);

async function loadSettings(db, tenantId) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ?', [tenantId]);
  const flags = parseFeatureFlags(row?.feature_flags_json);
  const templates = Array.isArray(flags.serviceDeliveryTemplates) ? flags.serviceDeliveryTemplates : [];
  return { flags, templates };
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({ items:SYSTEM_DELIVERY_TEMPLATES, total:SYSTEM_DELIVERY_TEMPLATES.length, demo:true });
    const { templates } = await loadSettings(context.env.DB, tenantId);
    const custom = templates.filter((item) => item?.active !== false).map((item) => ({ ...item, system:false }));
    return json({ items:[...SYSTEM_DELIVERY_TEMPLATES, ...custom], total:SYSTEM_DELIVERY_TEMPLATES.length + custom.length });
  } catch (cause) {
    return error(cause.message || 'Service templates could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = String(body.action || 'save').toLowerCase();
    if (!context.env.DB) return json({ updated:true, demo:true });
    const { flags, templates } = await loadSettings(context.env.DB, tenantId);
    let items = [...templates];
    let changed;
    if (action === 'archive') {
      const id = String(body.id || '').trim();
      if (id.startsWith('system_')) return error('Built-in service templates cannot be archived', 409);
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return error('Service template was not found', 404);
      changed = { ...items[index], active:false, updatedAt:nowIso() };
      items[index] = changed;
    } else {
      const existing = body.id ? items.find((item) => item.id === body.id) : null;
      changed = sanitizeCustomTemplate(body, existing || {});
      const index = items.findIndex((item) => item.id === changed.id);
      if (index >= 0) items[index] = changed;
      else items.push(changed);
    }
    flags.serviceDeliveryTemplates = items.slice(0, 50);
    const now = nowIso();
    await run(context.env.DB, `
      INSERT INTO tenant_settings (tenant_id, feature_flags_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET feature_flags_json = excluded.feature_flags_json, updated_at = excluded.updated_at
    `, [tenantId, JSON.stringify(flags), now]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, ?, 'SERVICE_TEMPLATE', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, action === 'archive' ? 'SERVICE_TEMPLATE_ARCHIVED' : 'SERVICE_TEMPLATE_SAVED', changed.id, JSON.stringify({ name:changed.name, serviceType:changed.serviceType, active:changed.active }), now]);
    return json({ updated:true, item:changed });
  } catch (cause) {
    console.error('Service template action error', cause);
    return error(cause.message || 'Service template could not be saved', Number(cause.status || 500));
  }
}
