import { all,first,run,makeId,nowIso } from './db.js';
import { decryptSecret,encryptSecret,randomToken,sha256 } from './integration-crypto.js';

export const GOOGLE_SCOPES=Object.freeze([
  'openid','email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]);
const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO='https://openidconnect.googleapis.com/v1/userinfo';
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const email=(value)=>{const match=String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return match?match[0].toLowerCase():'';};
const safeJson=(value,fallback={})=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed&&typeof parsed==='object'?parsed:fallback;}catch{return fallback;}};
const addMinutes=(minutes)=>new Date(Date.now()+minutes*60000).toISOString();
const iso=(value)=>{const ms=Date.parse(String(value||''));return Number.isFinite(ms)?new Date(ms).toISOString():'';};

function googleConfig(env,origin=''){
  const clientId=text(env.GOOGLE_CLIENT_ID,500),clientSecret=text(env.GOOGLE_CLIENT_SECRET,1000),encryptionKey=env.INTEGRATION_ENCRYPTION_KEY;
  if(!clientId||!clientSecret)throw Object.assign(new Error('Google integration credentials are not configured'),{status:503});
  const redirectUri=text(env.GOOGLE_REDIRECT_URI,1000)||`${String(origin||'').replace(/\/$/,'')}/api/integrations/google/callback`;
  if(!redirectUri.startsWith('https://'))throw Object.assign(new Error('Google redirect URI must use HTTPS'),{status:503});
  return{clientId,clientSecret,encryptionKey,redirectUri};
}

