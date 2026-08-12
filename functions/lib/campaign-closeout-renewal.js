import { campaignTrackingSummary } from './campaign-tracking.js';
import { gtmTrackingSummary } from './campaign-gtm-tracking.js';
import { buildCampaignPlanSummary } from './campaign-planning.js';
import { buildCampaignSettlementSummary } from './campaign-settlement.js';

export const CAMPAIGN_CLOSEOUT_VERSION='R69-1';
export const CAMPAIGN_CLOSEOUT_STATUSES=['NOT_STARTED','REPORT_READY','READY_FOR_APPROVAL','APPROVED','SENT_TO_CLIENT','COMPLETED','REJECTED'];
export const RENEWAL_RECOMMENDATIONS=['UNSET','RENEW','RETAINER','UPSELL','NEW_CAMPAIGN','HOLD','NO_RENEWAL'];
export const RENEWAL_OPPORTUNITY_RECOMMENDATIONS=new Set(['RENEW','RETAINER','UPSELL','NEW_CAMPAIGN']);

const text=(value,max=5000)=>String(value??'').trim().slice(0,max);
const num=(value)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;};
const upper=(value)=>text(value,100).toUpperCase();
const sortId=(rows=[])=>[...rows].sort((a,b)=>String(a?.id||'').localeCompare(String(b?.id||'')));
function fnv1a(value){let hash=2166136261;for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}

export function parseCampaignCloseout(root={}){
  const raw=root?.campaignCloseout&&typeof root.campaignCloseout==='object'&&!Array.isArray(root.campaignCloseout)?root.campaignCloseout:{};
  const status=CAMPAIGN_CLOSEOUT_STATUSES.includes(upper(raw.status))?upper(raw.status):'NOT_STARTED';
  const renewalRecommendation=RENEWAL_RECOMMENDATIONS.includes(upper(raw.renewalRecommendation))?upper(raw.renewalRecommendation):'UNSET';
  return {
    version:1,engineVersion:CAMPAIGN_CLOSEOUT_VERSION,status,
    reportFingerprint:text(raw.reportFingerprint,200)||null,
    reportPreparedAt:text(raw.reportPreparedAt,80)||null,reportPreparedBy:text(raw.reportPreparedBy,120)||null,
    submittedAt:text(raw.submittedAt,80)||null,submittedBy:text(raw.submittedBy,120)||null,
    approvedAt:text(raw.approvedAt,80)||null,approvedBy:text(raw.approvedBy,120)||null,
    rejectedAt:text(raw.rejectedAt,80)||null,rejectedBy:text(raw.rejectedBy,120)||null,rejectionReason:text(raw.rejectionReason,1500),
    clientSentAt:text(raw.clientSentAt,80)||null,clientSentBy:text(raw.clientSentBy,120)||null,clientSentChannel:text(raw.clientSentChannel,100),clientSentReference:text(raw.clientSentReference,1200),
    completedAt:text(raw.completedAt,80)||null,completedBy:text(raw.completedBy,120)||null,completionNote:text(raw.completionNote,3000),
    lessonsLearned:text(raw.lessonsLearned,5000),renewalRecommendation,renewalReason:text(raw.renewalReason,3000),renewalTargetDate:text(raw.renewalTargetDate,40)||null,
    renewalOpportunityId:text(raw.renewalOpportunityId,120)||null,renewalOpportunityName:text(raw.renewalOpportunityName,500)||null,renewalOpportunityLinkedAt:text(raw.renewalOpportunityLinkedAt,80)||null,renewalOpportunityLinkedBy:text(raw.renewalOpportunityLinkedBy,120)||null,
    lastModifiedAt:text(raw.lastModifiedAt,80)||null,lastModifiedBy:text(raw.lastModifiedBy,120)||null,
  };
}

