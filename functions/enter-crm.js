import { json } from './lib/response.js';

export async function onRequestGet(context){
  const auth=context.data?.auth;
  if(!auth)return json({error:'Authentication required'},401);
  const slug=String(auth.tenantSlug||'').trim().toLowerCase();
  if(!slug)return json({error:'Your account is not assigned to an active CRM workspace'},403);
  const url=new URL(context.request.url);
  url.pathname=`/app/${encodeURIComponent(slug)}/home`;
  url.search='';
  return Response.redirect(url.toString(),302);
}
