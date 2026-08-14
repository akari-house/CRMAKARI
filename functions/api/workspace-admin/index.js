import { json,error,readJson } from '../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../lib/db.js';
import { requireRole,requireTenant } from '../../lib/permissions.js';
import { addPlatformAdmin,captureUsageSnapshot,createInvitation,isPlatformAdmin,listPlatformAdmins,listPlatformWorkspaces,provisionWorkspace,revokeInvitation,revokePlatformAdmin,updateWorkspaceConfiguration,workspaceSnapshot } from '../../lib/workspace-admin.js';

const ADMIN_ROLES=['OWNER','ADMIN'];
const MISSING_SCHEMA=/no such table.*platform_admins|no such table.*workspace_usage_snapshots/i;

async function ensureSchema(db){
  try{await first(db,'SELECT id FROM platform_admins LIMIT 1');}
  catch(cause){if(MISSING_SCHEMA.test(String(cause?.message||''))){const e=new Error('SaaS Workspace Administration migration 0008 must be applied before R75 is available');e.status=503;throw e;}throw cause;}
}
async function currentTeam(db,tenantId){
  return all(db,`SELECT tm.id membership_id,tm.role,tm.finance_access,tm.status,tm.joined_at,u.id user_id,u.full_name,u.email,u.last_login_at FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? AND tm.status!='REVOKED' ORDER BY CASE tm.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END,u.full_name`,[tenantId]);
}
function originOf(request){const url=new URL(request.url);return url.origin;}

export async function onRequestGet(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth),url=new URL(context.request.url);
    requireRole(auth,ADMIN_ROLES);
    await ensureSchema(context.env.DB);
    const platformAdmin=await isPlatformAdmin(context.env.DB,auth);
    if(url.searchParams.get('scope')==='platform'){
      if(!platformAdmin)return error('Platform administrator access is required',403);
      const [workspaces,admins]=await Promise.all([listPlatformWorkspaces(context.env.DB),listPlatformAdmins(context.env.DB)]);
      return json({platformAdmin:true,workspaces,platformAdmins:admins});
    }
    const [snapshot,team]=await Promise.all([workspaceSnapshot(context.env.DB,tenantId),currentTeam(context.env.DB,tenantId)]);
    return json({...snapshot,team,platformAdmin});
  }catch(cause){
    console.error('R75 workspace administration read failed',cause);
    return error(cause.message||'Workspace administration could not be loaded',Number(cause.status||500));
  }
}

export async function onRequestPost(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);
    requireRole(auth,ADMIN_ROLES);
    await ensureSchema(context.env.DB);
    const body=await readJson(context.request),action=String(body.action||'');

    if(action==='update-workspace'){
      const result=await updateWorkspaceConfiguration(context.env.DB,tenantId,auth.userId,body.workspace||body,{platform:false});
      return json({updated:true,...result});
    }
    if(action==='create-invitation'){
      const invitation=await createInvitation(context.env.DB,tenantId,auth.userId,body,{origin:originOf(context.request)});
      return json({created:true,invitation});
    }
    if(action==='revoke-invitation'){
      const id=String(body.id||'').trim();if(!id)return error('Invitation id is required',422);
      const invitation=await revokeInvitation(context.env.DB,tenantId,auth.userId,id);
      return json({revoked:true,invitation});
    }
    if(action==='capture-usage'){
      const usage=await captureUsageSnapshot(context.env.DB,tenantId,auth.userId);
      return json({captured:true,usage});
    }

    const platformAdmin=await isPlatformAdmin(context.env.DB,auth);
    if(!platformAdmin)return error('Platform administrator access is required',403);

    if(action==='platform-create-workspace'){
      const result=await provisionWorkspace(context.env.DB,auth.userId,body.workspace||body,{origin:originOf(context.request)});
      return json({created:true,...result},201);
    }
    if(action==='platform-update-workspace'){
      const targetTenantId=String(body.tenantId||'').trim();if(!targetTenantId)return error('Workspace id is required',422);
      const result=await updateWorkspaceConfiguration(context.env.DB,targetTenantId,auth.userId,body.workspace||body,{platform:true});
      return json({updated:true,...result});
    }
    if(action==='platform-add-admin'){
      const user=await addPlatformAdmin(context.env.DB,auth.userId,body);
      await run(context.env.DB,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,auth.userId,'PLATFORM_ADMIN_ADDED','USER',user.id,JSON.stringify({email:user.email}),nowIso()]);
      return json({updated:true,user});
    }
    if(action==='platform-revoke-admin'){
      const id=String(body.id||'').trim();if(!id)return error('Platform admin id is required',422);
      const admin=await revokePlatformAdmin(context.env.DB,auth.userId,id);
      await run(context.env.DB,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,auth.userId,'PLATFORM_ADMIN_REVOKED','PLATFORM_ADMIN',id,JSON.stringify({userId:admin.user_id}),nowIso()]);
      return json({updated:true,admin});
    }
    return error('Workspace administration action is not supported',404);
  }catch(cause){
    console.error('R75 workspace administration write failed',cause);
    return error(cause.message||'Workspace administration update failed',Number(cause.status||500));
  }
}
