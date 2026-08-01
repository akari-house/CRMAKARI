import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const required = [
  'public/index.html',
  'public/assets/crm.css',
  'public/assets/crm.js',
  'public/assets/operations-v1.css',
  'public/assets/operations-v1.js',
  'public/assets/lifecycle-v1.css',
  'public/assets/lifecycle-v1.js',
  'public/sw.js',
  'functions/_middleware.js',
  'functions/api/[[path]].js',
  'functions/api/akari-leads/index.js',
  'functions/api/imports/akari-leads/commit.js',
  'functions/api/invoices/index.js',
  'functions/api/invoices/[id].js',
  'functions/api/billing-profile/index.js',
  'functions/api/team/index.js',
  'functions/api/team/[id].js',
  'functions/api/profile/index.js',
  'functions/api/projects/[id]/convert.js',
  'db/migrations/0001_core.sql',
  'README.md',
  'playwright.config.js',
  'tests/ui.spec.js',
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

const jsFiles = [
  ...await findJavaScriptFiles('public/assets'),
  'public/sw.js',
  ...await findJavaScriptFiles('functions'),
  'playwright.config.js',
  'tests/ui.spec.js',
];

for (const file of [...new Set(jsFiles)]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`JavaScript syntax check failed: ${file}`);
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const html = await readFile('public/index.html', 'utf8');
const shellRequirements = [
  'AKARI CRM',
  './assets/crm.css?v=',
  './assets/crm.js?v=',
  './assets/operations-v1.css?v=',
  './assets/operations-v1.js?v=',
  './assets/lifecycle-v1.css?v=',
  './assets/lifecycle-v1.js?v=',
  'id="app"',
  'id="modal-root"',
  'id="toast-root"',
];
for (const requirement of shellRequirements) {
  if (!html.includes(requirement)) throw new Error(`The application shell is incomplete: missing ${requirement}`);
}

if (html.includes('./assets/app.js') || html.includes('./assets/interactive-import.js')) {
  throw new Error('Legacy placeholder application scripts must not be loaded by the production entry point');
}

const serviceWorker = await readFile('public/sw.js', 'utf8');
for (const requirement of ['./assets/crm.js?v=', './assets/crm.css?v=', './assets/operations-v1.js?v=', './assets/operations-v1.css?v=', './assets/lifecycle-v1.js?v=', './assets/lifecycle-v1.css?v=']) {
  if (!serviceWorker.includes(requirement)) throw new Error(`The service-worker shell is missing ${requirement}`);
}

const conversionApi = await readFile('functions/api/projects/[id]/convert.js', 'utf8');
for (const requirement of ['referral_partner_id', 'referral_percentage', 'LEAD_CONVERTED', 'SERVICE_ENGAGEMENT_V1']) {
  if (!conversionApi.includes(requirement)) throw new Error(`Lead conversion is incomplete: missing ${requirement}`);
}

const repositoryTextFiles = [...required, ...jsFiles];
for (const file of [...new Set(repositoryTextFiles)]) {
  const content = await readFile(file, 'utf8');
  if (/AKARI_AppSheet_Ready_CRM\.xlsx/i.test(content) && !file.endsWith('crm.js')) {
    throw new Error(`Private workbook name unexpectedly referenced in ${file}`);
  }
}

console.log(`AKARI CRM production validation passed (${[...new Set(jsFiles)].length} JavaScript files checked).`);
