import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireRole, requireTenant } from '../../lib/permissions.js';

const MANAGE_ROLES = ['OWNER', 'ADMIN'];
const SIGNOFF_ITEMS = {
  accessBoundary: {
    label: 'Cloudflare Access boundary verified',
    description: 'The public homepage is reachable without login while CRM routes remain protected.',
  },
  roleMatrix: {
    label: 'Role and permission matrix tested',
    description: 'Owner, Admin, BD, Finance and Viewer behaviour has been checked with real accounts.',
  },
  leadToCash: {
    label: 'Lead-to-cash workflow completed',
    description: 'A real record has moved from lead through won work, delivery, invoice and payment.',
  },
  backupRestore: {
    label: 'Backup and recovery drill completed',
    description: 'A tenant backup was downloaded and the restore procedure was reviewed.',
  },
  mobile: {
    label: 'Desktop and mobile acceptance completed',
    description: 'The highest-frequency workflows were checked on desktop and mobile layouts.',
  },
  ownerApproval: {
    label: 'Production owner sign-off recorded',
    description: 'The workspace owner accepts the current release for controlled team use.',
  },
};

function safeJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function number(value) {
  return Number(value || 0);
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((number(numerator) / number(denominator)) * 100);
}

function statusForRatio(value, passAt, warnAt) {
  if (value === null) return 'WARNING';
  if (value >= passAt) return 'PASS';
  if (value >= warnAt) return 'WARNING';
  return 'FAIL';
}

function manualState(featureFlags) {
  const saved = featureFlags.productionReadinessV1?.signoff || {};
  return Object.entries(SIGNOFF_ITEMS).map(([key, definition]) => ({
    key,
    ...definition,
    completed: Boolean(saved[key]?.completed),
    note: String(saved[key]?.note || ''),
    checkedAt: saved[key]?.checkedAt || null,
    checkedBy: saved[key]?.checkedBy || null,
  }));
}

function automaticChecks(counts, lastBackup) {
  const leadOwnership = ratio(counts.leadsWithOwner, counts.leads);
  const followUpCoverage = ratio(counts.leadsWithFollowUp, counts.leads);
  const backupAge = lastBackup?.created_at ? Date.now() - new Date(lastBackup.created_at).getTime() : null;
  const backupFresh = backupAge !== null && Number.isFinite(backupAge) && backupAge <= 7 * 24 * 60 * 60 * 1000;

  return [
    {
      key: 'database',
      label: 'Production relationship database',
      status: counts.projects > 0 ? 'PASS' : 'WARNING',
      detail: counts.projects > 0 ? `${counts.projects} project and relationship records are visible.` : 'No project records are visible for this tenant.',
    },
    {
      key: 'owner',
      label: 'Active workspace owner',
      status: counts.activeOwners > 0 ? 'PASS' : 'FAIL',
      detail: `${counts.activeOwners} active owner membership${counts.activeOwners === 1 ? '' : 's'} detected.`,
    },
    {
      key: 'membership',
      label: 'Active team memberships',
      status: counts.activeMembers > 0 ? 'PASS' : 'FAIL',
      detail: `${counts.activeMembers} active team member${counts.activeMembers === 1 ? '' : 's'} can use this workspace.`,
    },
    {
      key: 'ownership',
      label: 'Lead ownership coverage',
      status: statusForRatio(leadOwnership, 90, 60),
      detail: leadOwnership === null ? 'No lead records are available to assess.' : `${leadOwnership}% of leads have an assigned owner.`,
    },
    {
      key: 'followup',
      label: 'Lead follow-up coverage',
      status: statusForRatio(followUpCoverage, 75, 40),
      detail: followUpCoverage === null ? 'No lead records are available to assess.' : `${followUpCoverage}% of leads have a next follow-up date.`,
    },
    {
      key: 'overdue',
      label: 'Overdue execution queue',
      status: counts.overdueTasks === 0 ? 'PASS' : 'WARNING',
      detail: counts.overdueTasks === 0 ? 'No overdue open tasks were detected.' : `${counts.overdueTasks} overdue task${counts.overdueTasks === 1 ? '' : 's'} need attention.`,
    },
    {
      key: 'commercial',
      label: 'Commercial workflow evidence',
      status: counts.wonOpportunities > 0 && counts.paymentRecords > 0 ? 'PASS' : 'WARNING',
      detail: `${counts.wonOpportunities} won opportunit${counts.wonOpportunities === 1 ? 'y' : 'ies'} and ${counts.paymentRecords} payment record${counts.paymentRecords === 1 ? '' : 's'} are present.`,
    },
    {
      key: 'backup',
      label: 'Recent tenant backup',
      status: backupFresh ? 'PASS' : 'WARNING',
      detail: lastBackup?.created_at ? `Last backup export: ${lastBackup.created_at}.` : 'No tenant backup export has been recorded yet.',
    },
  ];
}

