import fs from 'node:fs';

const checks = [
  ['db/migrations/0001_core.sql',['CREATE TABLE IF NOT EXISTS partners','tenant_id TEXT NOT NULL REFERENCES tenants','partner_type TEXT NOT NULL']],
  ['functions/api/partners/index.js',['SELECT * FROM partners WHERE tenant_id = ?','PARTNER_CREATED']],
  ['functions/api/campaign-tracking/[id].js',['loadDeliveryPartners','agencyPartnerId','Selected delivery partner was not found in this workspace','WHERE tenant_id = ? AND id = ?','deliveryPartners']],
  ['public/assets/campaign-creator-tracking-r43.js',['Agency / delivery partner','name="agencyPartnerId"','reusable Partners directory','Partner-linked','Legacy · needs mapping']],
];
for (const [file,tokens] of checks) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source = fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}
const api = fs.readFileSync('functions/api/campaign-tracking/[id].js','utf8');
if (!api.includes("SELECT id,name,partner_type,status FROM partners WHERE tenant_id = ? AND id = ?")) throw new Error('Delivery partner selection must be tenant scoped');
if (!api.includes('assignment.agencyPartnerId = partnerId || null')) throw new Error('Creator assignment must retain the reusable Partner reference');
const ui = fs.readFileSync('public/assets/campaign-creator-tracking-r43.js','utf8');
if (ui.includes('name="agencyName"')) throw new Error('Agency must not remain a manually entered creator field');
console.log('Campaign reusable delivery partner validation passed.');