function reportEvidence(tracking={},gtmTracking={},planning={},activation={},settlement={}){
  const campaignSummary=campaignTrackingSummary(tracking);
  const gtmSummary=gtmTrackingSummary(gtmTracking);
  const plan=buildCampaignPlanSummary(tracking,planning);
  const settlementSummary=buildCampaignSettlementSummary(tracking,planning,settlement);
  const creatorPosts=sortId(tracking.creatorPosts||[]).map((post)=>({id:post.id,assignmentId:post.assignmentId,status:upper(post.status||'APPROVED'),dataDate:post.dataDate,url:post.url,reach:num(post.reportedReach??post.reach),impressions:num(post.impressions),engagements:num(post.reportedEngagements??post.totalEngagements),likes:num(post.likes),comments:num(post.comments),shares:num(post.shares),videoViews:num(post.videoViews),clicks:num(post.linkClicks)}));
  const socialUpdates=sortId(tracking.socialUpdates||[]).map((item)=>({id:item.id,platform:item.platform,dataDate:item.dataDate,audience:num(item.audience),reach:num(item.reach),impressions:num(item.impressions),engagements:num(item.totalEngagements),sorsaScore:num(item.sorsaScore),xScore:num(item.xScore)}));
  const gtm=sortId(gtmTracking.activities||[]).map((item)=>({id:item.id,type:item.type,status:item.status,dataDate:item.dataDate,title:item.title,partner:item.partner,reach:num(item.reach),impressions:num(item.impressions),engagements:num(item.engagements),attendees:num(item.attendees),clicks:num(item.clicks),leads:num(item.leads),applications:num(item.applications),meetings:num(item.meetings)}));
  return {
    planFingerprint:plan.currentFingerprint,
    activationStatus:upper(activation.status),activationCompletedAt:text(activation.completedAt,80)||null,
    approvedCreatorPosts:num(campaignSummary.creatorTracking?.publishedPosts),plannedCreatorPosts:num(campaignSummary.creatorTracking?.plannedPosts),approvedCreatorReach:num(campaignSummary.creatorTracking?.creatorReach),approvedCreatorEngagements:num(campaignSummary.creatorTracking?.creatorEngagements),
    socialUpdates,creatorPosts,gtm,
    gtmTotals:{activityCount:num(gtmSummary.activityCount),completedCount:num(gtmSummary.completedCount),reach:num(gtmSummary.totalReach),engagements:num(gtmSummary.totalEngagements),leads:num(gtmSummary.totalLeads),meetings:num(gtmSummary.totalMeetings)},
    settlement:{paidUsdt:num(settlementSummary.paidUsdt),outstandingUsdt:num(settlementSummary.outstandingUsdt),disputedCount:num(settlementSummary.disputedCount),driftCount:num(settlementSummary.driftCount),paidCount:num(settlementSummary.paidCount),talentCount:num(settlementSummary.talentCount)},
  };
}

export function campaignCloseoutFingerprint(tracking={},gtmTracking={},planning={},activation={},settlement={}){
  return `r69-${fnv1a(JSON.stringify(reportEvidence(tracking,gtmTracking,planning,activation,settlement)))}`;
}

