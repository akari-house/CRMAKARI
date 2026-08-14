import { json } from '../../lib/response.js';

export async function onRequestGet(context){
  const auth=context.data.auth;
  return json({ok:true,apiVersion:'v1',workspace:{id:auth.tenantId,slug:auth.tenantSlug,name:auth.tenantName},scopes:auth.scopes,authenticatedAt:new Date().toISOString()});
}
