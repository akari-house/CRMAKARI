import fs from 'node:fs';

const checks = [
  ['functions/lib/campaign-gtm-tracking.js',['GTM_ACTIVITY_TYPES','sanitizeGtmActivity','gtmTrackingSummary','campaignGtmTracking']],
  ['functions/api/campaign-gtm-tracking/[id].js',['upsert-activity','delete-activity','CAMPAIGN_GTM_TRACKING','tenantId,context.params.id']],
  ['public/assets/campaign-gtm-tracking-r44.js',['PR, Spaces, partnerships & launch tracking','Track activity','totalMeetings','campaign-gtm-tracking-r44','if(!payload?.item)return;']],
  ['public/assets/campaign-gtm-tracking-r44.css',['campaign-gtm-tracking-r44','gtm-kpis-r44','gtm-modal-r44']],
  ['public/assets/delivery-planning-capacity-r39.js',['campaign-gtm-tracking-r44.css','campaign-gtm-tracking-r44.js']],
];

for (const [file,tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const api = fs.readFileSync('functions/api/campaign-gtm-tracking/[id].js','utf8');
if (!api.includes("c.tenant_id=? AND c.id=?")) throw new Error('GTM campaign lookup must remain tenant scoped');
if (!api.includes("MANAGER_ROLES")) throw new Error('Destructive GTM actions must remain manager controlled');

console.log('Campaign GTM activity tracking validation passed.');
