import fs from 'node:fs';

const required=[
  'functions/api/_middleware.js',
  'functions/api/system-health.js',
  'functions/api/production-readiness/index.js',
  'functions/api/portal/project/[id]/_middleware.js',
  'public/_headers',
  'public/assets/v1-runtime-hardening.css',
  'public/assets/v1-runtime-hardening.js',
  'public/assets/production-readiness-r15.js',
  'tests/v1-hardening-tenant-isolation.test.mjs',
  'tests/v1-release-signoff-tenant-isolation.test.mjs',
  'tests/v1-portal-privacy-tenant-isolation.test.mjs',
  'tests/v1-runtime-hardening.spec.js',
  'docs/V1_PRODUCTION_HARDENING.md',
  'docs/PRODUCTION_BACKUP_RESTORE.md',
  '.github/workflows/deploy-cloudflare-pages.yml',
  '.github/workflows/v1-production-acceptance.yml',
  'scripts/cloudflare-d1-preflight.mjs',
  'scripts/production-acceptance.mjs',
  'scripts/write-release-metadata.mjs',
  'public/app/index.html',
  'public/sw.js',
];
for(const file of required)if(!fs.existsSync(file))throw new Error(`V1 hardening missing ${file}`);

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!/^1\.0\.0-rc\.\d+$/.test(pkg.version))throw new Error(`V1 release candidate version is invalid: ${pkg.version}`);
for(const command of ['release:metadata','accept:production'])if(!pkg.scripts?.[command])throw new Error(`V1 package command missing ${command}`);

const middleware=fs.readFileSync('functions/api/_middleware.js','utf8');
for(const pattern of ['x-request-id','api_request_complete','api_request_error','Unexpected server error','x-content-type-options','permissions-policy'])if(!middleware.includes(pattern))throw new Error(`V1 API hardening missing ${pattern}`);

const health=fs.readFileSync('functions/api/system-health.js','utf8');
for(const pattern of ['requireTenant','sqlite_schema','DEGRADED','workspace_integrations','workspace_api_keys','webhook_endpoints'])if(!health.includes(pattern))throw new Error(`V1 health contract missing ${pattern}`);

const readiness=fs.readFileSync('functions/api/production-readiness/index.js','utf8');
for(const key of ['accessBoundary','roleMatrix','leadToCash','campaignJourney','fundraisingJourney','platformJourney','tenantTwo','portalPrivacy','backupRestore','mobile','integrations','ownerApproval'])if(!readiness.includes(`${key}:`))throw new Error(`V1 release sign-off missing ${key}`);
for(const pattern of ['CRM by AKARI V1.0','manualTotal','manualCompleted','productionReadinessV1','PRODUCTION_SIGNOFF_UPDATED'])if(!readiness.includes(pattern))throw new Error(`V1 release sign-off contract missing ${pattern}`);
const readinessUi=fs.readFileSync('public/assets/production-readiness-r15.js','utf8');
for(const pattern of ['V1.0 RELEASE CANDIDATE','V1 ACCEPTANCE & RELEASE BLOCKERS','V1 sign-off','do not tag V1.0'])if(!readinessUi.includes(pattern))throw new Error(`V1 release workspace UI missing ${pattern}`);
const signoffTests=fs.readFileSync('tests/v1-release-signoff-tenant-isolation.test.mjs','utf8');
for(const pattern of ['every frozen acceptance gate','portalPrivacy','tenantTwo','version,2'])if(!signoffTests.includes(pattern))throw new Error(`V1 release sign-off tests missing ${pattern}`);

const portalPrivacy=fs.readFileSync('functions/api/portal/project/[id]/_middleware.js','utf8');
for(const pattern of ['internal_notes','change_note','checksum','investor_pipeline_id','x-akari-portal-privacy','founder-safe'])if(!portalPrivacy.includes(pattern))throw new Error(`Founder portal privacy boundary missing ${pattern}`);
const portalMain=fs.readFileSync('functions/api/portal/project/[id].js','utf8');
for(const forbidden of ['relationship_profiles','relationship_paths','investor_contact_methods','fundraising_data_room_access','workspace_api_keys','webhook_endpoints'])if(portalMain.includes(forbidden))throw new Error(`Founder/client portal must not query internal ${forbidden}`);
const portalPrivacyTests=fs.readFileSync('tests/v1-portal-privacy-tenant-isolation.test.mjs','utf8');
for(const pattern of ['strips internal note and linkage fields','privacy evidence header','does not strip ordinary founder-visible notes'])if(!portalPrivacyTests.includes(pattern))throw new Error(`Founder portal privacy tests missing ${pattern}`);

const headers=fs.readFileSync('public/_headers','utf8');
for(const pattern of ['X-Content-Type-Options: nosniff','X-Frame-Options: DENY',"frame-ancestors 'none'",'/app/*','/portal/*','Cache-Control: no-store'])if(!headers.includes(pattern))throw new Error(`V1 static security headers missing ${pattern}`);

