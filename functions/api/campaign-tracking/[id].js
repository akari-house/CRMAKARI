import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import {
  parseCampaignTracking,
  serializeCampaignTracking,
  sanitizeOverview,
  sanitizeTarget,
  sanitizeSocialUpdate,
  sanitizeCreatorAssignment,
  sanitizeCreatorPost,
  campaignTrackingSummary,
} from '../../lib/campaign-tracking.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const DELIVERY_PARTNER_TYPES = new Set(['DELIVERY_PARTNER','CREATOR_AGENCY','KOL_AGENCY','AGENCY','SERVICE_PROVIDER','INTERNAL','OTHER']);

function requireWrite(auth) {
  if (!WRITE_ROLES.has(auth?.role)) {
    const cause = new Error('Campaign tracking write permission is required');
    cause.status = 403;
    throw cause;
  }
}

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.*, p.name AS project_name, p.website AS project_website,
      u.full_name AS campaign_owner_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    LEFT JOIN users u ON u.id = c.campaign_owner_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

async function loadDeliveryPartners(db, tenantId) {
  const rows = await all(db, `
    SELECT id,name,partner_type,status,website,x_url,contact_name
    FROM partners
    WHERE tenant_id = ? AND status IN ('ACTIVE','DORMANT')
    ORDER BY name COLLATE NOCASE
  `, [tenantId]);
  return rows.filter((row) => DELIVERY_PARTNER_TYPES.has(String(row.partner_type || 'OTHER').toUpperCase()));
}

function enrichTracking(tracking, partners) {
  const byId = new Map((partners || []).map((partner) => [partner.id, partner]));
  return {
    ...tracking,
    creatorAssignments:(tracking.creatorAssignments || []).map((assignment) => {
      const partner = assignment.agencyPartnerId ? byId.get(assignment.agencyPartnerId) : null;
      return {
        ...assignment,
        agencyName:partner?.name || assignment.agencyName || '',
        agencyPartnerType:partner?.partner_type || null,
        agencyPartnerStatus:partner?.status || null,
      };
    }),
  };
}

function publicItem(row, tracking, partners = []) {
  const resolvedTracking = enrichTracking(tracking, partners);
  return {
    id:row.id,
    name:row.name,
    projectId:row.project_id,
    projectName:row.project_name,
    campaignOwnerId:row.campaign_owner_id,
    campaignOwnerName:row.campaign_owner_name,
    startDate:row.start_date,
    targetCompletionDate:row.end_date,
    status:row.status,
    overview:{ ...resolvedTracking.overview, projectWebsite:resolvedTracking.overview.projectWebsite || row.project_website || '' },
    targets:resolvedTracking.targets,
    socialUpdates:[...resolvedTracking.socialUpdates].sort((a,b) => String(b.dataDate).localeCompare(String(a.dataDate))),
    creatorAssignments:resolvedTracking.creatorAssignments,
    creatorPosts:[...resolvedTracking.creatorPosts].sort((a,b) => String(b.dataDate).localeCompare(String(a.dataDate))),
    summary:campaignTrackingSummary(resolvedTracking, row.start_date),
    updatedAt:resolvedTracking.updatedAt || row.updated_at,
  };
}

