import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsPath='public/assets/opportunity-commercial-readiness-r64.js';
const cssPath='public/assets/opportunity-commercial-readiness-r64.css';
const indexPath='public/app/index.html';
for(const path of [jsPath,cssPath,indexPath]) assert.equal(fs.existsSync(path),true,`Missing ${path}`);

const js=fs.readFileSync(jsPath,'utf8');
const css=fs.readFileSync(cssPath,'utf8');
const index=fs.readFileSync(indexPath,'utf8');

assert.match(js,/NEXT REQUIRED ACTION/);
assert.match(js,/Collect outstanding invoice balance/);
assert.match(js,/balance remaining/);
assert.match(js,/View invoices/);
assert.match(js,/data-revenue-action=\"payment\"/);
assert.match(js,/next action/);
assert.match(js,/Referral reward/);
assert.match(js,/Opportunity/);
assert.match(js,/client\.classList\.add\('complete'\)/);
assert.match(css,/overflow-x:hidden/);
assert.match(css,/repeat\(8,minmax\(0,1fr\)\)/);
assert.match(index,/opportunity-commercial-readiness-r64\.css\?v=1/);
assert.match(index,/opportunity-commercial-readiness-r64\.js\?v=1/);
assert.ok(index.indexOf('bd-invoicing-readiness-r31.js') < index.indexOf('opportunity-commercial-readiness-r64.js'),'R64 must load after R31');

console.log('Opportunity Commercial Readiness R64 validation passed.');
