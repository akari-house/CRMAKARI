import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const endpoint = read('functions/api/projects/[id]/billing-profile.js');
const workspace = read('functions/api/opportunities/[id]/workspace.js');
const invoices = read('functions/api/invoices/index.js');
const ui = read('public/assets/bd-invoicing-readiness-r31.js');
const css = read('public/assets/bd-invoicing-readiness-r31.css');
const shell = read('public/app/index.html');
const worker = read('public/sw.js');

assert.match(endpoint, /AKARI_CLIENT_BILLING_PROFILE_V1/);
assert.match(endpoint, /WHERE p\.tenant_id = \? AND p\.id = \?/);
assert.match(endpoint, /CLIENT_BILLING_PROFILE_UPDATED/);
assert.match(endpoint, /could not be confirmed after saving/i);
assert.match(endpoint, /requireRole\(auth, EDIT_ROLES\)/);

assert.match(workspace, /commercialReadiness/);
assert.match(workspace, /clientBillingReady/);
assert.match(workspace, /issuerBillingReady/);
assert.match(workspace, /nextActionCode/);
assert.match(workspace, /COMPLETE_CLIENT_BILLING/);
assert.match(workspace, /CREATE_INVOICE/);

assert.match(invoices, /Issued commercial invoices must be linked to a won opportunity/);
assert.match(invoices, /Cancelled engagements cannot be invoiced/);
assert.match(invoices, /partnership engagement is marked as non-billable/i);
assert.match(invoices, /Complete the client billing profile before issuing this invoice/);
assert.match(invoices, /loadClientBillingProfile/);

assert.match(ui, /Commercial readiness/);
assert.match(ui, /Client billing profile/);
assert.match(ui, /saveClientBillingProfile/);
assert.match(ui, /data-client-billing-action/);
assert.match(ui, /payload\.recipient\.vatId/);
assert.match(ui, /payload\.taxMode/);
assert.match(css, /\.bd-readiness-grid/);
assert.match(css, /\.bd-client-billing-form/);

assert.match(shell, /bd-invoicing-readiness-r31\.css\?v=1/);
assert.match(shell, /bd-invoicing-readiness-r31\.js\?v=1/);
assert.match(worker, /akari-crm-shell-v50/);
assert.match(worker, /bd-invoicing-readiness-r31\.js\?v=1/);

console.log('BD invoicing readiness architecture validated.');
