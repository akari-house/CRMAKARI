import { json,error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';
import { buildDeliveryPartnerPortfolio } from '../lib/delivery-partner-portfolio-intelligence.js';

const DELIVERY_PARTNER_TYPES = new Set(['DELIVERY_PARTNER','CREATOR_AGENCY','KOL_AGENCY','AGENCY','SERVICE_PROVIDER','INTERNAL','OTHER']);

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);

    const [campaigns, partnerRows] = await Promise.all([
      all(context.env.DB,`
        SELECT c.id,c.name,c.status,c.start_date,c.end_date,c.notes,c.updated_at
        FROM campaigns c
        WHERE c.tenant_id = ?
        ORDER BY c.updated_at DESC
      `,[tenantId]),
      all(context.env.DB,`
        SELECT id,name,partner_type,status,website,x_url,contact_name
        FROM partners
        WHERE tenant_id = ?
        ORDER BY name COLLATE NOCASE
      `,[tenantId]),
    ]);
    const partners = partnerRows.filter((row) => DELIVERY_PARTNER_TYPES.has(String(row.partner_type || 'OTHER').toUpperCase()));
    return json({ portfolio:buildDeliveryPartnerPortfolio(campaigns,partners) });
  } catch (cause) {
    return error(cause.message || 'Delivery partner portfolio intelligence could not be loaded',Number(cause.status || 500));
  }
}
