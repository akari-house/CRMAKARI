import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
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

function publicItem(row, tracking) {
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
    overview:{ ...tracking.overview, projectWebsite:tracking.overview.projectWebsite || row.project_website || '' },
    targets:tracking.targets,
    socialUpdates:[...tracking.socialUpdates].sort((a,b) => String(b.dataDate).localeCompare(String(a.dataDate))),
    creatorAssignments:tracking.creatorAssignments,
    creatorPosts:[...tracking.creatorPosts].sort((a,b) => String(b.dataDate).localeCompare(String(a.dataDate))),
    summary:campaignTrackingSummary(tracking, row.start_date),
    updatedAt:tracking.updatedAt || row.updated_at,
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
    return json({ item:publicItem(row, tracking), permissions:{ canWrite:WRITE_ROLES.has(auth?.role), canManage:MANAGER_ROLES.has(auth?.role) } });
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
      const assignment = sanitizeCreatorAssignment(input, index >= 0 ? tracking.creatorAssignments[index] : {}, tracking.overview);
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
    return json({ updated:true, item:publicItem(row, tracking) });
  } catch (cause) {
    return error(cause.message || 'Campaign tracking could not be updated', Number(cause.status || 500));
  }
}
