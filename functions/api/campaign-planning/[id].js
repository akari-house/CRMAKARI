import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking, sanitizeCreatorAssignment } from '../../lib/campaign-tracking.js';
import { buildCampaignTalentRecommendations } from '../../lib/campaign-talent-recommendations.js';
import { creatorIdentity } from '../../lib/creator-kol-portfolio-intelligence.js';
import {
  parseCampaignPlanning,
  sanitizeCampaignPlanning,
  buildCampaignPlanSummary,
  campaignPlanFingerprint,
  assertCampaignPlanReady,
  touchPlanning,
  clearApproval,
} from '../../lib/campaign-planning.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const DELIVERY_PARTNER_TYPES = new Set(['DELIVERY_PARTNER','CREATOR_AGENCY','KOL_AGENCY','AGENCY','SERVICE_PROVIDER','INTERNAL','OTHER']);
const ACTIVE_PARTNER_STATUSES = new Set(['ACTIVE','DORMANT']);

const text = (value) => String(value || '').trim();
const normalize = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');

function requireWrite(auth) {
  if (!WRITE_ROLES.has(auth?.role)) {
    const cause = new Error('Campaign planning write permission is required');
    cause.status = 403;
    throw cause;
  }
}
function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const cause = new Error('Owner, Admin or BD Manager permission is required');
    cause.status = 403;
    throw cause;
  }
}
function requireEditable(planning) {
  if (planning.status === 'APPROVED') {
    const cause = new Error('Approved campaign plans must be reopened before editing');
    cause.status = 409;
    throw cause;
  }
  if (planning.status === 'READY_FOR_APPROVAL') {
    const cause = new Error('A submitted campaign plan must be reopened before editing');
    cause.status = 409;
    throw cause;
  }
}

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,c.project_id,
      p.name AS project_name,p.website AS project_website
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

async function loadCampaignUniverse(db, tenantId) {
  return all(db, `
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,p.name AS project_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ?
    ORDER BY c.updated_at DESC
  `, [tenantId]);
}

async function loadPartners(db, tenantId) {
  const rows = await all(db, `
    SELECT id,name,partner_type,status,website,x_url,contact_name
    FROM partners
    WHERE tenant_id = ?
    ORDER BY name COLLATE NOCASE
  `, [tenantId]);
  return rows.filter((row) => DELIVERY_PARTNER_TYPES.has(String(row.partner_type || 'OTHER').toUpperCase()));
}

function enrichAssignments(tracking, planning, partners) {
  const byPartner = new Map((partners || []).map((partner) => [partner.id, partner]));
  const provenance = new Map((planning.selections || []).map((item) => [item.assignmentId, item]));
  return (tracking.creatorAssignments || []).filter((item) => item.active !== false).map((assignment) => {
    const partner = assignment.agencyPartnerId ? byPartner.get(assignment.agencyPartnerId) : null;
    return {
      ...assignment,
      agencyName:partner?.name || assignment.agencyName || '',
      agencyPartnerType:partner?.partner_type || null,
      recommendation:provenance.get(assignment.id) || null,
    };
  });
}

function criteriaFrom(planning, request) {
  const url = new URL(request.url);
  return {
    objective:url.searchParams.get('objective') || planning.objective || 'BALANCED',
    platform:url.searchParams.get('platform') || planning.platform || 'ALL',
    creatorType:url.searchParams.get('creatorType') || planning.creatorType || 'ALL',
    contentType:url.searchParams.get('contentType') || planning.contentType || 'ALL',
    region:url.searchParams.get('region') || planning.region || 'ALL',
    budgetUsd:url.searchParams.get('budgetUsd') || planning.budgetUsd || 0,
    limit:url.searchParams.get('limit') || 12,
  };
}

function publicPayload(row, root, tracking, partners, recommendations, auth) {
  const planning = parseCampaignPlanning(root);
  const summary = buildCampaignPlanSummary(tracking, planning);
  return {
    item:{
      id:row.id,
      name:row.name,
      projectId:row.project_id,
      projectName:row.project_name,
      status:row.status,
      region:row.region,
      startDate:row.start_date,
      endDate:row.end_date,
      overview:tracking.overview || {},
      planning,
      summary,
      planItems:enrichAssignments(tracking, planning, partners),
    },
    recommendations,
    deliveryPartners:(partners || []).filter((partner) => ACTIVE_PARTNER_STATUSES.has(String(partner.status || '').toUpperCase())),
    permissions:{ canWrite:WRITE_ROLES.has(auth?.role), canManage:MANAGER_ROLES.has(auth?.role) },
    methodology:{ approvedSnapshot:true, driftDetection:true, recommendationVersion:'R8.5E-1' },
  };
}

