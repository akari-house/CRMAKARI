import fs from 'node:fs';

const checks = [
  ['functions/lib/campaign-reporting-history.js', [
    'REPORTING_SNAPSHOT_TYPES',
    'campaignReportingHistory',
    'rollingTrackedReach',
    'buildCampaignSnapshot',
    'reportingHistorySummary',
  ]],
  ['functions/api/campaign-reporting-history/[id].js', [
    'capture-snapshot',
    'delete-snapshot',
    'CAMPAIGN_REPORTING_HISTORY',
    'asOfTracking',
    'asOfGtmTracking',
    'c.tenant_id = ? AND c.id = ?',
  ]],
  ['public/assets/campaign-reporting-history-r47.js', [
    'Period snapshots & trend',
    'Capture snapshot',
    'Tracked / non-deduplicated',
    '/api/campaign-reporting-history/',
  ]],
  ['public/assets/campaign-reporting-history-r47.css', [
    'campaign-reporting-history-r47',
    'snapshot-trend-r47',
    'reporting-snapshot-modal-r47',
  ]],
  ['public/assets/delivery-planning-capacity-r39.js', [
    'campaign-reporting-history-r47.css',
    'campaign-reporting-history-r47.js',
  ]],
];

for (const [file, tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const api = fs.readFileSync('functions/api/campaign-reporting-history/[id].js', 'utf8');
if (!api.includes('MANAGER_ROLES')) throw new Error('Snapshot capture and deletion must remain manager controlled');
if (!api.includes("periodDate > nowIso().slice(0,10)")) throw new Error('Future reporting snapshots must be rejected');
if (!api.includes('periodDate < row.start_date')) throw new Error('Pre-campaign snapshots must be rejected');

const model = fs.readFileSync('functions/lib/campaign-reporting-history.js', 'utf8');
if (!model.includes('previous.rollingReach28?.total')) throw new Error('Period-over-period reach delta is missing');

console.log('Campaign reporting history validation passed.');