export async function createGoogleOAuthState(db,env,auth,{origin,returnPath='/app/'}={}){
  const config=googleConfig(env,origin),rawState=randomToken('gstate'),stateHash=await sha256(rawState),stamp=nowIso();
  await run(db,`INSERT INTO integration_oauth_states (id,tenant_id,user_id,provider,state_hash,requested_scopes_json,return_path,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[makeId('oauth'),auth.tenantId,auth.userId,'GOOGLE',stateHash,JSON.stringify(GOOGLE_SCOPES),text(returnPath,500)||'/app/',addMinutes(10),stamp]);
  const url=new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id',config.clientId);
  url.searchParams.set('redirect_uri',config.redirectUri);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',GOOGLE_SCOPES.join(' '));
  url.searchParams.set('access_type','offline');
  url.searchParams.set('include_granted_scopes','true');
  url.searchParams.set('prompt','consent');
  url.searchParams.set('state',rawState);
  return{authorizeUrl:url.toString(),expiresAt:addMinutes(10)};
}

async function tokenRequest(config,params){
  const body=new URLSearchParams(params);
  const response=await fetch(GOOGLE_TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(payload.error_description||payload.error||`Google token request failed (${response.status})`),{status:502});
  return payload;
}

export async function completeGoogleOAuth(db,env,auth,{origin,state,code}={}){
  const config=googleConfig(env,origin),stateHash=await sha256(state),stamp=nowIso();
  const oauth=await first(db,`SELECT * FROM integration_oauth_states WHERE provider='GOOGLE' AND state_hash=? AND tenant_id=? AND user_id=?`,[stateHash,auth.tenantId,auth.userId]);
  if(!oauth)throw Object.assign(new Error('Google authorization state is invalid'),{status:403});
  if(oauth.consumed_at)throw Object.assign(new Error('Google authorization state has already been used'),{status:409});
  if(Date.parse(oauth.expires_at)<=Date.now())throw Object.assign(new Error('Google authorization state has expired'),{status:410});
  if(!code)throw Object.assign(new Error('Google authorization code is missing'),{status:422});
  const tokens=await tokenRequest(config,{code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:'authorization_code'});
  if(!tokens.access_token)throw Object.assign(new Error('Google did not return an access token'),{status:502});
  const userInfoResponse=await fetch(GOOGLE_USERINFO,{headers:{authorization:`Bearer ${tokens.access_token}`}});
  const userInfo=await userInfoResponse.json().catch(()=>({}));
  if(!userInfoResponse.ok||!userInfo.email)throw Object.assign(new Error('Google account email could not be verified'),{status:502});
  const access=await encryptSecret(config.encryptionKey,tokens.access_token),refresh=tokens.refresh_token?await encryptSecret(config.encryptionKey,tokens.refresh_token):{ciphertext:null,iv:null};
  const existing=await first(db,`SELECT * FROM workspace_integrations WHERE tenant_id=? AND provider='GOOGLE' AND lower(account_email)=lower(?)`,[auth.tenantId,userInfo.email]);
  const expiresAt=new Date(Date.now()+Number(tokens.expires_in||3600)*1000).toISOString(),scopes=String(tokens.scope||GOOGLE_SCOPES.join(' ')).split(/\s+/).filter(Boolean);
  let integrationId=existing?.id||makeId('integration');
  if(existing){
    const refreshCipher=refresh.ciphertext||existing.refresh_token_ciphertext,refreshIv=refresh.iv||existing.refresh_token_iv;
    await run(db,`UPDATE workspace_integrations SET status='CONNECTED',scopes_json=?,access_token_ciphertext=?,access_token_iv=?,refresh_token_ciphertext=?,refresh_token_iv=?,token_expires_at=?,last_error=NULL,connected_by=?,updated_at=? WHERE tenant_id=? AND id=?`,[JSON.stringify(scopes),access.ciphertext,access.iv,refreshCipher,refreshIv,expiresAt,auth.userId,stamp,auth.tenantId,integrationId]);
  }else{
    await run(db,`INSERT INTO workspace_integrations (id,tenant_id,provider,account_email,status,scopes_json,access_token_ciphertext,access_token_iv,refresh_token_ciphertext,refresh_token_iv,token_expires_at,sync_cursor_json,connected_by,connected_at,updated_at) VALUES (?,?, 'GOOGLE',?,'CONNECTED',?,?,?,?,?,?,'{}',?,?,?)`,[integrationId,auth.tenantId,String(userInfo.email).toLowerCase(),JSON.stringify(scopes),access.ciphertext,access.iv,refresh.ciphertext,refresh.iv,expiresAt,auth.userId,stamp,stamp]);
  }
  await run(db,`UPDATE integration_oauth_states SET consumed_at=? WHERE id=? AND tenant_id=?`,[stamp,oauth.id,auth.tenantId]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),auth.tenantId,auth.userId,'GOOGLE_INTEGRATION_CONNECTED','WORKSPACE_INTEGRATION',integrationId,JSON.stringify({accountEmail:String(userInfo.email).toLowerCase(),scopes}),stamp]);
  return{integrationId,accountEmail:String(userInfo.email).toLowerCase(),returnPath:oauth.return_path||`/app/${auth.tenantSlug}/settings`};
}

async function integrationAccessToken(db,env,integration){
  const config=googleConfig(env,'https://placeholder.invalid');
  const expires=Date.parse(integration.token_expires_at||'');
  if(Number.isFinite(expires)&&expires>Date.now()+60000)return decryptSecret(config.encryptionKey,integration.access_token_ciphertext,integration.access_token_iv);
  const refreshToken=await decryptSecret(config.encryptionKey,integration.refresh_token_ciphertext,integration.refresh_token_iv);
  if(!refreshToken)throw Object.assign(new Error('Google connection requires reauthorization'),{status:409,reauth:true});
  const tokens=await tokenRequest(config,{refresh_token:refreshToken,client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token'});
  const access=await encryptSecret(config.encryptionKey,tokens.access_token),expiresAt=new Date(Date.now()+Number(tokens.expires_in||3600)*1000).toISOString(),stamp=nowIso();
  await run(db,`UPDATE workspace_integrations SET access_token_ciphertext=?,access_token_iv=?,token_expires_at=?,status='CONNECTED',last_error=NULL,updated_at=? WHERE tenant_id=? AND id=?`,[access.ciphertext,access.iv,expiresAt,stamp,integration.tenant_id,integration.id]);
  return tokens.access_token;
}

async function googleFetch(db,env,integration,path,options={}){
  let token;
  try{token=await integrationAccessToken(db,env,integration);}catch(error){if(error.reauth)await run(db,`UPDATE workspace_integrations SET status='REAUTH_REQUIRED',last_error=?,updated_at=? WHERE tenant_id=? AND id=?`,[error.message,nowIso(),integration.tenant_id,integration.id]);throw error;}
  const response=await fetch(`https://www.googleapis.com${path}`,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(payload?.error?.message||`Google API request failed (${response.status})`),{status:502});
  return payload;
}

export async function listGoogleIntegrations(db,tenantId){
  return all(db,`SELECT id,provider,account_email,status,scopes_json,token_expires_at,last_synced_at,last_error,connected_by,connected_at,updated_at FROM workspace_integrations WHERE tenant_id=? AND provider='GOOGLE' ORDER BY connected_at DESC`,[tenantId]);
}

export async function disconnectGoogle(db,tenantId,userId,integrationId){
  const item=await first(db,`SELECT id,account_email FROM workspace_integrations WHERE tenant_id=? AND id=? AND provider='GOOGLE'`,[tenantId,integrationId]);
  if(!item)throw Object.assign(new Error('Google integration not found'),{status:404});
  const stamp=nowIso();
  await run(db,`UPDATE workspace_integrations SET status='DISCONNECTED',access_token_ciphertext=NULL,access_token_iv=NULL,refresh_token_ciphertext=NULL,refresh_token_iv=NULL,token_expires_at=NULL,updated_at=? WHERE tenant_id=? AND id=?`,[stamp,tenantId,integrationId]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'GOOGLE_INTEGRATION_DISCONNECTED','WORKSPACE_INTEGRATION',integrationId,JSON.stringify({accountEmail:item.account_email}),stamp]);
  return item;
}

