import fs from 'node:fs';

const checks=[
  ['functions/lib/delivery-partner-portfolio-intelligence.js',['buildDeliveryPartnerPortfolio','buildDeliveryPartnerPerformance','activeCampaigns','completedCampaigns','lifetimeContributors','approvedPosts','approvedReach','approvedEngagements','totalCashSpend','totalTokenAllocation','totalEstimatedTokenCost','totalCampaignCost','averageDeliveryCompletion','averageReachTargetAchievement','averageSorsaScore','averageXScore','lifetimeCpv','lifetimeCpe','holdingRate','rejectionRate','campaignReliability','lastActiveDate','TOP_PERFORMING','RELIABLE','NEEDS_ATTENTION','UNDERPERFORMING','INACTIVE']],
  ['functions/api/delivery-partner-intelligence.js',['requireTenant','WHERE c.tenant_id = ?','WHERE tenant_id = ?','buildDeliveryPartnerPortfolio','DELIVERY_PARTNER_TYPES']],
  ['public/assets/delivery-partner-portfolio-r53.js',['Delivery partner portfolio','Approved creator/KOL posts only','Non-deduplicated','campaign history','CPV','CPE','delivery-partner-intelligence']],
  ['public/assets/delivery-partner-portfolio-r53.css',['partner-portfolio-r53','partner-portfolio-kpis-r53','partner-portfolio-table-r53','partner-rank-r53']],
  ['public/app/index.html',['delivery-partner-portfolio-r53.css','delivery-partner-portfolio-r53.js']],
  ['package.json',['validate-delivery-partner-portfolio.mjs']],
];
for(const [file,tokens] of checks){
  if(!fs.existsSync(file))throw new Error(`Missing ${file}`);
  const source=fs.readFileSync(file,'utf8');
  for(const token of tokens)if(!source.includes(token))throw new Error(`${file} missing ${token}`);
}
const model=fs.readFileSync('functions/lib/delivery-partner-portfolio-intelligence.js','utf8');
if(!model.includes('buildDeliveryPartnerPerformance(campaign.notes, partners)'))throw new Error('Portfolio performance must reuse Approved-only campaign partner performance');
if(model.includes('CREATE TABLE')||model.includes('INSERT INTO')||model.includes('UPDATE partners'))throw new Error('Portfolio partner intelligence must remain analytics-only');
const api=fs.readFileSync('functions/api/delivery-partner-intelligence.js','utf8');
if(api.includes('onRequestPost')||api.includes('onRequestPatch')||api.includes('onRequestDelete'))throw new Error('Portfolio partner intelligence API must remain read-only');
console.log('Delivery partner portfolio intelligence validation passed.');
