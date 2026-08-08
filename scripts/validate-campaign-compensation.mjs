import fs from 'node:fs';
import {
  allocateCampaignCompensation,
  campaignCompensationFingerprint,
  buildCampaignCompensationSummary,
  parseCampaignCompensation,
} from '../functions/lib/campaign-compensation.js';
import {
  buildCampaignPlanSummary,
  campaignPlanFingerprint,
  assertCampaignPlanReady,
} from '../functions/lib/campaign-planning.js';

const required = [
  ['functions/lib/campaign-compensation.js', ['R8.5G-1','followerScore * 0.4','* 0.3','platformScore * 0.7','postingCommitmentScore * 0.2','engagementCommitmentScore * 0.1','Math.floor(exact * budgetFactor)']],
  ['functions/api/campaign-compensation/[id].js', ['requireTenant','WHERE c.tenant_id = ? AND c.id = ?','apply-calculation','verify-talent-metrics','CAMPAIGN_COMPENSATION','allocationIsPaymentEvidence:false']],
  ['public/assets/campaign-compensation-intelligence-r57.js', ['CAMPAIGN COMPENSATION · R8.5G','AKARI USDT Allocation Intelligence','40% follower percentile','Calculate & apply USDT allocations','not proof that a Creator/KOL was paid']],
  ['public/assets/campaign-compensation-intelligence-r57.css', ['campaign-compensation-r57','campaign-comp-kpis-r57','campaign-comp-table-r57','campaign-comp-modal-r57']],
];
for (const [file,tokens] of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source=fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}
const apiSource=fs.readFileSync('functions/api/campaign-compensation/[id].js','utf8');
if (!apiSource.includes('JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id')) throw new Error('Campaign compensation must preserve project tenant scope');
if (apiSource.includes('export async function onRequestPost')) throw new Error('Campaign compensation must not expose a POST write path');
if (!apiSource.includes("const MANAGER_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER'])")) throw new Error('Compensation application must remain manager-governed');

function input(assignmentId,followers,xScore,sorsaScore) {
  return {
    assignmentId,
    included:true,
    selectedPlatforms:['X'],
    followers:{X:followers,YOUTUBE:0,TIKTOK:0,INSTAGRAM:0},
    postingDays:[1,3,5],
    engagementAccepted:true,
    metricsVerified:true,
    verificationNote:'Verified campaign metrics',
  };
}
const assignments = [
  {id:'strong',creatorType:'CREATOR',name:'Strong',handle:'@strong',platform:'X',xScore:900,sorsaScore:900,expectedPosts:3,expectedReach:50000,allocatedUsd:0,allocatedTokens:0,active:true},
  {id:'middle',creatorType:'KOL',name:'Middle',handle:'@middle',platform:'X',xScore:650,sorsaScore:650,expectedPosts:3,expectedReach:25000,allocatedUsd:0,allocatedTokens:0,active:true},
  {id:'lower',creatorType:'CREATOR',name:'Lower',handle:'@lower',platform:'X',xScore:300,sorsaScore:300,expectedPosts:3,expectedReach:5000,allocatedUsd:0,allocatedTokens:0,active:true},
];
const tracking={overview:{currentTokenPrice:0.5},creatorAssignments:assignments,creatorPosts:[]};
const compensation=parseCampaignCompensation({
  enabled:true,
  budgetUsdt:1000,
  bonusPoolUsdt:150,
  maximumBaseAllocationUsdt:100,
  maximumBonusPerTalentUsdt:50,
  platformWeights:{X:70,YOUTUBE:30,TIKTOK:0,INSTAGRAM:0},
  postingCadence:'WEEKLY_3',
  dailyEngagementRequired:true,
  engagementActions:['COMMENT','LIKE','REPOST','BOOKMARK'],
  talentInputs:[input('strong',100000),input('middle',40000),input('lower',5000)],
});
const allocation=allocateCampaignCompensation(tracking,compensation);
const strong=allocation.items.find((item)=>item.assignmentId==='strong');
const middle=allocation.items.find((item)=>item.assignmentId==='middle');
const lower=allocation.items.find((item)=>item.assignmentId==='lower');
if (strong.payoutUsdt!==100) throw new Error('Strongest verified Creator/KOL must be able to reach the configured ceiling');
if (!(middle.payoutUsdt<strong.payoutUsdt && lower.payoutUsdt<middle.payoutUsdt)) throw new Error('Lower percentile scores must receive lower AKARI USDT allocations');
if (allocation.totalAllocatedUsdt>allocation.baseBudgetUsdt) throw new Error('AKARI USDT allocations exceeded the base campaign pool');
if (allocation.items.some((item)=>item.payoutUsdt>100)) throw new Error('AKARI USDT allocation exceeded the individual ceiling');

const manyAssignments=Array.from({length:20},(_,index)=>({id:`creator-${index}`,creatorType:index%3===0?'KOL':'CREATOR',name:`Creator ${index}`,handle:`@creator${index}`,platform:'X',xScore:900-index*20,sorsaScore:900-index*20,expectedPosts:3,expectedReach:10000,allocatedUsd:0,allocatedTokens:0,active:true}));
const manyTracking={overview:{},creatorAssignments:manyAssignments,creatorPosts:[]};
const manyComp={...compensation,talentInputs:manyAssignments.map((assignment,index)=>input(assignment.id,100000-index*2000))};
const scaled=allocateCampaignCompensation(manyTracking,manyComp);
if (scaled.totalAllocatedUsdt>850) throw new Error('Scaled roster exceeded the base budget after reserving the bonus pool');
if (scaled.items.some((item)=>item.payoutUsdt>100)) throw new Error('Scaled roster exceeded the individual ceiling');

