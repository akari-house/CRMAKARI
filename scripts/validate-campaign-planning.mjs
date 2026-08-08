import fs from 'node:fs';
import {
  parseCampaignPlanning,
  sanitizeCampaignPlanning,
  buildCampaignPlanSummary,
  campaignPlanFingerprint,
  assertCampaignPlanReady,
  clearApproval,
} from '../functions/lib/campaign-planning.js';

const required = [
  ['functions/lib/campaign-planning.js', ['buildCampaignPlanSummary','campaignPlanFingerprint','CHANGES_AFTER_APPROVAL','Campaign plan allocations exceed the planning budget']],
  ['functions/api/campaign-planning/[id].js', ['requireTenant','WHERE c.tenant_id = ?','CAMPAIGN_PLAN','add-recommended-talent','submit-plan','approve-plan','reject-plan','reopen-plan']],
  ['public/assets/campaign-planning-talent-basket-r56.js', ['CAMPAIGN PLANNING · R8.5F','Talent Basket & Approval Workspace','Add to campaign plan','Submit for approval','Approval drift detected']],
  ['public/assets/campaign-planning-talent-basket-r56.css', ['campaign-planning-r56','campaign-plan-kpis-r56','campaign-plan-recs-r56','campaign-plan-drift-r56']],
];
for (const [file,tokens] of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source=fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const apiSource=fs.readFileSync('functions/api/campaign-planning/[id].js','utf8');
if (!apiSource.includes("JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id")) throw new Error('Campaign planning must preserve project tenant scope');
if (!apiSource.includes("WHERE tenant_id = ?")) throw new Error('Campaign planning partner reads must remain tenant scoped');
if (!apiSource.includes('creatorIdentity(assignment).key === identityKey')) throw new Error('Recommendation application must prevent duplicate canonical talent identities');
if (!apiSource.includes('Talent with tracked execution posts cannot be removed from the plan')) throw new Error('Planning cannot delete executed creator history');

const root={ campaignPlanning:{ objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,notes:'Launch plan' } };
let planning=parseCampaignPlanning(root);
planning=sanitizeCampaignPlanning(planning,planning);
const tracking={
  overview:{currentTokenPrice:0.5},
  creatorAssignments:[
    {id:'a1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',agencyPartnerId:'p1',category:'Thread',region:'EMEA',expectedPosts:3,expectedReach:15000,allocatedUsd:400,allocatedTokens:200,tgeUnlockPercent:25,cliffMonths:1,vestingMonths:4,active:true},
    {id:'b1',creatorType:'KOL',name:'Bob',handle:'@bob',platform:'X',agencyPartnerId:'p2',category:'Thread',region:'EMEA',expectedPosts:2,expectedReach:12000,allocatedUsd:100,allocatedTokens:400,tgeUnlockPercent:25,cliffMonths:1,vestingMonths:4,active:true},
  ],
};
const summary=buildCampaignPlanSummary(tracking,planning);
if (summary.talentCount!==2 || summary.creatorCount!==1 || summary.kolCount!==1) throw new Error('Talent basket counts are incorrect');
if (summary.partnerCount!==2 || summary.plannedPosts!==5 || summary.plannedReach!==27000) throw new Error('Campaign deliverable roll-up is incorrect');
if (summary.cashAllocation!==500 || summary.tokenAllocation!==600 || summary.estimatedTokenValue!==300) throw new Error('Cash/token allocation roll-up is incorrect');
if (summary.estimatedPlanCost!==800 || summary.remainingBudget!==200 || summary.budgetReconciled!==true) throw new Error('Budget reconciliation is incorrect');
assertCampaignPlanReady(summary);

const approvedFingerprint=campaignPlanFingerprint(tracking,planning);
const approved={...planning,status:'APPROVED',approvedFingerprint};
const approvedSummary=buildCampaignPlanSummary(tracking,approved);
if (approvedSummary.approvalDrift || approvedSummary.effectiveStatus!=='APPROVED') throw new Error('Unchanged approved basket must remain approved');

const changedTracking={...tracking,creatorAssignments:tracking.creatorAssignments.map((item)=>item.id==='a1'?{...item,allocatedUsd:650}:item)};
const drift=buildCampaignPlanSummary(changedTracking,approved);
if (!drift.approvalDrift || drift.effectiveStatus!=='CHANGES_AFTER_APPROVAL') throw new Error('Approved plan changes must trigger approval drift');
if (drift.currentFingerprint===approvedFingerprint) throw new Error('Plan fingerprint must change when approval-relevant fields change');

let blocked=false;
try { assertCampaignPlanReady({...summary,budgetUsd:700,estimatedPlanCost:800,budgetReconciled:false}); } catch (error) { blocked=error.status===422; }
if (!blocked) throw new Error('Over-budget campaign plans must fail closed before approval');
const reopened=clearApproval({...approved,submittedAt:'x',submittedBy:'u',rejectedAt:'y',rejectionReason:'fix'});
if (reopened.status!=='DRAFT' || reopened.approvedFingerprint || reopened.submittedAt || reopened.rejectionReason) throw new Error('Reopening must clear prior approval and rejection evidence');

console.log('Campaign planning talent basket validation passed.');
