import { json } from '../lib/response.js';
export async function onRequestGet(context){
  const auth=context.data?.auth;
  if(!auth)return json({error:'Authentication required'},401);
  return json({
    current:{tenantId:auth.tenantId,tenantSlug:auth.tenantSlug,tenantName:auth.tenantName,role:auth.role,financeAccess:Boolean(auth.financeAccess)},
    workspaces:Array.isArray(auth.workspaces)?auth.workspaces:[],
  });
}
export async function onRequestPost(){return json({error:'Method not allowed'},405);}
