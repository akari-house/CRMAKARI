import { json, error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';
import { buildCreatorKolPortfolio } from '../lib/creator-kol-portfolio-intelligence.js';

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const [campaigns, partners] = await Promise.all([
      all(context.env.DB, `
        SELECT c.id,c.name,c.status,c.start_date,c.end_date,c.notes,c.updated_at,p.name AS project_name
        FROM campaigns c
        JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
        ORDER BY c.updated_at DESC
      `, [tenantId]),
      all(context.env.DB, `
        SELECT id,name,partner_type,status
        FROM partners
        WHERE tenant_id = ?
        ORDER BY name COLLATE NOCASE
      `, [tenantId]),
    ]);

    return json({ portfolio:buildCreatorKolPortfolio(campaigns, partners) });
  } catch (cause) {
    return error(cause.message || 'Creator and KOL portfolio intelligence could not be loaded', Number(cause.status || 500));
  }
}
