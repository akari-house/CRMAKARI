import { parseCampaignTracking } from './campaign-tracking.js';
import { parseCampaignPlanning } from './campaign-planning.js';
import { buildCreatorKolPortfolio, creatorIdentity } from './creator-kol-portfolio-intelligence.js';

const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const number=(value)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;};
const HOUSE_TO_CRM_PLATFORM={x:'X',youtube:'YOUTUBE',instagram:'INSTAGRAM',tiktok:'TIKTOK',linkedin:'LINKEDIN',facebook:'FACEBOOK'};
const CRM_PLATFORM_ORDER=['X','YOUTUBE','INSTAGRAM','TIKTOK','LINKEDIN','FACEBOOK'];

function normalizeHandle(value){return text(value).toLowerCase().replace(/^@+/,'').replace(/\/$/,'');}
function normalizeUrl(value){return text(value).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[?#].*$/,'').replace(/\/$/,'');}

function identityKeyForSocial(social){
  const platform=HOUSE_TO_CRM_PLATFORM[String(social?.platform||'').toLowerCase()]||String(social?.platform||'').toUpperCase();
  const url=normalizeUrl(social?.profileUrl);
  if(!url)return null;
  const rules=[
    [/^(?:x\.com|twitter\.com)\/([^/]+)/,'X'],
    [/^instagram\.com\/([^/]+)/,'INSTAGRAM'],
    [/^tiktok\.com\/@?([^/]+)/,'TIKTOK'],
    [/^youtube\.com\/@([^/]+)/,'YOUTUBE'],
    [/^linkedin\.com\/(?:in|company)\/([^/]+)/,'LINKEDIN'],
    [/^facebook\.com\/([^/]+)/,'FACEBOOK'],
  ];
  for(const [pattern,resolved] of rules){const match=url.match(pattern);if(match?.[1])return `social:${resolved}:${normalizeHandle(match[1])}`;}
  return `url:${platform||'OTHER'}:${url}`;
}

export function sanitizeHouseCreatorFeed(payload={}){
  const items=[];
  const seen=new Set();
  for(const raw of Array.isArray(payload?.items)?payload.items:[]){
    const akariCreatorId=text(raw?.akariCreatorId,160);
    const username=text(raw?.username,160);
    const displayName=text(raw?.displayName,300);
    if(!akariCreatorId||!username||!displayName||seen.has(akariCreatorId))continue;
    seen.add(akariCreatorId);
    const socials=(Array.isArray(raw.socials)?raw.socials:[]).map((social)=>({
      platform:HOUSE_TO_CRM_PLATFORM[String(social?.platform||'').toLowerCase()]||text(social?.platform,40).toUpperCase(),
      housePlatform:text(social?.platform,40).toLowerCase(),
      profileUrl:text(social?.profileUrl,800),
      followerCount:number(social?.followerCount),
      followerCountAvailable:social?.followerCount!==null&&social?.followerCount!==undefined,
      countSource:text(social?.countSource,80)||'unavailable',
      syncStatus:text(social?.syncStatus,80)||'manual',
      lastSyncedAt:text(social?.lastSyncedAt,80)||null,
    })).filter((social)=>social.platform&&social.profileUrl);
    socials.sort((a,b)=>CRM_PLATFORM_ORDER.indexOf(a.platform)-CRM_PLATFORM_ORDER.indexOf(b.platform)||a.platform.localeCompare(b.platform));
    items.push({
      akariCreatorId,username,displayName,
      profileUrl:text(raw?.profileUrl,800)||`https://akarihouse.com/profiles/${encodeURIComponent(username)}`,
      avatarUrl:text(raw?.avatarUrl,1000)||null,
      headline:text(raw?.headline,500),location:text(raw?.location,200),websiteUrl:text(raw?.websiteUrl,800),
      expertise:text(raw?.expertise,1000),openTo:text(raw?.openTo,1000),languages:Array.isArray(raw?.languages)?raw.languages.map((item)=>text(item,100)).filter(Boolean).slice(0,10):[],
      creatorVerificationStatus:text(raw?.creatorVerificationStatus,80)||'unverified',
      sorsaScore:raw?.sorsaScore===null||raw?.sorsaScore===undefined?null:number(raw.sorsaScore),sorsaSource:text(raw?.sorsaSource,80)||'unavailable',
      xScore:raw?.xScore===null||raw?.xScore===undefined?null:number(raw.xScore),xScoreSource:text(raw?.xScoreSource,80)||'unavailable',
      socials,identitySource:'AKARI_HOUSE',profileDataStatus:'PROFILE_PROVIDED',
    });
  }
  return {
    source:text(payload?.source,120)||'AKARI_HOUSE_PUBLIC_CREATOR_DIRECTORY',
    schemaVersion:text(payload?.schemaVersion,80)||null,
    publicProfilesOnly:payload?.publicProfilesOnly!==false,
    profileDataStatus:'PROFILE_PROVIDED',
    generatedAt:text(payload?.generatedAt,80)||null,
    items,
  };
}

export async function fetchHouseCreatorFeed(fetchImpl=fetch,{url='https://akarihouse.com/api/crm/creators',limit=500}={}){
  const endpoint=new URL(url);
  endpoint.searchParams.set('limit',String(Math.max(1,Math.min(500,Number(limit)||500))));
  const response=await fetchImpl(endpoint.toString(),{headers:{accept:'application/json','user-agent':'CRM-by-AKARI/0.5.8 CreatorDirectory'}});
  if(!response.ok){const cause=new Error(`AKARI House Creator directory returned ${response.status}`);cause.status=502;throw cause;}
  const payload=await response.json();
  return sanitizeHouseCreatorFeed(payload);
}

function explicitHouseLinks(campaigns=[]){
  const map=new Map();
  for(const campaign of campaigns){
    const {root,tracking}=parseCampaignTracking(campaign.notes);
    const planning=parseCampaignPlanning(root);
    for(const selection of planning.selections||[]){
      const akariCreatorId=text(selection?.akariCreatorId,160);
      const assignment=(tracking.creatorAssignments||[]).find((item)=>item.id===selection?.assignmentId);
      if(!akariCreatorId||!assignment)continue;
      const key=creatorIdentity(assignment).key;
      const keys=map.get(akariCreatorId)||new Set();keys.add(key);map.set(akariCreatorId,keys);
    }
  }
  return map;
}

function candidateIdentityKeys(creator){return new Set((creator.socials||[]).map(identityKeyForSocial).filter(Boolean));}

export function buildAkariHouseCreatorDirectory(houseFeed,campaigns=[],partners=[],today=new Date().toISOString().slice(0,10)){
  const feed=sanitizeHouseCreatorFeed(houseFeed);
  const portfolio=buildCreatorKolPortfolio(campaigns,partners,today);
  const portfolioByKey=new Map((portfolio.items||[]).map((item)=>[item.identityKey,item]));
  const explicit=explicitHouseLinks(campaigns);
  const linkedPortfolioKeys=new Set();
  const items=feed.items.map((creator)=>{
    let linkedKey=null;
    let linkMethod='NONE';
    const explicitKeys=explicit.get(creator.akariCreatorId);
    if(explicitKeys?.size===1){linkedKey=[...explicitKeys][0];linkMethod='AKARI_CREATOR_ID';}
    else if(!explicitKeys?.size){
      const matches=[...candidateIdentityKeys(creator)].filter((key)=>portfolioByKey.has(key));
      const unique=[...new Set(matches)];
      if(unique.length===1){linkedKey=unique[0];linkMethod='EXACT_SOCIAL_IDENTITY';}
      else if(unique.length>1)linkMethod='AMBIGUOUS_SOCIAL_IDENTITY';
    }else linkMethod='AMBIGUOUS_AKARI_CREATOR_ID';
    const history=linkedKey?portfolioByKey.get(linkedKey):null;
    if(linkedKey&&history)linkedPortfolioKeys.add(linkedKey);
    const totalFollowers=(creator.socials||[]).reduce((sum,social)=>sum+number(social.followerCount),0);
    return {
      ...creator,
      totalFollowers,
      platforms:(creator.socials||[]).map((social)=>social.platform),
      crmLink:{linked:Boolean(history),method:history?linkMethod:linkMethod,identityKey:history?linkedKey:null},
      historyState:history?'CRM_HISTORY':'NEW_NO_CAMPAIGN_HISTORY',
      performance:history?{
        classification:history.classification,portfolioScore:history.portfolioScore,campaignCount:history.campaignCount,activeCampaigns:history.activeCampaigns,completedCampaigns:history.completedCampaigns,
        approvedPosts:history.approvedPosts,approvedReach:history.approvedReach,approvedEngagements:history.approvedEngagements,
        averageDeliveryCompletion:history.averageDeliveryCompletion,averageReachTargetAchievement:history.averageReachTargetAchievement,campaignReliability:history.campaignReliability,
        cashAllocation:history.cashAllocation,tokenAllocation:history.tokenAllocation,estimatedTokenValue:history.estimatedTokenValue,trackedAllocationValue:history.trackedAllocationValue,
        lifetimeCpv:history.lifetimeCpv,lifetimeCpe:history.lifetimeCpe,lastActiveDate:history.lastActiveDate,bestPlatform:history.bestPlatform,bestContentType:history.bestContentType,
      }:null,
    };
  });
  const external=(portfolio.items||[]).filter((item)=>!linkedPortfolioKeys.has(item.identityKey)).map((item)=>({
    identityKey:item.identityKey,name:item.name,handle:item.handle,profileUrl:item.profileUrl,creatorType:item.creatorType,platforms:item.platforms,
    identityConfidence:item.identityConfidence,historyState:'EXTERNAL_UNLINKED',classification:item.classification,portfolioScore:item.portfolioScore,
    campaignCount:item.campaignCount,approvedPosts:item.approvedPosts,approvedReach:item.approvedReach,approvedEngagements:item.approvedEngagements,
    trackedAllocationValue:item.trackedAllocationValue,lastActiveDate:item.lastActiveDate,
  }));
  return {
    source:feed.source,schemaVersion:feed.schemaVersion,generatedAt:feed.generatedAt,profileDataStatus:'PROFILE_PROVIDED',publicProfilesOnly:feed.publicProfilesOnly,
    creatorCount:items.length,withCrmHistory:items.filter((item)=>item.historyState==='CRM_HISTORY').length,newToCrm:items.filter((item)=>item.historyState==='NEW_NO_CAMPAIGN_HISTORY').length,
    externalUnlinkedCount:external.length,items,external,
  };
}

export function preferredHouseSocial(creator,preferredPlatform='ALL'){
  const socials=creator?.socials||[];
  if(preferredPlatform&&preferredPlatform!=='ALL')return socials.find((social)=>social.platform===preferredPlatform)||null;
  return socials.find((social)=>social.platform==='X')||socials[0]||null;
}