function score(automatic, manual) {
  const automaticPoints = automatic.reduce((total, item) => total + (item.status === 'PASS' ? 1 : item.status === 'WARNING' ? 0.5 : 0), 0);
  const manualPoints = manual.reduce((total, item) => total + (item.completed ? 1 : 0), 0);
  const possible = automatic.length + manual.length;
  return possible ? Math.round(((automaticPoints + manualPoints) / possible) * 100) : 0;
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const [tenant, totals, roles, settings, lastBackup, lastAudit] = await Promise.all([
      first(context.env.DB, `
        SELECT id, name, slug, status, base_currency, timezone, plan_code, user_limit, storage_limit_mb
        FROM tenants
        WHERE id = ?
        LIMIT 1
      `, [tenantId]),
      first(context.env.DB, `
        SELECT
          (SELECT COUNT(*) FROM projects WHERE tenant_id = ?) AS projects,
          (SELECT COUNT(*) FROM projects WHERE tenant_id = ? AND source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')) AS leads,
          (SELECT COUNT(*) FROM projects WHERE tenant_id = ? AND source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT') AND owner_user_id IS NOT NULL) AS leads_with_owner,
          (SELECT COUNT(*) FROM projects WHERE tenant_id = ? AND source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT') AND next_follow_up_at IS NOT NULL) AS leads_with_follow_up,
          (SELECT COUNT(*) FROM contacts WHERE tenant_id = ?) AS contacts,
          (SELECT COUNT(*) FROM tasks WHERE tenant_id = ? AND status NOT IN ('DONE','CANCELLED','ARCHIVED')) AS open_tasks,
          (SELECT COUNT(*) FROM tasks WHERE tenant_id = ? AND status NOT IN ('DONE','CANCELLED','ARCHIVED') AND due_at IS NOT NULL AND datetime(due_at) < datetime('now')) AS overdue_tasks,
          (SELECT COUNT(*) FROM opportunities WHERE tenant_id = ? AND stage NOT IN ('WON','LOST')) AS open_opportunities,
          (SELECT COUNT(*) FROM opportunities WHERE tenant_id = ? AND stage = 'WON') AS won_opportunities,
          (SELECT COUNT(*) FROM campaigns WHERE tenant_id = ? AND status NOT IN ('COMPLETED','CANCELLED')) AS active_campaigns,
          (SELECT COUNT(*) FROM payments WHERE tenant_id = ?) AS payment_records,
          (SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id = ? AND status = 'ACTIVE') AS active_members,
          (SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id = ? AND status = 'ACTIVE' AND role = 'OWNER') AS active_owners
      `, [tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId]),
      all(context.env.DB, `
        SELECT role, COUNT(*) AS member_count
        FROM tenant_memberships
        WHERE tenant_id = ? AND status = 'ACTIVE'
        GROUP BY role
        ORDER BY role ASC
      `, [tenantId]),
      first(context.env.DB, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]),
      first(context.env.DB, `
        SELECT created_at, user_id
        FROM audit_logs
        WHERE tenant_id = ? AND action = 'TENANT_BACKUP_EXPORTED'
        ORDER BY created_at DESC
        LIMIT 1
      `, [tenantId]),
      first(context.env.DB, `
        SELECT action, entity_type, entity_id, created_at
        FROM audit_logs
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [tenantId]),
    ]);

    if (!tenant) return error('Workspace was not found', 404);

    const counts = {
      projects: number(totals?.projects),
      leads: number(totals?.leads),
      leadsWithOwner: number(totals?.leads_with_owner),
      leadsWithFollowUp: number(totals?.leads_with_follow_up),
      contacts: number(totals?.contacts),
      openTasks: number(totals?.open_tasks),
      overdueTasks: number(totals?.overdue_tasks),
      openOpportunities: number(totals?.open_opportunities),
      wonOpportunities: number(totals?.won_opportunities),
      activeCampaigns: number(totals?.active_campaigns),
      paymentRecords: number(totals?.payment_records),
      activeMembers: number(totals?.active_members),
      activeOwners: number(totals?.active_owners),
    };
    const featureFlags = safeJson(settings?.feature_flags_json, {});
    const manual = manualState(featureFlags);
    const automatic = automaticChecks(counts, lastBackup);

    return json({
      tenant,
      generatedAt: nowIso(),
      counts,
      roles: roles.map((item) => ({ role: item.role, count: number(item.member_count) })),
      automaticChecks: automatic,
      manualChecks: manual,
      readinessScore: score(automatic, manual),
      lastBackup: lastBackup || null,
      lastAudit: lastAudit || null,
      canManage: MANAGE_ROLES.includes(auth.role),
      canExport: MANAGE_ROLES.includes(auth.role),
    });
  } catch (cause) {
    console.error('AKARI production readiness read error', cause);
    return error(cause.message || 'Production readiness could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, MANAGE_ROLES);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const key = String(body.key || '');
    if (!SIGNOFF_ITEMS[key]) return error('Production sign-off item is invalid', 422);

    const existing = await first(context.env.DB, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
    const featureFlags = safeJson(existing?.feature_flags_json, {});
    const before = featureFlags.productionReadinessV1?.signoff?.[key] || null;
    const now = nowIso();
    const next = {
      completed: Boolean(body.completed),
      note: String(body.note || '').trim().slice(0, 1000),
      checkedAt: now,
      checkedBy: auth.email || auth.userId,
    };

    featureFlags.productionReadinessV1 = {
      ...(featureFlags.productionReadinessV1 || {}),
      version: 1,
      signoff: {
        ...(featureFlags.productionReadinessV1?.signoff || {}),
        [key]: next,
      },
      updatedAt: now,
      updatedBy: auth.userId,
    };

    if (existing) {
      await run(context.env.DB, `
        UPDATE tenant_settings
        SET feature_flags_json = ?, updated_at = ?
        WHERE tenant_id = ?
      `, [JSON.stringify(featureFlags), now, tenantId]);
    } else {
      await run(context.env.DB, `
        INSERT INTO tenant_settings (tenant_id, feature_flags_json, updated_at)
        VALUES (?, ?, ?)
      `, [tenantId, JSON.stringify(featureFlags), now]);
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
      VALUES (?, ?, ?, 'PRODUCTION_SIGNOFF_UPDATED', 'TENANT', ?, ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, tenantId, JSON.stringify(before), JSON.stringify({ key, ...next }), now]);

    return json({ key, ...next, updated: true });
  } catch (cause) {
    console.error('AKARI production readiness update error', cause);
    return error(cause.message || 'Production sign-off could not be updated', Number(cause.status || 500));
  }
}
