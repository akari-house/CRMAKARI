import fs from 'node:fs';

const required = [
  'functions/lib/fundraising-os.js',
  'functions/lib/fundraising-intelligence.js',
  'functions/api/fundraising/index.js',
  'functions/api/fundraising/intelligence.js',
  'db/migrations/0002_fundraising_intelligence.sql',
  'docs/BACKEND_TECHNICAL_PAPER.md',
  'public/assets/fundraising-os-r5.js',
  'public/assets/fundraising-os-r5.css',
  'public/assets/fundraising-dataroom-r5.js',
  'public/assets/fundraising-dataroom-r5.css',
];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const api = fs.readFileSync('functions/api/fundraising/index.js', 'utf8');
for (const pattern of ['WHERE tenant_id = ?','INVESTOR_PIPELINE','Owner, Admin or BD Manager','upsert-document','upsert-access','upsert-diligence','upsert-question','NDA must be signed']) {
  if (!api.includes(pattern)) throw new Error(`Fundraising validation missing: ${pattern}`);
}

const lib = fs.readFileSync('functions/lib/fundraising-os.js', 'utf8');
for (const pattern of ['INVESTOR_PIPELINE_STAGES','investorFitScore','sanitizeInvestorPipelineItem','sanitizeDataRoomDocument','sanitizeInvestorAccess','sanitizeDiligenceRequest','sanitizeInvestorQuestion','diligenceSummary']) {
  if (!lib.includes(pattern)) throw new Error(`Fundraising model missing: ${pattern}`);
}

const intelligence = fs.readFileSync('functions/lib/fundraising-intelligence.js', 'utf8');
for (const pattern of ['assessInvestorFit','calculateRoundEconomics','legacyCompatibilitySnapshot','LEGACY_COMPATIBILITY','fundFreshness','warmPath','conflict']) {
  if (!intelligence.includes(pattern)) throw new Error(`Fundraising intelligence model missing: ${pattern}`);
}

const intelligenceApi = fs.readFileSync('functions/api/fundraising/intelligence.js', 'utf8');
for (const pattern of ['requireTenant','NORMALIZED_D1','migration 0002','upsert-organisation','upsert-person','upsert-source','upsert-claim','upsert-target','move-target','WHERE tenant_id = ?']) {
  if (!intelligenceApi.includes(pattern)) throw new Error(`Fundraising intelligence API missing: ${pattern}`);
}

const migration = fs.readFileSync('db/migrations/0002_fundraising_intelligence.sql', 'utf8');
for (const table of ['fundraising_rounds','investor_organisations','investor_people','investor_contact_methods','investor_sources','investor_claims','investor_portfolio_evidence','fundraising_targets','fundraising_pipeline_events','fundraising_commitments','fundraising_introduction_paths','fundraising_knowledge_items','fundraising_outreach_drafts']) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`Fundraising migration missing table: ${table}`);
}
for (const invariant of ['tenant_id TEXT NOT NULL','CHECK (allocated_amount <= committed_amount)','SAFE_FOR_OUTREACH','FOUNDER_APPROVED']) {
  if (!migration.includes(invariant)) throw new Error(`Fundraising migration missing invariant: ${invariant}`);
}

const paper = fs.readFileSync('docs/BACKEND_TECHNICAL_PAPER.md', 'utf8');
for (const pattern of ['Fundraising OS 2.0','Evidence before assertion','Explainable matching','Warm introductions are verified workflows','No automatic conversion may run during a Pages deployment']) {
  if (!paper.includes(pattern)) throw new Error(`Backend technical paper missing: ${pattern}`);
}

// R5 remains the legacy compatibility API/model. From R72 onward the interactive
// Data Room is intentionally normalized and the R5 asset is only a bootstrap loader.
const legacyUi = fs.readFileSync('public/assets/fundraising-dataroom-r5.js', 'utf8');
const r72ApiPath = 'functions/api/fundraising/data-room.js';
const r72UiPath = 'public/assets/data-room-diligence-r72.js';
const r72MigrationPath = 'db/migrations/0005_data_room_diligence.sql';
if (fs.existsSync(r72ApiPath) && fs.existsSync(r72UiPath) && fs.existsSync(r72MigrationPath)) {
  const r72Api = fs.readFileSync(r72ApiPath, 'utf8');
  const r72Ui = fs.readFileSync(r72UiPath, 'utf8');
  const r72Migration = fs.readFileSync(r72MigrationPath, 'utf8');
  for (const pattern of ['/assets/data-room-diligence-r72.js?v=1','/assets/data-room-diligence-r72.css?v=1']) {
    if (!legacyUi.includes(pattern)) throw new Error(`R72 compatibility loader missing: ${pattern}`);
  }
  for (const pattern of ['save-document','save-access','save-diligence','record-document-activity','NDA']) {
    if (!r72Api.includes(pattern)) throw new Error(`R72 Data Room API validation missing: ${pattern}`);
  }
  for (const pattern of ['Institutional Data Room','Investor Access','Diligence','Audit']) {
    if (!r72Ui.includes(pattern)) throw new Error(`R72 Data Room UI validation missing: ${pattern}`);
  }
  for (const table of ['fundraising_data_room_documents','fundraising_data_room_document_versions','fundraising_data_room_access','fundraising_diligence_requests','fundraising_data_room_activity']) {
    if (!r72Migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`R72 Data Room migration missing: ${table}`);
  }
} else {
  for (const pattern of ['Data Room & Diligence','Investor access & NDA','Due diligence requests','Investor questions','upsert-document']) {
    if (!legacyUi.includes(pattern)) throw new Error(`Data room UI validation missing: ${pattern}`);
  }
}

console.log('Fundraising OS and normalized intelligence validation passed');
