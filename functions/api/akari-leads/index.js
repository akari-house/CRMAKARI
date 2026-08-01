import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { buildBdProfile, readBdProfile, profileCompleteness } from '../../lib/bd-profile.js';

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

async function validateOwner(db, tenantId, ownerUserId) {
  if (!ownerUserId) return null;
  const owner = await first(db, `
    SELECT u.id FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.id = ?
  `, [tenantId, ownerUserId]);
  if (!owner) {
    const validationError = new Error('Selected owner is not an active member of this workspace');
    validationError.status = 422;
    throw validationError;
  }
  return ownerUserId;
}

async function validateReferralPartner(db, tenantId, partnerId) {
  if (!partnerId) return null;
  const partner = await first(db, 'SELECT id FROM partners WHERE tenant_id = ? AND id = ? AND status != ?', [tenantId, partnerId, 'ARCHIVED']);
  if (!partner) {
    const validationError = new Error('Selected referral partner does not belong to this workspace');
    validationError.status = 422;
    throw validationError;
  }
  return partnerId;
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
        p.funding_status,p.funding_amount,p.valuation,p.legacy_import_data,
        u.full_name AS owner, rp.name AS referral_partner_name,
        (SELECT c.full_name FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id ORDER BY c.is_primary_contact DESC,c.created_at ASC LIMIT 1) AS primary_contact,
        (SELECT c.job_title FROM contacts c WHERE c.project_id=p.id AND c.tenant_id=p.tenant_id ORDER BY c.is_primary_contact DESC,c.created_at ASC LIMIT 1) AS primary_contact_title,
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

    const enriched = items.map((item) => {
      const bdProfile = readBdProfile(item.legacy_import_data, item);
      const contacts = item.primary_contact ? [{
        full_name: item.primary_contact,
        job_title: item.primary_contact_title,
        email: item.primary_contact_email,
        telegram: item.primary_contact_telegram,
        x_handle: item.primary_contact_x,
        is_primary_contact: 1,
      }] : [];
      const result = {
        ...item,
        bdProfile,
        profile_completeness: profileCompleteness(item, contacts, bdProfile),
        entity_type: bdProfile.entityType,
        bd_stage: bdProfile.qualification.bdStage,
        meeting_status: bdProfile.meeting.status,
        identity_complete: Boolean(item.x_url && item.telegram),
        contact_identity_complete: Number(item.contact_count || 0) > 0 && Boolean(item.primary_contact_x && item.primary_contact_telegram),
        missing_identity_fields: [!item.x_url ? 'X account' : null, !item.telegram ? 'Telegram handle' : null].filter(Boolean),
      };
      delete result.legacy_import_data;
      return result;
    });
    const count = await first(context.env.DB, `SELECT COUNT(*) AS total FROM projects p WHERE ${where}`, bindings);
    const categories = await all(context.env.DB, `SELECT COALESCE(category,'Uncategorized') AS category,COUNT(*) AS count FROM projects WHERE tenant_id=? AND source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT') GROUP BY COALESCE(category,'Uncategorized') ORDER BY count DESC,category ASC`, [tenantId]);
    const lifecycles = await all(context.env.DB, `SELECT lifecycle_status AS lifecycle,COUNT(*) AS count FROM projects WHERE tenant_id=? AND source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT') GROUP BY lifecycle_status ORDER BY count DESC,lifecycle_status ASC`, [tenantId]);
    const owners = await all(context.env.DB, `
      SELECT DISTINCT u.id, u.full_name
      FROM projects p JOIN users u ON u.id=p.owner_user_id
      WHERE p.tenant_id=? AND p.source_type IN ('AKARI_LEADS','PRIVATE_TENANT_IMPORT')
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

    let ownerUserId = body.assignToMe === true ? auth.userId : text(body.ownerUserId, 120);
    if (body.assignToMe === false && !body.ownerUserId) ownerUserId = null;
    if (body.assignToMe === undefined && !body.ownerUserId) ownerUserId = auth.userId;
    await validateOwner(context.env.DB, tenantId, ownerUserId);
    const referralPartnerId = await validateReferralPartner(context.env.DB, tenantId, text(body.referralPartnerId, 120));

    const contactName = text(body.contactFullName, 300);
    const contactX = normalizeX(body.contactXHandle);
    const contactTelegram = normalizeTelegram(body.contactTelegram);
    const hasContactInput = Boolean(contactName || contactX || contactTelegram || text(body.contactEmail, 320) || text(body.contactJobTitle, 300));
    if (hasContactInput && (!contactName || !contactX || !contactTelegram)) {
      return error('A primary contact requires full name, X account and Telegram handle', 422);
    }

    const bd = buildBdProfile(null, body, {});
    const now = nowIso();
    const id = makeId('prj');
    const contactId = hasContactInput ? makeId('con') : null;
    const slug = `${slugify(name)}-${id.slice(-8)}`;
    const projectStatement = context.env.DB.prepare(`
      INSERT INTO projects (
        id,tenant_id,name,slug,lifecycle_status,website,x_url,telegram,category,region,description,
        funding_status,funding_amount,valuation,priority,source_type,source_name,referral_partner_id,
        owner_user_id,next_follow_up_at,original_import_source,original_status,original_notes,legacy_import_data,
        created_at,updated_at,created_by,updated_by
      ) VALUES (?,?,?,?,'LEAD',?,?,?,?,?,?,?,?,?,?,'AKARI_LEADS',?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,tenantId,name,slug,text(body.website,1000),xUrl,telegram,text(body.category,300),text(body.region,300),text(body.description,5000),
      bd.profile.funding.stage,bd.profile.funding.amountRaised,bd.profile.funding.valuation,normalizePriority(body.priority),text(body.sourceName,500)||'Manual AKARI Lead',referralPartnerId,
      ownerUserId,text(body.nextFollowUpAt,100),'Manual AKARI Lead','Manually created',text(body.notes,10000),bd.serialized,now,now,auth.userId,auth.userId
    );
    const statements = [projectStatement];
    if (hasContactInput) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO contacts (
          id,tenant_id,project_id,full_name,job_title,email,telegram,x_handle,phone,preferred_channel,
          is_decision_maker,is_primary_contact,notes,created_at,updated_at,created_by,updated_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        contactId,tenantId,id,contactName,text(body.contactJobTitle,300),text(body.contactEmail,320),contactTelegram,contactX,
        text(body.contactPhone,100),text(body.contactPreferredChannel,100)||'TELEGRAM',body.contactIsDecisionMaker===false?0:1,1,
        text(body.contactNotes,5000),now,now,auth.userId,auth.userId
      ));
    }
    statements.push(context.env.DB.prepare(`
      INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,ip_address,user_agent,created_at)
      VALUES (?,?,?,'AKARI_LEAD_CREATED','PROJECT',?,?,?,?,?)
    `).bind(
      makeId('aud'),tenantId,auth.userId,id,JSON.stringify({
        name,sourceType:'AKARI_LEADS',xUrl,telegram,ownerUserId,referralPartnerId,entityType:bd.profile.entityType,
        bdStage:bd.profile.qualification.bdStage,primaryContactCreated:Boolean(contactId),
      }),context.request.headers.get('cf-connecting-ip'),context.request.headers.get('user-agent'),now
    ));
    await context.env.DB.batch(statements);
    return json({ id, contactId, created: true, bdProfile: bd.profile }, 201);
  } catch (cause) {
    console.error('AKARI Lead create error', cause);
    return error(cause.message || 'AKARI Lead could not be created', Number(cause.status || 500));
  }
}
