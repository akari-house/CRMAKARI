import { json,error,readJson } from '../../../lib/response.js';
import { first } from '../../../lib/db.js';
import { requireRole,requireTenant } from '../../../lib/permissions.js';
import { addDriveLink,createGoogleOAuthState,disconnectGoogle,listDocumentLinks,listGoogleIntegrations,syncCalendarMetadata,syncGmailMetadata } from '../../../lib/google-integration.js';

const CONNECT_ROLES=['OWNER','ADMIN','BD_MANAGER','BD_MEMBER'];
const ADMIN_ROLES=new Set(['OWNER','ADMIN']);
const MISSING_SCHEMA=/no such table.*workspace_integrations|no such table.*external_document_links/i;

async function ensureSchema(db){
  try{await first(db,'SELECT id FROM workspace_integrations LIMIT 1');}
  catch(cause){if(MISSING_SCHEMA.test(String(cause?.message||''))){const e=new Error('Essential Integrations migration 0009 must be applied before R76 is available');e.status=503;throw e;}throw cause;}
}
async function assertIntegrationAccess(db,auth,integrationId){
  const row=await first(db,`SELECT id,connected_by FROM workspace_integrations WHERE tenant_id=? AND id=? AND provider='GOOGLE'`,[auth.tenantId,integrationId]);
  if(!row)throw Object.assign(new Error('Google integration not found'),{status:404});
  if(!ADMIN_ROLES.has(auth.role)&&row.connected_by!==auth.userId)throw Object.assign(new Error('You can only manage the Google account you connected'),{status:403});
  return row;
}

export async function onRequestGet(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);requireRole(auth,CONNECT_ROLES);await ensureSchema(context.env.DB);
    const url=new URL(context.request.url),action=url.searchParams.get('action')||'status';
    if(action==='start'){
      const result=await createGoogleOAuthState(context.env.DB,context.env,auth,{origin:url.origin,returnPath:`/app/${auth.tenantSlug}/settings`});
      return json(result);
    }
    if(action==='documents'){
      const documents=await listDocumentLinks(context.env.DB,tenantId,{entityType:url.searchParams.get('entityType')||'',entityId:url.searchParams.get('entityId')||''});
      return json({documents});
    }
    const integrations=await listGoogleIntegrations(context.env.DB,tenantId);
    return json({configured:Boolean(context.env.GOOGLE_CLIENT_ID&&context.env.GOOGLE_CLIENT_SECRET&&context.env.INTEGRATION_ENCRYPTION_KEY),integrations,privacy:{gmail:'Headers and relationship metadata only; message bodies are not stored.',calendar:'Event metadata is captured only when an attendee matches an existing CRM contact.',drive:'Drive links remain external; CRM stores metadata and the link.'}});
  }catch(cause){console.error('R76 Google integration read failed',cause);return error(cause.message||'Google integration could not be loaded',Number(cause.status||500));}
}

export async function onRequestPost(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);requireRole(auth,CONNECT_ROLES);await ensureSchema(context.env.DB);
    const body=await readJson(context.request),action=String(body.action||''),integrationId=String(body.integrationId||'').trim();
    if(['sync-gmail','sync-calendar','disconnect'].includes(action)){if(!integrationId)return error('Google integration id is required',422);await assertIntegrationAccess(context.env.DB,auth,integrationId);}
    if(action==='sync-gmail')return json({synced:true,result:await syncGmailMetadata(context.env.DB,context.env,tenantId,auth.userId,integrationId,{maxResults:body.maxResults||50})});
    if(action==='sync-calendar')return json({synced:true,result:await syncCalendarMetadata(context.env.DB,context.env,tenantId,auth.userId,integrationId,{maxResults:body.maxResults||100})});
    if(action==='disconnect')return json({disconnected:true,integration:await disconnectGoogle(context.env.DB,tenantId,auth.userId,integrationId)});
    if(action==='add-drive-link')return json({created:true,document:await addDriveLink(context.env.DB,context.env,tenantId,auth.userId,body)},201);
    return error('Google integration action is not supported',404);
  }catch(cause){console.error('R76 Google integration write failed',cause);return error(cause.message||'Google integration action failed',Number(cause.status||500));}
}
