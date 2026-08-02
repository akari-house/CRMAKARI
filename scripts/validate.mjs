import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const required = [
  'public/index.html','public/app/index.html','public/_redirects','public/uilib.html','public/assets/uilib.css','docs/uilib.md',
  'public/assets/page-upgrades-v1.css','public/assets/page-upgrades-v1.js',
  'public/assets/crm-stabilization-m1.css','public/assets/crm-stabilization-m1.js','public/assets/global-flow-v1.js',
  'public/assets/crm.css','public/assets/crm.js','public/assets/operations-v1.css','public/assets/operations-v1.js',
  'public/assets/lifecycle-v1.css','public/assets/lifecycle-v1.js','public/assets/identity-v1.js',
  'public/assets/bd-workflow-v1.css','public/assets/bd-workflow-v1.js','public/sw.js',
  'functions/_middleware.js','functions/lib/bd-profile.js','functions/api/[[path]].js','functions/api/akari-leads/index.js','functions/api/akari-leads/[id].js',
  'functions/api/contacts/index.js','functions/api/contacts/[id].js','functions/api/activities/index.js','functions/api/projects/[id].js','functions/api/projects/[id]/timeline.js',
  'functions/api/imports/akari-leads/commit.js','functions/api/invoices/index.js','functions/api/invoices/[id].js',
  'functions/api/billing-profile/index.js','functions/api/team/index.js','functions/api/team/[id].js','functions/api/profile/index.js',
  'functions/api/projects/[id]/convert.js','db/migrations/0001_core.sql','README.md','playwright.config.js','tests/ui.spec.js',
  'tests/stabilization-m1.spec.js','tests/global-flow.spec.js','tests/tenant-isolation.test.mjs',
];
for (const file of required) await access(file, constants.R_OK);
async function findJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}
const jsFiles = [...await findJavaScriptFiles('public/assets'),'public/sw.js',...await findJavaScriptFiles('functions'),'playwright.config.js','tests/ui.spec.js','tests/stabilization-m1.spec.js','tests/global-flow.spec.js'];
for (const file of [...new Set(jsFiles)]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  if (result.status !== 0) {
    console.error(`JavaScript syntax check failed: ${file}`);
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
const html = await readFile('public/app/index.html','utf8');
for (const requirement of ['CRM by AKARI','/assets/crm.css?v=','/assets/global-flow-v1.js?v=','/assets/crm.js?v=','/assets/operations-v1.js?v=','/assets/lifecycle-v1.js?v=','/assets/identity-v1.js?v=','/assets/uilib.css?v=','/assets/page-upgrades-v1.css?v=','/assets/page-upgrades-v1.js?v=','/assets/crm-stabilization-m1.css?v=','/assets/crm-stabilization-m1.js?v=','/assets/bd-workflow-v1.css?v=','/assets/bd-workflow-v1.js?v=','id="app"','id="modal-root"','id="toast-root"']) {
  if (!html.includes(requirement)) throw new Error(`The application shell is incomplete: missing ${requirement}`);
}
if (html.includes('./assets/app.js') || html.includes('./assets/interactive-import.js')) throw new Error('Legacy placeholder application scripts must not be loaded by the production entry point');
for (const obsolete of ['runtime-v8.js','runtime-v8-final.js','runtime-v8-compat.js','crm-stabilization-runtime-m1.js','crm-stabilization-runtime-guard-m1.js']) {
  if (html.includes(obsolete)) throw new Error(`Obsolete renderer reference returned: ${obsolete}`);
}
const globalFlow = await readFile('public/assets/global-flow-v1.js','utf8');
for (const requirement of ['history.pushState','ROUTE_PATHS','modal-backdrop','command-backdrop','akariDismissGuard','prepareHistoryNavigation']) {
  if (!globalFlow.includes(requirement)) throw new Error(`Global navigation and modal flow is incomplete: missing ${requirement}`);
}
const redirects = await readFile('public/_redirects','utf8');
for (const route of ['/dashboard','/home','/flows','/day','/leads','/contacts','/opportunities','/fundraising','/campaigns','/partners','/finance','/reports','/team','/settings']) {
  if (!redirects.includes(`${route} /enter-crm 302`)) throw new Error(`Protected legacy CRM route is missing its membership resolver redirect: ${route}`);
}
const uiHtml = await readFile('public/uilib.html','utf8');
for (const requirement of ['AKARI CRM UI Library','./assets/uilib.css','ak-node','ak-inspector','ak-btn--primary']) {
  if (!uiHtml.includes(requirement)) throw new Error(`The UI library reference is incomplete: missing ${requirement}`);
}
const uiDoc = await readFile('docs/uilib.md','utf8');
for (const requirement of ['Design principles','Workflow nodes','Referral attribution','Accessibility','Usage rules']) {
  if (!uiDoc.includes(requirement)) throw new Error(`The UI library documentation is incomplete: missing ${requirement}`);
}
const pageUpgrade = await readFile('public/assets/page-upgrades-v1.js','utf8');
for (const requirement of ['Relationship command centre','Daily execution queue','lead-density','day-focus']) {
  if (!pageUpgrade.includes(requirement)) throw new Error(`Page upgrades are incomplete: missing ${requirement}`);
}
const stabilization = await readFile('public/assets/crm-stabilization-m1.js','utf8');
for (const requirement of ['m1-lead-lifecycle','m1-lead-follow-up','m1-lead-identity','edit-contact-m1','Operational timeline','/timeline']) {
  if (!stabilization.includes(requirement)) throw new Error(`CRM stabilization UI is incomplete: missing ${requirement}`);
}
const bdWorkflow = await readFile('public/assets/bd-workflow-v1.js','utf8');
for (const requirement of ['Organisation type','Total funding raised','Assets under management','Primary point of contact','Book discovery call','/api/invoices','/api/billing-profile']) {
  if (!bdWorkflow.includes(requirement)) throw new Error(`BD workflow UI is incomplete: missing ${requirement}`);
}
const bdProfile = await readFile('functions/lib/bd-profile.js','utf8');
for (const requirement of ['VENTURE_CAPITAL','amountRaised','aumAmount','MEETING_BOOKED','PENDING_INTEGRATION','profileCompleteness']) {
  if (!bdProfile.includes(requirement)) throw new Error(`BD profile model is incomplete: missing ${requirement}`);
}
const serviceWorker = await readFile('public/sw.js','utf8');
for (const requirement of ['./assets/global-flow-v1.js?v=','./assets/crm.js?v=','./assets/operations-v1.js?v=','./assets/lifecycle-v1.js?v=','./assets/identity-v1.js?v=','./assets/uilib.css?v=','./assets/page-upgrades-v1.js?v=','./assets/crm-stabilization-m1.js?v=','./assets/bd-workflow-v1.js?v=','./assets/bd-workflow-v1.css?v=']) {
  if (!serviceWorker.includes(requirement)) throw new Error(`The service-worker shell is missing ${requirement}`);
}
const conversionApi = await readFile('functions/api/projects/[id]/convert.js','utf8');
for (const requirement of ['referral_partner_id','referral_percentage','LEAD_CONVERTED','SERVICE_ENGAGEMENT_V1','contact_x','contact_telegram']) {
  if (!conversionApi.includes(requirement)) throw new Error(`Lead conversion is incomplete: missing ${requirement}`);
}
for (const file of ['functions/api/akari-leads/index.js','functions/api/contacts/index.js','functions/api/contacts/[id].js']) {
  const content = await readFile(file,'utf8');
  for (const requirement of ['normalizeTelegram','normalizeX','X account','Telegram handle']) {
    if (!content.includes(requirement)) throw new Error(`Social identity enforcement is incomplete in ${file}: missing ${requirement}`);
  }
}
const leadApi = await readFile('functions/api/akari-leads/index.js','utf8');
for (const requirement of ['PRIVATE_TENANT_IMPORT','followUp','identity','owner','orderBy','p.tenant_id = ?','buildBdProfile','referralPartnerId','contactFullName']) {
  if (!leadApi.includes(requirement)) throw new Error(`Advanced lead operations are incomplete: missing ${requirement}`);
}
const projectDetail = await readFile('functions/api/projects/[id].js','utf8');
for (const requirement of ['WHERE tenant_id = ? AND id = ?','profileCompleteness','invoiceSummary','canViewFinance']) {
  if (!projectDetail.includes(requirement)) throw new Error(`Tenant-safe BD project detail is incomplete: missing ${requirement}`);
}
const activityApi = await readFile('functions/api/activities/index.js','utf8');
for (const requirement of ['meetingScheduledAt','PENDING_INTEGRATION','MEETING_PREPARATION','tenant_id = ? AND id = ? AND project_id = ?']) {
  if (!activityApi.includes(requirement)) throw new Error(`Meeting booking workflow is incomplete: missing ${requirement}`);
}
const contactPatch = await readFile('functions/api/contacts/[id].js','utf8');
for (const requirement of ['WHERE tenant_id = ? AND id = ?','Referenced project does not belong to this workspace','CONTACT_UPDATED']) {
  if (!contactPatch.includes(requirement)) throw new Error(`Tenant-safe contact editing is incomplete: missing ${requirement}`);
}
const timelineApi = await readFile('functions/api/projects/[id]/timeline.js','utf8');
for (const requirement of ['al.tenant_id = ?','a.tenant_id = ? AND a.project_id = ?','auditVisible']) {
  if (!timelineApi.includes(requirement)) throw new Error(`Tenant-safe project timeline is incomplete: missing ${requirement}`);
}
const repositoryTextFiles = [...required,...jsFiles];
for (const file of [...new Set(repositoryTextFiles)]) {
  const content = await readFile(file,'utf8');
  if (/AKARI_AppSheet_Ready_CRM\.xlsx/i.test(content) && !file.endsWith('crm.js')) throw new Error(`Private workbook name unexpectedly referenced in ${file}`);
}
console.log(`AKARI CRM production validation passed (${[...new Set(jsFiles)].length} JavaScript files checked).`);
