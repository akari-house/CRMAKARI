import { json,error,readJson } from '../../lib/response.js';
import { acceptInvitation } from '../../lib/workspace-admin.js';

export async function onRequestPost(context){
  try{
    const identity=context.data?.preAuthIdentity;
    if(!identity?.email)return error('Cloudflare Access identity is required',401);
    const body=await readJson(context.request);
    const result=await acceptInvitation(context.env.DB,identity,{token:body.token});
    return json({accepted:true,...result,redirectUrl:`/app/${encodeURIComponent(result.tenantSlug)}/home`});
  }catch(cause){
    console.error('R75 invitation acceptance failed',cause);
    return error(cause.message||'Invitation could not be accepted',Number(cause.status||500));
  }
}

export async function onRequestGet(){return error('Invitation acceptance requires POST',405);}
