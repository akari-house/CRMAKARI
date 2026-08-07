import fs from 'node:fs';

const required = [
  ['functions/lib/campaign-tracking.js',['creatorAssignments','creatorPosts','sanitizeCreatorAssignment','sanitizeCreatorPost','creatorTrackingSummary']],
  ['functions/api/campaign-tracking/[id].js',['upsert-creator-assignment','upsert-creator-post','delete-creator-assignment','delete-creator-post','CAMPAIGN_TRACKING']],
  ['public/assets/campaign-creator-tracking-r43.js',['Creator, KOL & agency tracking','expectedPosts','allocatedTokens','Published URL','creatorTrackingR43']],
  ['public/assets/campaign-creator-tracking-r43.css',['campaign-creator-tracking-r43','creator-tracking-kpis-r43','creator-tracking-modal-r43']],
  ['public/assets/delivery-planning-capacity-r39.js',['campaign-creator-tracking-r43.css','campaign-creator-tracking-r43.js']],
];

for (const [file,tokens] of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const lib = fs.readFileSync('functions/lib/campaign-tracking.js','utf8');
if (!lib.includes("version: 2")) throw new Error('campaignTracking version was not advanced');
if (!lib.includes("creatorType === 'KOL'")) throw new Error('KOL aggregation is missing');
if (!lib.includes('agencyMap')) throw new Error('Agency roll-up is missing');

const api = fs.readFileSync('functions/api/campaign-tracking/[id].js','utf8');
if (!api.includes('tenantId, context.params.id')) throw new Error('Campaign lookup must remain tenant scoped');
if (!api.includes('This creator post URL is already tracked')) throw new Error('Duplicate post URL protection is missing');

console.log('Campaign creator tracking validation passed.');
