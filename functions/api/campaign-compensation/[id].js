import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseCampaignTracking } from '../../lib/campaign-tracking.js';
import {
  parseCampaignPlanning,
  buildCampaignPlanSummary,
  touchPlanning,
  clearApproval,
} from '../../lib/campaign-planning.js';
import {
  CAMPAIGN_COMPENSATION_VERSION,
  CAMPAIGN_COMPENSATION_PLATFORMS,
  CAMPAIGN_COMPENSATION_POSTING_CADENCES,
  CAMPAIGN_COMPENSATION_ENGAGEMENT_ACTIONS,
  parseCampaignCompensation,
  sanitizeCampaignCompensation,
  sanitizeCompensationTalentInput,
  resolveCompensationTalentInputs,
  allocateCampaignCompensation,
  campaignCompensationFingerprint,
  buildCampaignCompensationSummary,
} from '../../lib/campaign-compensation.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER']);
const text = (value) => String(value || '').trim();
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function requireWrite(auth) {
  if (!WRITE_ROLES.has(auth?.role)) {
    const cause = new Error('Campaign compensation write permission is required');
    cause.status = 403;
    throw cause;
  }
}

function requireManager(auth) {
  if (!MANAGER_ROLES.has(auth?.role)) {
    const cause = new Error('Owner, Admin or BD Manager permission is required for compensation verification and allocation');
    cause.status = 403;
    throw cause;
  }
}

function requireEditable(planning) {
  if (planning.status === 'APPROVED') {
    const cause = new Error('Approved campaign plans must be reopened before compensation can change');
    cause.status = 409;
    throw cause;
  }
  if (planning.status === 'READY_FOR_APPROVAL') {
    const cause = new Error('A submitted campaign plan must be reopened before compensation can change');
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

function compensationItems(tracking, compensation, summary) {
  const inputs = resolveCompensationTalentInputs(tracking, compensation);
  const inputById = new Map(inputs.map((input) => [input.assignmentId, input]));
  const calculatedById = new Map((summary.calculation?.items || []).map((item) => [item.assignmentId, item]));
  const appliedById = new Map((compensation.lastResult?.items || []).map((item) => [item.assignmentId, item]));
  return (tracking.creatorAssignments || [])
    .filter((assignment) => assignment.active !== false)
    .map((assignment) => ({
      ...assignment,
      compensationInput:inputById.get(String(assignment.id || '')) || null,
      calculation:calculatedById.get(String(assignment.id || '')) || null,
      lastApplied:appliedById.get(String(assignment.id || '')) || null,
      supportedByEngine:(inputById.get(String(assignment.id || ''))?.selectedPlatforms || []).length > 0,
    }));
}

function publicPayload(row, tracking, planning, auth) {
  const compensation = parseCampaignCompensation(planning.compensation);
  const summary = buildCampaignCompensationSummary(tracking, compensation);
  const planSummary = buildCampaignPlanSummary(tracking, { ...planning, compensation });
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
      planningStatus:planning.status,
      planningBudgetUsd:planning.budgetUsd,
      compensation,
      summary,
      planSummary,
      talent:compensationItems(tracking, compensation, summary),
    },
    permissions:{
      canWrite:WRITE_ROLES.has(auth?.role),
      canManage:MANAGER_ROLES.has(auth?.role),
    },
    methodology:{
      engineVersion:CAMPAIGN_COMPENSATION_VERSION,
      currency:'USDT',
      usdtPlanningRate:1,
      supportedPlatforms:CAMPAIGN_COMPENSATION_PLATFORMS,
      postingCadences:CAMPAIGN_COMPENSATION_POSTING_CADENCES,
      engagementActions:CAMPAIGN_COMPENSATION_ENGAGEMENT_ACTIONS,
      xPlatformFormula:{ followers:40, xScore:30, sorsaScore:30 },
      finalSelectionFormula:{ platformScore:70, postingCommitment:20, engagementCommitment:10 },
      percentileRelativeToCampaignRoster:true,
      baseBudgetExcludesReservedBonusPool:true,
      strongestVerifiedTalentCanReachConfiguredCeiling:true,
      proportionalBudgetScaling:true,
      allocationIsPaymentEvidence:false,
    },
  };
}

