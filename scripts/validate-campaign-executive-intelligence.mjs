import fs from 'node:fs';

const checks = [
  ['public/assets/campaign-executive-intelligence-r45.js', [
    'Campaign command center',
    '4-week tracked reach',
    'Owned-social growth behind pace',
    'Creator publishing behind pace',
    'GTM outcome funnel',
    '/api/campaign-tracking/',
    '/api/campaign-gtm-tracking/',
  ]],
  ['public/assets/campaign-executive-intelligence-r45.css', [
    'campaign-executive-r45',
    'exec-health-r45',
    'exec-risk-list-r45',
    'exec-funnel-r45',
  ]],
  ['public/assets/delivery-planning-capacity-r39.js', [
    'campaign-executive-intelligence-r45.css',
    'campaign-executive-intelligence-r45.js',
  ]],
];

for (const [file, tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const executive = fs.readFileSync('public/assets/campaign-executive-intelligence-r45.js', 'utf8');
if (!executive.includes('Non-deduplicated across channels')) throw new Error('Reach must be labelled as non-deduplicated');
if (!executive.includes('health = 100')) throw new Error('Campaign health scoring is missing');
if (!executive.includes('lastDataUpdate')) throw new Error('Data freshness risk is missing');
if (!executive.includes('topCreators') || !executive.includes('topAgencies')) throw new Error('Performance leader roll-ups are missing');

console.log('Campaign executive intelligence validation passed.');
