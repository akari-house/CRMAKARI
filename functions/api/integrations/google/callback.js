import { error } from '../../../lib/response.js';
import { requireRole,requireTenant } from '../../../lib/permissions.js';
import { completeGoogleOAuth } from '../../../lib/google-integration.js';

const CONNECT_ROLES=['OWNER','ADMIN','BD_MANAGER','BD_MEMBER'];

export async function onRequestGet(context){
  try{
    const auth=context.data?.auth||{};requireTenant(auth);requireRole(auth,CONNECT_ROLES);
    const url=new URL(context.request.url),oauthError=url.searchParams.get('error');
    if(oauthError){const target=new URL(`/app/${auth.tenantSlug}/settings`,url.origin);target.searchParams.set('google','cancelled');target.searchParams.set('reason',oauthError);return Response.redirect(target.toString(),302);}
    const result=await completeGoogleOAuth(context.env.DB,context.env,auth,{origin:url.origin,state:url.searchParams.get('state')||'',code:url.searchParams.get('code')||''});
    const target=new URL(result.returnPath||`/app/${auth.tenantSlug}/settings`,url.origin);target.searchParams.set('google','connected');target.searchParams.set('account',result.accountEmail);return Response.redirect(target.toString(),302);
  }catch(cause){
    console.error('R76 Google OAuth callback failed',cause);
    const url=new URL(context.request.url),auth=context.data?.auth||{};
    if(auth.tenantSlug){const target=new URL(`/app/${auth.tenantSlug}/settings`,url.origin);target.searchParams.set('google','error');target.searchParams.set('reason',String(cause.message||'Google connection failed').slice(0,180));return Response.redirect(target.toString(),302);}
    return error(cause.message||'Google connection failed',Number(cause.status||500));
  }
}