async function contactForEmails(db,tenantId,addresses,accountEmail){
  const emails=[...new Set(addresses.map(email).filter(value=>value&&value!==String(accountEmail||'').toLowerCase()))];
  for(const address of emails){
    const contact=await first(db,`SELECT c.id,c.project_id,c.full_name,c.email,(SELECT o.id FROM opportunities o WHERE o.tenant_id=c.tenant_id AND o.project_id=c.project_id AND o.stage NOT IN ('WON','LOST') ORDER BY o.updated_at DESC LIMIT 1) opportunity_id FROM contacts c WHERE c.tenant_id=? AND lower(c.email)=? LIMIT 1`,[tenantId,address]);
    if(contact)return contact;
  }
  return null;
}

async function externalSeen(db,tenantId,provider,type,id){return first(db,`SELECT id FROM integration_external_refs WHERE tenant_id=? AND provider=? AND external_type=? AND external_id=?`,[tenantId,provider,type,id]);}
async function rememberExternal(db,integration,{type,externalId,internalType='',internalId='',metadata={}}){
  const stamp=nowIso();
  await run(db,`INSERT INTO integration_external_refs (id,tenant_id,integration_id,provider,external_type,external_id,internal_type,internal_id,first_seen_at,last_seen_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,provider,external_type,external_id) DO UPDATE SET internal_type=excluded.internal_type,internal_id=excluded.internal_id,last_seen_at=excluded.last_seen_at,metadata_json=excluded.metadata_json`,[makeId('xref'),integration.tenant_id,integration.id,'GOOGLE',type,externalId,internalType||null,internalId||null,stamp,stamp,JSON.stringify(metadata||{})]);
}

