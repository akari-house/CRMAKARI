import { error } from '../../lib/response.js';

export async function onRequest(context){
  const auth=context.data?.auth;
  if(auth?.role!=='API'||!auth?.tenantId)return error('AKARI API authentication is required',401);
  const path=new URL(context.request.url).pathname;
  if(path==='/api/v1/house-nda-status'){
    if(context.request.method.toUpperCase()!=='POST')return error('House NDA status requires POST',405);
    if(!Array.isArray(auth.scopes)||!auth.scopes.includes('house_nda_read'))return error('API key requires house_nda_read scope',403);
    return context.next();
  }
  const method=context.request.method.toUpperCase(),required=method==='GET'||method==='HEAD'?'read':'write';
  if(!Array.isArray(auth.scopes)||!auth.scopes.includes(required))return error(`API key requires ${required} scope`,403);
  return context.next();
}
