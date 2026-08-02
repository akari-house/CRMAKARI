import { json, error } from '../../../lib/response.js';
import { all, first } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';

const IMPORT_ROLES = new Set(['OWNER', 'ADMIN']);

function number(value) {
  return Number(value || 0);
}

function diagnose(counts, latestImport) {
  if (counts.visibleLeads > 0) return 'LEADS_PRESENT_FOR_AUTHENTICATED_TENANT';
  if (counts.projects === 0) return 'TENANT_HAS_NO_PROJECT_RECORDS';
  if (latestImport?.action === 'AKARI_LEADS_IMPORT_ROLLBACK') return 'LATEST_IMPORT_EVENT_IS_ROLLBACK';
  return 'PROJECTS_EXIST_BUT_VISIBLE_LEAD_SOURCES_ARE_MISSING';
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    if (!IMPORT_ROLES.has(auth?.role)) return error('Owner or Admin permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const [items, importedCount, sourceTypes, totals, tenant, recentImportEvents] = await Promise.all([
      all(context.env.DB, `
        SELECT id, name, website, x_url, telegram, original_import_source
        FROM projects
        WHERE tenant_id = ? AND source_type = 'AKARI_LEADS'
        ORDER BY created_at DESC
        LIMIT 5000
      `, [tenantId]),
      first(context.env.DB, `
        SELECT COUNT(*) AS total
        FROM projects
        WHERE tenant_id = ? AND source_type = 'AKARI_LEADS'
      `, [tenantId]),
      all(context.env.DB, `
        SELECT COALESCE(NULLIF(TRIM(source_type), ''), '(unset)') AS source_type, COUNT(*) AS record_count
        FROM projects
        WHERE tenant_id = ?
        GROUP BY COALESCE(NULLIF(TRIM(source_type), ''), '(unset)')
        ORDER BY record_count DESC, source_type ASC
      `, [tenantId]),
      first(context.env.DB, `
        SELECT
          (SELECT COUNT(*) FROM projects WHERE tenant_id = ?) AS projects,
          (SELECT COUNT(*) FROM contacts WHERE tenant_id = ?) AS contacts,
          (SELECT COUNT(*) FROM tasks WHERE tenant_id = ?) AS tasks,
          (SELECT COUNT(*) FROM projects WHERE tenant_id = ? AND source_type IN ('AKARI_LEADS', 'PRIVATE_TENANT_IMPORT')) AS visible_leads
      `, [tenantId, tenantId, tenantId, tenantId]),
      first(context.env.DB, `
        SELECT
          t.id AS tenant_id,
          t.slug,
          t.name,
          t.status AS tenant_status,
          u.email,
          u.status AS user_status,
          tm.role,
          tm.status AS membership_status,
          tm.finance_access
        FROM tenant_memberships tm
        JOIN tenants t ON t.id = tm.tenant_id
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ? AND tm.user_id = ?
        LIMIT 1
      `, [tenantId, auth.userId]),
      all(context.env.DB, `
        SELECT action, entity_id, after_data, created_at
        FROM audit_logs
        WHERE tenant_id = ?
          AND action IN ('AKARI_LEADS_IMPORT_COMPLETE', 'AKARI_LEADS_IMPORT_CHUNK', 'AKARI_LEADS_IMPORT_ROLLBACK')
        ORDER BY created_at DESC
        LIMIT 20
      `, [tenantId]),
    ]);

    const sourceCountMap = Object.fromEntries(sourceTypes.map((row) => [row.source_type, number(row.record_count)]));
    const counts = {
      projects: number(totals?.projects),
      contacts: number(totals?.contacts),
      tasks: number(totals?.tasks),
      akariLeads: number(importedCount?.total),
      privateTenantImports: number(sourceCountMap.PRIVATE_TENANT_IMPORT),
      visibleLeads: number(totals?.visible_leads),
    };
    counts.otherProjects = Math.max(0, counts.projects - counts.visibleLeads);

    const lastImport = recentImportEvents[0] || null;

    return json({
      items,
      total: counts.akariLeads,
      lastImport,
      diagnostics: {
        status: diagnose(counts, lastImport),
        generatedAt: new Date().toISOString(),
        authenticated: {
          userId: auth.userId,
          email: auth.email,
          role: auth.role,
          tenantId: auth.tenantId,
          tenantSlug: auth.tenantSlug,
        },
        tenant,
        counts,
        sourceTypes: sourceTypes.map((row) => ({
          sourceType: row.source_type,
          count: number(row.record_count),
        })),
        recentImportEvents,
      },
    });
  } catch (cause) {
    console.error('AKARI Leads existing import check error', cause);
    return error(cause.message || 'Existing lead fingerprints could not be loaded', Number(cause.status || 500));
  }
}
