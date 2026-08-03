import { readFile } from 'node:fs/promises';

const files={
  api:await readFile('functions/api/fundraising/outreach.js','utf8'),
  ui:await readFile('public/assets/fundraising-outreach-r20.js','utf8'),
  css:await readFile('public/assets/fundraising-outreach-r20.css','utf8'),
  shell:await readFile('public/app/index.html','utf8'),
  worker:await readFile('public/sw.js','utf8'),
  paper:await readFile('docs/BACKEND_TECHNICAL_PAPER.md','utf8'),
  tenantTest:await readFile('tests/fundraising-outreach-tenant-isolation.test.mjs','utf8'),
  browserTest:await readFile('tests/fundraising-outreach.spec.js','utf8'),
};

for(const requirement of [
  "const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER']",
  "const APPROVAL_ROLES = ['OWNER','ADMIN']",
  'FUNDRAISING_OUTREACH_DRAFT',
  'FUNDRAISING_INVESTOR_MEETING',
  "action === 'save-draft'",
  "action === 'approve-founder'",
  "action === 'approve-akari'",
  "action === 'mark-exported'",
  "action === 'mark-sent'",
  "action === 'record-reply'",
  "action === 'save-meeting'",
  "action === 'complete-meeting'",
  "action === 'create-follow-up-task'",
  'Exact draft content requires both founder and AKARI approval',
  'Approved content changed and requires fresh approval',
  'A manual-send reference or message identifier is required',
  'Internal-only knowledge cannot be used in an outreach draft',
  '[Fundraising Outreach:',
  'WHERE tenant_id=?',
  "body:'[REDACTED]'",
])if(!files.api.includes(requirement))throw new Error(`Fundraising outreach API is incomplete: missing ${requirement}`);

for(const requirement of [
  '/api/fundraising/outreach',
  '/api/ai/propose',
  'Controlled Outreach & Meetings',
  'Human approval controls are active',
  'AKARI never sends the message automatically',
  'AI proposal',
  'Manual draft',
  'Record manual send',
  'Founder approval',
  'AKARI approval',
  'Create investor follow-up task',
  'Complete investor meeting',
])if(!files.ui.includes(requirement))throw new Error(`Fundraising outreach UI is incomplete: missing ${requirement}`);

for(const requirement of ['#fundraising-outreach-root','.fo20-drafts','.fo20-meetings','.fo20-approvals','.fo20-modal','@media(max-width:760px)'])if(!files.css.includes(requirement))throw new Error(`Fundraising outreach styling is incomplete: missing ${requirement}`);

for(const asset of ['/assets/fundraising-outreach-r20.css?v=1','/assets/fundraising-outreach-r20.js?v=1']){
  if(!files.shell.includes(asset))throw new Error(`Protected shell is missing ${asset}`);
  if(!files.worker.includes(asset.replace('/assets/','./assets/')))throw new Error(`Service worker is missing ${asset}`);
}

for(const requirement of ['/api/fundraising/outreach','OpenAI/ChatGPT','Anthropic/Claude','exact-content approval','manual send','meeting brief','activity ledger','Release 6.2D'])if(!files.paper.toLowerCase().includes(requirement.toLowerCase()))throw new Error(`Backend technical paper is incomplete: missing ${requirement}`);

for(const requirement of ['authenticated tenant','reject non-manager roles','another tenant project','resets exact-content approvals','redacts body','Owner/Admin controlled','require both approvals','blocked until a manual send','active member','requires notes outcome and next steps','block duplicate open work'])if(!files.tenantTest.includes(requirement))throw new Error(`Fundraising outreach tenant tests are incomplete: missing ${requirement}`);

for(const requirement of ['AI proposals approvals and manual sending','exact recipient subject body and disclosure policy','ChatGPT or Claude proposal remains unsent','manual send rather than dispatching email','agenda completion outcome and linked follow-up task','avoid mobile page overflow'])if(!files.browserTest.includes(requirement))throw new Error(`Fundraising outreach browser coverage is incomplete: missing ${requirement}`);

console.log('AKARI controlled outreach, exact-content approval, meetings and follow-up validation passed.');
