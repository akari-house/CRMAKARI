import { all, first } from './db.js';

export const PORTAL_ACCESS_ACTIVITY='PORTAL_ACCESS_GRANT';
export const PORTAL_ACCESS_MARKER='AKARI_EXTERNAL_PORTAL_ACCESS_V1';
export const PORTAL_TYPES=new Set(['FOUNDER','CLIENT','PARTNER']);

const text=(value,max=5000)=>String(value??'').trim().slice(0,max);
const bool=(value,fallback=false)=>value===undefined||value===null?fallback:Boolean(value);

export function sanitizePortalGrant(input={},existing={}){
  const portalType=PORTAL_TYPES.has(String(input.portalType||existing.portalType||'CLIENT').toUpperCase())?String(input.portalType||existing.portalType||'CLIENT').toUpperCase():'CLIENT';
  return {
    recordType:PORTAL_ACCESS_MARKER,
    version:1,
    userId:text(input.userId||existing.userId,120),
    projectId:text(input.projectId||existing.projectId,120),
    portalType,
    status:String(input.status||existing.status||'ACTIVE').toUpperCase()==='REVOKED'?'REVOKED':'ACTIVE',
    permissions:{
      viewEngagement:bool(input.permissions?.viewEngagement,existing.permissions?.viewEngagement??true),
      viewCampaigns:bool(input.permissions?.viewCampaigns,existing.permissions?.viewCampaigns??true),
      viewFundraising:bool(input.permissions?.viewFundraising,existing.permissions?.viewFundraising??portalType==='FOUNDER'),
      viewDocuments:bool(input.permissions?.viewDocuments,existing.permissions?.viewDocuments??portalType==='FOUNDER'),
      viewReports:bool(input.permissions?.viewReports,existing.permissions?.viewReports??true),
      updateOwnTasks:bool(input.permissions?.updateOwnTasks,existing.permissions?.updateOwnTasks??true),
      answerDiligence:bool(input.permissions?.answerDiligence,existing.permissions?.answerDiligence??portalType==='FOUNDER'),
    },
    note:text(input.note??existing.note,1000),
    updatedAt:text(input.updatedAt||existing.updatedAt,80)||null,
    updatedBy:text(input.updatedBy||existing.updatedBy,120)||null,
  };
}

function parseRow(row){
  try{
    const parsed=JSON.parse(row?.description||'{}');
    if(parsed.recordType!==PORTAL_ACCESS_MARKER)return null;
    return {...sanitizePortalGrant(parsed),activityId:row.id,occurredAt:row.occurred_at||row.created_at};
  }catch{return null;}
}

export async function loadPortalGrants(db,tenantId,userId=null){
  const bindings=[tenantId];
  let userClause='';
  if(userId){userClause='AND user_id = ?';bindings.push(userId);}
  const rows=await all(db,`
    SELECT id,user_id,project_id,description,occurred_at,created_at
    FROM activities
    WHERE tenant_id=? AND activity_type=? ${userClause}
    ORDER BY occurred_at DESC,created_at DESC
    LIMIT 2000
  `,[tenantId,PORTAL_ACCESS_ACTIVITY,...bindings.slice(1)]);
  const latest=new Map();
  for(const row of rows){
    const grant=parseRow(row);if(!grant?.userId||!grant?.projectId)continue;
    const key=`${grant.userId}:${grant.projectId}`;
    if(!latest.has(key))latest.set(key,grant);
  }
  return [...latest.values()];
}

export async function requirePortalProject(db,auth,projectId,permission=null){
  const project=await first(db,'SELECT id,name,category,region,website,lifecycle_status,country FROM projects WHERE tenant_id=? AND id=? LIMIT 1',[auth.tenantId,projectId]);
  if(!project){const cause=new Error('Portal project was not found');cause.status=404;throw cause;}
  if(auth.role!=='EXTERNAL_COLLABORATOR')return {project,grant:null,internal:true};
  const grant=(await loadPortalGrants(db,auth.tenantId,auth.userId)).find(item=>item.projectId===projectId&&item.status==='ACTIVE');
  if(!grant){const cause=new Error('You do not have portal access to this project');cause.status=403;throw cause;}
  if(permission&&!grant.permissions?.[permission]){const cause=new Error('This portal permission is not enabled');cause.status=403;throw cause;}
  return {project,grant,internal:false};
}
