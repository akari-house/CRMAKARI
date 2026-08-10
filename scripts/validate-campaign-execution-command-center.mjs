import assert from 'node:assert/strict';
import fs from 'node:fs';
import { campaignPlanFingerprint } from '../functions/lib/campaign-planning.js';
import { campaignTalentOutreachFingerprint } from '../functions/lib/campaign-talent-outreach.js';
import {
  buildCampaignExecutionRow,
  buildCampaignExecutionCommandCenter,
} from '../functions/lib/campaign-execution-command-center.js';

const required=[
  'functions/lib/campaign-execution-command-center.js',
  'functions/api/campaign-execution-command-center.js',
  'public/assets/campaign-execution-command-center-r62.js',
  'public/assets/campaign-execution-command-center-r62.css',
  'tests/campaign-execution-command-center-tenant-isolation.test.mjs',
  'tests/campaign-execution-command-r62.spec.js',
];
for(const path of required)assert.equal(fs.existsSync(path),true,`Missing ${path}`);

const api=fs.readFileSync('functions/api/campaign-execution-command-center.js','utf8');
const lib=fs.readFileSync('functions/lib/campaign-execution-command-center.js','utf8');
const ui=fs.readFileSync('public/assets/campaign-execution-command-center-r62.js','utf8');
const index=fs.readFileSync('public/app/index.html','utf8');
assert.match(api,/WHERE c\.tenant_id=\?/);
assert.match(api,/WHERE t\.tenant_id=\? AND t\.campaign_id IS NOT NULL/);
assert.doesNotMatch(api,/INSERT INTO|UPDATE campaigns|DELETE FROM/i);
assert.match(api,/singleRankedNextAction:true/);
assert.match(lib,/PLAN_APPROVAL_DRIFT/);
assert.match(lib,/OVERDUE_TASKS/);
assert.match(lib,/HOLDING_POSTS/);
assert.match(ui,/Execution Command Centre/);
assert.match(ui,/Approved-only Creator\/KOL performance/i);
assert.match(ui,/Planned allocations are not proof/i);
assert.match(index,/campaign-execution-command-center-r62\.css\?v=1/);
assert.match(index,/campaign-execution-command-center-r62\.js\?v=1/);

function campaignNotes({drift=false,holding=false,rejected=false}={}){
  const tracking={version:3,overview:{},targets:[],socialUpdates:[],creatorAssignments:[{id:'cca_1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',expectedPosts:2,expectedReach:10000,allocatedUsd:100,allocatedTokens:0,active:true}],creatorPosts:[]};
  const planning={version:1,status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'EMEA',budgetUsd:300,selections:[],compensation:{enabled:false}};
  planning.approvedFingerprint=campaignPlanFingerprint(tracking,planning);
  const outreach={version:1,records:[{assignmentId:'cca_1',status:'CONFIRMED',agreedUsd:100,agreedTokens:0,deliverablesConfirmed:true,scheduleConfirmed:true,compensationConfirmed:true,agencyConfirmed:false,termsConfirmed:true,consentConfirmed:true,evidenceReference:'evidence-1',confirmedAt:'2026-08-01T10:00:00Z',confirmedBy:'usr_owner'}]};
  const confirmationFingerprint=campaignTalentOutreachFingerprint(tracking,outreach);
  const activation={version:1,status:'ACTIVE',executionOwnerId:'usr_owner',approvedPlanFingerprint:planning.approvedFingerprint,talentConfirmationFingerprint:confirmationFingerprint,taskIds:['tsk_1'],taskPlan:[{id:'tsk_1',slug:'execution',phase:'EXECUTION'}],activatedAt:'2026-08-01T10:00:00Z',activatedBy:'usr_owner'};
  if(holding)tracking.creatorPosts.push({id:'post_hold',assignmentId:'cca_1',platform:'X',dataDate:'2026-08-08',url:'https://x.com/alice/status/hold',status:'HOLDING',reach:9000,totalEngagements:600});
  if(rejected)tracking.creatorPosts.push({id:'post_reject',assignmentId:'cca_1',platform:'X',dataDate:'2026-08-08',url:'https://x.com/alice/status/reject',status:'REJECTED',reach:12000,totalEngagements:900});
  if(drift)tracking.creatorAssignments[0].expectedPosts=3;
  return JSON.stringify({campaignTracking:tracking,campaignPlanning:planning,campaignTalentOutreach:outreach,campaignActivation:activation});
}

const today='2026-08-09';
const driftCampaign={id:'cam_drift',name:'Drift Campaign',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-20',notes:campaignNotes({drift:true}),project_id:'prj_1',project_name:'Project One',campaign_owner_id:'usr_owner',owner_name:'Owner'};
const overdueCampaign={id:'cam_overdue',name:'Overdue Campaign',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-20',notes:campaignNotes(),project_id:'prj_2',project_name:'Project Two',campaign_owner_id:'usr_owner',owner_name:'Owner'};
const holdingCampaign={id:'cam_holding',name:'Holding Campaign',status:'LIVE',region:'EMEA',start_date:'2026-08-01',end_date:'2026-08-20',notes:campaignNotes({holding:true}),project_id:'prj_3',project_name:'Project Three',campaign_owner_id:'usr_other',owner_name:'Other'};
const tasks=[
  {id:'tsk_drift',campaign_id:'cam_drift',title:'Execution',status:'TODO',priority:'HIGH',due_at:'2026-08-12',owner_user_id:'usr_owner'},
  {id:'tsk_overdue',campaign_id:'cam_overdue',title:'Overdue execution task',status:'TODO',priority:'HIGH',due_at:'2026-08-07',owner_user_id:'usr_owner'},
  {id:'tsk_holding',campaign_id:'cam_holding',title:'Monitor delivery',status:'TODO',priority:'MEDIUM',due_at:'2026-08-12',owner_user_id:'usr_other'},
];

const driftRow=buildCampaignExecutionRow(driftCampaign,tasks,today);
assert.equal(driftRow.risk.level,'CRITICAL');
assert.equal(driftRow.nextAction.code,'RECONCILE_PLAN');
assert.equal(driftRow.delivery.approvedPosts,0);

const overdueRow=buildCampaignExecutionRow(overdueCampaign,tasks,today);
assert.equal(overdueRow.tasks.overdue,1);
assert.equal(overdueRow.nextAction.code,'RESOLVE_OVERDUE_TASKS');
assert.ok(['HIGH','MEDIUM'].includes(overdueRow.risk.level));

const holdingRow=buildCampaignExecutionRow(holdingCampaign,tasks,today);
assert.equal(holdingRow.delivery.holdingPosts,1);
assert.equal(holdingRow.delivery.approvedPosts,0,'Holding posts must not count as Approved delivery');
assert.equal(holdingRow.delivery.approvedReach,0,'Holding reach must not count toward performance');
assert.equal(holdingRow.nextAction.code,'REVIEW_HOLDING_POSTS');

const team=buildCampaignExecutionCommandCenter([overdueCampaign,holdingCampaign,driftCampaign],tasks,today,null);
assert.equal(team.items[0].id,'cam_drift','Governance drift must rank above secondary operational risk');
assert.equal(team.metrics.campaigns,3);
assert.equal(team.metrics.approvedReach,0);
assert.equal(team.metrics.holdingPosts,1);

const mine=buildCampaignExecutionCommandCenter([overdueCampaign,holdingCampaign,driftCampaign],tasks,today,'usr_owner');
assert.deepEqual(mine.items.map((item)=>item.id).sort(),['cam_drift','cam_overdue']);
assert.equal(mine.scope,'MINE');

console.log('Campaign Execution Command Centre validation passed.');
