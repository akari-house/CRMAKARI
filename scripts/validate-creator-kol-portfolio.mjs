import fs from 'node:fs';
import { buildCreatorKolPortfolio, creatorIdentity } from '../functions/lib/creator-kol-portfolio-intelligence.js';

const required = [
  ['functions/lib/creator-kol-portfolio-intelligence.js', ['buildCreatorKolPortfolio','creatorIdentity','TOP_PERFORMING','approvedReach','trackedAllocationValue','bestContentType']],
  ['functions/api/creator-kol-intelligence.js', ['requireTenant','WHERE c.tenant_id = ?','WHERE tenant_id = ?','buildCreatorKolPortfolio']],
  ['public/assets/creator-kol-portfolio-r54.js', ['CREATOR / KOL PORTFOLIO INTELLIGENCE','Approved posts only count toward performance','Tracked allocation','data-portfolio-filter','identityConfidence']],
  ['public/assets/creator-kol-portfolio-r54.css', ['creator-kol-portfolio-r54','creator-kol-table-r54','creator-history-r54']],
  ['public/app/index.html', ['creator-kol-portfolio-r54.css','creator-kol-portfolio-r54.js']],
];
for (const [file,tokens] of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const source=fs.readFileSync(file,'utf8');
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${file} missing ${token}`);
}

const urlIdentity=creatorIdentity({platform:'X',profileUrl:'https://x.com/AkariCreator'});
const handleIdentity=creatorIdentity({platform:'X',handle:'@AkariCreator'});
if (urlIdentity.key !== handleIdentity.key) throw new Error('X profile URL and handle must resolve to the same deterministic contributor identity');
if (creatorIdentity({id:'a1',platform:'X',name:'Creator One'}).key !== creatorIdentity({id:'a2',platform:'X',name:'Creator One'}).key) throw new Error('Name-only fallback grouping must remain deterministic for equivalent assignments');

const campaigns=[
  {
    id:'cam_1',name:'Launch Campaign',project_name:'Project One',status:'COMPLETED',start_date:'2026-01-01',end_date:'2026-01-31',
    notes:JSON.stringify({campaignTracking:{version:3,overview:{currentTokenPrice:0.5},creatorAssignments:[{id:'a1',creatorType:'CREATOR',name:'Creator One',handle:'@AkariCreator',platform:'X',profileUrl:'',agencyPartnerId:'p1',expectedPosts:2,expectedReach:1000,allocatedUsd:100,allocatedTokens:100,sorsaScore:600,xScore:700,active:true}],creatorPosts:[{id:'post1',assignmentId:'a1',platform:'X',dataDate:'2026-01-10',postType:'Thread',url:'https://x.com/AkariCreator/status/1',status:'APPROVED',reach:800,totalEngagements:80},{id:'post2',assignmentId:'a1',platform:'X',dataDate:'2026-01-11',postType:'Post',url:'https://x.com/AkariCreator/status/2',status:'REJECTED',reach:9999,totalEngagements:999}],targets:[],socialUpdates:[]}}),
  },
  {
    id:'cam_2',name:'Growth Campaign',project_name:'Project Two',status:'LIVE',start_date:'2026-02-01',end_date:'2026-02-28',
    notes:JSON.stringify({campaignTracking:{version:3,overview:{tokenListingPrice:1},creatorAssignments:[{id:'a2',creatorType:'KOL',name:'Creator One',handle:'',platform:'X',profileUrl:'https://x.com/AkariCreator',agencyPartnerId:'p2',expectedPosts:1,expectedReach:500,allocatedUsd:50,allocatedTokens:20,sorsaScore:650,xScore:720,active:true}],creatorPosts:[{id:'post3',assignmentId:'a2',platform:'X',dataDate:'2026-02-10',postType:'Thread',url:'https://x.com/AkariCreator/status/3',status:'APPROVED',reach:600,totalEngagements:60},{id:'post4',assignmentId:'a2',platform:'X',dataDate:'2026-02-12',postType:'Video',url:'https://x.com/AkariCreator/status/4',status:'HOLDING',reach:5000,totalEngagements:500}],targets:[],socialUpdates:[]}}),
  },
];
const portfolio=buildCreatorKolPortfolio(campaigns,[{id:'p1',name:'Agency One'},{id:'p2',name:'Agency Two'}],'2026-02-15');
if (portfolio.contributorCount !== 1) throw new Error('Cross-campaign identity grouping failed');
const item=portfolio.items[0];
if (item.campaignCount !== 2 || item.activeCampaigns !== 1) throw new Error('Campaign history aggregation failed');
if (item.approvedPosts !== 2 || item.approvedReach !== 1400 || item.approvedEngagements !== 140) throw new Error('Only Approved posts may count toward lifetime performance');
if (item.rejectedPosts !== 1 || item.holdingPosts !== 1) throw new Error('Quality-state counts are missing');
if (item.creatorType !== 'MIXED') throw new Error('Creator/KOL type history must preserve mixed assignment history');
if (item.agencies.length !== 2) throw new Error('Agency history aggregation failed');
if (item.bestPlatform?.name !== 'X' || item.bestContentType?.name !== 'Thread') throw new Error('Best platform/content intelligence failed');
if (Math.abs(item.trackedAllocationValue - 220) > 0.001) throw new Error('Tracked allocation valuation failed');
if (item.history.length !== 2) throw new Error('Full per-campaign contributor history is missing');

console.log('Creator / KOL portfolio intelligence validation passed.');
