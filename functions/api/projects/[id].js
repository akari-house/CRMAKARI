import { json, error } from '../../lib/response.js';
import { all, first } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { readBdProfile, profileCompleteness } from '../../lib/bd-profile.js';

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    const id = String(context.params.id || '');
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const item = await first(context.env.DB, 'SELECT * FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    if (!item) return error('Project not found', 404);
    const [contacts, opportunities, activities, invoiceSummary] = await Promise.all([
      all(context.env.DB, 'SELECT * FROM contacts WHERE tenant_id = ? AND project_id = ? ORDER BY is_primary_contact DESC, full_name', [tenantId, id]),
      all(context.env.DB, 'SELECT * FROM opportunities WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC', [tenantId, id]),
      all(context.env.DB, 'SELECT * FROM activities WHERE tenant_id = ? AND project_id = ? ORDER BY occurred_at DESC LIMIT 50', [tenantId, id]),
      canViewFinance(auth) ? first(context.env.DB, `
        SELECT COUNT(*) AS invoice_count,
          COALESCE(SUM(CASE WHEN status IN ('INVOICED','PARTIALLY_PAID','OVERDUE') THEN amount ELSE 0 END),0) AS outstanding,
          COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END),0) AS collected
        FROM payments
        WHERE tenant_id = ? AND project_id = ? AND (payment_type='INVOICE' OR notes LIKE '%\"recordType\":\"INVOICE_V1\"%')
      `, [tenantId, id]) : Promise.resolve(null),
    ]);
    const bdProfile = readBdProfile(item.legacy_import_data, item);
    const result = {
      ...item,
      bdProfile,
      profile_completeness: profileCompleteness(item, contacts, bdProfile),
      contacts,
      opportunities,
      activities,
      invoiceSummary: invoiceSummary ? {
        count: Number(invoiceSummary.invoice_count || 0),
        outstanding: Number(invoiceSummary.outstanding || 0),
        collected: Number(invoiceSummary.collected || 0),
      } : null,
    };
    delete result.legacy_import_data;
    return json(result);
  } catch (cause) {
    console.error('Project detail error', cause);
    return error(cause.message || 'Project could not be loaded', Number(cause.status || 500));
  }
}
