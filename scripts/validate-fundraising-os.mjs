import fs from 'node:fs';
const required=['functions/lib/fundraising-os.js','functions/api/fundraising/index.js','public/assets/fundraising-os-r5.js','public/assets/fundraising-os-r5.css'];
for(const file of required){if(!fs.existsSync(file))throw new Error(`Missing ${file}`);}
const api=fs.readFileSync('functions/api/fundraising/index.js','utf8');
for(const pattern of ['WHERE tenant_id = ?','INVESTOR_PIPELINE_CREATED','Owner, Admin or BD Manager','investorProjectId'])if(!api.includes(pattern))throw new Error(`Fundraising validation missing: ${pattern}`);
const lib=fs.readFileSync('functions/lib/fundraising-os.js','utf8');
for(const pattern of ['INVESTOR_PIPELINE_STAGES','investorFitScore','sanitizeInvestorPipelineItem','investorPipelineSummary'])if(!lib.includes(pattern))throw new Error(`Investor pipeline model missing: ${pattern}`);
const ui=fs.readFileSync('public/assets/fundraising-os-r5.js','utf8');
for(const pattern of ['Founder Capital Room','Investor pipeline','Warm intro source','upsert-investor','No duplicate founder or company record'])if(!ui.includes(pattern))throw new Error(`Fundraising UI validation missing: ${pattern}`);
console.log('Fundraising OS validation passed');
