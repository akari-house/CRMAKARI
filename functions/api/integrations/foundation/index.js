import { json,error,readJson } from '../../../lib/response.js';
import { first } from '../../../lib/db.js';
import { requireRole,requireTenant } from '../../../lib/permissions.js';
import { createApiKey,createWebhook,deliverWebhook,listApiKeys,listWebhookDeliveries,listWebhooks,revokeApiKey,updateWebhookStatus,WEBHOOK_EVENTS } from '../../../lib/api-webhooks.js';

const ADMIN_ROLES=['OWNER','ADMIN'];
const MISSING_SCHEMA=/no such table.*workspace_api_keys|no such table.*webhook_endpoints/i;
async function ensureSchema(db){try{await first(db,'SELECT id FROM workspace_api_keys LIMIT 1');}catch(cause){if(MISSING_SCHEMA.test(String(cause?.message||''))){const e=new Error('Essential Integrations migration 0009 must be applied before R76 is available');e.status=503;throw e;}throw cause;}}

export async function onRequestGet(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);requireRole(auth,ADMIN_ROLES);await ensureSchema(context.env.DB);
    const url=new URL(context.request.url),webhookId=url.searchParams.get('webhookId')||'';
    const [apiKeys,webhooks]=await Promise.all([listApiKeys(context.env.DB,tenantId),listWebhooks(context.env.DB,tenantId)]);
    const deliveries=webhookId?await listWebhookDeliveries(context.env.DB,tenantId,webhookId,{limit:url.searchParams.get('limit')||30}):[];
    return json({apiKeys,webhooks,deliveries,webhookEvents:WEBHOOK_EVENTS});
  }catch(cause){console.error('R76 integration foundation read failed',cause);return error(cause.message||'Integration foundation could not be loaded',Number(cause.status||500));}
}

export async function onRequestPost(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);requireRole(auth,ADMIN_ROLES);await ensureSchema(context.env.DB);
    const body=await readJson(context.request),action=String(body.action||'');
    if(action==='create-api-key')return json({created:true,apiKey:await createApiKey(context.env.DB,tenantId,auth.userId,body)},201);
    if(action==='revoke-api-key'){const id=String(body.id||'').trim();if(!id)return error('API key id is required',422);return json({revoked:true,apiKey:await revokeApiKey(context.env.DB,tenantId,auth.userId,id)});}
    if(action==='create-webhook')return json({created:true,webhook:await createWebhook(context.env.DB,context.env,tenantId,auth.userId,body)},201);
    if(action==='update-webhook-status'){const id=String(body.id||'').trim();if(!id)return error('Webhook id is required',422);return json({updated:true,webhook:await updateWebhookStatus(context.env.DB,tenantId,auth.userId,id,body.status)});}
    if(action==='test-webhook'){
      const id=String(body.id||'').trim();if(!id)return error('Webhook id is required',422);
      return json({tested:true,delivery:await deliverWebhook(context.env.DB,context.env,tenantId,id,'integration.test',{message:'CRM by AKARI webhook connection test',sentBy:auth.userId})});
    }
    return error('Integration foundation action is not supported',404);
  }catch(cause){console.error('R76 integration foundation write failed',cause);return error(cause.message||'Integration foundation action failed',Number(cause.status||500));}
}
