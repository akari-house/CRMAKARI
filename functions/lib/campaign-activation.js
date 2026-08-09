import { buildCampaignPlanSummary } from './campaign-planning.js';
import { creatorTrackingSummary } from './campaign-tracking.js';
import { buildCampaignTalentOutreachSummary } from './campaign-talent-outreach.js';

export const CAMPAIGN_ACTIVATION_STATUSES = ['NOT_ACTIVATED','ACTIVE','PAUSED','COMPLETED'];

const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function normalizeStatus(value) {
  const status = text(value, 80).toUpperCase();
  return CAMPAIGN_ACTIVATION_STATUSES.includes(status) ? status : 'NOT_ACTIVATED';
}

export function parseCampaignActivation(root = {}) {
  const existing = root?.campaignActivation && typeof root.campaignActivation === 'object' && !Array.isArray(root.campaignActivation)
    ? root.campaignActivation
    : {};
  return {
    version:1,
    status:normalizeStatus(existing.status),
    executionOwnerId:text(existing.executionOwnerId, 120) || null,
    activationNote:text(existing.activationNote, 5000),
    approvedPlanFingerprint:text(existing.approvedPlanFingerprint, 200) || null,
    talentConfirmationFingerprint:text(existing.talentConfirmationFingerprint, 200) || null,
    taskIds:Array.isArray(existing.taskIds) ? [...new Set(existing.taskIds.map((id) => text(id, 120)).filter(Boolean))] : [],
    taskPlan:Array.isArray(existing.taskPlan) ? existing.taskPlan.map((item) => ({
      id:text(item?.id, 120),
      slug:text(item?.slug, 180),
      title:text(item?.title, 500),
      ownerUserId:text(item?.ownerUserId, 120) || null,
      dueAt:text(item?.dueAt, 80) || null,
      phase:text(item?.phase, 80) || 'EXECUTION',
      assignmentId:text(item?.assignmentId, 120) || null,
    })).filter((item) => item.id) : [],
    activatedAt:text(existing.activatedAt, 80) || null,
    activatedBy:text(existing.activatedBy, 120) || null,
    pausedAt:text(existing.pausedAt, 80) || null,
    pausedBy:text(existing.pausedBy, 120) || null,
    pauseReason:text(existing.pauseReason, 1500),
    resumedAt:text(existing.resumedAt, 80) || null,
    resumedBy:text(existing.resumedBy, 120) || null,
    completedAt:text(existing.completedAt, 80) || null,
    completedBy:text(existing.completedBy, 120) || null,
    completionNote:text(existing.completionNote, 3000),
    lastModifiedAt:text(existing.lastModifiedAt, 80) || null,
    lastModifiedBy:text(existing.lastModifiedBy, 120) || null,
  };
}

function taskState(tasks = [], trackedIds = []) {
  const byId = new Map((tasks || []).map((task) => [String(task.id || ''), task]));
  const rows = trackedIds.map((id) => byId.get(id)).filter(Boolean);
  const done = rows.filter((task) => ['DONE','CANCELLED','ARCHIVED'].includes(String(task.status || '').toUpperCase())).length;
  return {
    generated:trackedIds.length,
    found:rows.length,
    done,
    open:Math.max(0, trackedIds.length - done),
    completionPercent:trackedIds.length ? Math.min(100, (done / trackedIds.length) * 100) : 0,
  };
}

