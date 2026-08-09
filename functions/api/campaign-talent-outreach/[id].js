import { json, error, readJson } from '../../lib/response.js';
import { first, all, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking } from '../../lib/campaign-tracking.js';
import { parseCampaignPlanning, buildCampaignPlanSummary } from '../../lib/campaign-planning.js';
import {
  parseCampaignTalentOutreach,
  upsertTalentOutreachRecord,
  buildCampaignTalentOutreachSummary,
  assertTalentConfirmationReady,
} from '../../lib/campaign-talent-outreach.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function requireWrite(auth) {
  if (!WRITE_ROLES.has(auth?.role)) {
    const cause = new Error('Business Development permission is required');
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

async function loadCampaign(db, tenantId, id) {
  return first(db, `
    SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,c.project_id,
      c.campaign_owner_id,p.name AS project_name
    FROM campaigns c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ?
    LIMIT 1
  `, [tenantId, id]);
}

async function activeMember(db, tenantId, userId) {
  if (!userId) return null;
  return first(db, `
    SELECT u.id,u.full_name,u.email,tm.role
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.user_id = ?
      AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  `, [tenantId, userId]);
}

async function members(db, tenantId) {
  return all(db, `
    SELECT u.id,u.full_name,u.email,tm.role
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ? AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    ORDER BY u.full_name COLLATE NOCASE
  `, [tenantId]);
}

function assignmentById(tracking, id) {
  return (tracking.creatorAssignments || []).find((item) => item.id === id && item.active !== false) || null;
}

function boolPatch(body, key, previous) {
  return body[key] === undefined ? previous : Boolean(body[key]);
}

function termsPatch(body, previous) {
  return {
    channel:body.channel === undefined ? previous.channel : text(body.channel, 80),
    contactReference:body.contactReference === undefined ? previous.contactReference : text(body.contactReference, 1000),
    quotedUsd:body.quotedUsd === undefined ? previous.quotedUsd : number(body.quotedUsd),
    quotedTokens:body.quotedTokens === undefined ? previous.quotedTokens : number(body.quotedTokens),
    agreedUsd:body.agreedUsd === undefined ? previous.agreedUsd : number(body.agreedUsd),
    agreedTokens:body.agreedTokens === undefined ? previous.agreedTokens : number(body.agreedTokens),
    deliverablesConfirmed:boolPatch(body,'deliverablesConfirmed',previous.deliverablesConfirmed),
    scheduleConfirmed:boolPatch(body,'scheduleConfirmed',previous.scheduleConfirmed),
    compensationConfirmed:boolPatch(body,'compensationConfirmed',previous.compensationConfirmed),
    agencyConfirmed:boolPatch(body,'agencyConfirmed',previous.agencyConfirmed),
    termsConfirmed:boolPatch(body,'termsConfirmed',previous.termsConfirmed),
    consentConfirmed:boolPatch(body,'consentConfirmed',previous.consentConfirmed),
    evidenceReference:body.evidenceReference === undefined ? previous.evidenceReference : text(body.evidenceReference, 1500),
    notes:body.notes === undefined ? previous.notes : text(body.notes, 5000),
    nextFollowUpAt:body.nextFollowUpAt === undefined ? previous.nextFollowUpAt : (text(body.nextFollowUpAt, 80) || null),
  };
}

function publicTalent(item, memberRows) {
  const owner = item.record.outreachOwnerId ? memberRows.find((row) => row.id === item.record.outreachOwnerId) : null;
  return {
    assignmentId:item.assignmentId,
    creatorType:item.creatorType,
    name:item.name,
    handle:item.handle,
    platform:item.platform,
    agencyName:item.agencyName,
    allocatedUsd:item.allocatedUsd,
    allocatedTokens:item.allocatedTokens,
    commercialMatch:item.commercialMatch,
    agencyRequired:item.agencyRequired,
    confirmationEvidenceComplete:item.confirmationEvidenceComplete,
    confirmed:item.confirmed,
    outreachOwnerName:owner?.full_name || null,
    outreach:item.record,
  };
}

async function payload(db, tenantId, row, root, tracking, auth) {
  const planning = parseCampaignPlanning(root);
  const outreach = parseCampaignTalentOutreach(root);
  const [memberRows] = await Promise.all([members(db, tenantId)]);
  const summary = buildCampaignTalentOutreachSummary(tracking, outreach);
  const planSummary = buildCampaignPlanSummary(tracking, planning);
  return {
    item:{
      id:row.id,
      name:row.name,
      projectId:row.project_id,
      projectName:row.project_name,
      campaignStatus:row.status,
      startDate:row.start_date,
      endDate:row.end_date,
      planningStatus:planning.status,
      planSummary:{
        approvalDrift:Boolean(planSummary.approvalDrift),
        budgetReconciled:Boolean(planSummary.budgetReconciled),
        compensationCalculationCurrent:Boolean(planSummary.compensationCalculationCurrent),
        currentFingerprint:planSummary.currentFingerprint,
        approvedFingerprint:planSummary.approvedFingerprint,
      },
      summary:{
        talentCount:summary.talentCount,
        confirmedCount:summary.confirmedCount,
        contactedCount:summary.contactedCount,
        negotiatingCount:summary.negotiatingCount,
        acceptedCount:summary.acceptedCount,
        declinedCount:summary.declinedCount,
        commercialMismatchCount:summary.commercialMismatchCount,
        pendingCount:summary.pendingCount,
        readyForActivation:summary.readyForActivation,
        currentFingerprint:summary.currentFingerprint,
      },
      talent:summary.talent.map((item) => publicTalent(item, memberRows)),
    },
    members:memberRows,
    permissions:{
      canWrite:WRITE_ROLES.has(auth?.role),
      canConfirm:MANAGER_ROLES.has(auth?.role),
    },
    methodology:{
      version:'R8.5J-1',
      manualOutreach:true,
      noAutomaticMessaging:true,
      confirmationEvidenceRequired:true,
      approvedAllocationMustMatch:true,
    },
  };
}

async function persist(db, auth, tenantId, row, root, tracking, planning, outreach, action, assignmentId, beforeSummary, request) {
  const now = nowIso();
  outreach.updatedAt = now;
  outreach.updatedBy = auth.userId;
  const notes = JSON.stringify({ ...root, campaignTracking:tracking, campaignPlanning:planning, campaignTalentOutreach:outreach });
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [notes, now, auth.userId, tenantId, row.id]);
  const afterSummary = buildCampaignTalentOutreachSummary(tracking, outreach);
  await run(db, `
    INSERT INTO audit_logs (
      id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,ip_address,user_agent,created_at
    ) VALUES (?, ?, ?, ?, 'CAMPAIGN_TALENT_OUTREACH', ?, ?, ?, ?, ?, ?)
  `, [
    makeId('aud'),tenantId,auth.userId,action,`${row.id}:${assignmentId}`,
    JSON.stringify(beforeSummary || {}),
    JSON.stringify({
      talentCount:afterSummary.talentCount,
      confirmedCount:afterSummary.confirmedCount,
      declinedCount:afterSummary.declinedCount,
      commercialMismatchCount:afterSummary.commercialMismatchCount,
      readyForActivation:afterSummary.readyForActivation,
      currentFingerprint:afterSummary.currentFingerprint,
    }),
    request.headers.get('cf-connecting-ip'),request.headers.get('user-agent'),now,
  ]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    return json(await payload(context.env.DB, tenantId, row, root, tracking, auth));
  } catch (cause) {
    return error(cause.message || 'Creator/KOL outreach workspace could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireWrite(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const action = text(body.action, 100).toLowerCase();
    const assignmentId = text(body.assignmentId, 120);
    if (!assignmentId) return error('Creator/KOL assignment is required', 422);
    if (!context.env.DB) return json({ updated:true, action, assignmentId, demo:true });

    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { root, tracking } = parseCampaignTracking(row.notes);
    const assignment = assignmentById(tracking, assignmentId);
    if (!assignment) return error('Active Creator/KOL assignment was not found in this campaign', 404);
    const planning = parseCampaignPlanning(root);
    let outreach = parseCampaignTalentOutreach(root);
    const beforeSummary = buildCampaignTalentOutreachSummary(tracking, outreach);
    const existing = beforeSummary.talent.find((item) => item.assignmentId === assignmentId)?.record;
    if (!existing) return error('Creator/KOL outreach record could not be resolved', 404);
    let patch = {};
    let auditAction = '';
    const now = nowIso();

    if (action === 'mark-contacted') {
      if (['DECLINED','CONFIRMED'].includes(existing.status)) return error('Reopen this Creator/KOL negotiation before recording new outreach', 409);
      const channel = text(body.channel || existing.channel, 80);
      if (!channel) return error('Outreach channel is required', 422);
      const outreachOwnerId = text(body.outreachOwnerId, 120) || existing.outreachOwnerId || auth.userId;
      const owner = await activeMember(context.env.DB, tenantId, outreachOwnerId);
      if (!owner) return error('Outreach owner is not an active member of this workspace', 422);
      patch = {
        ...termsPatch(body, existing),
        status:existing.status === 'NOT_CONTACTED' ? 'CONTACTED' : existing.status,
        channel,
        outreachOwnerId,
        firstContactedAt:existing.firstContactedAt || now,
        lastContactedAt:now,
        updatedAt:now,
        updatedBy:auth.userId,
      };
      auditAction='CAMPAIGN_TALENT_CONTACT_RECORDED';
    } else if (action === 'start-negotiation') {
      if (!existing.firstContactedAt) return error('Record first contact before starting negotiation', 409);
      if (['DECLINED','CONFIRMED'].includes(existing.status)) return error('Reopen this Creator/KOL before starting a new negotiation', 409);
      patch = { ...termsPatch(body, existing), status:'NEGOTIATING', updatedAt:now, updatedBy:auth.userId };
      auditAction='CAMPAIGN_TALENT_NEGOTIATION_STARTED';
    } else if (action === 'update-terms') {
      if (['DECLINED','CONFIRMED'].includes(existing.status)) return error('Reopen this Creator/KOL before changing negotiated terms', 409);
      patch = { ...termsPatch(body, existing), updatedAt:now, updatedBy:auth.userId };
      auditAction='CAMPAIGN_TALENT_TERMS_UPDATED';
    } else if (action === 'accept') {
      if (!existing.firstContactedAt) return error('Record outreach before recording Creator/KOL acceptance', 409);
      if (existing.status === 'DECLINED') return error('Reopen this Creator/KOL before recording acceptance', 409);
      if (existing.status === 'CONFIRMED') return error('Creator/KOL participation is already confirmed', 409);
      patch = {
        ...termsPatch(body, existing),
        status:'ACCEPTED',
        acceptedAt:now,
        acceptedBy:auth.userId,
        declinedAt:null,
        declinedBy:null,
        declinedReason:'',
        updatedAt:now,
        updatedBy:auth.userId,
      };
      auditAction='CAMPAIGN_TALENT_ACCEPTANCE_RECORDED';
    } else if (action === 'decline') {
      if (existing.status === 'CONFIRMED') return error('Reopen confirmed participation before recording a decline', 409);
      const reason = text(body.reason, 2000);
      if (!reason) return error('Decline reason is required', 422);
      const replacementAssignmentId = text(body.replacementAssignmentId, 120) || null;
      if (replacementAssignmentId) {
        if (replacementAssignmentId === assignmentId) return error('Replacement Creator/KOL must be different from the declined assignment', 422);
        if (!assignmentById(tracking, replacementAssignmentId)) return error('Replacement Creator/KOL is not an active assignment in this campaign', 422);
      }
      patch = {
        status:'DECLINED',
        declinedAt:now,
        declinedBy:auth.userId,
        declinedReason:reason,
        replacementAssignmentId,
        nextFollowUpAt:null,
        updatedAt:now,
        updatedBy:auth.userId,
      };
      auditAction='CAMPAIGN_TALENT_DECLINED';
    } else if (action === 'confirm') {
      requireManager(auth);
      const planSummary = buildCampaignPlanSummary(tracking, planning);
      if (planning.status !== 'APPROVED') return error('Approve the campaign plan before confirming Creator/KOL participation', 409);
      if (planSummary.approvalDrift) return error('The approved campaign plan changed and must be reapproved before talent confirmation', 409);
      if (!planSummary.compensationCalculationCurrent) return error('AKARI USDT compensation must be current before talent confirmation', 409);
      if (!planSummary.budgetReconciled) return error('Campaign budget must reconcile before talent confirmation', 409);
      const candidateOutreach = upsertTalentOutreachRecord(outreach, assignmentId, { ...termsPatch(body, existing), updatedAt:now, updatedBy:auth.userId }).outreach;
      const candidateSummary = buildCampaignTalentOutreachSummary(tracking, candidateOutreach);
      const candidate = candidateSummary.talent.find((item) => item.assignmentId === assignmentId);
      assertTalentConfirmationReady(candidate);
      patch = {
        ...termsPatch(body, existing),
        status:'CONFIRMED',
        confirmedAt:now,
        confirmedBy:auth.userId,
        nextFollowUpAt:null,
        updatedAt:now,
        updatedBy:auth.userId,
      };
      auditAction='CAMPAIGN_TALENT_PARTICIPATION_CONFIRMED';
    } else if (action === 'reopen') {
      requireManager(auth);
      if (existing.status === 'NOT_CONTACTED') return error('Creator/KOL outreach has not started yet', 409);
      const reason = text(body.reason, 2000);
      if (!reason) return error('Reopen reason is required', 422);
      patch = {
        status:'NEGOTIATING',
        acceptedAt:null,
        acceptedBy:null,
        declinedAt:null,
        declinedBy:null,
        declinedReason:'',
        confirmedAt:null,
        confirmedBy:null,
        deliverablesConfirmed:false,
        scheduleConfirmed:false,
        compensationConfirmed:false,
        agencyConfirmed:false,
        termsConfirmed:false,
        consentConfirmed:false,
        evidenceReference:'',
        reopenedAt:now,
        reopenedBy:auth.userId,
        reopenReason:reason,
        updatedAt:now,
        updatedBy:auth.userId,
      };
      auditAction='CAMPAIGN_TALENT_NEGOTIATION_REOPENED';
    } else {
      return error('Creator/KOL outreach action is not supported', 404);
    }

    const updated = upsertTalentOutreachRecord(outreach, assignmentId, patch);
    outreach = updated.outreach;
    await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, outreach, auditAction, assignmentId, beforeSummary, context.request);
    const nextRoot = { ...root, campaignTalentOutreach:outreach };
    return json(await payload(context.env.DB, tenantId, row, nextRoot, tracking, auth));
  } catch (cause) {
    return error(cause.message || 'Creator/KOL outreach action failed', Number(cause.status || 500));
  }
}