function scoringInputSnapshot(input) {
  return JSON.stringify({
    selectedPlatforms:input.selectedPlatforms,
    followers:input.followers,
    postingDays:input.postingDays,
    engagementAccepted:input.engagementAccepted,
  });
}

function replaceTalentInput(compensation, next) {
  const items = [...(compensation.talentInputs || [])];
  const index = items.findIndex((item) => item.assignmentId === next.assignmentId);
  if (index >= 0) items[index] = next;
  else items.push(next);
  compensation.talentInputs = items;
  return compensation;
}

async function persist(db, auth, tenantId, row, root, tracking, planning, action, before) {
  const now = nowIso();
  planning.lastModifiedAt = now;
  planning.lastModifiedBy = auth.userId;
  tracking.updatedAt = now;
  tracking.updatedBy = auth.userId;
  const notes = JSON.stringify({ ...root, campaignTracking:tracking, campaignPlanning:planning });
  await run(db, `UPDATE campaigns SET notes = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`, [notes, now, auth.userId, tenantId, row.id]);
  const after = {
    plan:buildCampaignPlanSummary(tracking, planning),
    compensation:buildCampaignCompensationSummary(tracking, planning.compensation),
  };
  await run(db, `
    INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'CAMPAIGN_COMPENSATION', ?, ?, ?, ?)
  `, [makeId('aud'), tenantId, auth.userId, action, row.id, JSON.stringify(before || {}), JSON.stringify(after), now]);
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await loadCampaign(context.env.DB, tenantId, context.params.id);
    if (!row) return error('Campaign engagement not found', 404);
    const { tracking } = parseCampaignTracking(row.notes);
    const { root } = parseCampaignTracking(row.notes);
    const planning = parseCampaignPlanning(root);
    return json(publicPayload(row, tracking, planning, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign compensation workspace could not be loaded', Number(cause.status || 500));
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
    const parsed = parseCampaignTracking(row.notes);
    const root = parsed.root;
    const tracking = parsed.tracking;
    let planning = parseCampaignPlanning(root);
    requireEditable(planning);
    let compensation = parseCampaignCompensation(planning.compensation);
    const before = {
      plan:buildCampaignPlanSummary(tracking, planning),
      compensation:buildCampaignCompensationSummary(tracking, compensation),
    };
    let auditAction = 'campaign.compensation_updated';

    if (action === 'update-compensation') {
      compensation = sanitizeCampaignCompensation(body.compensation || {}, compensation);
      if (compensation.enabled && planning.budgetUsd > 0 && compensation.budgetUsdt > planning.budgetUsd) {
        return error('The AKARI USDT compensation budget cannot exceed the campaign planning budget', 422);
      }
      auditAction = 'campaign.compensation_rules_updated';
    } else if (action === 'upsert-talent-input') {
      const assignmentId = text(body.assignmentId || body.input?.assignmentId);
      const assignment = (tracking.creatorAssignments || []).find((item) => item.id === assignmentId && item.active !== false);
      if (!assignment) return error('Campaign compensation talent item was not found', 404);
      const inputs = resolveCompensationTalentInputs(tracking, compensation);
      const previous = inputs.find((item) => item.assignmentId === assignmentId);
      const next = sanitizeCompensationTalentInput(body.input || {}, previous || {}, assignment);
      if (scoringInputSnapshot(next) !== scoringInputSnapshot(previous || {})) {
        next.metricsVerified = false;
        next.verificationNote = '';
        next.verifiedAt = null;
        next.verifiedBy = null;
      }
      next.updatedAt = nowIso();
      next.updatedBy = auth.userId;
      compensation = replaceTalentInput(compensation, next);
      auditAction = 'campaign.compensation_talent_metrics_updated';
    } else if (action === 'verify-talent-metrics') {
      requireManager(auth);
      const assignmentId = text(body.assignmentId);
      const assignment = (tracking.creatorAssignments || []).find((item) => item.id === assignmentId && item.active !== false);
      if (!assignment) return error('Campaign compensation talent item was not found', 404);
      const inputs = resolveCompensationTalentInputs(tracking, compensation);
      const previous = inputs.find((item) => item.assignmentId === assignmentId);
      if (!previous || !previous.selectedPlatforms.length) return error('Add at least one supported compensation platform before verifying metrics', 422);
      const note = text(body.note).slice(0,1000);
      if (note.length < 5) return error('Add a verification note describing how the Creator or KOL metrics were checked', 422);
      const next = {
        ...previous,
        metricsVerified:true,
        verificationNote:note,
        verifiedAt:nowIso(),
        verifiedBy:auth.userId,
        updatedAt:nowIso(),
        updatedBy:auth.userId,
      };
      compensation = replaceTalentInput(compensation, next);
      auditAction = 'campaign.compensation_talent_metrics_verified';
    } else if (action === 'apply-calculation') {
      requireManager(auth);
      const calculation = allocateCampaignCompensation(tracking, compensation);
      const allocationById = new Map(calculation.items.map((item) => [item.assignmentId, item]));
      const previousAppliedById = new Map((compensation.lastResult?.items || []).map((item) => [item.assignmentId, item]));
      const now = nowIso();
      tracking.creatorAssignments = (tracking.creatorAssignments || []).map((assignment) => {
        if (assignment.active === false) return assignment;
        const allocation = allocationById.get(String(assignment.id || ''));
        if (allocation) return { ...assignment, allocatedUsd:allocation.payoutUsdt, updatedAt:now };
        const previousApplied = previousAppliedById.get(String(assignment.id || ''));
        if (previousApplied && Math.abs(number(assignment.allocatedUsd) - number(previousApplied.payoutUsdt)) < 0.005) {
          return { ...assignment, allocatedUsd:0, updatedAt:now };
        }
        return assignment;
      });
      compensation.lastAppliedAt = now;
      compensation.lastAppliedBy = auth.userId;
      compensation.lastResult = {
        version:calculation.version,
        appliedAt:now,
        appliedBy:auth.userId,
        baseBudgetUsdt:calculation.baseBudgetUsdt,
        bonusPoolUsdt:calculation.bonusPoolUsdt,
        totalAllocatedUsdt:calculation.totalAllocatedUsdt,
        unallocatedBaseUsdt:calculation.unallocatedBaseUsdt,
        budgetFactor:calculation.budgetFactor,
        items:calculation.items.map((item) => ({
          assignmentId:item.assignmentId,
          rank:item.rank,
          selectionScore:item.selectionScore,
          platformScore:item.platformScore,
          postingCommitmentScore:item.postingCommitmentScore,
          engagementCommitmentScore:item.engagementCommitmentScore,
          payoutUsdt:item.payoutUsdt,
          payoutPercent:item.payoutPercent,
        })),
      };
      compensation.lastAppliedFingerprint = campaignCompensationFingerprint(tracking, compensation);
      planning.compensation = compensation;
      const hypothetical = buildCampaignPlanSummary(tracking, planning);
      if (planning.budgetUsd > 0 && !hypothetical.budgetReconciled) {
        return error('The calculated USDT allocations plus reserved bonus exceed the campaign planning budget', 422);
      }
      auditAction = 'campaign.compensation_allocations_applied';
    } else {
      return error('Unsupported campaign compensation action', 400);
    }

    if (planning.status === 'REJECTED') planning = clearApproval(planning);
    planning.compensation = compensation;
    planning = touchPlanning(planning, auth);
    await persist(context.env.DB, auth, tenantId, row, root, tracking, planning, auditAction, before);
    return json(publicPayload(row, tracking, planning, auth));
  } catch (cause) {
    return error(cause.message || 'Campaign compensation could not be updated', Number(cause.status || 500));
  }
}
