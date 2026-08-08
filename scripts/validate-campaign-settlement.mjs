import fs from 'node:fs';
import assert from 'node:assert/strict';
import { campaignCompensationFingerprint } from '../functions/lib/campaign-compensation.js';
import { campaignPlanFingerprint } from '../functions/lib/campaign-planning.js';
import {
  CAMPAIGN_SETTLEMENT_VERSION,
  buildCampaignSettlementSummary,
  settlementEvidenceFingerprint,
  upsertSettlementRecord,
  addSettlementPayment,
} from '../functions/lib/campaign-settlement.js';

const api = fs.readFileSync(new URL('../functions/api/campaign-settlement/[id].js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/assets/campaign-settlement-r58.js', import.meta.url), 'utf8');
for (const token of [
  'WHERE c.tenant_id = ? AND c.id = ?',
  "'CAMPAIGN_SETTLEMENT'",
  'Approve the Creator/KOL settlement before recording payment',
  'payment reference is already recorded',
  'Approved Creator/KOL bonuses cannot exceed the reserved campaign bonus pool',
  'Reapprove the settlement before recording another payment',
]) assert.ok(api.includes(token), `Settlement API is missing ${token}`);
for (const token of ['PERFORMANCE & SETTLEMENT · R8.5H','Creator / KOL Settlement Control','Record payment','Holding and Rejected posts never contribute reach or engagement']) assert.ok(ui.includes(token), `Settlement UI is missing ${token}`);

const tracking = {
  overview:{ currentTokenPrice:0.5 },
  creatorAssignments:[
    { id:'cca_a', creatorType:'CREATOR', name:'Alice', handle:'@alice', platform:'X', expectedPosts:2, expectedReach:2000, allocatedUsd:200, allocatedTokens:0, active:true, xScore:800, sorsaScore:750 },
    { id:'cca_b', creatorType:'KOL', name:'Bob', handle:'@bob', platform:'X', expectedPosts:2, expectedReach:2000, allocatedUsd:150, allocatedTokens:0, active:true, xScore:700, sorsaScore:680 },
  ],
  creatorPosts:[
    { id:'p1', assignmentId:'cca_a', status:'APPROVED', dataDate:'2026-08-01', url:'https://x.com/a/1', reach:1200, reportedReach:1200, totalEngagements:150, reportedEngagements:150 },
    { id:'p2', assignmentId:'cca_a', status:'APPROVED', dataDate:'2026-08-02', url:'https://x.com/a/2', reach:1000, reportedReach:1000, totalEngagements:120, reportedEngagements:120 },
    { id:'p3', assignmentId:'cca_b', status:'APPROVED', dataDate:'2026-08-01', url:'https://x.com/b/1', reach:1000, reportedReach:1000, totalEngagements:100, reportedEngagements:100 },
    { id:'p4', assignmentId:'cca_b', status:'APPROVED', dataDate:'2026-08-02', url:'https://x.com/b/2', reach:900, reportedReach:900, totalEngagements:90, reportedEngagements:90 },
    { id:'p5', assignmentId:'cca_a', status:'REJECTED', dataDate:'2026-08-03', url:'https://x.com/a/3', reach:999999, reportedReach:999999, totalEngagements:999999, reportedEngagements:999999 },
  ],
};
let compensation = {
  enabled:true,
  currency:'USDT',
  budgetUsdt:450,
  bonusPoolUsdt:100,
  maximumBaseAllocationUsdt:200,
  maximumBonusPerTalentUsdt:75,
  platformWeights:{ X:100, YOUTUBE:0, TIKTOK:0, INSTAGRAM:0 },
  postingCadence:'WEEKLY_2',
  dailyEngagementRequired:false,
  engagementActions:[],
  talentInputs:[
    { assignmentId:'cca_a', included:true, selectedPlatforms:['X'], followers:{X:100000}, postingDays:[1,3], engagementAccepted:true, metricsVerified:true },
    { assignmentId:'cca_b', included:true, selectedPlatforms:['X'], followers:{X:80000}, postingDays:[1,3], engagementAccepted:true, metricsVerified:true },
  ],
  lastResult:{
    version:'R8.5G-1', appliedAt:'2026-08-01T10:00:00Z', appliedBy:'usr_owner', baseBudgetUsdt:350, bonusPoolUsdt:100, totalAllocatedUsdt:350, unallocatedBaseUsdt:0, budgetFactor:1,
    items:[{assignmentId:'cca_a',payoutUsdt:200},{assignmentId:'cca_b',payoutUsdt:150}],
  },
};
compensation.lastAppliedFingerprint = campaignCompensationFingerprint(tracking, compensation);
let planning = {
  status:'APPROVED', objective:'BALANCED', platform:'X', creatorType:'ALL', contentType:'Thread', region:'EMEA', budgetUsd:450,
  selections:[], compensation,
};
planning.approvedFingerprint = campaignPlanFingerprint(tracking, planning);

