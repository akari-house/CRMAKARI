import fs from 'node:fs';

const checks=[
  ['functions/lib/campaign-delivery-partner-performance.js',['buildDeliveryPartnerPerformance','approvedPosts','approvedReach','approvedEngagements','costPerView','costPerEngagement','averageSorsaScore','averageXScore','contributorNames']],
  ['functions/api/campaign-delivery-partners/[id].js',['requireTenant','WHERE c.tenant_id=? AND c.id=?','WHERE tenant_id=?','buildDeliveryPartnerPerformance']],
  ['public/assets/campaign-delivery-partner-performance-r52.js',['Agency & partner performance','Approved creator/KOL posts only','CPV','CPE','campaign-delivery-partners']],
  ['public/assets/campaign-delivery-partner-performance-r52.css',['campaign-partner-performance-r52','partner-kpis-r52','partner-table-wrap-r52']],
  ['public/assets/delivery-planning-capacity-r39.js',['campaign-delivery-partner-performance-r52.css','campaign-delivery-partner-performance-r52.js']],
];
for(const [file,tokens] of checks){if(!fs.existsSync(file))throw new Error(`Missing ${file}`);const source=fs.readFileSync(file,'utf8');for(const token of tokens)if(!source.includes(token))throw new Error(`${file} missing ${token}`);}
const model=fs.readFileSync('functions/lib/campaign-delivery-partner-performance.js','utf8');
if(!model.includes("const approved = (post) => !post.status || post.status === 'APPROVED'"))throw new Error('Partner performance must only use Approved posts');
if(!model.includes('const totalCost=item.allocatedUsd+tokenCost'))throw new Error('Partner total cost must include cash and token value');
const api=fs.readFileSync('functions/api/campaign-delivery-partners/[id].js','utf8');
if(api.includes('onRequestPost')||api.includes('onRequestPatch'))throw new Error('Partner performance API must remain read-only');
console.log('Campaign delivery partner performance validation passed.');