export function buildCampaignActivationSummary(tracking = {}, planning = {}, activationInput = {}, tasks = [], outreachInput = {}) {
  const activation = parseCampaignActivation({ campaignActivation:activationInput });
  const planSummary = buildCampaignPlanSummary(tracking, planning);
  const delivery = creatorTrackingSummary(tracking);
  const tasksSummary = taskState(tasks, activation.taskIds || []);
  const outreachSummary = buildCampaignTalentOutreachSummary(tracking, outreachInput);
  const planApproved = planning.status === 'APPROVED';
  const planIntegrity = planApproved && !planSummary.approvalDrift;
  const talentConfirmationRequired = activation.status === 'NOT_ACTIVATED';
  const talentConfirmationReady = outreachSummary.readyForActivation;
  const governanceReady = planIntegrity
    && planSummary.budgetReconciled
    && planSummary.compensationCalculationCurrent
    && planSummary.talentCount > 0
    && planSummary.plannedPosts > 0
    && (!talentConfirmationRequired || talentConfirmationReady);
  const activationDrift = activation.status !== 'NOT_ACTIVATED'
    && Boolean(activation.approvedPlanFingerprint)
    && activation.approvedPlanFingerprint !== planSummary.currentFingerprint;
  const outreachDrift = activation.status !== 'NOT_ACTIVATED'
    && Boolean(activation.talentConfirmationFingerprint)
    && activation.talentConfirmationFingerprint !== outreachSummary.currentFingerprint;
  const approvedDeliveryComplete = delivery.plannedPosts > 0 && delivery.publishedPosts >= delivery.plannedPosts;
  const completionReady = activation.status === 'ACTIVE'
    && governanceReady
    && !activationDrift
    && !outreachDrift
    && approvedDeliveryComplete
    && tasksSummary.generated > 0
    && tasksSummary.open === 0;
  let effectiveStatus = activation.status;
  if (activation.status === 'NOT_ACTIVATED' && governanceReady) effectiveStatus = 'READY_TO_ACTIVATE';
  if ((activationDrift || outreachDrift) && activation.status !== 'COMPLETED') effectiveStatus = 'CHANGES_AFTER_ACTIVATION';
  return {
    status:activation.status,
    effectiveStatus,
    governanceReady,
    planApproved,
    planApprovalDrift:Boolean(planSummary.approvalDrift),
    activationDrift,
    outreachDrift,
    currentPlanFingerprint:planSummary.currentFingerprint,
    approvedPlanFingerprint:activation.approvedPlanFingerprint || null,
    currentTalentConfirmationFingerprint:outreachSummary.currentFingerprint,
    approvedTalentConfirmationFingerprint:activation.talentConfirmationFingerprint || null,
    talentConfirmationRequired,
    talentConfirmationReady,
    confirmedTalentCount:number(outreachSummary.confirmedCount),
    pendingTalentCount:number(outreachSummary.pendingCount),
    declinedTalentCount:number(outreachSummary.declinedCount),
    budgetReconciled:Boolean(planSummary.budgetReconciled),
    compensationCalculationCurrent:Boolean(planSummary.compensationCalculationCurrent),
    talentCount:number(planSummary.talentCount),
    plannedPosts:number(planSummary.plannedPosts),
    plannedReach:number(planSummary.plannedReach),
    approvedPosts:number(delivery.publishedPosts),
    approvedReach:number(delivery.creatorReach),
    approvedEngagements:number(delivery.creatorEngagements),
    approvedDeliveryComplete,
    deliveryCompletionPercent:number(delivery.postCompletionPercent),
    taskCount:tasksSummary.generated,
    taskFoundCount:tasksSummary.found,
    taskDoneCount:tasksSummary.done,
    taskOpenCount:tasksSummary.open,
    taskCompletionPercent:tasksSummary.completionPercent,
    completionReady,
  };
}

export function assertCampaignActivationReady(summary = {}) {
  if (!summary.planApproved) {
    const cause = new Error('Approve the campaign plan before activation');
    cause.status = 409;
    throw cause;
  }
  if (summary.planApprovalDrift) {
    const cause = new Error('The approved campaign plan changed and must be reapproved before activation');
    cause.status = 409;
    throw cause;
  }
  if (!summary.compensationCalculationCurrent) {
    const cause = new Error('AKARI USDT compensation changed and must be recalculated before activation');
    cause.status = 409;
    throw cause;
  }
  if (!summary.budgetReconciled) {
    const cause = new Error('Campaign budget must reconcile before activation');
    cause.status = 409;
    throw cause;
  }
  if (!(summary.talentCount > 0) || !(summary.plannedPosts > 0)) {
    const cause = new Error('Campaign activation requires at least one planned Creator or KOL deliverable');
    cause.status = 409;
    throw cause;
  }
  if (summary.talentConfirmationRequired && !summary.talentConfirmationReady) {
    const cause = new Error('Every active Creator/KOL must have confirmed participation evidence before campaign activation');
    cause.status = 409;
    throw cause;
  }
  return true;
}

export function assertCampaignActivationCompletable(summary = {}) {
  if (summary.status !== 'ACTIVE') {
    const cause = new Error('Only an active campaign execution can be completed');
    cause.status = 409;
    throw cause;
  }
  if (summary.activationDrift || summary.outreachDrift || !summary.governanceReady) {
    const cause = new Error('Campaign governance changed after activation and must be resolved before completion');
    cause.status = 409;
    throw cause;
  }
  if (!summary.approvedDeliveryComplete) {
    const cause = new Error('All planned Creator/KOL posts must be Approved before campaign execution can be completed');
    cause.status = 409;
    throw cause;
  }
  if (summary.taskOpenCount > 0) {
    const cause = new Error('Complete or cancel all generated campaign execution tasks before completion');
    cause.status = 409;
    throw cause;
  }
  return true;
}
