import { json, error } from '../../../lib/response.js';
import { all, first } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';

const IMPORT_ROLES = new Set(['OWNER', 'ADMIN']);

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    if (!IMPORT_ROLES.has(auth?.role)) return error('Owner or Admin permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const items = await all(context.env.DB, `
      SELECT id, name, website, x_url, telegram, original_import_source
      FROM projects
      WHERE tenant_id = ? AND source_type = 'AKARI_LEADS'
      ORDER BY created_at DESC
      LIMIT 5000
    `, [tenantId]);

    const lastImport = await first(context.env.DB, `
      SELECT action, after_data, created_at
      FROM audit_logs
      WHERE tenant_id = ? AND action IN ('AKARI_LEADS_IMPORT_COMPLETE','AKARI_LEADS_IMPORT_CHUNK','AKARI_LEADS_IMPORT_ROLLBACK')
      ORDER BY created_at DESC
      LIMIT 1
    `, [tenantId]);

    return json({ items, total: items.length, lastImport });
  } catch (cause) {
    console.error('AKARI Leads existing import check error', cause);
    return error(cause.message || 'Existing lead fingerprints could not be loaded', Number(cause.status || 500));
  }
}
