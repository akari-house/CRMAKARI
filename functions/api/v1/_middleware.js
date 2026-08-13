import { error } from '../../lib/response.js';

export async function onRequest(context){
  const auth=context.data?.auth;
  if(auth?.role!=='API'||!auth?.tenantId)return error('AKARI API authentication is required',401);
  const method=context.request.method.toUpperCase(),required=method==='GET'||method==='HEAD'?'read':'write';
  if(!Array.isArray(auth.scopes)||!auth.scopes.includes(required))return error(`API key requires ${required} scope`,403);
  return context.next();
}
