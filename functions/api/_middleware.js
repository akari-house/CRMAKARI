const requestIdFor=(request)=>String(request.headers.get('cf-ray')||request.headers.get('x-request-id')||crypto.randomUUID()).slice(0,128);

function hardenResponse(response,requestId){
  const headers=new Headers(response.headers);
  headers.set('x-request-id',requestId);
  headers.set('x-content-type-options','nosniff');
  headers.set('referrer-policy','no-referrer');
  headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
  if(!headers.has('cache-control')&&String(headers.get('content-type')||'').includes('application/json'))headers.set('cache-control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export async function onRequest(context){
  const requestId=requestIdFor(context.request),startedAt=Date.now(),url=new URL(context.request.url);
  context.data.requestId=requestId;
  try{
    const response=await context.next();
    console.log(JSON.stringify({event:'api_request_complete',requestId,method:context.request.method,path:url.pathname,status:response.status,durationMs:Date.now()-startedAt,tenantId:context.data.auth?.tenantId||null,userId:context.data.auth?.userId||null}));
    return hardenResponse(response,requestId);
  }catch(cause){
    console.error(JSON.stringify({event:'api_request_error',requestId,method:context.request.method,path:url.pathname,durationMs:Date.now()-startedAt,tenantId:context.data.auth?.tenantId||null,userId:context.data.auth?.userId||null,error:String(cause?.message||'Unhandled API error').slice(0,500)}));
    return new Response(JSON.stringify({error:'Unexpected server error',requestId}),{status:500,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-request-id':requestId,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()'}});
  }
}
