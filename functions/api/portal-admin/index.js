import { json,error,readJson } from '../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../lib/db.js';
import { requireTenant,requireRole } from '../../lib/permissions.js';
import { PORTAL_ACCESS_ACTIVITY,PORTAL_ACCESS_MARKER,loadPortalGrants,sanitizePortalGrant } from '../../lib/portal-access.js';

const MANAGE_ROLES=['OWNER','ADMIN'];
const text=(value,max=1000)=>String(value??'').trim().slice(0,max);

async function externalMembers(db,tenantId){return all(db,`
  SELECT tm.user_id,u.full_name,u.email,tm.status
  FROM tenant_memberships tm
  JOIN users u ON u.id=tm.user_id
  WHERE tm.tenant_id=? AND tm.role='EXTERNAL_COLLABORATOR' AND tm.status!='REVOKED' AND u.status!='DELETED'
  ORDER BY u.full_name COLLATE NOCASE
`,[tenantId]);}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;requireRole(auth,MANAGE_ROLES);const tenantId=requireTenant(auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const [members,projects,grants]=await Promise.all([
      externalMembers(context.env.DB,tenantId),
      all(context.env.DB,`SELECT id,name,category,lifecycle_status FROM projects WHERE tenant_id=? ORDER BY name COLLATE NOCASE`,[tenantId]),
      loadPortalGrants(context.env.DB,tenantId),
    ]);
    return json({members:members.map(item=>({userId:item.user_id,fullName:item.full_name,email:item.email,status:item.status})),projects,grants,permissions:{canManage:true},portalPath:`/portal/${encodeURIComponent(auth.tenantSlug||'')}`});
  }catch(cause){return error(cause.message||'Portal access administration could not be loaded',Number(cause.status||500));}
}

export async function onRequestPost(context){
  try{
    const auth=context.data.auth;requireRole(auth,MANAGE_ROLES);const tenantId=requireTenant(auth);const body=await readJson(context.request);
    if(!context.env.DB)return json({updated:true,demo:true});
    const userId=text(body.userId,120),projectId=text(body.projectId,120),action=String(body.action||'GRANT').toUpperCase();
    if(!userId||!projectId)return error('External collaborator and project are required',422);
    const [member,project]=await Promise.all([
      first(context.env.DB,`SELECT tm.user_id,u.full_name,u.email FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? AND tm.user_id=? AND tm.role='EXTERNAL_COLLABORATOR' AND tm.status='ACTIVE' AND u.status='ACTIVE' LIMIT 1`,[tenantId,userId]),
      first(context.env.DB,'SELECT id,name FROM projects WHERE tenant_id=? AND id=? LIMIT 1',[tenantId,projectId]),
    ]);
    if(!member)return error('Selected user is not an active External Collaborator',422);
    if(!project)return error('Selected project was not found',404);
    const existing=(await loadPortalGrants(context.env.DB,tenantId,userId)).find(item=>item.projectId===projectId)||{};
    const now=nowIso();
    const grant=sanitizePortalGrant({
      ...existing,...body,userId,projectId,status:action==='REVOKE'?'REVOKED':'ACTIVE',updatedAt:now,updatedBy:auth.userId,
    },existing);
    const activityId=makeId('act');
    await run(context.env.DB,`
      INSERT INTO activities(id,tenant_id,project_id,user_id,activity_type,subject,description,outcome,occurred_at,next_action,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `,[activityId,tenantId,projectId,auth.userId,PORTAL_ACCESS_ACTIVITY,'External portal access',JSON.stringify(grant),grant.status,now,grant.status==='ACTIVE'?'Portal access active':'Portal access revoked',now]);
    await run(context.env.DB,`
      INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at)
      VALUES(?,?,?,?,?,?,?,?)
    `,[makeId('aud'),tenantId,auth.userId,grant.status==='ACTIVE'?'PORTAL_ACCESS_GRANTED':'PORTAL_ACCESS_REVOKED','PORTAL_ACCESS',`${userId}:${projectId}`,JSON.stringify({recordType:PORTAL_ACCESS_MARKER,userId,projectId,portalType:grant.portalType,permissions:grant.permissions}),now]);
    return json({updated:true,grant:{...grant,activityId},member:{userId,fullName:member.full_name,email:member.email},project});
  }catch(cause){return error(cause.message||'Portal access could not be updated',Number(cause.status||500));}
}
