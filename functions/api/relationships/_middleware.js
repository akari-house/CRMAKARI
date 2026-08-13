import { error } from '../../lib/response.js';

export async function onRequest(context){
  const auth=context.data?.auth;
  if(!auth?.tenantId)return error('Authenticated workspace access is required',401);
  if(auth.role==='EXTERNAL_COLLABORATOR')return error('Relationship Intelligence is internal-only',403);
  return context.next();
}
