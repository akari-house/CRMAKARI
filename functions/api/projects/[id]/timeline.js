import { json, error } from '../../../lib/response.js';
import { first, all } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';

const AUDIT_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const safeJson = (value) => {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
};

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    const projectId = String(context.params.id || '');
    if (!context.env.DB) return json({ items: [], auditVisible: AUDIT_ROLES.has(auth?.role), demo: true });

    const project = await first(context.env.DB, 'SELECT id, name FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, projectId]);
    if (!project) return error('Project not found in this workspace', 404);

    const activities = await all(context.env.DB, `
      SELECT a.id, a.activity_type, a.subject, a.description, a.outcome, a.occurred_at,
             a.next_action, a.follow_up_at, u.full_name AS actor_name
      FROM activities a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = ? AND a.project_id = ?
      ORDER BY a.occurred_at DESC
      LIMIT 100
    `, [tenantId, projectId]);

    const activityItems = activities.map((item) => ({
      id: item.id,
      kind: 'ACTIVITY',
      type: item.activity_type,
      title: item.subject || item.activity_type,
      description: item.description || null,
      outcome: item.outcome || null,
      actor: item.actor_name || null,
      occurredAt: item.occurred_at,
      nextAction: item.next_action || null,
      followUpAt: item.follow_up_at || null,
    }));

    let auditItems = [];
    if (AUDIT_ROLES.has(auth?.role)) {
      const audits = await all(context.env.DB, `
        SELECT al.id, al.action, al.entity_type, al.entity_id, al.before_data, al.after_data,
               al.created_at, u.full_name AS actor_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.tenant_id = ? AND (
          (al.entity_type = 'PROJECT' AND al.entity_id = ?)
          OR (al.entity_type = 'CONTACT' AND al.entity_id IN (SELECT id FROM contacts WHERE tenant_id = ? AND project_id = ?))
          OR (al.entity_type = 'OPPORTUNITY' AND al.entity_id IN (SELECT id FROM opportunities WHERE tenant_id = ? AND project_id = ?))
          OR (al.entity_type = 'CAMPAIGN' AND al.entity_id IN (SELECT id FROM campaigns WHERE tenant_id = ? AND project_id = ?))
        )
        ORDER BY al.created_at DESC
        LIMIT 100
      `, [tenantId, projectId, tenantId, projectId, tenantId, projectId, tenantId, projectId]);

      auditItems = audits.map((item) => ({
        id: item.id,
        kind: 'AUDIT',
        type: item.action,
        title: item.action.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
        entityType: item.entity_type,
        entityId: item.entity_id,
        actor: item.actor_name || null,
        occurredAt: item.created_at,
        before: safeJson(item.before_data),
        after: safeJson(item.after_data),
      }));
    }

    const items = [...activityItems, ...auditItems]
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')))
      .slice(0, 150);

    return json({ project: { id: project.id, name: project.name }, items, auditVisible: AUDIT_ROLES.has(auth?.role) });
  } catch (cause) {
    console.error('Project timeline GET error', cause);
    return error(cause.message || 'Project timeline could not be loaded', Number(cause.status || 500));
  }
}
