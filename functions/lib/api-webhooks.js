import { all,first,run,makeId,nowIso } from './db.js';
import { decryptSecret,encryptSecret,hmacSha256,randomToken,sha256 } from './integration-crypto.js';

export const API_SCOPES=Object.freeze(['read','write','webhooks']);
export const WEBHOOK_EVENTS=Object.freeze(['integration.test','project.updated','opportunity.updated','campaign.updated','fundraising.updated','payment.updated','agreement.updated']);
const text=(value,max=1000)=>String(value??'').trim().slice(0,max);
const safeJson=(value,fallback=[])=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)?parsed:fallback;}catch{return fallback;}};
const addDays=days=>new Date(Date.now()+days*86400000).toISOString();

export function normalizeApiScopes(value){
  const source=Array.isArray(value)?value:[];
  const scopes=[...new Set(source.map(item=>String(item||'').toLowerCase()).filter(item=>API_SCOPES.includes(item)))];
  return scopes.length?scopes:['read'];
}
export function normalizeWebhookEvents(value){
  const source=Array.isArray(value)?value:[];
  return [...new Set(source.map(item=>String(item||'').toLowerCase()).filter(item=>WEBHOOK_EVENTS.includes(item)))];
}
export function validateWebhookUrl(value){
  let url;try{url=new URL(String(value||''));}catch{throw Object.assign(new Error('Webhook URL is invalid'),{status:422});}
  if(url.protocol!=='https:')throw Object.assign(new Error('Webhook URL must use HTTPS'),{status:422});
  const host=url.hostname.toLowerCase();
  if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.includes(':'))throw Object.assign(new Error('Webhook URL must use a public DNS hostname'),{status:422});
  if(url.username||url.password)throw Object.assign(new Error('Webhook URL cannot contain credentials'),{status:422});
  url.hash='';return url.toString();
}

export async function createApiKey(db,tenantId,userId,input){
  const name=text(input.name,160);if(!name)throw Object.assign(new Error('API key name is required'),{status:422});
  const rawKey=randomToken('ak_live'),hash=await sha256(rawKey),prefix=rawKey.slice(0,16),scopes=normalizeApiScopes(input.scopes),stamp=nowIso(),expiresAt=input.expiresInDays?addDays(Math.min(365,Math.max(1,Number(input.expiresInDays)))):null,id=makeId('apikey');
  await run(db,`INSERT INTO workspace_api_keys (id,tenant_id,name,key_prefix,key_hash,scopes_json,status,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?)`,[id,tenantId,name,prefix,hash,JSON.stringify(scopes),expiresAt,userId,stamp]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'API_KEY_CREATED','WORKSPACE_API_KEY',id,JSON.stringify({name,prefix,scopes,expiresAt}),stamp]);
  return{id,name,prefix,scopes,expiresAt,key:rawKey};
}

export async function listApiKeys(db,tenantId){return all(db,`SELECT id,name,key_prefix,scopes_json,status,expires_at,last_used_at,created_by,created_at,revoked_at FROM workspace_api_keys WHERE tenant_id=? ORDER BY created_at DESC`,[tenantId]);}

export async function revokeApiKey(db,tenantId,userId,id){
  const existing=await first(db,`SELECT id,name,key_prefix,status FROM workspace_api_keys WHERE tenant_id=? AND id=?`,[tenantId,id]);if(!existing)throw Object.assign(new Error('API key not found'),{status:404});
  const stamp=nowIso();await run(db,`UPDATE workspace_api_keys SET status='REVOKED',revoked_at=? WHERE tenant_id=? AND id=?`,[stamp,tenantId,id]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'API_KEY_REVOKED','WORKSPACE_API_KEY',id,JSON.stringify({prefix:existing.key_prefix}),stamp]);return existing;
}

export async function authenticateApiKey(db,rawKey){
  if(!rawKey||!String(rawKey).startsWith('ak_live_'))return null;
  const hash=await sha256(rawKey),row=await first(db,`SELECT k.*,t.slug tenant_slug,t.name tenant_name,t.status tenant_status FROM workspace_api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE k.key_hash=? AND k.status='ACTIVE'`,[hash]);
  if(!row||!['ACTIVE','TRIAL'].includes(row.tenant_status))return null;
  if(row.expires_at&&Date.parse(row.expires_at)<=Date.now())return null;
  await run(db,`UPDATE workspace_api_keys SET last_used_at=? WHERE id=? AND tenant_id=?`,[nowIso(),row.id,row.tenant_id]);
  return{apiKeyId:row.id,tenantId:row.tenant_id,tenantSlug:row.tenant_slug,tenantName:row.tenant_name,role:'API',financeAccess:false,scopes:normalizeApiScopes(safeJson(row.scopes_json,[])),modules:[]};
}

