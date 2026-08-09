import { creatorTrackingSummary } from './campaign-tracking.js';
import { buildCampaignPlanSummary } from './campaign-planning.js';
import { buildCampaignSettlementSummary } from './campaign-settlement.js';

export const CAMPAIGN_CLOSEOUT_STATUSES=['NOT_STARTED','REPORT_READY','READY_FOR_APPROVAL','APPROVED','SENT_TO_CLIENT','COMPLETED','REJECTED'];
export const CAMPAIGN_RENEWAL_RECOMMENDATIONS=['UNSET','RENEW','RETAINER','UPSELL','NEW_CAMPAIGN','HOLD','NO_RENEWAL'];

const text=(value,max=4000)=>String(value??'').trim().slice(0,max);
const number=(value)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;};
const upper=(value)=>text(value,100).toUpperCase();
function fnv1a(value){let hash=2166136261;for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}

export function parseCampaignClientCloseout(root={}){
  const raw=root?.campaignClientCloseout&&typeof root.campaignClientCloseout==='object'&&!Array.isArray(root.campaignClientCloseout)?root.campaignClientCloseout:{};
  const status=CAMPAIGN_CLOSEOUT_STATUSES.includes(upper(raw.status))?upper(raw.status):'NOT_STARTED';
  const renewalRecommendation=CAMPAIGN_RENEWAL_RECOMMENDATIONS.includes(upper(raw.renewalRecommendation))?upper(raw.renewalRecommendation):'UNSET';
  return {
    version:1,status,
    reportFingerprint:text(raw.reportFingerprint,200)||null,
    reportPreparedAt:text(raw.reportPreparedAt,80)||null,reportPreparedBy:text(raw.reportPreparedBy,120)||null,
    submittedAt:text(raw.submittedAt,80)||null,submittedBy:text(raw.submittedBy,120)||null,
    approvedAt:text(raw.approvedAt,80)||null,approvedBy:text(raw.approvedBy,120)||null,
    rejectedAt:text(raw.rejectedAt,80)||null,rejectedBy:text(raw.rejectedBy,120)||null,rejectionReason:text(raw.rejectionReason,1000),
    clientSentAt:text(raw.clientSentAt,80)||null,clientSentBy:text(raw.clientSentBy,120)||null,clientSentChannel:text(raw.clientSentChannel,80),clientSentReference:text(raw.clientSentReference,1000),
    completedAt:text(raw.completedAt,80)||null,completedBy:text(raw.completedBy,120)||null,completionNote:text(raw.completionNote,3000),
    lessonsLearned:text(raw.lessonsLearned,5000),renewalRecommendation,renewalReason:text(raw.renewalReason,3000),renewalTargetDate:text(raw.renewalTargetDate,40)||null,
    lastModifiedAt:text(raw.lastModifiedAt,80)||null,lastModifiedBy:text(raw.lastModifiedBy,120)||null,
  };
}

export function campaignClientCloseoutFingerprint(tracking={},planning={},activation={},settlement={}){
  const delivery=creatorTrackingSummary(tracking);
  const plan=buildCampaignPlanSummary(tracking,planning);
  const settlementSummary=buildCampaignSettlementSummary(tracking,planning,settlement);
  const payload={
    planFingerprint:plan.currentFingerprint,
    activationStatus:upper(activation.status),
    activationCompletedAt:text(activation.completedAt,80)||null,
    plannedPosts:number(delivery.plannedPosts),approvedPosts:number(delivery.publishedPosts),holdingPosts:number(delivery.holdingPosts),rejectedPosts:number(delivery.rejectedPosts),
    approvedReach:number(delivery.creatorReach),approvedEngagements:number(delivery.creatorEngagements),
    cashAllocation:number(plan.cashAllocation),tokenAllocation:number(plan.tokenAllocation),estimatedTokenValue:number(plan.estimatedTokenValue),reservedBonusPoolUsd:number(plan.reservedBonusPoolUsd),
    settlementPaidUsdt:number(settlementSummary.paidUsdt),settlementOutstandingUsdt:number(settlementSummary.outstandingUsdt),settlementDisputedCount:number(settlementSummary.disputedCount),
  };
  return `r8.5m-${fnv1a(JSON.stringify(payload))}`;
}

