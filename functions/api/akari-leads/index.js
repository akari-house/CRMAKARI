import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);

function canWrite(auth) {
  return WRITE_ROLES.has(auth?.role);
}

function text(value, max = 5000) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function slugify(value) {
  return String(value || 'lead')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'lead';
}

function normalizePriority(value) {
  const priority = String(value || 'MEDIUM').toUpperCase();
  return ['URGENT', 'HIGH', 'MEDIUM', 'LOW'].includes(priority) ? priority : 'MEDIUM';
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const url = new URL(context.request.url);
    const search = text(url.searchParams.get('search'), 200) || '';
    const category = text(url.searchParams.get('category'), 200);
    const priority = text(url.searchParams.get('priority'), 20);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    const conditions = ["p.tenant_id = ?", "p.source_type = 'AKARI_LEADS'"];
    const bindings = [tenantId];

    if (search) {
      const like = `%${search}%`;
      conditions.push('(p.name LIKE ? OR p.website LIKE ? OR p.x_url LIKE ? OR p.telegram LIKE ? OR p.source_name LIKE ?)');
      bindings.push(like, like, like, like, like);
    }
    if (category) {
      conditions.push('p.category = ?');
      bindings.push(category);
    }
    if (priority) {
      conditions.push('p.priority = ?');
      bindings.push(priority.toUpperCase());
    }

    const where = conditions.join(' AND ');
    const items = await all(context.env.DB, `
      SELECT
        p.id,
        p.name,
        p.category,
        p.lifecycle_status,
        p.priority,
        p.website,
        p.x_url,
        p.telegram,
        p.region,
        p.source_name,
        p.original_status,
        p.original_notes,
        p.last_activity_at,
        p.next_follow_up_at,
        p.created_at,
        u.full_name AS owner,
        c.full_name AS primary_contact,
        c.email AS primary_contact_email,
        c.telegram AS primary_contact_telegram,
        COUNT(DISTINCT c2.id) AS contact_count,
        COUNT(DISTINCT CASE WHEN o.stage NOT IN ('WON','LOST') THEN o.id END) AS open_opportunities,
        COALESCE(SUM(CASE WHEN o.stage NOT IN ('WON','LOST') THEN COALESCE(o.estimated_value_base_currency, o.estimated_value, 0) ELSE 0 END), 0) AS pipeline_value
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_user_id
      LEFT JOIN contacts c ON c.project_id = p.id AND c.tenant_id = p.tenant_id AND c.is_primary_contact = 1
      LEFT JOIN contacts c2 ON c2.project_id = p.id AND c2.tenant_id = p.tenant_id
      LEFT JOIN opportunities o ON o.project_id = p.id AND o.tenant_id = p.tenant_id
      WHERE ${where}
      GROUP BY p.id
      ORDER BY
        CASE p.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        COALESCE(p.next_follow_up_at, '9999-12-31') ASC,
        p.name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `, [...bindings, limit, offset]);

    const count = await first(context.env.DB, `SELECT COUNT(*) AS total FROM projects p WHERE ${where}`, bindings);
    const categories = await all(context.env.DB, `
      SELECT COALESCE(category, 'Uncategorized') AS category, COUNT(*) AS count
      FROM projects
      WHERE tenant_id = ? AND source_type = 'AKARI_LEADS'
      GROUP BY COALESCE(category, 'Uncategorized')
      ORDER BY count DESC, category ASC
    `, [tenantId]);

    return json({
      items,
      total: Number(count?.total || 0),
      categories,
      limit,
      offset,
      canWrite: canWrite(auth),
      tenant: { id: tenantId, slug: auth.tenantSlug, name: auth.tenantSlug === 'akari-house' ? 'AKARI House' : auth.tenantSlug },
    });
  } catch (cause) {
    console.error('AKARI Leads list error', cause);
    return error(cause.message || 'AKARI Leads could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!canWrite(auth)) return error('Owner, Admin or BD Manager permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const body = await readJson(context.request);
    const name = text(body.name, 300);
    if (!name) return error('Project / organization name is required', 422);

    const now = nowIso();
    const id = makeId('prj');
    const slug = `${slugify(name)}-${id.slice(-8)}`;
    await run(context.env.DB, `
      INSERT INTO projects (
        id, tenant_id, name, slug, lifecycle_status, website, x_url, telegram,
        category, region, description, priority, source_type, source_name,
        owner_user_id, next_follow_up_at, original_import_source, original_status,
        original_notes, legacy_import_data, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, 'LEAD', ?, ?, ?, ?, ?, ?, ?, 'AKARI_LEADS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      tenantId,
      name,
      slug,
      text(body.website, 1000),
      text(body.xUrl, 1000),
      text(body.telegram, 300),
      text(body.category, 300),
      text(body.region, 300),
      text(body.description, 5000),
      normalizePriority(body.priority),
      text(body.sourceName, 500) || 'Manual AKARI Lead',
      body.assignToMe === false ? null : auth.userId,
      text(body.nextFollowUpAt, 100),
      'Manual AKARI Lead',
      'Manually created',
      text(body.notes, 10000),
      JSON.stringify({ collection: 'AKARI Leads', createdManually: true }),
      now,
      now,
      auth.userId,
      auth.userId,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, 'AKARI_LEAD_CREATED', 'PROJECT', ?, ?, ?, ?, ?)
    `, [
      makeId('aud'), tenantId, auth.userId, id,
      JSON.stringify({ name, sourceType: 'AKARI_LEADS' }),
      context.request.headers.get('cf-connecting-ip'),
      context.request.headers.get('user-agent'),
      now,
    ]);

    return json({ id, created: true }, 201);
  } catch (cause) {
    console.error('AKARI Lead create error', cause);
    return error(cause.message || 'AKARI Lead could not be created', Number(cause.status || 500));
  }
}
