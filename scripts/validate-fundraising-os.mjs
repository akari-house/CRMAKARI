import fs from 'node:fs';
const required=['functions/lib/fundraising-os.js','functions/api/fundraising/index.js','public/assets/fundraising-os-r5.js','public/assets/fundraising-os-r5.css','public/assets/fundraising-dataroom-r5.js','public/assets/fundraising-dataroom-r5.css'];
for(const file of required){if(!fs.existsSync(file))throw new Error(`Missing ${file}`);}
const api=fs.readFileSync('functions/api/fundraising/index.js','utf8');
for(const pattern of ['WHERE tenant_id = ?','INVESTOR_PIPELINE','Owner, Admin or BD Manager','upsert-document','upsert-access','upsert-diligence','upsert-question','NDA must be signed'])if(!api.includes(pattern))throw new Error(`Fundraising validation missing: ${pattern}`);
const lib=fs.readFileSync('functions/lib/fundraising-os.js','utf8');
for(const pattern of ['INVESTOR_PIPELINE_STAGES','investorFitScore','sanitizeInvestorPipelineItem','sanitizeDataRoomDocument','sanitizeInvestorAccess','sanitizeDiligenceRequest','sanitizeInvestorQuestion','diligenceSummary'])if(!lib.includes(pattern))throw new Error(`Fundraising model missing: ${pattern}`);
const ui=fs.readFileSync('public/assets/fundraising-dataroom-r5.js','utf8');
for(const pattern of ['Data Room & Diligence','Investor access & NDA','Due diligence requests','Investor questions','upsert-document'])if(!ui.includes(pattern))throw new Error(`Data room UI validation missing: ${pattern}`);
console.log('Fundraising OS validation passed');