let summary = buildCampaignSettlementSummary(tracking, planning, {});
assert.equal(summary.version, CAMPAIGN_SETTLEMENT_VERSION);
assert.equal(summary.governanceReady, true);
assert.equal(summary.baseReadyCount, 2);
assert.equal(summary.bonusEligibleCount, 1);
assert.equal(summary.plannedBaseUsdt, 350);
assert.equal(summary.recommendedBonusUsdt, 75, 'single eligible talent must respect the configured per-talent bonus cap');
const alice = summary.talent.find((item)=>item.id==='cca_a');
const bob = summary.talent.find((item)=>item.id==='cca_b');
assert.equal(alice.approvedReach, 2200, 'Rejected reach must not count toward settlement performance');
assert.equal(alice.bonusRecommendedUsdt, 75);
assert.equal(bob.bonusRecommendedUsdt, 0, 'Talent below the configured reach target must not receive a bonus recommendation');

const evidence = settlementEvidenceFingerprint(tracking, planning, 'cca_a');
let settlement = upsertSettlementRecord({}, {
  assignmentId:'cca_a', status:'APPROVED', baseApprovedUsdt:200, bonusApprovedUsdt:75,
  approvalNote:'Approved from verified campaign evidence', evidenceFingerprint:evidence,
  approvedAt:'2026-08-04T10:00:00Z', approvedBy:'usr_owner',
});
settlement = addSettlementPayment(settlement, {
  id:'csp_1', assignmentId:'cca_a', amountUsdt:100, paidAt:'2026-08-05', method:'USDT_ONCHAIN', reference:'0xtest', recordedAt:'2026-08-05T10:00:00Z', recordedBy:'usr_finance',
});
summary = buildCampaignSettlementSummary(tracking, planning, settlement);
const approvedAlice = summary.talent.find((item)=>item.id==='cca_a');
assert.equal(approvedAlice.paymentStatus, 'PARTIALLY_PAID');
assert.equal(approvedAlice.outstandingUsdt, 175);
assert.equal(summary.paidUsdt, 100);

const changedTracking = structuredClone(tracking);
changedTracking.creatorPosts.find((post)=>post.id==='p2').reportedReach = 1200;
changedTracking.creatorPosts.find((post)=>post.id==='p2').reach = 1200;
summary = buildCampaignSettlementSummary(changedTracking, planning, settlement);
assert.equal(summary.talent.find((item)=>item.id==='cca_a').approvalDrift, true, 'Changed performance evidence must invalidate the old settlement approval snapshot');

const driftedPlan = { ...planning, approvedFingerprint:'r8.5f-stale' };
summary = buildCampaignSettlementSummary(tracking, driftedPlan, settlement);
assert.equal(summary.governanceReady, false, 'Planning approval drift must block settlement');

console.log('Campaign performance bonus and settlement validation passed.');
