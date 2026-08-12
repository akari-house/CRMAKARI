export async function onRequestGet(context){
  const auth=context.data?.auth;
  if(!auth)return new Response('Authentication required',{status:401});
  if(auth.role!=='EXTERNAL_COLLABORATOR')return new Response('External portal access is required',{status:403});
  const url=new URL(context.request.url);const parts=url.pathname.split('/').filter(Boolean);const requestedSlug=String(parts[1]||'').toLowerCase();
  if(!requestedSlug||requestedSlug!==String(auth.tenantSlug||'').toLowerCase())return new Response('You do not have access to this portal workspace',{status:403});
  const shellUrl=new URL('/portal/',url.origin);const response=await context.env.ASSETS.fetch(new Request(shellUrl.toString(),context.request));const headers=new Headers(response.headers);headers.set('cache-control','no-store');headers.set('x-akari-shell','protected-external-portal');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export async function onRequest(context){if(context.request.method==='GET')return onRequestGet(context);return new Response('Method not allowed',{status:405,headers:{allow:'GET'}});}