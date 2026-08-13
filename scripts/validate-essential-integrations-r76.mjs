import fs from 'node:fs';

const required=[
  'db/migrations/0009_essential_integrations.sql',
  'functions/lib/integration-crypto.js',
  'functions/lib/google-integration.js',
  'functions/lib/api-webhooks.js',
  'functions/lib/csv-portability.js',
  'functions/api/integrations/google/index.js',
  'functions/api/integrations/google/callback.js',
  'functions/api/integrations/foundation/index.js',
  'functions/api/integrations/csv/index.js',
  'functions/api/v1/_middleware.js',
  'functions/api/v1/ping.js',
  'functions/api/v1/projects.js',
  'public/assets/integrations-r76.js',
  'public/assets/integrations-r76.css',
  'tests/essential-integrations-r76-tenant-isolation.test.mjs',
  'public/app/index.html',
];
for(const file of required)if(!fs.existsSync(file))throw new Error(`R76 missing ${file}`);

const migration=fs.readFileSync('db/migrations/0009_essential_integrations.sql','utf8');
for(const table of ['workspace_integrations','integration_oauth_states','integration_external_refs','external_document_links','workspace_api_keys','webhook_endpoints','webhook_deliveries'])if(!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`))throw new Error(`R76 migration missing table: ${table}`);

const crypto=fs.readFileSync('functions/lib/integration-crypto.js','utf8');
for(const pattern of ['AES-GCM','INTEGRATION_ENCRYPTION_KEY','sha256','hmacSha256'])if(!crypto.includes(pattern))throw new Error(`R76 encryption foundation missing: ${pattern}`);

const google=fs.readFileSync('functions/lib/google-integration.js','utf8');
for(const pattern of ['gmail.readonly','calendar.events','drive.metadata.readonly','format=metadata','metadataHeaders=From','contactForEmails','GMAIL_MESSAGE','CALENDAR_EVENT','external_document_links'])if(!google.includes(pattern))throw new Error(`R76 Google integration missing: ${pattern}`);
for(const forbidden of ['format=full','message.snippet','payload.body','raw:'])if(google.includes(forbidden))throw new Error(`R76 Gmail privacy boundary violated: ${forbidden}`);

const foundation=fs.readFileSync('functions/lib/api-webhooks.js','utf8');
for(const pattern of ['key_hash','sha256','validateWebhookUrl','https:','public DNS hostname','x-akari-signature','hmacSha256','webhook_deliveries'])if(!foundation.includes(pattern))throw new Error(`R76 API/webhook foundation missing: ${pattern}`);

const middleware=fs.readFileSync('functions/_middleware.js','utf8');
for(const pattern of ['isExternalApiRequest','authenticateApiKey','x-akari-api-key','Bearer','context.data.auth=apiAuth'])if(!middleware.includes(pattern))throw new Error(`R76 API authentication boundary missing: ${pattern}`);

const csv=fs.readFileSync('functions/lib/csv-portability.js','utf8');
for(const pattern of ['CSV_ENTITIES','CSV_IMPORT_ENTITIES','parseCsv','toCsv','PROJECT_LIFECYCLES','tenant_id=?','previewCsvImport','commitCsvImport'])if(!csv.includes(pattern))throw new Error(`R76 CSV portability missing: ${pattern}`);

const ui=fs.readFileSync('public/assets/integrations-r76.js','utf8');
for(const pattern of ['Essential Integrations','Google Workspace','Gmail','Calendar','Google Drive document link','CSV import / export','API keys','Outbound webhooks','Copy this key now','Copy signing secret now'])if(!ui.includes(pattern))throw new Error(`R76 UI missing: ${pattern}`);

const shell=fs.readFileSync('public/app/index.html','utf8');
for(const pattern of ['/assets/integrations-r76.css?v=1','/assets/integrations-r76.js?v=1'])if(!shell.includes(pattern))throw new Error(`R76 shell wiring missing: ${pattern}`);

console.log('R76 Essential Integrations validation passed');
