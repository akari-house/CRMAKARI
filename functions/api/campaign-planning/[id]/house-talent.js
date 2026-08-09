import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import { parseCampaignTracking, sanitizeCreatorAssignment } from '../../../lib/campaign-tracking.js';
import { parseCampaignPlanning, buildCampaignPlanSummary, touchPlanning, clearApproval } from '../../../lib/campaign-planning.js';
import { creatorIdentity } from '../../../lib/creator-kol-portfolio-intelligence.js';
import { fetchHouseCreatorFeed, preferredHouseSocial } from '../../../lib/akari-house-creator-directory.js';

const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);

function requireWrite(auth){if(!WRITE_ROLES.has(auth?.role)){const cause=new Error('Campaign planning write permission is required');cause.status=403;throw cause;}}
function requireEditable(planning){
  if(planning.status==='APPROVED'){const cause=new Error('Approved campaign plans must be reopened before editing');cause.status=409;throw cause;}
  if(planning.status==='READY_FOR_APPROVAL'){const cause=new Error('A submitted campaign plan must be reopened before editing');cause.status=409;throw cause;}
}
async function loadCampaign(db,tenantId,id){return first(db,`
  SELECT c.id,c.name,c.status,c.region,c.start_date,c.end_date,c.notes,c.updated_at,c.project_id,p.name AS project_name
  FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id
  WHERE c.tenant_id=? AND c.id=? LIMIT 1
`,[tenantId,id]);}
function handleFromSocial(social,username){
  try{const url=new URL(social?.profileUrl||'');const parts=url.pathname.split('/').filter(Boolean);const candidate=(parts.find((part)=>part.startsWith('@'))||parts.at(-1)||'').replace(/^@+/,'');return candidate?`@${candidate}`:`@${username}`;}catch{return `@${username}`;}
}

export async function onRequestPost(context){
  try{
    const auth=context.data.auth;requireWrite(auth);const tenantId=requireTenant(auth);
    const body=await readJson(context.request);const akariCreatorId=text(body.akariCreatorId,160);
    if(!akariCreatorId)return error('AKARI House Creator identity is required',422);
    if(!context.env.DB)return json({updated:true,demo:true});
    const row=await loadCampaign(context.env.DB,tenantId,context.params.id);
    if(!row)return error('Campaign engagement not found',404);
    const {root,tracking}=parseCampaignTracking(row.notes);
    let planning=parseCampaignPlanning(root);requireEditable(planning);
    const beforeSummary=buildCampaignPlanSummary(tracking,planning);
    if((planning.selections||[]).some((item)=>item.akariCreatorId===akariCreatorId))return error('This AKARI House Creator is already in the campaign plan',409);

    const feed=await fetchHouseCreatorFeed(fetch,{url:context.env.AKARI_HOUSE_CREATOR_FEED_URL||'https://akarihouse.com/api/crm/creators',limit:500});
    const creator=(feed.items||[]).find((item)=>item.akariCreatorId===akariCreatorId);
    if(!creator)return error('AKARI House Creator was not found in the public Creator directory',404);
    const requestedPlatform=planning.platform&&planning.platform!=='ALL'?planning.platform:'ALL';
    const social=preferredHouseSocial(creator,requestedPlatform);
    if(requestedPlatform!=='ALL'&&!social)return error(`This Creator does not have a public ${requestedPlatform} profile in AKARI House`,422);
    if(!social)return error('This Creator does not have a public social profile available for campaign planning',422);

    const candidate=sanitizeCreatorAssignment({
      creatorType:planning.creatorType==='KOL'?'KOL':'CREATOR',
      name:creator.displayName,
      handle:handleFromSocial(social,creator.username),
      platform:social.platform,
      profileUrl:social.profileUrl,
      category:planning.contentType!=='ALL'?planning.contentType:'',
      region:planning.region!=='ALL'?planning.region:creator.location,
      sorsaScore:creator.sorsaScore||0,
      xScore:creator.xScore||0,
      expectedPosts:1,
      expectedReach:0,
      allocatedUsd:0,
      allocatedTokens:0,
      notes:`AKARI House profile: ${creator.profileUrl}. Identity source AKARI_HOUSE; profile/social URLs are PROFILE_PROVIDED. Follower metrics retain their House source metadata and are not used as a guaranteed reach target.`,
    },{},tracking.overview||{});
    const candidateIdentity=creatorIdentity(candidate).key;
    const duplicate=(tracking.creatorAssignments||[]).find((assignment)=>assignment.active!==false&&creatorIdentity(assignment).key===candidateIdentity);
    if(duplicate)return error('This Creator social identity is already in the campaign plan',409);

    candidate.akariCreatorId=creator.akariCreatorId;
    candidate.identitySource='AKARI_HOUSE';
    candidate.profileDataStatus='PROFILE_PROVIDED';
    candidate.houseProfileUrl=creator.profileUrl;
    candidate.houseUsername=creator.username;
    candidate.profileSyncedAt=nowIso();
    tracking.creatorAssignments.push(candidate);
    planning.selections=[...(planning.selections||[]),{
      assignmentId:candidate.id,
      identityKey:candidateIdentity,
      recommendationScore:0,
      recommendationVersion:'AKARI_HOUSE_DIRECTORY_R8.5K',
      akariCreatorId:creator.akariCreatorId,
      identitySource:'AKARI_HOUSE',
      profileDataStatus:'PROFILE_PROVIDED',
      houseProfileUrl:creator.profileUrl,
      houseUsername:creator.username,
      addedAt:nowIso(),addedBy:auth.userId,
    }];
    if(planning.status==='REJECTED')planning=clearApproval(planning);
    planning=touchPlanning(planning,auth);
    tracking.updatedAt=nowIso();tracking.updatedBy=auth.userId;
    const afterSummary=buildCampaignPlanSummary(tracking,planning);
    const notes=JSON.stringify({...root,campaignTracking:tracking,campaignPlanning:planning});
    await run(context.env.DB,'UPDATE campaigns SET notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[notes,nowIso(),auth.userId,tenantId,row.id]);
    await run(context.env.DB,`
      INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at)
      VALUES(?,?,?,'CAMPAIGN_PLAN_HOUSE_TALENT_ADDED','CAMPAIGN_PLAN',?,?,?,?)
    `,[makeId('aud'),tenantId,auth.userId,row.id,JSON.stringify(beforeSummary),JSON.stringify({summary:afterSummary,akariCreatorId:creator.akariCreatorId,assignmentId:candidate.id,profileDataStatus:'PROFILE_PROVIDED'}),nowIso()]);
    return json({updated:true,assignment:candidate,planning,summary:afterSummary,houseCreator:{akariCreatorId:creator.akariCreatorId,username:creator.username,profileUrl:creator.profileUrl,profileDataStatus:'PROFILE_PROVIDED'}});
  }catch(cause){return error(cause.message||'AKARI House Creator could not be added to the campaign plan',Number(cause.status||500));}
}