function gmailHeader(message,name){return message?.payload?.headers?.find(header=>String(header.name||'').toLowerCase()===name.toLowerCase())?.value||'';}
export async function syncGmailMetadata(db,env,tenantId,userId,integrationId,{maxResults=50}={}){
  const integration=await first(db,`SELECT * FROM workspace_integrations WHERE tenant_id=? AND id=? AND provider='GOOGLE' AND status IN ('CONNECTED','REAUTH_REQUIRED')`,[tenantId,integrationId]);
  if(!integration)throw Object.assign(new Error('Connected Google account not found'),{status:404});
  const cursor=safeJson(integration.sync_cursor_json,{}),afterEpoch=Math.floor(Date.parse(cursor.gmailLastSync||integration.last_synced_at||new Date(Date.now()-30*86400000).toISOString())/1000),list=await googleFetch(db,env,integration,`/gmail/v1/users/me/messages?maxResults=${Math.min(100,Math.max(1,Number(maxResults||50)))}&q=${encodeURIComponent(`after:${Math.max(0,afterEpoch)}`)}`);
  let captured=0,skipped=0;
  for(const summary of list.messages||[]){
    if(await externalSeen(db,tenantId,'GOOGLE','GMAIL_MESSAGE',summary.id)){skipped++;continue;}
    const message=await googleFetch(db,env,integration,`/gmail/v1/users/me/messages/${encodeURIComponent(summary.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`);
    const from=gmailHeader(message,'From'),to=gmailHeader(message,'To'),cc=gmailHeader(message,'Cc'),contact=await contactForEmails(db,tenantId,[from,to,cc],integration.account_email),occurredAt=iso(gmailHeader(message,'Date'))||new Date(Number(message.internalDate||Date.now())).toISOString(),direction=email(from)===String(integration.account_email||'').toLowerCase()?'OUTBOUND':'INBOUND';
    if(!contact){await rememberExternal(db,integration,{type:'GMAIL_MESSAGE',externalId:summary.id,metadata:{matched:false,occurredAt}});skipped++;continue;}
    const activityId=makeId('activity'),subject=text(gmailHeader(message,'Subject'),500)||'(No subject)';
    await run(db,`INSERT INTO activities (id,tenant_id,project_id,contact_id,opportunity_id,user_id,activity_type,subject,description,outcome,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[activityId,tenantId,contact.project_id,contact.id,contact.opportunity_id||null,userId,'EMAIL',subject,`Gmail metadata captured · ${direction}`,'CAPTURED',occurredAt,nowIso()]);
    await rememberExternal(db,integration,{type:'GMAIL_MESSAGE',externalId:summary.id,internalType:'ACTIVITY',internalId:activityId,metadata:{matched:true,direction,threadId:message.threadId||null}});captured++;
  }
  const stamp=nowIso(),nextCursor={...cursor,gmailLastSync:stamp};
  await run(db,`UPDATE workspace_integrations SET sync_cursor_json=?,last_synced_at=?,last_error=NULL,updated_at=? WHERE tenant_id=? AND id=?`,[JSON.stringify(nextCursor),stamp,stamp,tenantId,integrationId]);
  return{captured,skipped,syncedAt:stamp};
}

export async function syncCalendarMetadata(db,env,tenantId,userId,integrationId,{maxResults=100}={}){
  const integration=await first(db,`SELECT * FROM workspace_integrations WHERE tenant_id=? AND id=? AND provider='GOOGLE' AND status IN ('CONNECTED','REAUTH_REQUIRED')`,[tenantId,integrationId]);
  if(!integration)throw Object.assign(new Error('Connected Google account not found'),{status:404});
  const cursor=safeJson(integration.sync_cursor_json,{}),timeMin=cursor.calendarLastSync||integration.last_synced_at||new Date(Date.now()-30*86400000).toISOString(),params=new URLSearchParams({timeMin,maxResults:String(Math.min(250,Math.max(1,Number(maxResults||100)))),singleEvents:'true',orderBy:'startTime'}),payload=await googleFetch(db,env,integration,`/calendar/v3/calendars/primary/events?${params}`);
  let captured=0,skipped=0;
  for(const event of payload.items||[]){
    if(!event.id||event.status==='cancelled'||await externalSeen(db,tenantId,'GOOGLE','CALENDAR_EVENT',event.id)){skipped++;continue;}
    const attendeeEmails=(event.attendees||[]).map(item=>item.email),contact=await contactForEmails(db,tenantId,attendeeEmails,integration.account_email),occurredAt=iso(event.start?.dateTime||event.start?.date)||nowIso();
    if(!contact){await rememberExternal(db,integration,{type:'CALENDAR_EVENT',externalId:event.id,metadata:{matched:false,occurredAt}});skipped++;continue;}
    const activityId=makeId('activity');
    await run(db,`INSERT INTO activities (id,tenant_id,project_id,contact_id,opportunity_id,user_id,activity_type,subject,description,outcome,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[activityId,tenantId,contact.project_id,contact.id,contact.opportunity_id||null,userId,'MEETING',text(event.summary,500)||'Google Calendar meeting','Google Calendar metadata captured','CAPTURED',occurredAt,nowIso()]);
    await rememberExternal(db,integration,{type:'CALENDAR_EVENT',externalId:event.id,internalType:'ACTIVITY',internalId:activityId,metadata:{matched:true,htmlLink:event.htmlLink||null,end:event.end?.dateTime||event.end?.date||null}});captured++;
  }
  const stamp=nowIso(),nextCursor={...cursor,calendarLastSync:stamp};
  await run(db,`UPDATE workspace_integrations SET sync_cursor_json=?,last_synced_at=?,last_error=NULL,updated_at=? WHERE tenant_id=? AND id=?`,[JSON.stringify(nextCursor),stamp,stamp,tenantId,integrationId]);
  return{captured,skipped,syncedAt:stamp};
}

export function googleDriveFileId(url){
  const value=String(url||'');
  return value.match(/\/d\/([a-zA-Z0-9_-]{10,})/)?.[1]||value.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1]||'';
}

