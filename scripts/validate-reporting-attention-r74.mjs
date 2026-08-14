import fs from 'node:fs';

const required=[
  'db/migrations/0007_reporting_attention.sql',
  'functions/lib/reporting-attention.js',
  'functions/api/operating-rhythm/_middleware.js',
  'functions/api/operating-rhythm/index.js',
  'public/assets/operating-rhythm-r74.js',
  'public/assets/operating-rhythm-r74.css',
  'tests/reporting-attention-r74-tenant-isolation.test.mjs',
  'public/app/index.html',
];
for(const file of required)if(!fs.existsSync(file))throw new Error(`R74 missing ${file}`);

const migration=fs.readFileSync('db/migrations/0007_reporting_attention.sql','utf8');
for(const table of ['operational_attention','operating_report_snapshots'])if(!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`))throw new Error(`R74 migration missing table: ${table}`);
for(const invariant of ["UNIQUE (tenant_id, source_type, source_id, reason_key)","'OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED','DISMISSED'","'FOUNDER_WEEKLY','CLIENT','CAMPAIGN','FUNDRAISING','INVESTOR_UPDATE','REVENUE','MANAGEMENT'"])if(!migration.includes(invariant))throw new Error(`R74 migration missing invariant: ${invariant}`);

const lib=fs.readFileSync('functions/lib/reporting-attention.js','utf8');
for(const pattern of ['deriveAttention','refreshAttention','listAttention','updateAttention','buildReport','saveReportSnapshot','FOLLOW_UP_OVERDUE','PAYMENT_OVERDUE','REPORT_OVERDUE','RENEWAL_APPROACHING','INVESTOR_FOLLOW_UP_DUE','DILIGENCE_DUE','FOUNDER_DOCUMENT_MISSING','WHERE tenant_id = ?'])if(!lib.includes(pattern))throw new Error(`R74 domain engine missing: ${pattern}`);

const middleware=fs.readFileSync('functions/api/operating-rhythm/_middleware.js','utf8');
for(const pattern of ['EXTERNAL_COLLABORATOR','internal-only'])if(!middleware.includes(pattern))throw new Error(`R74 middleware missing: ${pattern}`);

const api=fs.readFileSync('functions/api/operating-rhythm/index.js','utf8');
for(const pattern of ['requireTenant','requireRole','canViewFinance','TEAM_ROLES','FINANCE_REPORTS','refresh-attention','update-attention','snapshot-report','owner_user_id!==auth.userId','tenant_id = ?'])if(!api.includes(pattern))throw new Error(`R74 API validation missing: ${pattern}`);

const ui=fs.readFileSync('public/assets/operating-rhythm-r74.js','utf8');
for(const pattern of ['Attention Engine','My attention','Team attention','Snooze 1d','Operating Reports','MANAGEMENT','REVENUE','FUNDRAISING','FOUNDER_WEEKLY','CLIENT','CAMPAIGN','INVESTOR_UPDATE','Save Snapshot'])if(!ui.includes(pattern))throw new Error(`R74 UI validation missing: ${pattern}`);

const shell=fs.readFileSync('public/app/index.html','utf8');
for(const pattern of ['/assets/operating-rhythm-r74.css?v=1','/assets/operating-rhythm-r74.js?v=1'])if(!shell.includes(pattern))throw new Error(`R74 shell wiring missing: ${pattern}`);

console.log('R74 Reporting + Attention Engine validation passed');