const runtimeJs=fs.readFileSync('public/assets/v1-runtime-hardening.js','utf8');
for(const pattern of ['offline','online','unhandledrejection','Something went wrong','AkariRuntimeStatus','syncModalSafety','openInstitutionalDataRoom','showDataRoomFallback','Data Room is not available for this round yet.','Retry Data Room','dedupeDataRoomLaunches','data-fcr67-nav="data-room"','data-dr72-round','Fundraising data room','rel73-launch'])if(!runtimeJs.includes(pattern))throw new Error(`V1 runtime resilience missing ${pattern}`);
if(runtimeJs.includes("attributeFilter:['class','style','aria-modal']"))throw new Error('V1 modal observer must not watch attributes that syncModalSafety mutates');
const runtimeCss=fs.readFileSync('public/assets/v1-runtime-hardening.css','utf8');
for(const pattern of ['#v1-runtime-status','safe-area-inset-top','@media(max-width:760px)'])if(!runtimeCss.includes(pattern))throw new Error(`V1 runtime resilience styling missing ${pattern}`);
const shell=fs.readFileSync('public/app/index.html','utf8');
for(const asset of ['/assets/v1-runtime-hardening.css?v=1','/assets/v1-runtime-hardening.js?v=1'])if(!shell.includes(asset))throw new Error(`V1 shell missing ${asset}`);
const worker=fs.readFileSync('public/sw.js','utf8');
for(const asset of ['./assets/v1-runtime-hardening.css?v=1','./assets/v1-runtime-hardening.js?v=1'])if(!worker.includes(asset))throw new Error(`V1 service worker missing ${asset}`);
const runtimeBrowser=fs.readFileSync('tests/v1-runtime-hardening.spec.js','utf8');
for(const pattern of ['runtime resilience loads','mobile viewport','document.documentElement.scrollWidth','suppresses the Relationship 360 launcher','Founder Capital Data Room handoff','fails visibly instead of becoming a dead button','Retry Data Room','Fundraising data room'])if(!runtimeBrowser.includes(pattern))throw new Error(`V1 runtime browser acceptance missing ${pattern}`);

const hardening=fs.readFileSync('docs/V1_PRODUCTION_HARDENING.md','utf8');
for(const journey of ['Commercial','Campaign','Fundraising','Platform','Tenant #2 acceptance','Role acceptance matrix','Production sign-off'])if(!hardening.includes(journey))throw new Error(`V1 sign-off contract missing ${journey}`);

const recovery=fs.readFileSync('docs/PRODUCTION_BACKUP_RESTORE.md','utf8');
for(const pattern of ['Time Travel','tenant backup','restore','production'])if(!recovery.toLowerCase().includes(pattern.toLowerCase()))throw new Error(`V1 recovery runbook missing ${pattern}`);

const preflight=fs.readFileSync('scripts/cloudflare-d1-preflight.mjs','utf8');
for(const pattern of ['SELECT 1 AS akari_d1_authorized','7403','Account > D1 > Edit','AKARI_D1_DATABASE_ID'])if(!preflight.includes(pattern))throw new Error(`Cloudflare D1 authorization preflight missing ${pattern}`);

const acceptance=fs.readFileSync('scripts/production-acceptance.mjs','utf8');
for(const pattern of ['release metadata matches deployment','custom-domain app is access protected','custom-domain health endpoint is protected','pages.dev API still fails closed','production security headers','production-acceptance-report.json'])if(!acceptance.includes(pattern))throw new Error(`Production acceptance runner missing ${pattern}`);
const metadata=fs.readFileSync('scripts/write-release-metadata.mjs','utf8');
for(const pattern of ['public/release.json','GITHUB_SHA','generatedAt'])if(!metadata.includes(pattern))throw new Error(`Release metadata generator missing ${pattern}`);
const acceptanceWorkflow=fs.readFileSync('.github/workflows/v1-production-acceptance.yml','utf8');
for(const pattern of ['workflow_dispatch','production-acceptance.mjs','actions/upload-artifact@v4','retention-days: 30'])if(!acceptanceWorkflow.includes(pattern))throw new Error(`Repeatable production acceptance workflow missing ${pattern}`);

const deploy=fs.readFileSync('.github/workflows/deploy-cloudflare-pages.yml','utf8');
for(const pattern of ['wrangler d1 export akari-crm-production','actions/upload-artifact@v4','sha256sum','retention-days: 30'])if(!deploy.includes(pattern))throw new Error(`Pre-migration backup gate missing ${pattern}`);
for(const migration of ['0003_agreements_compliance.sql','0004_founder_onboarding_readiness.sql','0005_data_room_diligence.sql','0006_relationship_intelligence.sql','0007_reporting_attention.sql','0008_saas_workspace_admin.sql','0009_essential_integrations.sql'])if(!deploy.includes(migration))throw new Error(`Production migration chain missing ${migration}`);
for(const pattern of ['https://crmakari.pages.dev','https://crm.akarihouse.com','x-content-type-options: nosniff','/api/system-health'])if(!deploy.includes(pattern))throw new Error(`Production verification missing ${pattern}`);
for(const pattern of ['cloudflare-d1-preflight.mjs','write-release-metadata.mjs','production-acceptance.mjs','production-acceptance-report.json'])if(!deploy.includes(pattern))throw new Error(`R10 deploy gate missing ${pattern}`);

const tests=fs.readFileSync('tests/v1-hardening-tenant-isolation.test.mjs','utf8');
for(const pattern of ['correlation and hardening headers','redacts uncaught server errors','authenticated-tenant scoped','production schema is incomplete'])if(!tests.includes(pattern))throw new Error(`V1 hardening test coverage missing ${pattern}`);

console.log('CRM by AKARI V1 production hardening validation passed');
