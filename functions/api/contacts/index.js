import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const text = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const url = new URL(context.request.url);
    const search = text(url.searchParams.get('search'), 200) || '';
    const like = `%${search}%`;
    const where = search ? 'AND (c.full_name LIKE ? OR c.email LIKE ? OR c.telegram LIKE ? OR c.x_handle LIKE ? OR p.name LIKE ?)' : '';
    const bindings = search ? [tenantId, like, like, like, like, like] : [tenantId];
    const items = await all(context.env.DB, `
      SELECT c.*, p.name AS project_name
      FROM contacts c
      JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
      WHERE c.tenant_id = ? ${where}
      ORDER BY c.is_primary_contact DESC, c.updated_at DESC
      LIMIT 250
    `, bindings);
    return json({ items, total: items.length });
  } catch (cause) {
    console.error('Contacts GET error', cause);
    return error(cause.message || 'Contacts could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Contact write permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const projectId = text(body.projectId, 120);
    const fullName = text(body.fullName, 300);
    if (!projectId || !fullName) return error('Project and full name are required', 422);
    if (!context.env.DB) return json({ id: makeId('con'), created: true, demo: true }, 201);
    const project = await first(context.env.DB, 'SELECT id FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, projectId]);
    if (!project) return error('Project not found in this workspace', 404);
    const id = makeId('con');
    const now = nowIso();
    await run(context.env.DB, `
      INSERT INTO contacts (
        id, tenant_id, project_id, full_name, job_title, contact_role, email,
        telegram, x_handle, linkedin_url, phone, preferred_channel,
        is_decision_maker, is_primary_contact, notes, created_at, updated_at,
        created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, tenantId, projectId, fullName, text(body.jobTitle, 500), text(body.contactRole, 500),
      text(body.email, 500), text(body.telegram, 500), text(body.xHandle, 1000),
      text(body.linkedinUrl, 1000), text(body.phone, 500), text(body.preferredChannel, 100),
      body.isDecisionMaker ? 1 : 0, body.isPrimaryContact ? 1 : 0, text(body.notes, 10000),
      now, now, auth.userId, auth.userId,
    ]);
    await run(context.env.DB, `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at) VALUES (?, ?, ?, 'CONTACT_CREATED', 'CONTACT', ?, ?, ?)`, [makeId('aud'), tenantId, auth.userId, id, JSON.stringify({ projectId, fullName }), now]);
    return json({ id, created: true }, 201);
  } catch (cause) {
    console.error('Contacts POST error', cause);
    return error(cause.message || 'Contact could not be created', Number(cause.status || 500));
  }
}