async function persist(db, auth, tenantId, row, root, tracking, planning, action, beforeSummary) {
  const now = nowIso();
  planning.lastModifiedAt = now;
  planning.lastModifiedBy = auth.userId;
  tracking.updatedAt = now;
  tracking.updatedBy = auth.userId;
  const notes = JSON.stringify({ ...root, campaignTracking:tracking, campaignPlanning:planning });
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [notes, now, auth.userId, tenantId, row.id]);
  const afterSummary = buildCampaignPlanSummary(tracking, planning);
  await run(db, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'CAMPAIGN_PLAN', ?, ?, ?, ?)
  `, [makeId('aud'), tenantId, auth.userId, action, row.id, JSON.stringify(beforeSummary || {}), JSON.stringify(afterSummary), now]);
}

async function recommendationSet(db, tenantId, partners, criteria) {
  const campaigns = await loadCampaignUniverse(db, tenantId);
  return buildCampaignTalentRecommendations(campaigns, partners, criteria);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    const planning = parseCampaignPlanning(root);
    const partners = await loadPartners(context.env.DB, tenantId);
    const intelligence = await recommendationSet(context.env.DB, tenantId, partners, criteriaFrom(planning, context.request));
    const selectedKeys = new Set((planning.selections || []).map((item) => item.identityKey).filter(Boolean));
    intelligence.recommendations = (intelligence.recommendations || []).filter((item) => !selectedKeys.has(item.identityKey));
    return json(publicPayload(row, root, tracking, partners, intelligence, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign planning workspace could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireWrite(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = text(body.action).toLowerCase();
    if (!context.env.DB) return json({ updated:true, action, demo:true });

    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    let planning = parseCampaignPlanning(root);
    const beforeSummary = buildCampaignPlanSummary(tracking, planning);
    const partners = await loadPartners(context.env.DB, tenantId);

    if (action === 'update-plan') {
      requireEditable(planning);
      planning = sanitizeCampaignPlanning(body.planning || {}, planning);
      if (planning.status === 'REJECTED') planning = clearApproval(planning);
      planning = touchPlanning(planning, auth);
    } else if (action === 'add-recommended-talent') {
      requireEditable(planning);
      const identityKey = text(body.identityKey);
      if (!identityKey) return error('A recommended talent identity is required', 422);
      const existing = (tracking.creatorAssignments || []).find((assignment) => creatorIdentity(assignment).key === identityKey && assignment.active !== false);
      if (existing) return error('This Creator or KOL is already in the campaign plan', 409);
      const intelligence = await recommendationSet(context.env.DB, tenantId, partners, { ...planning, limit:25 });
      const recommendation = (intelligence.recommendations || []).find((item) => item.identityKey === identityKey);
      if (!recommendation) return error('Recommended talent was not found for the current planning criteria', 404);
      const activePartners = partners.filter((partner) => ACTIVE_PARTNER_STATUSES.has(String(partner.status || '').toUpperCase()));
      const partner = activePartners.find((candidate) => (recommendation.agencies || []).some((name) => normalize(name) === normalize(candidate.name))) || null;
      const preferredPlatform = planning.platform !== 'ALL' && (recommendation.platforms || []).includes(planning.platform)
        ? planning.platform
        : (recommendation.platforms || [])[0] || 'X';
      const expectedReach = recommendation.approvedPosts > 0 ? Math.round(recommendation.approvedReach / recommendation.approvedPosts) : 0;
      const assignment = sanitizeCreatorAssignment({
        creatorType:recommendation.creatorType === 'MIXED' ? 'CREATOR' : recommendation.creatorType,
        name:recommendation.name,
        handle:recommendation.handle,
        platform:preferredPlatform,
        profileUrl:recommendation.profileUrl,
        agencyName:partner?.name || (recommendation.agencies || []).find((name) => name !== 'Direct / Unassigned') || '',
        category:planning.contentType !== 'ALL' ? planning.contentType : '',
        region:planning.region !== 'ALL' ? planning.region : (recommendation.regions || [])[0] || '',
        sorsaScore:recommendation.latestSorsaScore || recommendation.averageSorsaScore || 0,
        xScore:recommendation.latestXScore || recommendation.averageXScore || 0,
        expectedPosts:1,
        expectedReach,
        allocatedUsd:recommendation.historicalAverageAllocation || 0,
        allocatedTokens:0,
        notes:`Added from AKARI recommendation intelligence ${intelligence.methodology?.rankingVersion || 'R8.5E-1'} at score ${Number(recommendation.recommendationScore || 0).toFixed(1)}.`,
      }, {}, tracking.overview || {});
      assignment.agencyPartnerId = partner?.id || null;
      tracking.creatorAssignments.push(assignment);
      planning.selections = [...(planning.selections || []), {
        assignmentId:assignment.id,
        identityKey:recommendation.identityKey,
        recommendationScore:recommendation.recommendationScore,
        recommendationVersion:intelligence.methodology?.rankingVersion || 'R8.5E-1',
        addedAt:nowIso(),
        addedBy:auth.userId,
      }];
      if (planning.status === 'REJECTED') planning = clearApproval(planning);
      planning = touchPlanning(planning, auth);
    } else if (action === 'upsert-plan-item') {
      requireEditable(planning);
      const input = body.assignment || {};
      const index = tracking.creatorAssignments.findIndex((item) => item.id === text(input.id));
      if (index < 0) return error('Campaign plan talent item was not found', 404);
      const previous = tracking.creatorAssignments[index];
      const partnerId = text(input.agencyPartnerId ?? previous.agencyPartnerId);
      let partner = null;
      if (partnerId) {
        partner = partners.find((item) => item.id === partnerId && ACTIVE_PARTNER_STATUSES.has(String(item.status || '').toUpperCase())) || null;
        if (!partner) return error('Selected delivery partner was not found or is unavailable in this workspace', 422);
        input.agencyName = partner.name;
      } else if (Object.prototype.hasOwnProperty.call(input, 'agencyPartnerId')) {
        input.agencyName = '';
      }
      const next = sanitizeCreatorAssignment(input, previous, tracking.overview || {});
      next.agencyPartnerId = partnerId || null;
      tracking.creatorAssignments[index] = next;
      if (planning.status === 'REJECTED') planning = clearApproval(planning);
      planning = touchPlanning(planning, auth);
    } else if (action === 'remove-plan-item') {
      requireEditable(planning);
      const assignmentId = text(body.assignmentId);
      const index = tracking.creatorAssignments.findIndex((item) => item.id === assignmentId);
      if (index < 0) return error('Campaign plan talent item was not found', 404);
      if ((tracking.creatorPosts || []).some((post) => post.assignmentId === assignmentId)) return error('Talent with tracked execution posts cannot be removed from the plan', 409);
      tracking.creatorAssignments.splice(index, 1);
      planning.selections = (planning.selections || []).filter((item) => item.assignmentId !== assignmentId);
      if (planning.status === 'REJECTED') planning = clearApproval(planning);
      planning = touchPlanning(planning, auth);
    } else if (action === 'submit-plan') {
      if (!['DRAFT','REJECTED'].includes(planning.status)) return error('Only a Draft or Rejected campaign plan can be submitted', 409);
      const summary = buildCampaignPlanSummary(tracking, planning);
      assertCampaignPlanReady(summary);
      planning = {
        ...planning,
        status:'READY_FOR_APPROVAL',
        submittedAt:nowIso(),
        submittedBy:auth.userId,
        approvedAt:null,
        approvedBy:null,
        approvedFingerprint:null,
        rejectedAt:null,
        rejectedBy:null,
        rejectionReason:'',
      };
      planning = touchPlanning(planning, auth);
    } else if (action === 'approve-plan') {
      requireManager(auth);
      if (planning.status !== 'READY_FOR_APPROVAL') return error('Only a submitted campaign plan can be approved', 409);
      const summary = buildCampaignPlanSummary(tracking, planning);
      assertCampaignPlanReady(summary);
      planning = {
        ...planning,
        status:'APPROVED',
        approvedAt:nowIso(),
        approvedBy:auth.userId,
        approvedFingerprint:campaignPlanFingerprint(tracking, planning),
        rejectedAt:null,
        rejectedBy:null,
        rejectionReason:'',
      };
      planning = touchPlanning(planning, auth);
    } else if (action === 'reject-plan') {
      requireManager(auth);
      if (planning.status !== 'READY_FOR_APPROVAL') return error('Only a submitted campaign plan can be rejected', 409);
      const reason = text(body.reason);
      if (!reason) return error('A rejection reason is required', 422);
      planning = {
        ...planning,
        status:'REJECTED',
        rejectedAt:nowIso(),
        rejectedBy:auth.userId,
        rejectionReason:reason.slice(0,1000),
        approvedAt:null,
        approvedBy:null,
        approvedFingerprint:null,
      };
      planning = touchPlanning(planning, auth);
    } else if (action === 'reopen-plan') {
      requireManager(auth);
      if (planning.status === 'DRAFT') return error('Campaign plan is already a Draft', 409);
      planning = touchPlanning(clearApproval(planning), auth);
    } else {
      return error('Campaign planning action is invalid', 422);
    }

    await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, `CAMPAIGN_PLAN_${action.toUpperCase().replaceAll('-', '_')}`, beforeSummary);
    const intelligence = await recommendationSet(context.env.DB, tenantId, partners, { ...planning, limit:12 });
    const selectedKeys = new Set((planning.selections || []).map((item) => item.identityKey).filter(Boolean));
    intelligence.recommendations = (intelligence.recommendations || []).filter((item) => !selectedKeys.has(item.identityKey));
    return json({ updated:true, ...publicPayload(row, { ...root, campaignPlanning:planning }, tracking, partners, intelligence, auth) });
  } catch (cause) {
    return error(cause.message || 'Campaign planning could not be updated', Number(cause.status || 500));
  }
}
