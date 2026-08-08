import fs from 'node:fs';

const checks = [
  ['functions/lib/campaign-summary-intelligence.js', [
    'buildCampaignPeriodSummary',
    'ACCELERATING',
    'BASELINE_ONLY',
    'clientSummary',
    'recommendations',
  ]],
  ['functions/api/campaign-summary-intelligence/[id].js', [
    'requireTenant',
    'c.tenant_id = ? AND c.id = ?',
    'buildCampaignPeriodSummary',
    'WEEKLY',
    'MONTHLY',
  ]],
  ['public/assets/campaign-summary-intelligence-r48.js', [
    'Weekly & monthly summary',
    'CLIENT-FACING SUMMARY',
    '/api/campaign-summary-intelligence/',
    'Recommended next actions',
  ]],
  ['public/assets/campaign-summary-intelligence-r48.css', [
    'campaign-summary-intelligence-r48',
    'summary-momentum-r48',
    'summary-grid-r48',
  ]],
  ['public/assets/delivery-planning-capacity-r39.js', [
    'campaign-summary-intelligence-r48.css',
    'campaign-summary-intelligence-r48.js',
  ]],
];

for (const [file, tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const api = fs.readFileSync('functions/api/campaign-summary-intelligence/[id].js', 'utf8');
if (!api.includes('WHERE c.tenant_id = ? AND c.id = ?')) throw new Error('Summary intelligence lookup must remain tenant scoped');
if (api.includes('onRequestPatch') || api.includes('onRequestPost')) throw new Error('Summary intelligence must remain read-only');

const model = fs.readFileSync('functions/lib/campaign-summary-intelligence.js', 'utf8');
if (!model.includes("candidate.type ===") && !model.includes("filter((item) => item.type === wanted)")) throw new Error('Period comparisons must stay same-type');
if (!model.includes('tracked, non-deduplicated')) throw new Error('Client summary must label reach correctly');

console.log('Campaign summary intelligence validation passed.');
