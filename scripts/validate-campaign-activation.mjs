import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseCampaignActivation,
  buildCampaignActivationSummary,
  assertCampaignActivationReady,
  assertCampaignActivationCompletable,
} from '../functions/lib/campaign-activation.js';
import { campaignPlanFingerprint } from '../functions/lib/campaign-planning.js';
import { campaignTalentOutreachFingerprint } from '../functions/lib/campaign-talent-outreach.js';

const required=[
  'functions/lib/campaign-activation.js',
  'functions/api/campaign-activation/[id].js',
  'public/assets/campaign-activation-r59.js',
  'public/assets/campaign-activation-r59.css',
  'tests/campaign-activation-tenant-isolation.test.mjs',
  'tests/campaign-activation-r59.spec.js',
];
for(const path of required)assert.equal(fs.existsSync(path),true,`Missing ${path}`);

const api=fs.readFileSync('functions/api/campaign-activation/[id].js','utf8');
const ui=fs.readFileSync('public/assets/campaign-activation-r59.js','utf8');
assert.match(api,/WHERE c\.tenant_id = \? AND c\.id = \?/);
assert.match(api,/WHERE t\.tenant_id = \? AND t\.campaign_id = \?/);
assert.match(api,/SERVICE_CAMPAIGN_ACTIVATION:/);
assert.match(api,/INSERT INTO tasks/);
assert.match(api,/CAMPAIGN_EXECUTION_ACTIVATED/);
assert.match(api,/talentConfirmationFingerprint/);
assert.match(api,/assertCampaignActivationCompletable/);
assert.match(ui,/Activation & Work OS Handoff/);
assert.match(ui,/confirmed Creator\/KOL participation evidence/i);
assert.match(ui,/Open Work OS/);

const tracking={
  version:3,overview:{},targets:[],socialUpdates:[],
  creatorAssignments:[{ id:'cca_1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',expectedPosts:2,expectedReach:10000,allocatedUsd:100,allocatedTokens:0,active:true }],
  creatorPosts:[],
};
const planning={ status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:300,selections:[],compensation:{enabled:false} };
planning.approvedFingerprint=campaignPlanFingerprint(tracking,planning);
const outreach={
  version:1,
  records:[{
    assignmentId:'cca_1',status:'CONFIRMED',agreedUsd:100,agreedTokens:0,
    deliverablesConfirmed:true,scheduleConfirmed:true,compensationConfirmed:true,
    agencyConfirmed:false,termsConfirmed:true,consentConfirmed:true,
    evidenceReference:'tg-thread-1',confirmedAt:'2026-08-09T10:00:00Z',confirmedBy:'usr_1',
  }],
};
let activation=parseCampaignActivation({});
let summary=buildCampaignActivationSummary(tracking,planning,activation,[],{});
assert.equal(summary.effectiveStatus,'NOT_ACTIVATED');
assert.equal(summary.governanceReady,false);
assert.throws(()=>assertCampaignActivationReady(summary),/confirmed participation evidence/i);

summary=buildCampaignActivationSummary(tracking,planning,activation,[],outreach);
assert.equal(summary.effectiveStatus,'READY_TO_ACTIVATE');
assert.equal(summary.governanceReady,true);
assert.equal(summary.talentConfirmationReady,true);
assert.doesNotThrow(()=>assertCampaignActivationReady(summary));

activation={
  ...activation,status:'ACTIVE',executionOwnerId:'usr_1',approvedPlanFingerprint:summary.currentPlanFingerprint,
  talentConfirmationFingerprint:campaignTalentOutreachFingerprint(tracking,outreach),taskIds:['tsk_1','tsk_2'],
};
let tasks=[{id:'tsk_1',status:'DONE'},{id:'tsk_2',status:'TODO'}];
summary=buildCampaignActivationSummary(tracking,planning,activation,tasks,outreach);
assert.equal(summary.taskDoneCount,1);
assert.equal(summary.taskOpenCount,1);
assert.equal(summary.completionReady,false);

tracking.creatorPosts=[
  {id:'ccp_1',assignmentId:'cca_1',status:'APPROVED',reach:6000,totalEngagements:400},
  {id:'ccp_2',assignmentId:'cca_1',status:'APPROVED',reach:7000,totalEngagements:500},
];
tasks=[{id:'tsk_1',status:'DONE'},{id:'tsk_2',status:'DONE'}];
summary=buildCampaignActivationSummary(tracking,planning,activation,tasks,outreach);
assert.equal(summary.approvedPosts,2);
assert.equal(summary.approvedReach,13000);
assert.equal(summary.approvedEngagements,900);
assert.equal(summary.approvedDeliveryComplete,true);
assert.equal(summary.completionReady,true);
assert.doesNotThrow(()=>assertCampaignActivationCompletable(summary));

outreach.records[0].consentConfirmed=false;
summary=buildCampaignActivationSummary(tracking,planning,activation,tasks,outreach);
assert.equal(summary.outreachDrift,true);
assert.equal(summary.effectiveStatus,'CHANGES_AFTER_ACTIVATION');
assert.throws(()=>assertCampaignActivationCompletable(summary),/governance changed/i);
outreach.records[0].consentConfirmed=true;

tracking.creatorAssignments[0].expectedPosts=3;
summary=buildCampaignActivationSummary(tracking,planning,activation,tasks,outreach);
assert.equal(summary.activationDrift,true);
assert.equal(summary.effectiveStatus,'CHANGES_AFTER_ACTIVATION');
assert.throws(()=>assertCampaignActivationCompletable(summary),/governance changed/i);

console.log('Campaign activation and Work OS handoff validation passed.');