export async function createWebhook(db,env,tenantId,userId,input){
  const name=text(input.name,160),endpointUrl=validateWebhookUrl(input.endpointUrl);if(!name)throw Object.assign(new Error('Webhook name is required'),{status:422});
  const events=normalizeWebhookEvents(input.eventTypes);if(!events.length)throw Object.assign(new Error('Choose at least one webhook event'),{status:422});
  const rawSecret=randomToken('whsec'),encrypted=await encryptSecret(env.INTEGRATION_ENCRYPTION_KEY,rawSecret),stamp=nowIso(),id=makeId('webhook');
  await run(db,`INSERT INTO webhook_endpoints (id,tenant_id,name,endpoint_url,event_types_json,signing_secret_ciphertext,signing_secret_iv,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,[id,tenantId,name,endpointUrl,JSON.stringify(events),encrypted.ciphertext,encrypted.iv,userId,stamp,stamp]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'WEBHOOK_CREATED','WEBHOOK_ENDPOINT',id,JSON.stringify({name,endpointUrl,eventTypes:events}),stamp]);
  return{id,name,endpointUrl,eventTypes:events,status:'ACTIVE',signingSecret:rawSecret};
}
export async function listWebhooks(db,tenantId){return all(db,`SELECT id,name,endpoint_url,event_types_json,status,failure_count,last_delivered_at,last_error,created_by,created_at,updated_at FROM webhook_endpoints WHERE tenant_id=? AND status!='REVOKED' ORDER BY created_at DESC`,[tenantId]);}
export async function updateWebhookStatus(db,tenantId,userId,id,status){
  const normalized=String(status||'').toUpperCase();if(!['ACTIVE','PAUSED','REVOKED'].includes(normalized))throw Object.assign(new Error('Webhook status is invalid'),{status:422});
  const existing=await first(db,`SELECT id,name,status FROM webhook_endpoints WHERE tenant_id=? AND id=?`,[tenantId,id]);if(!existing)throw Object.assign(new Error('Webhook not found'),{status:404});
  await run(db,`UPDATE webhook_endpoints SET status=?,updated_at=? WHERE tenant_id=? AND id=?`,[normalized,nowIso(),tenantId,id]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'WEBHOOK_STATUS_UPDATED','WEBHOOK_ENDPOINT',id,JSON.stringify({status:existing.status}),JSON.stringify({status:normalized}),nowIso()]);return{...existing,status:normalized};
}

export async function deliverWebhook(db,env,tenantId,webhookId,eventType,payload,{eventId=''}={}){
  const event=String(eventType||'').toLowerCase();if(!WEBHOOK_EVENTS.includes(event))throw Object.assign(new Error('Webhook event type is invalid'),{status:422});
  const webhook=await first(db,`SELECT * FROM webhook_endpoints WHERE tenant_id=? AND id=? AND status='ACTIVE'`,[tenantId,webhookId]);if(!webhook)throw Object.assign(new Error('Active webhook not found'),{status:404});
  const subscribed=normalizeWebhookEvents(safeJson(webhook.event_types_json,[]));if(!subscribed.includes(event))throw Object.assign(new Error('Webhook is not subscribed to this event'),{status:409});
  const deliveryId=makeId('whdel'),resolvedEventId=eventId||makeId('event'),stamp=nowIso(),body=JSON.stringify({id:resolvedEventId,type:event,createdAt:stamp,tenantId,data:payload||{}}),secret=await decryptSecret(env.INTEGRATION_ENCRYPTION_KEY,webhook.signing_secret_ciphertext,webhook.signing_secret_iv),timestamp=Math.floor(Date.now()/1000),signature=await hmacSha256(secret,`${timestamp}.${body}`);
  await run(db,`INSERT INTO webhook_deliveries (id,tenant_id,webhook_id,event_type,event_id,payload_json,status,created_at) VALUES (?,?,?,?,?,?,'PENDING',?)`,[deliveryId,tenantId,webhookId,event,resolvedEventId,body,stamp]);
  let responseStatus=0,errorMessage='';
  try{
    const response=await fetch(webhook.endpoint_url,{method:'POST',headers:{'content-type':'application/json','user-agent':'CRM-by-AKARI-Webhooks/1.0','x-akari-event':event,'x-akari-delivery':deliveryId,'x-akari-signature':`t=${timestamp},v1=${signature}`},body,signal:AbortSignal.timeout(8000)});responseStatus=response.status;
    if(!response.ok)errorMessage=`Endpoint returned HTTP ${response.status}`;
  }catch(error){errorMessage=String(error?.message||'Webhook request failed').slice(0,500);}
  const delivered=responseStatus>=200&&responseStatus<300,finished=nowIso();
  await run(db,`UPDATE webhook_deliveries SET response_status=?,status=?,attempted_at=?,delivered_at=?,error_message=? WHERE tenant_id=? AND id=?`,[responseStatus||null,delivered?'DELIVERED':'FAILED',finished,delivered?finished:null,errorMessage||null,tenantId,deliveryId]);
  await run(db,`UPDATE webhook_endpoints SET failure_count=CASE WHEN ? THEN 0 ELSE failure_count+1 END,last_delivered_at=?,last_error=?,updated_at=? WHERE tenant_id=? AND id=?`,[delivered?1:0,delivered?finished:null,errorMessage||null,finished,tenantId,webhookId]);
  return{deliveryId,eventId:resolvedEventId,delivered,responseStatus:responseStatus||null,error:errorMessage||null};
}

export async function listWebhookDeliveries(db,tenantId,webhookId,{limit=30}={}){return all(db,`SELECT id,event_type,event_id,response_status,status,attempted_at,delivered_at,error_message,created_at FROM webhook_deliveries WHERE tenant_id=? AND webhook_id=? ORDER BY created_at DESC LIMIT ?`,[tenantId,webhookId,Math.min(100,Math.max(1,Number(limit||30)))]);}
