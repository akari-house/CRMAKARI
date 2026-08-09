import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseCampaignTalentOutreach,
  upsertTalentOutreachRecord,
  buildCampaignTalentOutreachSummary,
  campaignTalentOutreachFingerprint,
  assertTalentConfirmationReady,
} from '../functions/lib/campaign-talent-outreach.js';

const required=[
  'functions/lib/campaign-talent-outreach.js',
  'functions/api/campaign-talent-outreach/[id].js',
  'public/assets/campaign-talent-outreach-r60.js',
  'public/assets/campaign-talent-outreach-r60.css',
  'tests/campaign-talent-outreach-tenant-isolation.test.mjs',
  'tests/campaign-talent-outreach-r60.spec.js',
];
for(const path of required)assert.equal(fs.existsSync(path),true,`Missing ${path}`);

const api=fs.readFileSync('functions/api/campaign-talent-outreach/[id].js','utf8');
const ui=fs.readFileSync('public/assets/campaign-talent-outreach-r60.js','utf8');
assert.match(api,/WHERE c\.tenant_id = \? AND c\.id = \?/);
assert.match(api,/WHERE tm\.tenant_id = \? AND tm\.user_id = \?/);
assert.match(api,/CAMPAIGN_TALENT_PARTICIPATION_CONFIRMED/);
assert.match(api,/approved campaign allocation/i);
assert.match(ui,/Acceptance & Consent Workspace/);
assert.match(ui,/does not send the message automatically/i);
assert.match(ui,/Plan mismatch/);

const tracking={
  creatorAssignments:[
    {id:'cca_1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',agencyName:'',allocatedUsd:150,allocatedTokens:0,active:true},
    {id:'cca_2',creatorType:'KOL',name:'Bob',handle:'@bob',platform:'X',agencyName:'Partner A',allocatedUsd:100,allocatedTokens:5000,active:true},
  ],
};
let outreach=parseCampaignTalentOutreach({});
let summary=buildCampaignTalentOutreachSummary(tracking,outreach);
assert.equal(summary.talentCount,2);
assert.equal(summary.readyForActivation,false);
assert.equal(summary.confirmedCount,0);

let updated=upsertTalentOutreachRecord(outreach,'cca_1',{
  status:'ACCEPTED',agreedUsd:150,agreedTokens:0,deliverablesConfirmed:true,scheduleConfirmed:true,
  compensationConfirmed:true,termsConfirmed:true,consentConfirmed:true,evidenceReference:'telegram:alice-acceptance',
});
outreach=updated.outreach;
summary=buildCampaignTalentOutreachSummary(tracking,outreach);
let alice=summary.talent.find((item)=>item.assignmentId==='cca_1');
assert.equal(alice.commercialMatch,true);
assert.doesNotThrow(()=>assertTalentConfirmationReady(alice));

outreach=upsertTalentOutreachRecord(outreach,'cca_1',{status:'CONFIRMED'}).outreach;
outreach=upsertTalentOutreachRecord(outreach,'cca_2',{
  status:'ACCEPTED',agreedUsd:100,agreedTokens:5000,deliverablesConfirmed:true,scheduleConfirmed:true,
  compensationConfirmed:true,agencyConfirmed:true,termsConfirmed:true,consentConfirmed:true,evidenceReference:'email:bob-acceptance',
}).outreach;
summary=buildCampaignTalentOutreachSummary(tracking,outreach);
const bob=summary.talent.find((item)=>item.assignmentId==='cca_2');
assert.doesNotThrow(()=>assertTalentConfirmationReady(bob));
outreach=upsertTalentOutreachRecord(outreach,'cca_2',{status:'CONFIRMED'}).outreach;
summary=buildCampaignTalentOutreachSummary(tracking,outreach);
assert.equal(summary.readyForActivation,true);
assert.equal(summary.confirmedCount,2);

const stable=campaignTalentOutreachFingerprint(tracking,outreach);
outreach=upsertTalentOutreachRecord(outreach,'cca_1',{notes:'Follow-up note only'}).outreach;
assert.equal(campaignTalentOutreachFingerprint(tracking,outreach),stable,'Operational notes must not invalidate confirmed activation evidence');
outreach=upsertTalentOutreachRecord(outreach,'cca_1',{agreedUsd:149}).outreach;
summary=buildCampaignTalentOutreachSummary(tracking,outreach);
assert.equal(summary.readyForActivation,false);
assert.equal(summary.commercialMismatchCount,1);
assert.notEqual(campaignTalentOutreachFingerprint(tracking,outreach),stable);

console.log('Creator / KOL outreach, acceptance and consent validation passed.');
