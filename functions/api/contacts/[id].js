import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const text = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};
const normalizeTelegram = (value) => {
  const raw = text(value, 500);
  if (!raw) return null;
  const handle = raw.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0].trim();
  return handle ? `@${handle}` : null;
};
const normalizeX = (value) => {
  const raw = text(value, 1000);
  if (!raw) return null;
  const handle = raw.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].trim();
  return handle ? `https://x.com/${handle}` : null;
};
const valueOrExisting = (body, key, existing, max) => hasOwn(body, key) ? text(body[key], max) : existing;

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Contact write permission is required', 403);
    const tenantId = requireTenant(auth);
    const id = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id, updated: true, demo: true });

    const existing = await first(context.env.DB, 'SELECT * FROM contacts WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    if (!existing) return error('Contact not found in this workspace', 404);

    const projectId = hasOwn(body, 'projectId') ? text(body.projectId, 120) : existing.project_id;
    const project = await first(context.env.DB, 'SELECT id FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, projectId]);
    if (!project) return error('Referenced project does not belong to this workspace', 422);

    const fullName = valueOrExisting(body, 'fullName', existing.full_name, 300);
    const telegram = hasOwn(body, 'telegram') ? normalizeTelegram(body.telegram) : existing.telegram;
    const xHandle = hasOwn(body, 'xHandle') ? normalizeX(body.xHandle) : existing.x_handle;
    if (!fullName) return error('Full name is required', 422);
    if (!telegram || !xHandle) return error('Every contact requires both an X account and Telegram handle', 422);

    const next = {
      projectId,
      fullName,
      jobTitle: valueOrExisting(body, 'jobTitle', existing.job_title, 500),
      contactRole: valueOrExisting(body, 'contactRole', existing.contact_role, 500),
      email: valueOrExisting(body, 'email', existing.email, 500),
      telegram,
      xHandle,
      linkedinUrl: valueOrExisting(body, 'linkedinUrl', existing.linkedin_url, 1000),
      phone: valueOrExisting(body, 'phone', existing.phone, 500),
      preferredChannel: valueOrExisting(body, 'preferredChannel', existing.preferred_channel, 100),
      isDecisionMaker: hasOwn(body, 'isDecisionMaker') ? Boolean(body.isDecisionMaker) : Boolean(existing.is_decision_maker),
      isPrimaryContact: hasOwn(body, 'isPrimaryContact') ? Boolean(body.isPrimaryContact) : Boolean(existing.is_primary_contact),
      nextFollowUpAt: valueOrExisting(body, 'nextFollowUpAt', existing.next_follow_up_at, 100),
      notes: valueOrExisting(body, 'notes', existing.notes, 10000),
    };

    const now = nowIso();
    if (next.isPrimaryContact) {
      await run(context.env.DB, 'UPDATE contacts SET is_primary_contact = 0, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND project_id = ? AND id <> ?', [now, auth.userId, tenantId, projectId, id]);
    }

    await run(context.env.DB, `
      UPDATE contacts SET
        project_id = ?, full_name = ?, job_title = ?, contact_role = ?, email = ?,
        telegram = ?, x_handle = ?, linkedin_url = ?, phone = ?, preferred_channel = ?,
        is_decision_maker = ?, is_primary_contact = ?, next_follow_up_at = ?, notes = ?,
        updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      next.projectId, next.fullName, next.jobTitle, next.contactRole, next.email,
      next.telegram, next.xHandle, next.linkedinUrl, next.phone, next.preferredChannel,
      next.isDecisionMaker ? 1 : 0, next.isPrimaryContact ? 1 : 0, next.nextFollowUpAt, next.notes,
      now, auth.userId, tenantId, id,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs (
        id, tenant_id, user_id, action, entity_type, entity_id,
        before_data, after_data, ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, 'CONTACT_UPDATED', 'CONTACT', ?, ?, ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, id,
      JSON.stringify({ projectId: existing.project_id, fullName: existing.full_name, email: existing.email, telegram: existing.telegram, xHandle: existing.x_handle, isPrimaryContact: Boolean(existing.is_primary_contact) }),
      JSON.stringify(next), context.request.headers.get('cf-connecting-ip'), context.request.headers.get('user-agent'), now,
    ]);

    return json({ id, updated: true, item: { ...next, id, project_id: next.projectId, full_name: next.fullName, x_handle: next.xHandle, is_primary_contact: next.isPrimaryContact ? 1 : 0, is_decision_maker: next.isDecisionMaker ? 1 : 0 } });
  } catch (cause) {
    console.error('Contact PATCH error', cause);
    return error(cause.message || 'Contact could not be updated', Number(cause.status || 500));
  }
}
