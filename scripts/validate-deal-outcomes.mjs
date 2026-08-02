import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const required = [
  'docs/DEAL_OUTCOMES_R11.md',
  'functions/api/opportunities/[id]/close.js',
  'functions/api/invoices/_middleware.js',
  'functions/lib/revenue-lifecycle.js',
  'public/assets/deal-outcomes-r11.js',
  'public/assets/deal-outcomes-r11.css',
  'tests/deal-outcomes.spec.js',
  'tests/deal-outcomes-tenant-isolation.test.mjs',
];
for (const file of required) await access(file, constants.R_OK);

const closeApi = await readFile('functions/api/opportunities/[id]/close.js', 'utf8');
for (const token of ['DEAL_MODELS', "'PARTNERSHIP'", "'SERVICE'", "'HYBRID'", 'invoiceEligible', "projectLifecycle = invoiceEligible ? 'CLIENT' : 'PARTNER'", 'createAnnouncementPlan', 'PARTNERSHIP_ACTIVATION:', 'PARTNERSHIP_ANNOUNCEMENT_PLAN_CREATED']) {
  if (!closeApi.includes(token)) throw new Error(`Deal close API missing ${token}`);
}

const invoiceMiddleware = await readFile('functions/api/invoices/_middleware.js', 'utf8');
for (const token of ['metadata.invoiceEligible === false', "metadata.dealModel === 'PARTNERSHIP'", 'non-billable and does not require an invoice']) {
  if (!invoiceMiddleware.includes(token)) throw new Error(`Invoice eligibility guard missing ${token}`);
}

const domain = await readFile('functions/lib/revenue-lifecycle.js', 'utf8');
for (const token of ['dealModel', 'invoiceEligible', 'partnershipIncluded', 'announcementRequested', 'valueContribution', 'strategicValue']) {
  if (!domain.includes(token)) throw new Error(`Revenue lifecycle parser missing ${token}`);
}

const ui = await readFile('public/assets/deal-outcomes-r11.js', 'utf8');
for (const token of ['Strategic partnership · no invoice', 'Paid service / campaign · invoice eligible', 'Partnership + paid service', 'createAnnouncementPlan', 'marketingOwnerId', 'designOwnerId', 'No invoice will be created.', 'data-revenue-action="invoice"']) {
  if (!ui.includes(token)) throw new Error(`Deal outcome runtime missing ${token}`);
}

const css = await readFile('public/assets/deal-outcomes-r11.css', 'utf8');
for (const token of ['.deal-outcome-intro', '.deal-announcement-fields', '.deal-no-invoice', '.deal-partnership-callout']) {
  if (!css.includes(token)) throw new Error(`Deal outcome CSS missing ${token}`);
}

const html = await readFile('public/app/index.html', 'utf8');
for (const token of ['/assets/deal-outcomes-r11.css?v=1', '/assets/deal-outcomes-r11.js?v=1']) {
  if (!html.includes(token)) throw new Error(`Protected application shell missing ${token}`);
}

const worker = await readFile('public/sw.js', 'utf8');
for (const token of ['akari-crm-shell-v40', 'app/index.html?runtime=v40', './assets/deal-outcomes-r11.css?v=1', './assets/deal-outcomes-r11.js?v=1']) {
  if (!worker.includes(token)) throw new Error(`Service worker missing ${token}`);
}

const docs = await readFile('docs/DEAL_OUTCOMES_R11.md', 'utf8');
for (const token of ['Strategic partnership', 'Paid service or campaign', 'Hybrid partnership and service', 'Optional social announcement activation', 'No production schema migration']) {
  if (!docs.includes(token)) throw new Error(`Deal outcome documentation missing ${token}`);
}

console.log('AKARI partnership and service deal outcome validation passed');
