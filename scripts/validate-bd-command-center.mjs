import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const endpoint = read('functions/api/bd-command-center/index.js');
const ui = read('public/assets/bd-command-center-r32.js');
const css = read('public/assets/bd-command-center-r32.css');
const shell = read('public/app/index.html');
const worker = read('public/sw.js');

assert.match(endpoint, /Business Development permission is required/);
assert.match(endpoint, /const scope = canManage && requestedScope === 'team' \? 'TEAM' : 'MINE'/);
assert.match(endpoint, /leadOwnerClause = scope === 'MINE'/);
assert.match(endpoint, /opportunityOwnerClause = scope === 'MINE'/);
assert.match(endpoint, /WHERE p\.tenant_id = \?/);
assert.match(endpoint, /WHERE o\.tenant_id = \?/);
assert.match(endpoint, /UPPER\(COALESCE\(o\.service_type, ''\)\) NOT LIKE '%FUNDRAISING%'/);
assert.match(endpoint, /rankCommandActions/);
assert.match(endpoint, /CLOSING_THIS_WEEK/);
assert.match(endpoint, /PROPOSAL_FOLLOW_UP/);
assert.match(endpoint, /CLIENT_BILLING/);
assert.match(endpoint, /INVOICE_HANDOFF/);
assert.match(endpoint, /No accountable owner is assigned/);

assert.match(ui, /BD command centre/);
assert.match(ui, /Next best action/);
assert.match(ui, /My priorities/);
assert.match(ui, /Team risks/);
assert.match(ui, /data-revenue-action="open"/);
assert.match(ui, /data-open-lead/);
assert.match(ui, /data-bd-command-refresh/);
assert.match(css, /\.bd-command-next/);
assert.match(css, /\.bd-command-metrics/);
assert.match(css, /@media \(max-width: 620px\)/);

assert.match(shell, /bd-command-center-r32\.css\?v=1/);
assert.match(shell, /bd-command-center-r32\.js\?v=1/);
assert.match(worker, /akari-crm-shell-v51/);
assert.match(worker, /bd-command-center-r32\.js\?v=1/);

console.log('BD daily command centre architecture validated.');
