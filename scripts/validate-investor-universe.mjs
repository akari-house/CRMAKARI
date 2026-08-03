import { readFile } from 'node:fs/promises';

const files = {
  api:await readFile('functions/api/fundraising/universe.js','utf8'),
  ui:await readFile('public/assets/investor-universe-r18.js','utf8'),
  css:await readFile('public/assets/investor-universe-r18.css','utf8'),
  shell:await readFile('public/app/index.html','utf8'),
  worker:await readFile('public/sw.js','utf8'),
  paper:await readFile('docs/BACKEND_TECHNICAL_PAPER.md','utf8'),
  tenantTest:await readFile('tests/investor-universe-tenant-isolation.test.mjs','utf8'),
  browserTest:await readFile('tests/investor-universe.spec.js','utf8'),
};

for (const requirement of [
  "const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER']",
  "storageMode:'NORMALIZED_D1'",
  "storageMode:'LEGACY_COMPATIBILITY'",
  'migration 0002 must be applied',
  "action === 'upsert-organisation'",
  "action === 'upsert-person'",
  "action === 'upsert-contact'",
  "action === 'upsert-source'",
  "action === 'upsert-claim'",
  "action === 'upsert-portfolio'",
  "action === 'review-source'",
  "action === 'review-claim'",
  "action === 'set-conflict'",
  'WHERE tenant_id = ?',
  'duplicateCandidates',
  "action:'REVIEW_REQUIRED'",
  "value:'[REDACTED]'",
  "requireRole(auth, ['OWNER','ADMIN'])",
]) {
  if (!files.api.includes(requirement)) throw new Error(`Investor Universe API is incomplete: missing ${requirement}`);
}

for (const requirement of [
  '/api/fundraising/universe',
  'Investor Universe',
  'Organisations',
  'People',
  'Evidence',
  'Review queue',
  'No automated merge',
  'Private contact recorded',
  'LEGACY COMPATIBILITY',
  'data-iu18-action="new-organisation"',
  'data-iu18-action="review-source"',
]) {
  if (!files.ui.includes(requirement)) throw new Error(`Investor Universe UI is incomplete: missing ${requirement}`);
}

for (const requirement of ['#investor-universe-root','.iu18-organisation-list','.iu18-evidence-layout','.iu18-review-layout','.iu18-modal','@media(max-width:760px)']) {
  if (!files.css.includes(requirement)) throw new Error(`Investor Universe styling is incomplete: missing ${requirement}`);
}

for (const asset of ['/assets/investor-universe-r18.css?v=1','/assets/investor-universe-r18.js?v=1']) {
  if (!files.shell.includes(asset)) throw new Error(`Protected shell is missing ${asset}`);
  if (!files.worker.includes(asset.replace('/assets/','./assets/'))) throw new Error(`Service worker is missing ${asset}`);
}

for (const requirement of ['/api/fundraising/universe','canonical investor','source review','claim review','duplicate','compatibility mode','Release 6.2B']) {
  if (!files.paper.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Backend technical paper is incomplete: missing ${requirement}`);
}

for (const requirement of [
  'authenticated tenant',
  'read-only tenant-scoped Capital Room compatibility view',
  'reject non-manager roles',
  'fail closed until migration 0002',
  'redacted from the general audit record',
  'final portfolio conflict decisions require a review note',
]) {
  if (!files.tenantTest.includes(requirement)) throw new Error(`Investor Universe tenant tests are incomplete: missing ${requirement}`);
}

for (const requirement of [
  'organisations people evidence and review workflow',
  'one canonical investor organisation',
  'without automatic data merging',
  'compatibility mode preserves legacy investors',
  'without mobile page overflow',
]) {
  if (!files.browserTest.includes(requirement)) throw new Error(`Investor Universe browser coverage is incomplete: missing ${requirement}`);
}

console.log('AKARI Investor Universe, evidence ledger and review governance validation passed.');
