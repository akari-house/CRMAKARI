import fs from 'node:fs';

const checks = [
  ['functions/api/campaign-tracking/[id]/report.js', [
    'Campaign performance report',
    'tracked and non-deduplicated',
    'parseCampaignTracking',
    'parseCampaignGtmTracking',
    'canViewFinance',
    'Print / Save as PDF',
    'sections',
  ]],
  ['public/assets/campaign-report-builder-r46.js', [
    'Campaign report builder',
    'campaign-tracking/',
    '/report?sections=',
    'Commercial summary',
  ]],
  ['public/assets/campaign-report-builder-r46.css', [
    'campaign-report-modal-r46',
    'campaign-report-button-r46',
  ]],
  ['public/assets/delivery-planning-capacity-r39.js', [
    'campaign-report-builder-r46.css',
    'campaign-report-builder-r46.js',
  ]],
];

for (const [file, tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const report = fs.readFileSync('functions/api/campaign-tracking/[id]/report.js', 'utf8');
if (!report.includes('c.tenant_id = ? AND c.id = ?')) throw new Error('Campaign report lookup must remain tenant scoped');
if (!report.includes("'cache-control':'private, no-store'")) throw new Error('Campaign report must remain private and non-cacheable');
if (!report.includes("sections.has('finance') && financeVisible")) throw new Error('Finance report section must remain permission gated');

console.log('Campaign client report validation passed.');
