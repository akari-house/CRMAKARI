import { readFile } from 'node:fs/promises';

const files={
  domain:await readFile('functions/lib/fundraising-strategy.js','utf8'),
  api:await readFile('functions/api/fundraising/strategy.js','utf8'),
  ui:await readFile('public/assets/fundraising-strategy-r22.js','utf8'),
  css:await readFile('public/assets/fundraising-strategy-r22.css','utf8'),
  shell:await readFile('public/app/index.html','utf8'),
  worker:await readFile('public/sw.js','utf8'),
  paper:await readFile('docs/FUNDRAISING_STRATEGY_R22.md','utf8'),
  tenantTest:await readFile('tests/fundraising-strategy-tenant-isolation.test.mjs','utf8'),
  browserTest:await readFile('tests/fundraising-strategy.spec.js','utf8'),
};

for(const requirement of [
  "export const STRATEGY_WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER']",
  "export const STRATEGY_APPROVAL_ROLES = ['OWNER','ADMIN']",
  'FUNDRAISING_TERM_SHEET',
  'FUNDRAISING_CAP_TABLE_SCENARIO',
  'FUNDRAISING_STRATEGIC_FUNDING',
  'termRiskFlags',
  'calculateCapScenario',
  'Stakeholder ownership before financing cannot exceed 100%',
  'Owner or Admin finance permission is required for a final term-sheet decision',
  'Owner or Admin finance permission is required to approve an ownership scenario',
  'Owner or Admin finance permission is required to recognise a funding award',
  '[Strategic Funding:',
  'WHERE tenant_id=?',
])if(!files.domain.includes(requirement))throw new Error(`Fundraising strategy domain is incomplete: missing ${requirement}`);

for(const requirement of [
  'strategySnapshot',
  "action === 'save-term-sheet'",
  "action === 'decide-term-sheet'",
  "action === 'save-cap-table'",
  "action === 'approve-cap-table'",
  "action === 'save-strategic-funding'",
  "action === 'recognize-funding-award'",
  "action === 'create-funding-task'",
  'AI is optional. Terms, ownership scenarios and strategic funding work fully in manual mode.',
  'AKARI records and compares terms but does not provide legal advice.',
])if(!files.api.includes(requirement))throw new Error(`Fundraising strategy API is incomplete: missing ${requirement}`);

for(const requirement of [
  '/api/fundraising/strategy',
  '/api/fundraising/targeting',
  'Terms, Ownership & Strategic Funding',
  'No AI or third-party funding API is required.',
  'Planning and comparison only.',
  'Term sheets',
  'Ownership scenarios',
  'Grants & strategic funding',
  'TERM COMPARISON · NOT LEGAL ADVICE',
  'Planning model only',
  'Create task',
])if(!files.ui.includes(requirement))throw new Error(`Fundraising strategy UI is incomplete: missing ${requirement}`);

for(const requirement of ['#fundraising-strategy-root','.fs22-head','.fs22-rounds','.fs22-tabs','.fs22-comparison','.fs22-ownership-table','.fs22-form','@media(max-width:760px)'])if(!files.css.includes(requirement))throw new Error(`Fundraising strategy styling is incomplete: missing ${requirement}`);

for(const asset of ['/assets/fundraising-strategy-r22.css?v=1','/assets/fundraising-strategy-r22.js?v=1']){
  if(!files.shell.includes(asset))throw new Error(`Protected shell is missing ${asset}`);
  if(!files.worker.includes(asset.replace('/assets/','./assets/')))throw new Error(`Service worker is missing ${asset}`);
}
const cacheVersion=files.worker.match(/const CACHE_NAME='akari-crm-shell-v(\d+)'/)?.[1];
const runtimeVersions=[...files.worker.matchAll(/app\/index\.html\?runtime=v(\d+)/g)].map(match=>match[1]);
if(!cacheVersion||runtimeVersions.length<2||runtimeVersions.some(version=>version!==cacheVersion))throw new Error('Service worker cache and runtime versions must match');

for(const requirement of ['Release 6.2F','Manual-first operating mode','Term-sheet comparison','Lightweight ownership scenarios','Grants and strategic funding','No production schema migration is required','No AI provider or API key is required'])if(!files.paper.includes(requirement))throw new Error(`Fundraising strategy documentation is incomplete: missing ${requirement}`);

for(const requirement of ['authenticated tenant','reject non-manager roles','require Owner Admin finance permission before database access','selected tenant round','above one hundred percent','active member of the same tenant','before an amount is recorded','prevents duplicate open work'])if(!files.tenantTest.includes(requirement))throw new Error(`Fundraising strategy tenant tests are incomplete: missing ${requirement}`);

for(const requirement of ['manual-first and exposes all remaining modules','economics rights and document reference','without presenting legal advice','stakeholder percentages for dilution calculation','Work OS follow-up are manual','avoid mobile page overflow'])if(!files.browserTest.includes(requirement))throw new Error(`Fundraising strategy browser coverage is incomplete: missing ${requirement}`);

console.log('AKARI term-sheet comparison, ownership scenarios and strategic-funding validation passed.');
