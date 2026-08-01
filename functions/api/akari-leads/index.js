import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const LIFECYCLES = new Set(['LEAD','PROSPECT','ACTIVE_OPPORTUNITY','CLIENT','DORMANT_CLIENT','FORMER_CLIENT','PARTNER','ARCHIVED']);
const PRIORITIES = new Set(['URGENT','HIGH','MEDIUM','LOW']);
const FOLLOW_UP_FILTERS = new Set(['overdue','today','missing','scheduled']);
const IDENTITY_FILTERS = new Set(['complete','missing','lead-missing','contact-missing']);
const SORTS = new Set(['priority','follow_up','updated','name','created','pipeline']);
const canWrite = (auth) => WRITE_ROLES.has(auth?.role);
const text = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};
const normalizeTelegram = (value) => {
  const raw = text(value, 300);
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
function slugify(value) {
  return String(value || 'lead').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'lead';
}
function normalizePriority(value) {
  const priority = String(value || 'MEDIUM').toUpperCase();
  return PRIORITIES.has(priority) ? priority : 'MEDIUM';
}
function orderBy(sort, direction) {
  const dir = direction === 'desc' ? 'DESC' : 'ASC';
  if (sort === 'follow_up') return `COALESCE(p.next_follow_up_at,'9999-12-31') ${dir}, p.name COLLATE NOCASE ASC`;
  if (sort === 'updated') return `p.updated_at ${dir}, p.name COLLATE NOCASE ASC`;
  if (sort === 'name') return `p.name COLLATE NOCASE ${dir}`;
  if (sort === 'created') return `p.created_at ${dir}, p.name COLLATE NOCASE ASC`;
  if (sort === 'pipeline') return `pipeline_value ${dir}, p.name COLLATE NOCASE ASC`;
  return `CASE p.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END ${direction === 'desc' ? 'DESC' : 'ASC'}, COALESCE(p.next_follow_up_at,'9999-12-31') ASC, p.name COLLATE NOCASE ASC`;
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const url = new URL(context.request.url);
    const search = text(url.searchParams.get('search'), 200) || '';
    const category = text(url.searchParams.get('category'), 200);
    const priority = text(url.searchParams.get('priority'), 20)?.toUpperCase();
    const lifecycle = text(url.searchParams.get('lifecycle'), 40)?.toUpperCase();
    const owner = text(url.searchParams.get('owner'), 120);
    const followUp = text(url.searchParams.get('followUp'), 40)?.toLowerCase();
    const identity = text(url.searchParams.get('identity'), 40)?.toLowerCase();
    const sort = SORTS.has(String(url.searchParams.get('sort') || '').toLowerCase()) ? String(url.searchParams.get('sort')).toLowerCase() : 'priority';
    const direction = String(url.searchParams.get('direction') || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
    const conditions = ["p.tenant_id = ?", "p.source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')"];
    const bindings = [tenantId];

    if (search) {
      const like = `%${search}%`;
      conditions.push(`(
        p.name LIKE ? OR p.website LIKE ? OR p.x_url LIKE ? OR p.telegram LIKE ? OR p.source_name LIKE ?
        OR EXISTS (SELECT 1 FROM contacts cs WHERE cs.tenant_id = p.tenant_id AND cs.project_id = p.id AND (cs.full_name LIKE ? OR cs.email LIKE ? OR cs.telegram LIKE ? OR cs.x_handle LIKE ?))
      )`);
      bindings.push(like, like, like, like, like, like, like, like, like);
    }
    if (category) { conditions.push('p.category = ?'); bindings.push(category); }
    if (priority && PRIORITIES.has(priority)) { conditions.push('p.priority = ?'); bindings.push(priority); }
    if (lifecycle && LIFECYCLES.has(lifecycle)) { conditions.push('p.lifecycle_status = ?'); bindings.push(lifecycle); }
    if (owner === 'unassigned') conditions.push('p.owner_user_id IS NULL');
    else if (owner) { conditions.push('p.owner_user_id = ?'); bindings.push(owner); }

    if (followUp && FOLLOW_UP_FILTERS.has(followUp)) {
      if (followUp === 'overdue') conditions.push("p.next_follow_up_at IS NOT NULL AND datetime(p.next_follow_up_at) < datetime('now')");
      if (followUp === 'today') conditions.push("p.next_follow_up_at IS NOT NULL AND date(p.next_follow_up_at) = date('now')");
      if (followUp === 'missing') conditions.push('p.next_follow_up_at IS NULL');
      if (followUp === 'scheduled') conditions.push("p.next_follow_up_at IS NOT NULL AND datetime(p.next_follow_up_at) >= datetime('now')");
    }

    if (identity && IDENTITY_FILTERS.has(identity)) {
      const contactComplete = `EXISTS (SELECT 1 FROM contacts ci WHERE ci.tenant_id = p.tenant_id AND ci.project_id = p.id AND ci.telegram IS NOT NULL AND ci.x_handle IS NOT NULL)`;
      const leadComplete = '(p.x_url IS NOT NULL AND p.telegram IS NOT NULL)';
      if (identity === 'complete') conditions.push(`${leadComplete} AND ${contactComplete}`);
      if (identity === 'missing') conditions.push(`(NOT ${leadComplete} OR NOT ${contactComplete})`);
      if (identity === 'lead-missing') conditions.push(`NOT ${leadComplete}`);
      if (identity === 'contact-missing') conditions.push(`NOT ${contactComplete}`);
    }

    const where = conditions.join(' AND ');
    const items = await all(context.env.DB, `
      SELECT p.id,p.name,p.category,p.lifecycle_status,p.priority,p.website,p.x_url,p.telegram,p.region,p.source_name,
        p.original_status,p.original_notes,p.last_activity_at,p.next_follow_up_at,p.created_at,p.updated_at,p.owner_user_id,
        u.full_name AS owner, rp.name AS referral_partner_name,
        (SELECT c.full_name FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id ORDER BY c.is_primary_contact DESC,c.created_at ASC LIMIT 1) AS primary_contact,
        (SELECT c.email FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id ORDER BY c.is_primary_contact DESC,c.created_at ASC LIMIT 1) AS primary_contact_email,
        (SELECT c.telegram FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id ORDER BY c.is_primary_contact DESC,c.created_at ASC LIMIT 1) AS primary_contact_telegram,
        (SELECT c.x_handle FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id ORDER BY c.is_primary_contact DESC,c.created_at ASC LIMIT 1) AS primary_contact_x,
        (SELECT COUNT(*) FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id) AS contact_count,
        (SELECT COUNT(*) FROM opportunities o WHERE o.project_id=p.id AND o.tenant_id=p.tenant_id AND o.stage NOT IN ('WON','LOST')) AS open_opportunities,
        (SELECT COALESCE(SUM(COALESCE(o.estimated_value_base_currency,o.estimated_value,0)),0) FROM opportunities o WHERE o.project_id=p.id AND o.tenant_id=p.tenant_id AND o.stage NOT IN ('WON','LOST')) AS pipeline_value
      FROM projects p
      LEFT JOIN users u ON u.id=p.owner_user_id
      LEFT JOIN partners rp ON rp.id=p.referral_partner_id AND rp.tenant_id=p.tenant_id
      WHERE ${where}
      ORDER BY ${orderBy(sort, direction)}
      LIMIT ? OFFSET ?
    `, [...bindings, limit, offset]);

    const enriched = items.map((item) => ({
      ...item,
      identity_complete: Boolean(item.x_url && item.telegram),
      contact_identity_complete: Number(item.contact_count || 0) > 0 && Boolean(item.primary_contact_x && item.primary_contact_telegram),
      missing_identity_fields: [!item.x_url ? 'X account' : null, !item.telegram ? 'Telegram handle' : null].filter(Boolean),
    }));
    const count = await first(context.env.DB, `SELECT COUNT(*) AS total FROM projects p WHERE ${where}`, bindings);
    const sourceScope = "tenant_id=? AND source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')";
    const categories = await all(context.env.DB, `SELECT COALESCE(category,'Uncategorized') AS category,COUNT(*) AS count FROM projects WHERE ${sourceScope} GROUP BY COALESCE(category,'Uncategorized') ORDER BY count DESC,category ASC`, [tenantId]);
    const lifecycles = await all(context.env.DB, `SELECT lifecycle_status AS lifecycle,COUNT(*) AS count FROM projects WHERE ${sourceScope} GROUP BY lifecycle_status ORDER BY count DESC,lifecycle_status ASC`, [tenantId]);
    const owners = await all(context.env.DB, `
      SELECT DISTINCT u.id, u.full_name
      FROM projects p JOIN users u ON u.id=p.owner_user_id
      WHERE p.${sourceScope.replace('tenant_id', 'tenant_id')}
      ORDER BY u.full_name COLLATE NOCASE ASC
    `, [tenantId]);

    return json({
      items: enriched,
      total: Number(count?.total || 0),
      categories,
      lifecycles,
      owners,
      limit,
      offset,
      applied: { search, category, priority: priority || '', lifecycle: lifecycle || '', owner: owner || '', followUp: followUp || '', identity: identity || '', sort, direction },
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
    const xUrl = normalizeX(body.xUrl);
    const telegram = normalizeTelegram(body.telegram);
    if (!name) return error('Project / organization name is required', 422);
    if (!xUrl || !telegram) return error('Every lead requires both an X account and Telegram handle', 422);
    const now = nowIso();
    const id = makeId('prj');
    const slug = `${slugify(name)}-${id.slice(-8)}`;
    await run(context.env.DB, `INSERT INTO projects (id,tenant_id,name,slug,lifecycle_status,website,x_url,telegram,category,region,description,priority,source_type,source_name,owner_user_id,next_follow_up_at,original_import_source,original_status,original_notes,legacy_import_data,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,'LEAD',?,?,?,?,?,?,?,'AKARI_LEADS',?,?,?,?,?,?,?,?,?,?,?)`, [
      id,tenantId,name,slug,text(body.website,1000),xUrl,telegram,text(body.category,300),text(body.region,300),text(body.description,5000),normalizePriority(body.priority),text(body.sourceName,500)||'Manual AKARI Lead',body.assignToMe===false?null:auth.userId,text(body.nextFollowUpAt,100),'Manual AKARI Lead','Manually created',text(body.notes,10000),JSON.stringify({collection:'AKARI Leads',createdManually:true}),now,now,auth.userId,auth.userId
    ]);
    await run(context.env.DB, `INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,ip_address,user_agent,created_at) VALUES (?,?,?,'AKARI_LEAD_CREATED','PROJECT',?,?,?,?,?)`, [makeId('aud'),tenantId,auth.userId,id,JSON.stringify({name,sourceType:'AKARI_LEADS',xUrl,telegram}),context.request.headers.get('cf-connecting-ip'),context.request.headers.get('user-agent'),now]);
    return json({ id, created: true }, 201);
  } catch (cause) {
    console.error('AKARI Lead create error', cause);
    return error(cause.message || 'AKARI Lead could not be created', Number(cause.status || 500));
  }
}
