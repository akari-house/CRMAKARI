import { error } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireRole, requireTenant } from '../../lib/permissions.js';

const EXPORT_ROLES = ['OWNER', 'ADMIN'];

function slug(value) {
  return String(value || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'workspace';
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, EXPORT_ROLES);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const tenant = await first(context.env.DB, 'SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
    if (!tenant) return error('Workspace was not found', 404);

    const [members, tenantSettings, partners, projects, contacts, opportunities, stageHistory, campaigns, deliverables, tasks, activities, referrals, payments, monthlyTargets, dailyScorecards, sourceDirectory, files, comments, auditLogs] = await Promise.all([
      all(context.env.DB, `
        SELECT tm.id, tm.tenant_id, tm.user_id, tm.role, tm.finance_access, tm.status, tm.joined_at, tm.created_at, tm.updated_at,
               u.full_name, u.email, u.avatar_url, u.status AS user_status, u.last_login_at
        FROM tenant_memberships tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ?
        ORDER BY u.full_name COLLATE NOCASE ASC
      `, [tenantId]),
      all(context.env.DB, 'SELECT * FROM tenant_settings WHERE tenant_id = ?', [tenantId]),
      all(context.env.DB, 'SELECT * FROM partners WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM projects WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM contacts WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM opportunities WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM opportunity_stage_history WHERE tenant_id = ? ORDER BY changed_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM campaign_deliverables WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM tasks WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM activities WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM referrals WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM monthly_targets WHERE tenant_id = ? ORDER BY year ASC, month ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM daily_scorecards WHERE tenant_id = ? ORDER BY scorecard_date ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM source_directory WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM files WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM comments WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
      all(context.env.DB, 'SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at ASC', [tenantId]),
    ]);

    const exportedAt = nowIso();
    const datasets = {
      members,
      tenantSettings,
      partners,
      projects,
      contacts,
      opportunities,
      opportunityStageHistory: stageHistory,
      campaigns,
      campaignDeliverables: deliverables,
      tasks,
      activities,
      referrals,
      payments,
      monthlyTargets,
      dailyScorecards,
      sourceDirectory,
      files,
      comments,
      auditLogs,
    };
    const counts = Object.fromEntries(Object.entries(datasets).map(([key, rows]) => [key, rows.length]));
    const snapshot = {
      format: 'AKARI_TENANT_BACKUP_V1',
      schemaVersion: 1,
      exportedAt,
      exportedBy: { userId: auth.userId, email: auth.email, role: auth.role },
      tenant,
      counts,
      datasets,
      restoreNotice: 'This export is a tenant-scoped recovery snapshot. Restore only through a reviewed AKARI recovery procedure; do not import it through the lead workbook importer.',
    };

    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'TENANT_BACKUP_EXPORTED', 'TENANT', ?, NULL, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, tenantId, JSON.stringify({ format: snapshot.format, counts }), exportedAt]);

    const filename = `akari-${slug(tenant.slug || tenant.name)}-backup-${exportedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(snapshot, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (cause) {
    console.error('AKARI tenant export error', cause);
    return error(cause.message || 'Tenant backup could not be created', Number(cause.status || 500));
  }
}
