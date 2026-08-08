import fs from 'node:fs';

const checks=[
  ['functions/lib/campaign-tracking.js',['CREATOR_POST_STATUSES','reportedReach','reportedEngagements','holdingPosts','rejectedPosts','status === \'APPROVED\'']],
  ['functions/lib/campaign-gtm-tracking.js',['engagements:number(input.engagements','totalEngagements','engagements:0']],
  ['functions/lib/campaign-period-view.js',['CAMPAIGN_PERIOD_VIEWS','THIS_WEEK','PREVIOUS_WEEK','THIS_MONTH','PREVIOUS_MONTH','LIFETIME','CUSTOM','trackedReach','item.engagements']],
  ['functions/api/campaign-period-view/[id].js',['requireTenant','c.tenant_id=? AND c.id=?','buildCampaignPeriodView']],
  ['public/assets/campaign-creator-tracking-r43.js',['Approved posts','HOLDING','REJECTED','data-edit-post','reportedReach']],
  ['public/assets/campaign-gtm-tracking-r44.js',['Engagements','name="engagements"','totalEngagements']],
  ['public/assets/campaign-period-view-r50.js',['This week','Previous week','Campaign lifetime','Custom range','/api/campaign-period-view/']],
  ['public/assets/campaign-period-view-r50.css',['campaign-period-view-r50','period-kpis-r50','period-modal-r50']],
  ['public/assets/delivery-planning-capacity-r39.js',['campaign-period-view-r50.css','campaign-period-view-r50.js']],
];
for(const [file,tokens] of checks){if(!fs.existsSync(file))throw new Error(`Missing ${file}`);const source=fs.readFileSync(file,'utf8');for(const token of tokens)if(!source.includes(token))throw new Error(`${file} missing ${token}`);}
const model=fs.readFileSync('functions/lib/campaign-tracking.js','utf8');
if(!model.includes("reach: approved ? reportedReach : 0"))throw new Error('Non-approved creator reach must be excluded from campaign totals');
if(!model.includes("totalEngagements: approved ? reportedEngagements : 0"))throw new Error('Non-approved creator engagements must be excluded from campaign totals');
const period=fs.readFileSync('functions/lib/campaign-period-view.js','utf8');
if(!period.includes("!post.status || post.status === 'APPROVED'"))throw new Error('Period views must exclude Holding and Rejected creator posts');
const api=fs.readFileSync('functions/api/campaign-period-view/[id].js','utf8');
if(api.includes('onRequestPatch')||api.includes('onRequestPost'))throw new Error('Period view API must remain read-only');
console.log('Campaign measurement integrity and period view validation passed.');
