import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  sanitizeHouseCreatorFeed,
  buildAkariHouseCreatorDirectory,
  preferredHouseSocial,
} from '../functions/lib/akari-house-creator-directory.js';
import { campaignPlanFingerprint, parseCampaignPlanning } from '../functions/lib/campaign-planning.js';

const required=[
  'functions/lib/akari-house-creator-directory.js',
  'functions/api/creator-directory.js',
  'functions/api/campaign-planning/[id]/house-talent.js',
  'public/assets/akari-house-creator-directory-r61.js',
  'public/assets/akari-house-creator-directory-r61.css',
  'tests/creator-directory-tenant-isolation.test.mjs',
  'tests/akari-house-creator-directory-r61.spec.js',
];
for(const path of required)assert.equal(fs.existsSync(path),true,`Missing ${path}`);

const api=fs.readFileSync('functions/api/creator-directory.js','utf8');
const addApi=fs.readFileSync('functions/api/campaign-planning/[id]/house-talent.js','utf8');
const lib=fs.readFileSync('functions/lib/akari-house-creator-directory.js','utf8');
const ui=fs.readFileSync('public/assets/akari-house-creator-directory-r61.js','utf8');
assert.match(api,/WHERE c\.tenant_id = \?/);
assert.match(api,/WHERE tenant_id = \?/);
assert.match(api,/AKARI House Creator profiles are temporarily unavailable/i);
assert.match(addApi,/WHERE c\.tenant_id=\? AND c\.id=\?/);
assert.match(addApi,/expectedReach:0/);
assert.match(addApi,/allocatedUsd:0/);
assert.match(addApi,/allocatedTokens:0/);
assert.match(addApi,/profileDataStatus:'PROFILE_PROVIDED'/);
assert.match(lib,/AMBIGUOUS_SOCIAL_IDENTITY/);
assert.match(lib,/EXTERNAL_UNLINKED/);
assert.match(lib,/NEW_NO_CAMPAIGN_HISTORY/);
assert.match(lib,/CRM_PLANNED_NO_PERFORMANCE/);
assert.match(ui,/House Creator Directory/);
assert.match(ui,/No performance evidence/i);
assert.match(ui,/Profile Provided/i);

const feed=sanitizeHouseCreatorFeed({
  source:'AKARI_HOUSE_PUBLIC_CREATOR_DIRECTORY',publicProfilesOnly:true,
  items:[
    {akariCreatorId:'house_1',username:'alice',displayName:'Alice Creator',profileUrl:'https://akarihouse.com/profiles/alice',sorsaScore:640,sorsaSource:'partner_verified',xScore:720,xScoreSource:'partner_verified',socials:[{platform:'x',profileUrl:'https://x.com/alice',followerCount:25000,countSource:'member_reported'}]},
    {akariCreatorId:'house_2',username:'newcreator',displayName:'New Creator',profileUrl:'https://akarihouse.com/profiles/newcreator',socials:[{platform:'x',profileUrl:'https://x.com/newcreator',followerCount:8000,countSource:'member_reported'}]},
  ],
});
assert.equal(feed.items[0].profileDataStatus,'PROFILE_PROVIDED');
assert.equal(feed.items[0].socials[0].countSource,'member_reported');
assert.equal(preferredHouseSocial(feed.items[0],'X').profileUrl,'https://x.com/alice');

const campaign={
  id:'cam_1',name:'Campaign One',status:'COMPLETED',start_date:'2026-07-01',end_date:'2026-07-31',updated_at:'2026-07-31',project_name:'Project One',
  notes:JSON.stringify({campaignTracking:{version:3,overview:{},targets:[],socialUpdates:[],creatorAssignments:[{id:'cca_1',creatorType:'CREATOR',name:'Alice Creator',handle:'@alice',platform:'X',profileUrl:'https://x.com/alice',expectedPosts:1,expectedReach:1000,allocatedUsd:100,allocatedTokens:0,active:true}],creatorPosts:[{id:'ccp_1',assignmentId:'cca_1',platform:'X',dataDate:'2026-07-10',url:'https://x.com/alice/status/1',status:'APPROVED',reach:1500,totalEngagements:120}]},campaignPlanning:{version:1,status:'APPROVED',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'ALL',budgetUsd:200,selections:[]}}),
};
const directory=buildAkariHouseCreatorDirectory(feed,[campaign],[],'2026-08-09');
const alice=directory.items.find((item)=>item.akariCreatorId==='house_1');
const fresh=directory.items.find((item)=>item.akariCreatorId==='house_2');
assert.equal(alice.historyState,'CRM_PERFORMANCE_HISTORY');
assert.equal(alice.performance.approvedPosts,1);
assert.equal(alice.performance.approvedReach,1500);
assert.equal(fresh.historyState,'NEW_NO_CAMPAIGN_HISTORY');
assert.equal(fresh.performance,null);

const plannedCampaign={...campaign,id:'cam_2',status:'PLANNED',notes:JSON.stringify({campaignTracking:{version:3,overview:{},targets:[],socialUpdates:[],creatorAssignments:[{id:'cca_2',creatorType:'CREATOR',name:'New Creator',handle:'@newcreator',platform:'X',profileUrl:'https://x.com/newcreator',expectedPosts:1,expectedReach:0,allocatedUsd:0,allocatedTokens:0,active:true}],creatorPosts:[]},campaignPlanning:{version:1,status:'DRAFT',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'ALL',budgetUsd:200,selections:[{assignmentId:'cca_2',identityKey:'social:X:newcreator',akariCreatorId:'house_2',identitySource:'AKARI_HOUSE',profileDataStatus:'PROFILE_PROVIDED'}]}})};
const plannedDirectory=buildAkariHouseCreatorDirectory(feed,[campaign,plannedCampaign],[],'2026-08-09');
const planned=plannedDirectory.items.find((item)=>item.akariCreatorId==='house_2');
assert.equal(planned.historyState,'CRM_PLANNED_NO_PERFORMANCE');
assert.equal(planned.performance,null);

const legacyTracking={creatorAssignments:[{id:'cca_x',creatorType:'CREATOR',name:'Legacy',handle:'@legacy',platform:'X',expectedPosts:1,expectedReach:0,allocatedUsd:0,allocatedTokens:0,active:true}]};
const legacyPlanning=parseCampaignPlanning({campaignPlanning:{status:'DRAFT',objective:'BALANCED',platform:'X',creatorType:'ALL',contentType:'Post',region:'ALL',budgetUsd:200,selections:[{assignmentId:'cca_x',identityKey:'social:X:legacy'}]}});
const before=campaignPlanFingerprint(legacyTracking,legacyPlanning);
legacyPlanning.selections[0].identitySource='EXTERNAL';
legacyPlanning.selections[0].profileDataStatus='PROFILE_PROVIDED';
assert.equal(campaignPlanFingerprint(legacyTracking,legacyPlanning),before,'Legacy fingerprint must ignore non-House provenance fields');
legacyPlanning.selections[0].akariCreatorId='house_legacy';
assert.notEqual(campaignPlanFingerprint(legacyTracking,legacyPlanning),before,'Stable House identity must become approval-relevant only when present');

console.log('AKARI House Creator directory sync validation passed.');
