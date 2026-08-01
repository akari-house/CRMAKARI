import fs from 'node:fs';
const required=['functions/lib/fundraising-os.js','functions/api/fundraising/index.js','public/assets/fundraising-os-r5.js','public/assets/fundraising-os-r5.css'];
for(const file of required){if(!fs.existsSync(file))throw new Error(`Missing ${file}`);}
const api=fs.readFileSync('functions/api/fundraising/index.js','utf8');
for(const pattern of ['WHERE tenant_id = ?','FUNDRAISING_CAPITAL_ROOM','Owner, Admin or BD Manager'])if(!api.includes(pattern))throw new Error(`Fundraising validation missing: ${pattern}`);
const ui=fs.readFileSync('public/assets/fundraising-os-r5.js','utf8');
for(const pattern of ['Founder Capital Room','/api/fundraising','No duplicate founder or company record'])if(!ui.includes(pattern))throw new Error(`Fundraising UI validation missing: ${pattern}`);
console.log('Fundraising OS validation passed');