const fingerprintA=campaignCompensationFingerprint(tracking,compensation);
const changedComp={...compensation,talentInputs:compensation.talentInputs.map((item)=>item.assignmentId==='middle'?{...item,followers:{...item.followers,X:41000}}:item)};
const fingerprintB=campaignCompensationFingerprint(tracking,changedComp);
if (fingerprintA===fingerprintB) throw new Error('Compensation fingerprint must change when verified scoring evidence changes');
if (fingerprintA!==campaignCompensationFingerprint(tracking,compensation)) throw new Error('Compensation fingerprint must be deterministic');

const payoutById=new Map(allocation.items.map((item)=>[item.assignmentId,item.payoutUsdt]));
const appliedTracking={...tracking,creatorAssignments:assignments.map((assignment)=>({...assignment,allocatedUsd:payoutById.get(assignment.id)||0}))};
const appliedComp={...compensation,lastAppliedFingerprint:campaignCompensationFingerprint(appliedTracking,compensation),lastAppliedAt:'2026-08-08T20:00:00.000Z',lastAppliedBy:'owner'};
const planning={status:'DRAFT',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,selections:[],compensation:appliedComp};
const planSummary=buildCampaignPlanSummary(appliedTracking,planning);
const cash=appliedTracking.creatorAssignments.reduce((sum,item)=>sum+item.allocatedUsd,0);
if (planSummary.reservedBonusPoolUsd!==150) throw new Error('Campaign planning must reserve the performance bonus pool');
if (Math.abs(planSummary.estimatedPlanCost-(cash+150))>0.001) throw new Error('Campaign planning cost must include applied base allocations plus reserved bonus pool');
if (!planSummary.compensationCalculationCurrent) throw new Error('Freshly applied compensation must be current');
assertCampaignPlanReady(planSummary);

const staleTracking={...appliedTracking,creatorAssignments:appliedTracking.creatorAssignments.map((item)=>item.id==='middle'?{...item,xScore:item.xScore+1}:item)};
const staleSummary=buildCampaignPlanSummary(staleTracking,planning);
if (staleSummary.compensationCalculationCurrent) throw new Error('Compensation must become stale when an approval-relevant scoring input changes');
let staleBlocked=false;
try { assertCampaignPlanReady(staleSummary); } catch (error) { staleBlocked=error.status===422 && /recalculated/i.test(error.message); }
if (!staleBlocked) throw new Error('Stale AKARI USDT compensation must block campaign-plan approval');

function oldNumber(value){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;}
function oldText(value,max=3000){return String(value||'').trim().slice(0,max);}
function oldUpper(value){return oldText(value,100).toUpperCase();}
function oldClamp(value){return Math.max(0,Math.min(100,oldNumber(value)));}
function oldStableSelection(value={}){return (value.creatorAssignments||[]).filter((item)=>item.active!==false).map((item)=>({id:String(item.id||''),creatorType:oldUpper(item.creatorType||'CREATOR'),name:oldText(item.name,300),handle:oldText(item.handle,200),platform:oldUpper(item.platform||'X'),agencyPartnerId:oldText(item.agencyPartnerId,120)||null,agencyName:oldText(item.agencyName,300),category:oldText(item.category,200),region:oldText(item.region,120),expectedPosts:oldNumber(item.expectedPosts),expectedReach:oldNumber(item.expectedReach),allocatedUsd:oldNumber(item.allocatedUsd),allocatedTokens:oldNumber(item.allocatedTokens),tgeUnlockPercent:oldClamp(item.tgeUnlockPercent),cliffMonths:oldNumber(item.cliffMonths),vestingMonths:oldNumber(item.vestingMonths)})).sort((a,b)=>a.id.localeCompare(b.id));}
function oldFnv1a(value){let hash=2166136261;for(let index=0;index<value.length;index+=1){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');}
function oldPlanFingerprint(valueTracking,valuePlanning){const payload=JSON.stringify({objective:valuePlanning.objective||'BALANCED',platform:valuePlanning.platform||'ALL',creatorType:valuePlanning.creatorType||'ALL',contentType:valuePlanning.contentType||'ALL',region:valuePlanning.region||'ALL',budgetUsd:oldNumber(valuePlanning.budgetUsd),selections:oldStableSelection(valueTracking)});return `r8.5f-${oldFnv1a(payload)}`;}
const legacyPlanning={status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,selections:[]};
if (campaignPlanFingerprint(tracking,legacyPlanning)!==oldPlanFingerprint(tracking,legacyPlanning)) throw new Error('Compensation-off plans must preserve the exact pre-R8.5G approval fingerprint');

const compSummary=buildCampaignCompensationSummary(appliedTracking,appliedComp);
if (!compSummary.calculationCurrent || compSummary.verifiedTalentCount!==3 || compSummary.includedTalentCount!==3) throw new Error('Compensation summary did not preserve verified roster state');

console.log('Campaign compensation intelligence validation passed.');