export function buildCampaignCloseoutSummary(tracking={},gtmTracking={},planning={},activation={},settlement={},closeoutValue={}){
  const closeout=parseCampaignCloseout({campaignCloseout:closeoutValue});
  const campaignSummary=campaignTrackingSummary(tracking);
  const gtmSummary=gtmTrackingSummary(gtmTracking);
  const plan=buildCampaignPlanSummary(tracking,planning);
  const settlementSummary=buildCampaignSettlementSummary(tracking,planning,settlement);
  const currentFingerprint=campaignCloseoutFingerprint(tracking,gtmTracking,planning,activation,settlement);
  const reportDrift=Boolean(closeout.reportFingerprint)&&closeout.reportFingerprint!==currentFingerprint;
  const activationCompleted=upper(activation.status)==='COMPLETED';
  const settlementRequiredTalent=(settlementSummary.talent||[]).filter((item)=>num(item.basePlannedUsdt)>0||num(item.totalApprovedUsdt)>0);
  const settlementCoverageComplete=settlementRequiredTalent.every((item)=>item.paymentStatus==='PAID');
  const settlementClear=num(settlementSummary.outstandingUsdt)===0&&num(settlementSummary.disputedCount)===0&&num(settlementSummary.driftCount)===0&&settlementCoverageComplete;
  const clientSendEvidence=Boolean(closeout.clientSentAt&&closeout.clientSentReference);
  const renewalReady=closeout.renewalRecommendation!=='UNSET';
  const renewalOpportunityExpected=RENEWAL_OPPORTUNITY_RECOMMENDATIONS.has(closeout.renewalRecommendation);
  const renewalOpportunityLinked=Boolean(closeout.renewalOpportunityId);
  const completionReady=activationCompleted&&closeout.status==='SENT_TO_CLIENT'&&!reportDrift&&settlementClear&&clientSendEvidence&&renewalReady;
  return {
    version:CAMPAIGN_CLOSEOUT_VERSION,status:closeout.status,
    effectiveStatus:reportDrift&&['APPROVED','SENT_TO_CLIENT','COMPLETED'].includes(closeout.status)?'REPORT_CHANGED_AFTER_APPROVAL':closeout.status,
    currentFingerprint,reportFingerprint:closeout.reportFingerprint,reportDrift,activationCompleted,settlementClear,settlementCoverageComplete,clientSendEvidence,renewalReady,renewalOpportunityExpected,renewalOpportunityLinked,completionReady,
    approvedPosts:num(campaignSummary.creatorTracking?.publishedPosts),plannedPosts:num(campaignSummary.creatorTracking?.plannedPosts),holdingPosts:num(campaignSummary.creatorTracking?.holdingPosts),rejectedPosts:num(campaignSummary.creatorTracking?.rejectedPosts),approvedReach:num(campaignSummary.creatorTracking?.creatorReach),approvedEngagements:num(campaignSummary.creatorTracking?.creatorEngagements),
    gtmActivityCount:num(gtmSummary.activityCount),gtmCompletedCount:num(gtmSummary.completedCount),gtmReach:num(gtmSummary.totalReach),gtmLeads:num(gtmSummary.totalLeads),gtmMeetings:num(gtmSummary.totalMeetings),
    budgetUsd:num(plan.budgetUsd),plannedCashAllocation:num(plan.cashAllocation),plannedTokenUnits:num(plan.tokenAllocation),estimatedTokenValue:num(plan.estimatedTokenValue),estimatedPlanCost:num(plan.estimatedPlanCost),
    settlementRequiredTalentCount:settlementRequiredTalent.length,settlementPaidTalentCount:settlementRequiredTalent.filter((item)=>item.paymentStatus==='PAID').length,settlementPaidUsdt:num(settlementSummary.paidUsdt),settlementOutstandingUsdt:num(settlementSummary.outstandingUsdt),settlementDisputedCount:num(settlementSummary.disputedCount),settlementDriftCount:num(settlementSummary.driftCount),
    renewalRecommendation:closeout.renewalRecommendation,renewalTargetDate:closeout.renewalTargetDate,renewalOpportunityId:closeout.renewalOpportunityId,
  };
}

export function assertReportCanPrepare(summary={}){if(!summary.activationCompleted){const cause=new Error('Complete campaign execution before preparing the final client report');cause.status=409;throw cause;}return true;}
export function assertCloseoutCanComplete(summary={}){
  if(summary.completionReady)return true;
  const reasons=[];
  if(!summary.activationCompleted)reasons.push('campaign execution is not completed');
  if(summary.reportDrift)reasons.push('final report evidence changed');
  if(!summary.clientSendEvidence)reasons.push('client-send evidence is missing');
  if(!summary.settlementClear)reasons.push('Creator/KOL settlement is not clear');
  if(!summary.renewalReady)reasons.push('renewal handoff is not recorded');
  const cause=new Error(`Campaign closeout cannot complete: ${reasons.join('; ')||'requirements are incomplete'}`);cause.status=409;throw cause;
}
export function clearCloseoutApproval(closeout={}){return{...closeout,status:'REPORT_READY',submittedAt:null,submittedBy:null,approvedAt:null,approvedBy:null,rejectedAt:null,rejectedBy:null,rejectionReason:'',clientSentAt:null,clientSentBy:null,clientSentChannel:'',clientSentReference:'',completedAt:null,completedBy:null,completionNote:''};}
