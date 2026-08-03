import { readFile } from 'node:fs/promises';

const files={
  domain:await readFile('functions/lib/fundraising-closing.js','utf8'),
  api:await readFile('functions/api/fundraising/closing.js','utf8'),
  ui:await readFile('public/assets/fundraising-closing-r5.js','utf8'),
  css:await readFile('public/assets/fundraising-closing-r5.css','utf8'),
  shell:await readFile('public/app/index.html','utf8'),
  worker:await readFile('public/sw.js','utf8'),
  paper:await readFile('docs/FUNDRAISING_CLOSING_R21.md','utf8'),
  tenantTest:await readFile('tests/fundraising-closing-tenant-isolation.test.mjs','utf8'),
  browserTest:await readFile('tests/fundraising-closing.spec.js','utf8'),
};

for(const requirement of [
  "export const CLOSING_WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER']",
  "export const CLOSING_APPROVAL_ROLES = ['OWNER','ADMIN']",
  'NORMALIZED_D1',
  'LEGACY_COMPATIBILITY',
  'FUNDRAISING_FUNDS_RECEIPT',
  'FUNDRAISING_INVESTOR_UPDATE',
  "action==='save-commitment'",
  "action==='record-funds'",
  "action==='cancel-commitment'",
  "action==='close-round'",
  "action==='save-investor-update'",
  "action==='publish-investor-update'",
  "action==='create-follow-up-task'",
  "action==='preview-legacy-migration'",
  'Allocated amount cannot exceed committed amount',
  'Funds received cannot exceed the investor allocation',
  'Every active commitment must be funded or cancelled',
  'Finance permission is required for commitments, allocation, funds and closing',
  '[Fundraising Closing:',
])if(!files.domain.includes(requirement))throw new Error(`Fundraising closing domain is incomplete: missing ${requirement}`);

for(const requirement of [
  'closingSnapshot',
  'executeClosingAction',
  'canFinance',
  'AI is optional. Commitments, closing and investor updates work fully in manual mode.',
  'D1 binding DB is not configured',
])if(!files.api.includes(requirement))throw new Error(`Fundraising closing API is incomplete: missing ${requirement}`);

for(const requirement of [
  '/api/fundraising/closing',
  '/api/fundraising/targeting',
  'Commitments, Closing & Investor Relations',
  'AI is optional and currently not required.',
  'Manual drafting, approvals, commitments, meetings, closing and investor updates remain fully operational.',
  'Funds ledger',
  'Closing checklist',
  'Migration preview',
  'Create investor update',
  'Close round',
  'Record funds',
])if(!files.ui.includes(requirement))throw new Error(`Fundraising closing UI is incomplete: missing ${requirement}`);

for(const requirement of ['.fc-centre','.fc-rounds','.fc-tabs','.fc-checklist','.fc-blockers','.fc-ready','.fc-form','@media(max-width:760px)'])if(!files.css.includes(requirement))throw new Error(`Fundraising closing styling is incomplete: missing ${requirement}`);

for(const asset of ['/assets/fundraising-closing-r5.css?v=38','/assets/fundraising-closing-r5.js?v=38']){
  if(!files.shell.includes(asset))throw new Error(`Protected shell is missing ${asset}`);
  if(!files.worker.includes(asset.replace('/assets/','./assets/')))throw new Error(`Service worker is missing ${asset}`);
}
const cacheVersion=files.worker.match(/const CACHE_NAME='akari-crm-shell-v(\d+)'/)?.[1];
const runtimeVersions=[...files.worker.matchAll(/app\/index\.html\?runtime=v(\d+)/g)].map(match=>match[1]);
if(!cacheVersion||runtimeVersions.length<2||runtimeVersions.some(version=>version!==cacheVersion))throw new Error('Service worker cache and runtime versions must match');

for(const requirement of ['Release 6.2E','Manual-first operating mode','without OpenAI, Anthropic, Kimi','Kimi K2.5','Commitment lifecycle','Closing controls','Funds ledger','Investor relations','No AI provider is required'])if(!files.paper.includes(requirement))throw new Error(`Fundraising closing documentation is incomplete: missing ${requirement}`);

for(const requirement of ['authenticated tenant','reject non-manager roles','require finance access','selected tenant round','above the tenant commitment allocation','fully funded or cancelled','Owner or Admin controlled','active member of the same tenant','Legacy Capital Room remains operational'])if(!files.tenantTest.includes(requirement))throw new Error(`Fundraising closing tenant tests are incomplete: missing ${requirement}`);

for(const requirement of ['operational without an AI provider','allocation and instrument manually','cumulative manual receipt with transaction reference','below-target explanation and final notes','without AI','avoid mobile page overflow'])if(!files.browserTest.includes(requirement))throw new Error(`Fundraising closing browser coverage is incomplete: missing ${requirement}`);

console.log('AKARI manual commitments, funds reconciliation, closing and investor-relations validation passed.');