export async function addDriveLink(db,env,tenantId,userId,input){
  const documentUrl=text(input.documentUrl,1500);if(!/^https:\/\/(drive|docs)\.google\.com\//i.test(documentUrl))throw Object.assign(new Error('A Google Drive or Docs HTTPS URL is required'),{status:422});
  const entityType=text(input.entityType,80).toUpperCase(),entityId=text(input.entityId,160);if(!entityType||!entityId)throw Object.assign(new Error('Document entity type and id are required'),{status:422});
  const fileId=googleDriveFileId(documentUrl);let name=text(input.name,500),mimeType='';
  const integration=await first(db,`SELECT * FROM workspace_integrations WHERE tenant_id=? AND provider='GOOGLE' AND status='CONNECTED' ORDER BY updated_at DESC LIMIT 1`,[tenantId]);
  if(integration&&fileId){try{const meta=await googleFetch(db,env,integration,`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,trashed`);if(meta.trashed)throw new Error('Drive file is in Trash');name=name||text(meta.name,500);mimeType=text(meta.mimeType,250);}catch(error){if(!name)throw error;}}
  if(!name)name='Google Drive document';
  const existing=await first(db,`SELECT id FROM external_document_links WHERE tenant_id=? AND entity_type=? AND entity_id=? AND document_url=?`,[tenantId,entityType,entityId,documentUrl]);if(existing)throw Object.assign(new Error('This document is already linked to the record'),{status:409});
  const id=makeId('doclink'),stamp=nowIso();
  await run(db,`INSERT INTO external_document_links (id,tenant_id,provider,external_file_id,document_url,name,mime_type,entity_type,entity_id,added_by,created_at,updated_at) VALUES (?,?, 'GOOGLE_DRIVE',?,?,?,?,?,?,?,?,?)`,[id,tenantId,fileId||null,documentUrl,name,mimeType||null,entityType,entityId,userId,stamp,stamp]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'GOOGLE_DRIVE_DOCUMENT_LINKED',entityType,entityId,JSON.stringify({documentLinkId:id,name,fileId:fileId||null}),stamp]);
  return{id,provider:'GOOGLE_DRIVE',externalFileId:fileId||null,documentUrl,name,mimeType,entityType,entityId};
}

export async function listDocumentLinks(db,tenantId,{entityType='',entityId=''}={}){
  const bindings=[tenantId];let where='tenant_id=?';
  if(entityType){where+=' AND entity_type=?';bindings.push(text(entityType,80).toUpperCase());}
  if(entityId){where+=' AND entity_id=?';bindings.push(text(entityId,160));}
  return all(db,`SELECT id,provider,external_file_id,document_url,name,mime_type,entity_type,entity_id,added_by,created_at FROM external_document_links WHERE ${where} ORDER BY created_at DESC LIMIT 200`,bindings);
}
