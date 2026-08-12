import { json,error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { loadPortalGrants } from '../../lib/portal-access.js';

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;const tenantId=requireTenant(auth);
    if(auth.role!=='EXTERNAL_COLLABORATOR')return error('This portal is reserved for external collaborators',403);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const grants=(await loadPortalGrants(context.env.DB,tenantId,auth.userId)).filter(item=>item.status==='ACTIVE');
    if(!grants.length)return json({user:{fullName:auth.fullName,email:auth.email},tenant:{id:tenantId,slug:auth.tenantSlug,name:auth.tenantName},projects:[],empty:true});
    const ids=grants.map(item=>item.projectId);const placeholders=ids.map(()=>'?').join(',');
    const projects=await all(context.env.DB,`SELECT id,name,category,region,country,website,lifecycle_status FROM projects WHERE tenant_id=? AND id IN (${placeholders}) ORDER BY name COLLATE NOCASE`,[tenantId,...ids]);
    const byId=new Map(grants.map(item=>[item.projectId,item]));
    return json({
      user:{userId:auth.userId,fullName:auth.fullName,email:auth.email},
      tenant:{id:tenantId,slug:auth.tenantSlug,name:auth.tenantName},
      projects:projects.map(project=>({
        id:project.id,name:project.name,category:project.category,region:project.region,country:project.country,website:project.website,lifecycleStatus:project.lifecycle_status,
        portalType:byId.get(project.id)?.portalType||'CLIENT',permissions:byId.get(project.id)?.permissions||{},
      })),
      empty:false,
      security:{portalOnly:true,tenantScoped:true,explicitProjectGrants:true},
    });
  }catch(cause){return error(cause.message||'Portal could not be loaded',Number(cause.status||500));}
}
