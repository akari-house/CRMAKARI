import fs from 'node:fs';
const read=(file)=>{if(!fs.existsSync(file))throw new Error(`Missing ${file}`);return fs.readFileSync(file,'utf8')};
const required={
 'functions/lib/campaign-closeout-renewal.js':['R69-1','REPORT_CHANGED_AFTER_APPROVAL','settlementCoverageComplete','renewalOpportunityExpected','Approved'],
 'functions/api/campaign-closeout/[id].js':['c.tenant_id=? AND c.id=?','CAMPAIGN_CLOSEOUT_COMPLETED','AKARI_CAMPAIGN_RENEWAL','CAMPAIGN_RENEWAL_OPPORTUNITY_CREATED','/api/campaign-tracking/','COMPLETE_CLOSEOUT'],
 'public/assets/campaign-closeout-renewal-r69.js':['Final Report, Closeout & Renewal','Open client report','Approved-only','COMPLETE_CLOSEOUT','RENEWAL'],
 'public/assets/campaign-closeout-renewal-r69.css':['.ccr69','.ccr69-kpis','.ccr69-modal'],
 'public/app/index.html':['campaign-closeout-renewal-r69.css?v=1','campaign-closeout-renewal-r69.js?v=1'],
};
for(const [file,tokens] of Object.entries(required)){const source=read(file);for(const token of tokens)if(!source.includes(token))throw new Error(`${file} missing ${token}`)}
const api=read('functions/api/campaign-closeout/[id].js');
if(!/WHERE c\.tenant_id=\? AND c\.id=\?/.test(api))throw new Error('R69 campaign lookup must remain tenant scoped');
if(!api.includes("WHERE tenant_id=? AND project_id=? AND description LIKE ?"))throw new Error('Renewal opportunity duplicate lookup must remain tenant and project scoped');
if(!api.includes("JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id"))throw new Error('R69 project join must preserve tenant isolation');
const lib=read('functions/lib/campaign-closeout-renewal.js');
if(!lib.includes("paymentStatus==='PAID'"))throw new Error('R69 must require actual paid settlement coverage');
if(!lib.includes("closeout.renewalRecommendation!=='UNSET'"))throw new Error('R69 must require explicit renewal handoff');
const pkg=JSON.parse(read('package.json'));const parts=String(pkg.version||'0').split('.').map(Number);if(parts[0]!==0||parts[1]<5||(parts[1]===5&&parts[2]<14))throw new Error('R69 requires package version 0.5.14 or newer');
console.log('R69 campaign closeout and renewal validation passed');
