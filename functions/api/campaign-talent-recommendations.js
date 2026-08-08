import { json, error } from '../lib/response.js';
import { all } from '../lib/db.js';
import { requireTenant } from '../lib/permissions.js';
import { buildCampaignTalentRecommendations } from '../lib/campaign-talent-recommendations.js';

const DELIVERY_PARTNER_TYPES = new Set(['DELIVERY_PARTNER','CREATOR_AGENCY','KOL_AGENCY','AGENCY','SERVICE_PROVIDER','INTERNAL','OTHER']);

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const url = new URL(context.request.url);
    const criteria = {
      objective:url.searchParams.get('objective') || 'BALANCED',
      platform:url.searchParams.get('platform') || 'ALL',
      creatorType:url.searchParams.get('creatorType') || 'ALL',
      contentType:url.searchParams.get('contentType') || 'ALL',
      region:url.searchParams.get('region') || 'ALL',
      budgetUsd:url.searchParams.get('budgetUsd') || 0,
      limit:url.searchParams.get('limit') || 10,
    };

    const [campaigns, partnerRows] = await Promise.all([
      all(context.env.DB, `
        SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,p.name AS project_name
        FROM campaigns c
        JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
        ORDER BY c.updated_at DESC
      `, [tenantId]),
      all(context.env.DB, `
        SELECT id,name,partner_type,status,website,x_url,contact_name
        FROM partners
        WHERE tenant_id = ?
        ORDER BY name COLLATE NOCASE
      `, [tenantId]),
    ]);
    const partners = partnerRows.filter((row) => DELIVERY_PARTNER_TYPES.has(String(row.partner_type || 'OTHER').toUpperCase()));
    return json({ intelligence:buildCampaignTalentRecommendations(campaigns, partners, criteria) });
  } catch (cause) {
    return error(cause.message || 'Campaign talent recommendations could not be loaded', Number(cause.status || 500));
  }
}
