import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { buildBdProfile } from '../../lib/bd-profile.js';

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

async function validateOwner(db, tenantId, ownerUserId) {
  if (!ownerUserId) return null;
  const owner = await first(db, `
    SELECT u.id FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.id = ?
  `, [tenantId, ownerUserId]);
  if (!owner) return error('Selected owner is not an active member of this workspace', 422);
  return null;
}

async function validateReferralPartner(db, tenantId, partnerId) {
  if (!partnerId) return null;
  const partner = await first(db, 'SELECT id FROM partners WHERE tenant_id = ? AND id = ? AND status != ?', [tenantId, partnerId, 'ARCHIVED']);
  return partner ? null : error('Selected referral partner does not belong to this workspace', 422);
}

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
    if (hasOwn(body, 'ownerUserId')) ownerUserId = text(body.ownerUserId, 120);
    else if (body.assignToMe === true) ownerUserId = auth.userId;
    else if (body.assignToMe === false) ownerUserId = null;
    const ownerError = await validateOwner(context.env.DB, tenantId, ownerUserId);
    if (ownerError) return ownerError;

    let referralPartnerId = existing.referral_partner_id;
    if (hasOwn(body, 'referralPartnerId')) referralPartnerId = text(body.referralPartnerId, 120);
    const referralError = await validateReferralPartner(context.env.DB, tenantId, referralPartnerId);
    if (referralError) return referralError;

    const bd = buildBdProfile(existing.legacy_import_data, body, existing);
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
      referralPartnerId,
      fundingStatus: bd.profile.funding.stage,
      fundingAmount: bd.profile.funding.amountRaised,
      valuation: bd.profile.funding.valuation,
      legacyImportData: bd.serialized,
    };
    if (!next.name) return error('Project / organization name is required', 422);

    const contactKeys = ['contactFullName','contactJobTitle','contactEmail','contactTelegram','contactXHandle','contactPhone','contactPreferredChannel','contactIsDecisionMaker','contactNotes'];
    const wantsContactUpdate = contactKeys.some((key) => hasOwn(body, key));
    const currentContact = wantsContactUpdate ? await first(context.env.DB, `
      SELECT * FROM contacts WHERE tenant_id = ? AND project_id = ?
      ORDER BY is_primary_contact DESC, created_at ASC LIMIT 1
    `, [tenantId, id]) : null;
    let contact = null;
    if (wantsContactUpdate) {
      contact = {
        id: currentContact?.id || makeId('con'),
        fullName: field(body, 'contactFullName', currentContact?.full_name, 300),
        jobTitle: field(body, 'contactJobTitle', currentContact?.job_title, 300),
        email: field(body, 'contactEmail', currentContact?.email, 320),
        telegram: hasOwn(body, 'contactTelegram') ? normalizeTelegram(body.contactTelegram) : currentContact?.telegram,
        xHandle: hasOwn(body, 'contactXHandle') ? normalizeX(body.contactXHandle) : currentContact?.x_handle,
        phone: field(body, 'contactPhone', currentContact?.phone, 100),
        preferredChannel: field(body, 'contactPreferredChannel', currentContact?.preferred_channel, 100) || 'TELEGRAM',
        isDecisionMaker: hasOwn(body, 'contactIsDecisionMaker') ? Boolean(body.contactIsDecisionMaker) : Boolean(currentContact?.is_decision_maker),
        notes: field(body, 'contactNotes', currentContact?.notes, 5000),
      };
      if (!contact.fullName || !contact.xHandle || !contact.telegram) {
        return error('A primary contact requires full name, X account and Telegram handle', 422);
      }
    }

    const now = nowIso();
    const statements = [context.env.DB.prepare(`
      UPDATE projects SET
        name = ?, category = ?, website = ?, x_url = ?, telegram = ?, region = ?,
        description = ?, funding_status = ?, funding_amount = ?, valuation = ?, priority = ?, lifecycle_status = ?,
        source_name = ?, referral_partner_id = ?, next_follow_up_at = ?, original_notes = ?,
        owner_user_id = ?, legacy_import_data = ?, updated_at = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `).bind(
      next.name,next.category,next.website,next.xUrl,next.telegram,next.region,next.description,
      next.fundingStatus,next.fundingAmount,next.valuation,next.priority,next.lifecycle,next.sourceName,next.referralPartnerId,
      next.nextFollowUpAt,next.notes,next.ownerUserId,next.legacyImportData,now,auth.userId,tenantId,id
    )];

    if (contact) {
      if (currentContact) {
        statements.push(context.env.DB.prepare(`
          UPDATE contacts SET full_name=?,job_title=?,email=?,telegram=?,x_handle=?,phone=?,preferred_channel=?,
            is_decision_maker=?,is_primary_contact=1,notes=?,updated_at=?,updated_by=?
          WHERE tenant_id=? AND id=?
        `).bind(
          contact.fullName,contact.jobTitle,contact.email,contact.telegram,contact.xHandle,contact.phone,contact.preferredChannel,
          contact.isDecisionMaker?1:0,contact.notes,now,auth.userId,tenantId,contact.id
        ));
      } else {
        statements.push(context.env.DB.prepare(`
          INSERT INTO contacts (
            id,tenant_id,project_id,full_name,job_title,email,telegram,x_handle,phone,preferred_channel,
            is_decision_maker,is_primary_contact,notes,created_at,updated_at,created_by,updated_by
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          contact.id,tenantId,id,contact.fullName,contact.jobTitle,contact.email,contact.telegram,contact.xHandle,contact.phone,
          contact.preferredChannel,contact.isDecisionMaker?1:0,1,contact.notes,now,now,auth.userId,auth.userId
        ));
      }
    }

    statements.push(context.env.DB.prepare(`
      INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,ip_address,user_agent,created_at)
      VALUES (?,?,?,'AKARI_LEAD_UPDATED','PROJECT',?,?,?,?,?,?)
    `).bind(
      makeId('aud'),tenantId,auth.userId,id,
      JSON.stringify({
        name:existing.name,priority:existing.priority,lifecycle:existing.lifecycle_status,xUrl:existing.x_url,telegram:existing.telegram,
        ownerUserId:existing.owner_user_id,referralPartnerId:existing.referral_partner_id,nextFollowUpAt:existing.next_follow_up_at,
      }),
      JSON.stringify({
        ...next,legacyImportData:undefined,entityType:bd.profile.entityType,bdStage:bd.profile.qualification.bdStage,
        primaryContactUpdated:Boolean(contact),
      }),context.request.headers.get('cf-connecting-ip'),context.request.headers.get('user-agent'),now
    ));
    await context.env.DB.batch(statements);

    return json({ id, updated: true, item: { ...next, legacyImportData: undefined }, bdProfile: bd.profile, contactId: contact?.id || null });
  } catch (cause) {
    console.error('Lead PATCH error', cause);
    return error(cause.message || 'Lead could not be updated', Number(cause.status || 500));
  }
}
