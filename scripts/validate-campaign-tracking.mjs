import fs from 'node:fs';

const required = [
  'functions/lib/campaign-tracking.js',
  'functions/api/campaign-tracking/[id].js',
  'public/assets/campaign-tracking-r42.js',
  'public/assets/campaign-tracking-r42.css',
];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing campaign tracking file: ${file}`);
}

const model = fs.readFileSync('functions/lib/campaign-tracking.js','utf8');
const api = fs.readFileSync('functions/api/campaign-tracking/[id].js','utf8');
const ui = fs.readFileSync('public/assets/campaign-tracking-r42.js','utf8');
const loader = fs.readFileSync('public/assets/delivery-planning-capacity-r39.js','utf8');

const assertions = [
  [model.includes('CAMPAIGN_PLATFORMS'), 'controlled platform list'],
  [model.includes('campaignTrackingSummary'), 'derived scorecard summary'],
  [model.includes('campaignWeek') && model.includes('campaignMonth'), 'date-derived reporting periods'],
  [api.includes('WHERE c.tenant_id = ? AND c.id = ?'), 'tenant-scoped campaign lookup'],
  [api.includes("'CAMPAIGN_TRACKING'"), 'campaign tracking audit trail'],
  [api.includes("action === 'upsert-social-update'"), 'owned-social update persistence'],
  [api.includes('An update already exists for this platform and reporting date'), 'platform/date duplicate protection'],
  [ui.includes('Baseline & target') && ui.includes('Add social update'), 'campaign tracking input controls'],
  [ui.includes('Owned-social scorecard'), 'derived executive scorecard'],
  [ui.includes('if (!payload?.item) return;'), 'invalid progressive payload guard'],
  [loader.includes('/assets/campaign-tracking-r42.js?v=1'), 'campaign tracking runtime loader'],
];
for (const [condition, label] of assertions) {
  if (!condition) throw new Error(`Campaign tracking validation failed: ${label}`);
}
console.log('Campaign tracking foundation validation passed.');
