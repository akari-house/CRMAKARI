import fs from 'node:fs';
import { buildCampaignTalentRecommendations } from '../functions/lib/campaign-talent-recommendations.js';

const required = [
  ['functions/lib/campaign-talent-recommendations.js', ['buildCampaignTalentRecommendations','recommendationScore','budgetBasket','Approved creator/KOL posts']],
  ['functions/api/campaign-talent-recommendations.js', ['requireTenant','WHERE c.tenant_id = ?','WHERE tenant_id = ?','onRequestGet']],
  ['public/assets/campaign-talent-recommendations-r55.js', ['CAMPAIGN TALENT SELECTION · R8.5E','Generate shortlist','Why this rank','BUDGET-FIT BASKET','Spend without delivery']],
  ['public/assets/campaign-talent-recommendations-r55.css', ['campaign-talent-r55','talent-planner-r55','talent-score-r55','talent-insights-r55']],
];
for (const [file,tokens] of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source=fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}
const apiSource=fs.readFileSync('functions/api/campaign-talent-recommendations.js','utf8');
if (/onRequest(Post|Patch|Put|Delete)/.test(apiSource)) throw new Error('Talent recommendation API must remain GET-only');

const campaigns=[
  {
    id:'cam_a',name:'Alpha Launch',project_name:'Alpha',status:'COMPLETED',start_date:'2026-06-01',end_date:'2026-06-30',
    notes:JSON.stringify({campaignTracking:{version:3,overview:{currentTokenPrice:1},targets:[],socialUpdates:[],creatorAssignments:[
      {id:'a1',creatorType:'CREATOR',name:'Alice',handle:'@alice',platform:'X',agencyPartnerId:'p1',region:'EMEA',expectedPosts:2,expectedReach:1000,allocatedUsd:200,allocatedTokens:0,sorsaScore:700,xScore:760,active:true},
      {id:'b1',creatorType:'KOL',name:'Bob',handle:'@bob',platform:'X',agencyPartnerId:'p2',region:'EMEA',expectedPosts:2,expectedReach:1000,allocatedUsd:800,allocatedTokens:0,sorsaScore:610,xScore:640,active:true},
      {id:'c1',creatorType:'CREATOR',name:'Cara',handle:'@cara',platform:'X',agencyPartnerId:'p2',region:'APAC',expectedPosts:2,expectedReach:1000,allocatedUsd:500,allocatedTokens:0,active:true}
    ],creatorPosts:[
      {id:'ap1',assignmentId:'a1',platform:'X',dataDate:'2026-06-10',postType:'Thread',status:'APPROVED',reach:700,totalEngagements:70},
      {id:'ap2',assignmentId:'a1',platform:'X',dataDate:'2026-06-15',postType:'Thread',status:'APPROVED',reach:500,totalEngagements:50},
      {id:'bp1',assignmentId:'b1',platform:'X',dataDate:'2026-06-11',postType:'Video',status:'APPROVED',reach:400,totalEngagements:20},
      {id:'bp2',assignmentId:'b1',platform:'X',dataDate:'2026-06-12',postType:'Video',status:'REJECTED',reach:50000,totalEngagements:5000},
      {id:'cp1',assignmentId:'c1',platform:'X',dataDate:'2026-06-13',postType:'Thread',status:'HOLDING',reach:30000,totalEngagements:3000}
    ]}}),
  },
  {
    id:'cam_b',name:'Alpha Growth',project_name:'Alpha',status:'LIVE',start_date:'2026-07-01',end_date:'2026-08-31',
    notes:JSON.stringify({campaignTracking:{version:3,overview:{currentTokenPrice:0.5},targets:[],socialUpdates:[],creatorAssignments:[
      {id:'a2',creatorType:'CREATOR',name:'Alice',handle:'',profileUrl:'https://x.com/alice',platform:'X',agencyPartnerId:'p1',region:'EMEA',expectedPosts:1,expectedReach:500,allocatedUsd:150,allocatedTokens:100,sorsaScore:730,xScore:780,active:true}
    ],creatorPosts:[
      {id:'ap3',assignmentId:'a2',platform:'X',dataDate:'2026-07-20',postType:'Thread',status:'APPROVED',reach:650,totalEngagements:65}
    ]}}),
  }
];
const partners=[
  {id:'p1',name:'Agency One',partner_type:'CREATOR_AGENCY',status:'ACTIVE'},
  {id:'p2',name:'Agency Two',partner_type:'KOL_AGENCY',status:'ACTIVE'},
];

const intelligence=buildCampaignTalentRecommendations(campaigns,partners,{objective:'REACH',platform:'X',creatorType:'ALL',contentType:'Thread',region:'EMEA',budgetUsd:1000,limit:10},'2026-08-08');
if (intelligence.criteria.objective !== 'REACH' || intelligence.criteria.platform !== 'X') throw new Error('Recommendation criteria normalization failed');
if (intelligence.eligibleCount !== 1) throw new Error('Platform/content/region eligibility filtering failed');
const top=intelligence.recommendations[0];
if (!top || top.name !== 'Alice') throw new Error('Expected Alice to lead the filtered recommendation shortlist');
if (top.approvedReach !== 1850 || top.approvedPosts !== 3) throw new Error('Approved-only creator evidence aggregation failed');
if (top.platformEvidence?.reach !== 1850 || top.contentEvidence?.reach !== 1850) throw new Error('Filtered Approved evidence is incorrect');
if (!(top.recommendationScore >= 70)) throw new Error('High-performing creator should receive a strong recommendation score');
if (!top.recommendationReasons.some((item)=>item.includes('Proven Approved performance on X'))) throw new Error('Recommendation reasons must explain platform fit');
if (!intelligence.basket.items.length || intelligence.basket.estimatedHistoricalAllocation > 1000) throw new Error('Historical budget-fit basket failed');
if (intelligence.partnerRecommendations[0]?.partnerName !== 'Agency One') throw new Error('Delivery partner match should follow shortlisted talent evidence');
if (!intelligence.insights.spendWithoutDelivery.some((item)=>item.name==='Cara')) throw new Error('Spend-without-delivery risk signal failed');
if (intelligence.recommendations.some((item)=>item.name==='Bob')) throw new Error('Content-type filtering must not use rejected content as evidence');
if (intelligence.methodology.approvedOnly !== true || intelligence.methodology.deterministic !== true) throw new Error('Recommendation methodology contract is missing');

const broad=buildCampaignTalentRecommendations(campaigns,partners,{objective:'BALANCED',platform:'ALL',creatorType:'ALL',contentType:'ALL',region:'ALL',budgetUsd:0},'2026-08-08');
const bob=broad.recommendations.find((item)=>item.name==='Bob');
if (!bob || bob.approvedReach !== 400) throw new Error('Rejected reach must never inflate broad recommendations');
const cara=broad.recommendations.find((item)=>item.name==='Cara');
if (!cara || cara.approvedReach !== 0) throw new Error('Holding reach must never inflate broad recommendations');

console.log('Campaign talent recommendation intelligence validation passed.');
