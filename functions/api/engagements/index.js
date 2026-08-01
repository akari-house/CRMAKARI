import { json, error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseEngagement } from '../../lib/revenue-lifecycle.js';

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const rows = await all(context.env.DB, `
      SELECT c.*, p.name AS project_name, o.name AS opportunity_name, u.full_name AS owner_name
      FROM campaigns c
      JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
      LEFT JOIN opportunities o ON o.id = c.opportunity_id AND o.tenant_id = c.tenant_id
      LEFT JOIN users u ON u.id = c.campaign_owner_id
      WHERE c.tenant_id = ?
        AND (c.opportunity_id IS NOT NULL OR c.notes LIKE '%\"recordType\":\"AKARI_ENGAGEMENT_V1\"%')
      ORDER BY CASE c.status WHEN 'LIVE' THEN 1 WHEN 'ONBOARDING' THEN 2 WHEN 'PLANNING' THEN 3 ELSE 4 END,
               c.updated_at DESC
    `, [tenantId]);
    const showFinance = canViewFinance(auth);
    const items = rows.map((row) => {
      const engagement = parseEngagement(row);
      return {
        ...engagement,
        projectName: row.project_name,
        opportunityName: row.opportunity_name,
        ownerName: row.owner_name,
        ...(showFinance ? {} : {
          grossRevenue: null,
          directCosts: null,
          marginBeforeReferral: null,
          referralPercentage: null,
          referralReward: null,
          akariNetRevenue: null,
          amountInvoiced: null,
          amountReceived: null,
          outstandingAmount: null,
        }),
      };
    });
    return json({ items, total: items.length, financeVisible: showFinance });
  } catch (cause) {
    return error(cause.message || 'Service engagements could not be loaded', Number(cause.status || 500));
  }
}
