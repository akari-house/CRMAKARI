import { readFile } from 'node:fs/promises';

const files = {
  api:await readFile('functions/api/fundraising/targeting.js','utf8'),
  boundary:await readFile('functions/api/fundraising/_middleware.js','utf8'),
  ui:await readFile('public/assets/fundraising-targeting-r19.js','utf8'),
  css:await readFile('public/assets/fundraising-targeting-r19.css','utf8'),
  shell:await readFile('public/app/index.html','utf8'),
  worker:await readFile('public/sw.js','utf8'),
  paper:await readFile('docs/BACKEND_TECHNICAL_PAPER.md','utf8'),
  tenantTest:await readFile('tests/fundraising-targeting-tenant-isolation.test.mjs','utf8'),
  browserTest:await readFile('tests/fundraising-targeting.spec.js','utf8'),
};

for (const requirement of [
  "const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER']",
  "const APPROVAL_ROLES = ['OWNER','ADMIN']",
  "action === 'update-target'",
  "action === 'move-target'",
  "action === 'upsert-introduction'",
  "action === 'set-consent'",
  "action === 'set-request-status'",
  "action === 'create-follow-up-task'",
  'Fundraising intelligence migration 0002 must be applied',
  'A verified introduction path with granted consent is required',
  'Verification and granted consent are required',
  'A consent decision note is required',
  '[Fundraising Target:',
  'WHERE tenant_id=?',
  'FUNDRAISING_FOLLOW_UP_TASK_CREATED',
]) {
  if (!files.api.includes(requirement)) throw new Error(`Fundraising targeting API is incomplete: missing ${requirement}`);
}

for (const requirement of [
  "'/api/fundraising/targeting'",
  'LEGACY_STAGE_MAP',
  "SOFT_COMMITMENT:'SOFT_CIRCLE'",
  "CONFIRMED:'COMMITTED'",
]) {
  if (!files.boundary.includes(requirement)) throw new Error(`Fundraising targeting boundary is incomplete: missing ${requirement}`);
}

for (const requirement of [
  '/api/fundraising/targeting',
  'Investor Targeting & Introductions',
  'Expected pipeline',
  'Warm paths',
  'Overdue follow-ups',
  'Ready for introduction',
  'Consent required',
  'Published cheque evidence',
  'Add introduction path',
  'Introduction consent',
  'Introduction request status',
  'Create investor follow-up task',
  'Targeting is visible in compatibility mode',
]) {
  if (!files.ui.includes(requirement)) throw new Error(`Fundraising targeting UI is incomplete: missing ${requirement}`);
}

for (const requirement of ['#fundraising-targeting-root','.ft19-board','.ft19-focus','.ft19-workspace','.ft19-path-list','@media(max-width:760px)']) {
  if (!files.css.includes(requirement)) throw new Error(`Fundraising targeting styling is incomplete: missing ${requirement}`);
}

for (const asset of ['/assets/fundraising-targeting-r19.css?v=1','/assets/fundraising-targeting-r19.js?v=1']) {
  if (!files.shell.includes(asset)) throw new Error(`Protected shell is missing ${asset}`);
  if (!files.worker.includes(asset.replace('/assets/','./assets/'))) throw new Error(`Service worker is missing ${asset}`);
}

for (const requirement of [
  '/api/fundraising/targeting',
  'expected cheque',
  'published cheque evidence',
  'verified introduction path',
  'consent',
  'follow-up task',
  'Release 6.2C',
]) {
  if (!files.paper.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Backend technical paper is incomplete: missing ${requirement}`);
}

for (const requirement of [
  'authenticated tenant',
  'legacy targeting stays read only',
  'reject non-manager roles',
  'fail closed until migration 0002',
  'verified path with granted consent',
  'Owner/Admin authority',
  'cannot bypass verification and consent',
  'prevent duplicate open work',
]) {
  if (!files.tenantTest.includes(requirement)) throw new Error(`Fundraising targeting tenant tests are incomplete: missing ${requirement}`);
}

for (const requirement of [
  'separates expected cheques from published evidence',
  'private expected cheque and accountable next action',
  'verification separately from consent and request status',
  'linked task rather than an untracked reminder',
  'compatibility mode preserves targets',
  'avoid mobile page overflow',
]) {
  if (!files.browserTest.includes(requirement)) throw new Error(`Fundraising targeting browser coverage is incomplete: missing ${requirement}`);
}

console.log('AKARI investor targeting, warm introduction, consent and follow-up validation passed.');
