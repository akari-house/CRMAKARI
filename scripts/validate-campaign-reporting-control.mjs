import fs from 'node:fs';

const checks = [
  ['functions/lib/campaign-reporting-control.js',['buildReportingControlSummary','weeklyCadenceDays','freshnessCriticalDays','OVERDUE','healthScore']],
  ['functions/api/campaign-reporting-control/[id].js',['requireTenant','CAMPAIGN_REPORTING_CONTROL_UPDATED','WHERE c.tenant_id=? AND c.id=?']],
  ['functions/api/campaign-reporting-control.js',['overdueReports','dueSoon','buildReportingControlSummary']],
  ['public/assets/campaign-reporting-control-r49.js',['Calendar & data freshness','Portfolio reporting queue','/api/campaign-reporting-control']],
  ['public/assets/campaign-reporting-control-r49.css',['campaign-reporting-control-r49','freshness-grid-r49','report-queue-r49']],
  ['public/assets/delivery-planning-capacity-r39.js',['campaign-reporting-control-r49.css','campaign-reporting-control-r49.js']],
];
for (const [file,tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}
const api = fs.readFileSync('functions/api/campaign-reporting-control/[id].js','utf8');
if (!api.includes('MANAGER_ROLES')) throw new Error('Reporting control writes must remain manager controlled');
const portfolio = fs.readFileSync('functions/api/campaign-reporting-control.js','utf8');
if (!portfolio.includes('c.tenant_id=?')) throw new Error('Portfolio reporting queue must remain tenant scoped');
console.log('Campaign reporting control validation passed.');