export function buildCampaignClientCloseoutSummary(tracking={},planning={},activation={},settlement={},closeout={}){
  const parsed=parseCampaignClientCloseout({campaignClientCloseout:closeout});
  const delivery=creatorTrackingSummary(tracking);
  const plan=buildCampaignPlanSummary(tracking,planning);
  const settlementSummary=buildCampaignSettlementSummary(tracking,planning,settlement);
  const currentFingerprint=campaignClientCloseoutFingerprint(tracking,planning,activation,settlement);
  const reportDrift=Boolean(parsed.reportFingerprint)&&parsed.reportFingerprint!==currentFingerprint;
  const activationCompleted=upper(activation.status)==='COMPLETED';
  const settlementClear=number(settlementSummary.outstandingUsdt)===0&&number(settlementSummary.disputedCount)===0;
  const clientSendEvidence=Boolean(parsed.clientSentAt&&parsed.clientSentReference);
  const completionReady=activationCompleted&&parsed.status==='SENT_TO_CLIENT'&&!reportDrift&&settlementClear&&clientSendEvidence;
  return {
    status:parsed.status,effectiveStatus:reportDrift&&['APPROVED','SENT_TO_CLIENT','COMPLETED'].includes(parsed.status)?'REPORT_CHANGED_AFTER_APPROVAL':parsed.status,
    currentFingerprint,reportFingerprint:parsed.reportFingerprint,reportDrift,activationCompleted,settlementClear,clientSendEvidence,completionReady,
    plannedPosts:number(delivery.plannedPosts),approvedPosts:number(delivery.publishedPosts),holdingPosts:number(delivery.holdingPosts),rejectedPosts:number(delivery.rejectedPosts),
    approvedReach:number(delivery.creatorReach),approvedEngagements:number(delivery.creatorEngagements),postCompletionPercent:number(delivery.postCompletionPercent),
    planningBudgetUsd:number(plan.budgetUsd),plannedCashAllocation:number(plan.cashAllocation),plannedTokenUnits:number(plan.tokenAllocation),estimatedTokenValue:number(plan.estimatedTokenValue),reservedBonusPoolUsd:number(plan.reservedBonusPoolUsd),estimatedPlanCost:number(plan.estimatedPlanCost),
    settlementPaidUsdt:number(settlementSummary.paidUsdt),settlementOutstandingUsdt:number(settlementSummary.outstandingUsdt),settlementDisputedCount:number(settlementSummary.disputedCount),
    renewalRecommendation:parsed.renewalRecommendation,renewalTargetDate:parsed.renewalTargetDate,
  };
}

export function assertCloseoutReportReady(summary){
  if(!summary.activationCompleted){const cause=new Error('Complete campaign execution before preparing the final client closeout report');cause.status=409;throw cause;}
  return true;
}
export function assertCloseoutCompletionReady(summary){
  if(!summary.completionReady){
    const reasons=[];
    if(!summary.activationCompleted)reasons.push('campaign execution is not completed');
    if(summary.reportDrift)reasons.push('the approved report evidence changed');
    if(!summary.clientSendEvidence)reasons.push('client-send evidence is missing');
    if(!summary.settlementClear)reasons.push('Creator/KOL settlement is not clear');
    const cause=new Error(`Campaign closeout cannot complete: ${reasons.join('; ')||'closeout requirements are incomplete'}`);cause.status=409;throw cause;
  }
  return true;
}

export function clearCloseoutApproval(closeout){return{...closeout,status:'REPORT_READY',submittedAt:null,submittedBy:null,approvedAt:null,approvedBy:null,rejectedAt:null,rejectedBy:null,rejectionReason:'',clientSentAt:null,clientSentBy:null,clientSentChannel:'',clientSentReference:'',completedAt:null,completedBy:null,completionNote:''};}
