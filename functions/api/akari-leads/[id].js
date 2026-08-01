import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const EDITABLE_LIFECYCLES = new Set(['LEAD','PROSPECT','ACTIVE_OPPORTUNITY','DORMANT_CLIENT','FORMER_CLIENT','ARCHIVED']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const text = (value, max = 10000) => {
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
const priority = (value) => ['URGENT','HIGH','MEDIUM','LOW'].includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : 'MEDIUM';
const field = (body, key, existing, max) => hasOwn(body, key) ? text(body[key], max) : existing;

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Lead write permission is required', 403);
    const tenantId = requireTenant(auth);
    const id = String(context.params.id || '');
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ id, updated: true, demo: true });

    const existing = await first(context.env.DB, 'SELECT * FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, id]);
    if (!existing) return error('Lead not found in this workspace', 404);

    const xUrl = hasOwn(body, 'xUrl') ? normalizeX(body.xUrl) : existing.x_url;
    const telegram = hasOwn(body, 'telegram') ? normalizeTelegram(body.telegram) : existing.telegram;
    if (!xUrl || !telegram) return error('Every lead requires both an X account and Telegram handle', 422);

    let lifecycle = existing.lifecycle_status;
    if (hasOwn(body, 'lifecycleStatus')) {
      lifecycle = String(body.lifecycleStatus || '').toUpperCase();
      if (['CLIENT','PARTNER'].includes(lifecycle)) return error('Use the controlled lead conversion workflow for Client or Partner status', 422);
      if (!EDITABLE_LIFECYCLES.has(lifecycle)) return error('Invalid lifecycle status', 422);
    }

    let ownerUserId = existing.owner_user_id;
    if (body.assignToMe === true) ownerUserId = auth.userId;
    else if (body.assignToMe === false) ownerUserId = null;
    else if (hasOwn(body, 'ownerUserId')) ownerUserId = text(body.ownerUserId, 120);
    if (ownerUserId) {
      const owner = await first(context.env.DB, `
        SELECT u.id FROM users u
        JOIN tenant_memberships tm ON tm.user_id = u.id
        WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.id = ?
      `, [tenantId, ownerUserId]);
      if (!owner) return error('Selected owner is not an active member of this workspace', 422);
    }

    const next = {
      name: field(body, 'name', existing.name, 300),
      category: field(body, 'category', existing.category, 300),
      website: field(body, 'website', existing.website, 1000),
      xUrl,
      telegram,
      region: field(body, 'region', existing.region, 500),
      description: field(body, 'description', existing.description, 10000),
      priority: hasOwn(body, 'priority') ? priority(body.priority) : existing.priority,
      lifecycle,
      sourceName: field(body, 'sourceName', existing.source_name, 1000),
      nextFollowUpAt: field(body, 'nextFollowUpAt', existing.next_follow_up_at, 100),
      notes: field(body, 'notes', existing.original_notes, 20000),
      ownerUserId,
    };
    if (!next.name) return error('Project / organization name is required', 422);

    const now = nowIso();
    await run(context.env.DB, `
      UPDATE projects SET
        name = ?, category = ?, website = ?, x_url = ?, telegram = ?, region = ?,
        description = ?, priority = ?, lifecycle_status = ?, source_name = ?,
        next_follow_up_at = ?, original_notes = ?, owner_user_id = ?, updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `, [
      next.name, next.category, next.website, next.xUrl, next.telegram, next.region,
      next.description, next.priority, next.lifecycle, next.sourceName,
      next.nextFollowUpAt, next.notes, next.ownerUserId, now, auth.userId, tenantId, id,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,ip_address,user_agent,created_at)
      VALUES (?,?,?,'AKARI_LEAD_UPDATED','PROJECT',?,?,?,?,?,?)
    `, [
      makeId('aud'), tenantId, auth.userId, id,
      JSON.stringify({ name: existing.name, priority: existing.priority, lifecycle: existing.lifecycle_status, xUrl: existing.x_url, telegram: existing.telegram, ownerUserId: existing.owner_user_id, nextFollowUpAt: existing.next_follow_up_at }),
      JSON.stringify(next), context.request.headers.get('cf-connecting-ip'), context.request.headers.get('user-agent'), now,
    ]);

    return json({ id, updated: true, item: next });
  } catch (cause) {
    console.error('Lead PATCH error', cause);
    return error(cause.message || 'Lead could not be updated', Number(cause.status || 500));
  }
}
