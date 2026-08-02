import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const required = [
  'docs/LAUNCH_HARDENING_R13.md',
  'functions/api/fundraising/index.js',
  'public/assets/launch-hardening-r13.css',
  'public/assets/launch-hardening-r13.js',
  'public/assets/work-os-interaction-stability-r13.js',
  'tests/fundraising-schema-compat-tenant-isolation.test.mjs',
  'tests/launch-hardening.spec.js',
];
for (const file of required) await access(file, constants.R_OK);

const fundraising = await readFile('functions/api/fundraising/index.js', 'utf8');
for (const token of ['readBdProfile', 'legacy_import_data', 'funding_status', 'funding_amount', 'technicalFailure', 'Fundraising workspace could not be loaded']) {
  if (!fundraising.includes(token)) throw new Error(`Fundraising launch compatibility missing ${token}`);
}
if (/SELECT[^;]*\bfunding_stage\b/i.test(fundraising)) throw new Error('Fundraising still selects the missing projects.funding_stage column');
if (/SELECT[^;]*\btotal_funds_raised\b/i.test(fundraising)) throw new Error('Fundraising still selects the missing projects.total_funds_raised column');

const css = await readFile('public/assets/launch-hardening-r13.css', 'utf8');
for (const token of ['.ops-billing-profile-modal', '.ops-billing-section', '#modal-root .ak-modal-standard .field', 'grid-template-rows: auto minmax(0, 1fr) auto', 'overflow: auto']) {
  if (!css.includes(token)) throw new Error(`Launch hardening CSS missing ${token}`);
}

const runtime = await readFile('public/assets/launch-hardening-r13.js', 'utf8');
for (const token of ['enhanceBillingModal', 'Organisation billing details', 'Organisation identity', 'Address and contact', 'Tax and payment details', 'Invoice defaults', 'patchToastRoot', 'friendlyMessage', 'maxVisibleToasts']) {
  if (!runtime.includes(token)) throw new Error(`Launch hardening runtime missing ${token}`);
}

const stability = await readFile('public/assets/work-os-interaction-stability-r13.js', 'utf8');
for (const token of ['stableWorkFetch', 'waitForWorkIdle', 'work-is-dragging', "url.searchParams.get('full') === '1'", 'quietWindowMs']) {
  if (!stability.includes(token)) throw new Error(`Work OS interaction stability missing ${token}`);
}

const html = await readFile('public/app/index.html', 'utf8');
for (const token of ['/assets/launch-hardening-r13.css?v=1', '/assets/work-os-interaction-stability-r13.js?v=1', '/assets/launch-hardening-r13.js?v=1']) {
  if (!html.includes(token)) throw new Error(`Protected shell missing ${token}`);
}
if (html.indexOf('/assets/work-os-interaction-stability-r13.js?v=1') > html.indexOf('/assets/my-day-canonical-r8.js?v=1')) {
  throw new Error('Work OS stability guard must load before the progressive My Day runtime');
}

const worker = await readFile('public/sw.js', 'utf8');
for (const token of ['./assets/launch-hardening-r13.css?v=1', './assets/work-os-interaction-stability-r13.js?v=1', './assets/launch-hardening-r13.js?v=1']) {
  if (!worker.includes(token)) throw new Error(`Service worker missing ${token}`);
}

const docs = await readFile('docs/LAUNCH_HARDENING_R13.md', 'utf8');
for (const token of ['Billing profile', 'Fundraising', 'Shared launch protection', 'No seed data']) {
  if (!docs.includes(token)) throw new Error(`Launch hardening documentation missing ${token}`);
}

console.log('AKARI CRM launch hardening validation passed');