async function persist(db, auth, tenantId, row, root, tracking, action, before) {
  const now = nowIso();
  tracking.createdAt ||= now;
  tracking.createdBy ||= auth.userId;
  tracking.updatedAt = now;
  tracking.updatedBy = auth.userId;
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [serializeCampaignTracking(root, tracking), now, auth.userId, tenantId, row.id]);
  await run(db, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'CAMPAIGN_TRACKING', ?, ?, ?, ?)
  `, [makeId('aud'), tenantId, auth.userId, action, row.id, JSON.stringify(before || {}), JSON.stringify(campaignTrackingSummary(tracking, row.start_date)), now]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { tracking } = parseCampaignTracking(row.notes);
    const deliveryPartners = await loadDeliveryPartners(context.env.DB, tenantId);
    return json({ item:publicItem(row, tracking, deliveryPartners), deliveryPartners, permissions:{ canWrite:WRITE_ROLES.has(auth?.role), canManage:MANAGER_ROLES.has(auth?.role) } });
  } catch (cause) {
    return error(cause.message || 'Campaign tracking workspace could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireWrite(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = String(body.action || '').toLowerCase();
    if (!context.env.DB) return json({ updated:true, action, demo:true });
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    const before = campaignTrackingSummary(tracking, row.start_date);

    if (action === 'update-overview') {
      tracking.overview = sanitizeOverview(body.overview || {}, tracking.overview);
    } else if (action === 'upsert-target') {
      const targetInput = body.target || {};
      const index = tracking.targets.findIndex((item) => item.platform === String(targetInput.platform || '').toUpperCase());
      const target = sanitizeTarget(targetInput, index >= 0 ? tracking.targets[index] : {});
      if (index >= 0) tracking.targets[index] = target; else tracking.targets.push(target);
    } else if (action === 'upsert-social-update') {
      const updateInput = body.update || {};
      const duplicateIndex = tracking.socialUpdates.findIndex((item) => item.platform === String(updateInput.platform || '').toUpperCase() && item.dataDate === updateInput.dataDate && item.id !== updateInput.id);
      if (duplicateIndex >= 0) return error('An update already exists for this platform and reporting date', 409);
      const index = updateInput.id ? tracking.socialUpdates.findIndex((item) => item.id === updateInput.id) : -1;
      const update = sanitizeSocialUpdate(updateInput, row.start_date, index >= 0 ? tracking.socialUpdates[index] : {});
      update.enteredBy ||= auth.userId;
      if (index >= 0) tracking.socialUpdates[index] = update; else tracking.socialUpdates.push(update);
    } else if (action === 'delete-social-update') {
      if (!MANAGER_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
      const index = tracking.socialUpdates.findIndex((item) => item.id === String(body.id || ''));
      if (index < 0) return error('Owned-social update was not found', 404);
      tracking.socialUpdates.splice(index, 1);
    } else if (action === 'upsert-creator-assignment') {
      const input = body.assignment || {};
      const index = input.id ? tracking.creatorAssignments.findIndex((item) => item.id === input.id) : -1;
      const previous = index >= 0 ? tracking.creatorAssignments[index] : {};
      const partnerId = String(input.agencyPartnerId ?? previous.agencyPartnerId ?? '').trim();
      let partner = null;
      if (partnerId) {
        partner = await first(context.env.DB, `SELECT id,name,partner_type,status FROM partners WHERE tenant_id = ? AND id = ? AND status IN ('ACTIVE','DORMANT') LIMIT 1`, [tenantId, partnerId]);
        if (!partner) return error('Selected delivery partner was not found in this workspace', 422);
        if (!DELIVERY_PARTNER_TYPES.has(String(partner.partner_type || 'OTHER').toUpperCase())) return error('Selected partner is not configured as a delivery partner', 422);
        input.agencyName = partner.name;
      } else if (Object.prototype.hasOwnProperty.call(input, 'agencyPartnerId')) {
        input.agencyName = '';
      }
      const assignment = sanitizeCreatorAssignment(input, previous, tracking.overview);
      assignment.agencyPartnerId = partnerId || null;
      if (index >= 0) tracking.creatorAssignments[index] = assignment; else tracking.creatorAssignments.push(assignment);
    } else if (action === 'delete-creator-assignment') {
      if (!MANAGER_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
      const id = String(body.id || '');
      const index = tracking.creatorAssignments.findIndex((item) => item.id === id);
      if (index < 0) return error('Tracked creator was not found', 404);
      tracking.creatorAssignments.splice(index, 1);
      tracking.creatorPosts = tracking.creatorPosts.filter((post) => post.assignmentId !== id);
    } else if (action === 'upsert-creator-post') {
      const input = body.post || {};
      const assignment = tracking.creatorAssignments.find((item) => item.id === String(input.assignmentId || ''));
      if (!assignment) return error('Tracked creator assignment was not found', 422);
      const duplicate = tracking.creatorPosts.find((item) => item.url === String(input.url || '').trim() && item.id !== input.id);
      if (duplicate) return error('This creator post URL is already tracked', 409);
      const index = input.id ? tracking.creatorPosts.findIndex((item) => item.id === input.id) : -1;
      const post = sanitizeCreatorPost(input, assignment, row.start_date, index >= 0 ? tracking.creatorPosts[index] : {});
      post.enteredBy ||= auth.userId;
      if (index >= 0) tracking.creatorPosts[index] = post; else tracking.creatorPosts.push(post);
    } else if (action === 'delete-creator-post') {
      if (!MANAGER_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
      const index = tracking.creatorPosts.findIndex((item) => item.id === String(body.id || ''));
      if (index < 0) return error('Tracked creator post was not found', 404);
      tracking.creatorPosts.splice(index, 1);
    } else {
      return error('Campaign tracking action is invalid', 422);
    }

    await persist(context.env.DB, auth, tenantId, row, root, tracking, `CAMPAIGN_TRACKING_${action.toUpperCase().replaceAll('-', '_')}`, before);
    const deliveryPartners = await loadDeliveryPartners(context.env.DB, tenantId);
    return json({ updated:true, item:publicItem(row, tracking, deliveryPartners), deliveryPartners });
  } catch (cause) {
    return error(cause.message || 'Campaign tracking could not be updated', Number(cause.status || 500));
  }
}
