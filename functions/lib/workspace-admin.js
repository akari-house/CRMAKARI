import { all,first,run,makeId,nowIso } from './db.js';

export const WORKSPACE_MODULES=Object.freeze(['BD','REVENUE','DELIVERY','CAMPAIGNS','FUNDRAISING','RELATIONSHIPS','PORTAL','REPORTING']);
export const WORKSPACE_ROLES=Object.freeze(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER','EXTERNAL_COLLABORATOR']);
export const WORKSPACE_STATUSES=Object.freeze(['TRIAL','ACTIVE','SUSPENDED','CANCELLED']);
const INTERNAL_SEAT_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER']);

const text=(value,max=500)=>String(value??'').trim().slice(0,max);
const email=(value)=>text(value,320).toLowerCase();
const upper=(value)=>text(value,100).toUpperCase();
const int=(value,min,max,fallback)=>{const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;};
const safeJson=(value,fallback)=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed??fallback;}catch{return fallback;}};
const hex=(bytes)=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const addDays=(days)=>new Date(Date.now()+days*86400000).toISOString();

export function normalizeWorkspaceSlug(value){
  const slug=text(value,80).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);
  if(!slug||slug.length<2)throw Object.assign(new Error('Workspace slug must contain at least two letters or numbers'),{status:422});
  if(['app','api','portal','admin','www','crm','accept-invite'].includes(slug))throw Object.assign(new Error('Workspace slug is reserved'),{status:422});
  return slug;
}
export function normalizeModules(value,{allowEmpty=false}={}){
  const source=Array.isArray(value)?value:typeof value==='string'?safeJson(value,[]):[];
  const modules=[...new Set(source.map(upper).filter(item=>WORKSPACE_MODULES.includes(item)))];
  if(!modules.length&&!allowEmpty)return [...WORKSPACE_MODULES];
  return modules;
}
export function normalizeRole(value){
  const role=upper(value);
  if(!WORKSPACE_ROLES.includes(role))throw Object.assign(new Error('Workspace role is invalid'),{status:422});
  return role;
}
export function normalizeWorkspaceStatus(value){
  const status=upper(value);
  if(!WORKSPACE_STATUSES.includes(status))throw Object.assign(new Error('Workspace status is invalid'),{status:422});
  return status;
}
export function normalizePlanCode(value='FOUNDING'){
  const code=upper(value||'FOUNDING');
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))throw Object.assign(new Error('Plan code is invalid'),{status:422});
  return code;
}
export function moduleEnabled(enabledModules,moduleName){return normalizeModules(enabledModules).includes(upper(moduleName));}

export async function hashInviteToken(token){
  const raw=text(token,400);
  if(raw.length<32)throw Object.assign(new Error('Invitation token is invalid'),{status:422});
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
}
export function newInviteToken(){return `${crypto.randomUUID().replaceAll('-','')}${crypto.randomUUID().replaceAll('-','')}`;}

async function safeFirst(db,sql,bindings=[]){try{return await first(db,sql,bindings);}catch(error){if(/no such table|no such column/i.test(String(error?.message||'')))return null;throw error;}}
async function safeAll(db,sql,bindings=[]){try{return await all(db,sql,bindings);}catch(error){if(/no such table|no such column/i.test(String(error?.message||'')))return [];throw error;}}

export async function workspaceUsage(db,tenantId){
  const now=nowIso();
  const [members,pendingInvites,storage,projects,campaigns,rounds]=await Promise.all([
    safeFirst(db,`SELECT COUNT(CASE WHEN status='ACTIVE' AND role != 'EXTERNAL_COLLABORATOR' THEN 1 END) active_seats,COUNT(CASE WHEN status='INVITED' AND role != 'EXTERNAL_COLLABORATOR' THEN 1 END) invited_seats FROM tenant_memberships WHERE tenant_id = ?`,[tenantId]),
    safeFirst(db,`SELECT COUNT(*) count FROM invitations WHERE tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND role != 'EXTERNAL_COLLABORATOR'`,[tenantId,now]),
    safeFirst(db,`SELECT COALESCE(SUM(v.size_bytes),0) storage_used_bytes FROM fundraising_data_room_document_versions v JOIN fundraising_data_room_documents d ON d.id=v.document_id AND d.tenant_id=v.tenant_id WHERE v.tenant_id = ? AND d.status != 'ARCHIVED'`,[tenantId]),
    safeFirst(db,`SELECT COUNT(*) count FROM projects WHERE tenant_id = ? AND lifecycle_status != 'ARCHIVED'`,[tenantId]),
    safeFirst(db,`SELECT COUNT(*) count FROM campaigns WHERE tenant_id = ?`,[tenantId]),
    safeFirst(db,`SELECT COUNT(*) count FROM fundraising_rounds WHERE tenant_id = ?`,[tenantId]),
  ]);
  const activeSeats=Number(members?.active_seats||0),membershipInvites=Number(members?.invited_seats||0),pending=Number(pendingInvites?.count||0);
  return {activeSeats,invitedSeats:membershipInvites+pending,seatConsumption:activeSeats+membershipInvites+pending,storageUsedBytes:Number(storage?.storage_used_bytes||0),projectCount:Number(projects?.count||0),campaignCount:Number(campaigns?.count||0),fundraisingRoundCount:Number(rounds?.count||0)};
}

export async function workspaceSnapshot(db,tenantId){
  const tenant=await safeFirst(db,`SELECT t.id,t.name,t.slug,t.status,t.organisation_type,t.base_currency,t.timezone,t.logo_url,t.plan_code,t.user_limit,t.storage_limit_mb,t.trial_start_at,t.trial_end_at,t.created_at,t.updated_at,s.enabled_modules_json,s.feature_flags_json FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id=t.id WHERE t.id = ?`,[tenantId]);
  if(!tenant)throw Object.assign(new Error('Workspace not found'),{status:404});
  const usage=await workspaceUsage(db,tenantId);
  const pendingInvitations=await safeAll(db,`SELECT id,email,role,finance_access,expires_at,created_at,invited_by FROM invitations WHERE tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,[tenantId,nowIso()]);
  const modules=normalizeModules(tenant.enabled_modules_json);
  return {workspace:{id:tenant.id,name:tenant.name,slug:tenant.slug,status:tenant.status,organisationType:tenant.organisation_type||'',baseCurrency:tenant.base_currency,timezone:tenant.timezone,logoUrl:tenant.logo_url||'',planCode:tenant.plan_code,userLimit:Number(tenant.user_limit||0),storageLimitMb:Number(tenant.storage_limit_mb||0),trialStartAt:tenant.trial_start_at,trialEndAt:tenant.trial_end_at,modules,featureFlags:safeJson(tenant.feature_flags_json,{})},usage:{...usage,seatLimit:Number(tenant.user_limit||0),storageLimitBytes:Number(tenant.storage_limit_mb||0)*1024*1024},pendingInvitations};
}

export async function captureUsageSnapshot(db,tenantId,userId){
  const usage=await workspaceUsage(db,tenantId),stamp=nowIso();
  await run(db,`INSERT INTO workspace_usage_snapshots (id,tenant_id,active_seats,invited_seats,storage_used_bytes,project_count,campaign_count,fundraising_round_count,captured_at,captured_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,[makeId('usage'),tenantId,usage.activeSeats,usage.invitedSeats,usage.storageUsedBytes,usage.projectCount,usage.campaignCount,usage.fundraisingRoundCount,stamp,userId||null]);
  return usage;
}

export async function isPlatformAdmin(db,auth,{allowBootstrap=true}={}){
  if(!auth?.userId)return false;
  const existing=await safeFirst(db,`SELECT id FROM platform_admins WHERE user_id = ? AND status='ACTIVE'`,[auth.userId]);
  if(existing)return true;
  if(!allowBootstrap||auth.tenantSlug!=='akari-house'||auth.role!=='OWNER')return false;
  const count=await safeFirst(db,`SELECT COUNT(*) count FROM platform_admins WHERE status='ACTIVE'`);
  if(Number(count?.count||0)!==0)return false;
  const stamp=nowIso();
  await run(db,`INSERT INTO platform_admins (id,user_id,status,created_by,created_at,updated_at) VALUES (?,?, 'ACTIVE', ?,?,?)`,[makeId('padmin'),auth.userId,auth.userId,stamp,stamp]);
  return true;
}

export async function listPlatformAdmins(db){
  return safeAll(db,`SELECT pa.id,pa.user_id,pa.status,pa.created_at,u.full_name,u.email FROM platform_admins pa JOIN users u ON u.id=pa.user_id WHERE pa.status != 'REVOKED' ORDER BY pa.created_at`,[]);
}

export async function createInvitation(db,tenantId,actorUserId,input,{origin=''}={}){
  const inviteEmail=email(input.email);if(!inviteEmail||!inviteEmail.includes('@'))throw Object.assign(new Error('A valid invitation email is required'),{status:422});
  const role=normalizeRole(input.role||'VIEWER');
  const financeAccess=Boolean(input.financeAccess)&&['OWNER','ADMIN','FINANCE'].includes(role)?1:0;
  const tenant=await safeFirst(db,`SELECT id,slug,user_limit,status FROM tenants WHERE id = ?`,[tenantId]);
  if(!tenant)throw Object.assign(new Error('Workspace not found'),{status:404});
  if(['SUSPENDED','CANCELLED'].includes(tenant.status))throw Object.assign(new Error('Workspace must be active before inviting members'),{status:409});
  const existingMember=await safeFirst(db,`SELECT tm.id,tm.status FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id = ? AND lower(u.email)=? AND tm.status != 'REVOKED'`,[tenantId,inviteEmail]);
  if(existingMember)throw Object.assign(new Error('This email already belongs to the workspace'),{status:409});
  const existingInvite=await safeFirst(db,`SELECT id FROM invitations WHERE tenant_id = ? AND lower(email)=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,[tenantId,inviteEmail,nowIso()]);
  if(existingInvite)throw Object.assign(new Error('An active invitation already exists for this email'),{status:409});
  if(INTERNAL_SEAT_ROLES.has(role)){
    const usage=await workspaceUsage(db,tenantId);
    if(usage.seatConsumption>=Number(tenant.user_limit||0))throw Object.assign(new Error('Workspace seat limit has been reached'),{status:409});
  }
  const rawToken=newInviteToken(),tokenHash=await hashInviteToken(rawToken),stamp=nowIso(),expiresAt=addDays(int(input.expiresInDays,1,30,7));
  const id=makeId('invite');
  await run(db,`INSERT INTO invitations (id,tenant_id,email,role,finance_access,token_hash,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[id,tenantId,inviteEmail,role,financeAccess,tokenHash,actorUserId||null,expiresAt,stamp]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,actorUserId||null,'WORKSPACE_INVITATION_CREATED','INVITATION',id,JSON.stringify({email:inviteEmail,role,financeAccess:Boolean(financeAccess),expiresAt}),stamp]);
  const base=origin?origin.replace(/\/$/,''):'';
  return {id,email:inviteEmail,role,financeAccess:Boolean(financeAccess),expiresAt,inviteUrl:`${base}/accept-invite.html?token=${encodeURIComponent(rawToken)}`,token:rawToken};
}

export async function revokeInvitation(db,tenantId,actorUserId,id){
  const invite=await safeFirst(db,`SELECT id,email,accepted_at,revoked_at FROM invitations WHERE tenant_id = ? AND id = ?`,[tenantId,id]);
  if(!invite)throw Object.assign(new Error('Invitation not found'),{status:404});
  if(invite.accepted_at)throw Object.assign(new Error('Accepted invitations cannot be revoked'),{status:409});
  if(invite.revoked_at)return invite;
  const stamp=nowIso();
  await run(db,`UPDATE invitations SET revoked_at=? WHERE tenant_id=? AND id=?`,[stamp,tenantId,id]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,actorUserId||null,'WORKSPACE_INVITATION_REVOKED','INVITATION',id,JSON.stringify({email:invite.email}),stamp]);
  return {...invite,revoked_at:stamp};
}

export async function acceptInvitation(db,identity,input){
  const tokenHash=await hashInviteToken(input.token),identityEmail=email(identity?.email);
  if(!identityEmail)throw Object.assign(new Error('Cloudflare Access identity is required'),{status:401});
  const invite=await safeFirst(db,`SELECT i.*,t.slug tenant_slug,t.status tenant_status FROM invitations i JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash = ?`,[tokenHash]);
  if(!invite)throw Object.assign(new Error('Invitation is invalid'),{status:404});
  if(invite.revoked_at)throw Object.assign(new Error('Invitation has been revoked'),{status:410});
  if(invite.accepted_at)throw Object.assign(new Error('Invitation has already been accepted'),{status:409});
  if(Date.parse(invite.expires_at)<=Date.now())throw Object.assign(new Error('Invitation has expired'),{status:410});
  if(email(invite.email)!==identityEmail)throw Object.assign(new Error('This invitation belongs to a different email address'),{status:403});
  if(['SUSPENDED','CANCELLED'].includes(invite.tenant_status))throw Object.assign(new Error('This workspace is not accepting invitations'),{status:409});
  let user=await safeFirst(db,`SELECT id,full_name,email,status FROM users WHERE lower(email)=?`,[identityEmail]);
  const stamp=nowIso();
  if(!user){
    const userId=makeId('user'),name=text(identity?.name,160)||identityEmail.split('@')[0];
    await run(db,`INSERT INTO users (id,full_name,email,authentication_provider,status,last_login_at,created_at,updated_at) VALUES (?,?,?,'CLOUDFLARE_ACCESS','ACTIVE',?,?,?)`,[userId,name,identityEmail,stamp,stamp,stamp]);
    user={id:userId,full_name:name,email:identityEmail,status:'ACTIVE'};
  }else if(user.status!=='ACTIVE'){
    await run(db,`UPDATE users SET status='ACTIVE',last_login_at=?,updated_at=? WHERE id=?`,[stamp,stamp,user.id]);
  }
  const existing=await safeFirst(db,`SELECT id,status FROM tenant_memberships WHERE tenant_id=? AND user_id=?`,[invite.tenant_id,user.id]);
  if(existing){
    await run(db,`UPDATE tenant_memberships SET role=?,finance_access=?,status='ACTIVE',joined_at=COALESCE(joined_at,?),updated_at=? WHERE tenant_id=? AND user_id=?`,[invite.role,Number(invite.finance_access||0),stamp,stamp,invite.tenant_id,user.id]);
  }else{
    await run(db,`INSERT INTO tenant_memberships (id,tenant_id,user_id,role,finance_access,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`,[makeId('membership'),invite.tenant_id,user.id,invite.role,Number(invite.finance_access||0),stamp,stamp,stamp]);
  }
  await run(db,`UPDATE invitations SET accepted_at=? WHERE id=? AND tenant_id=?`,[stamp,invite.id,invite.tenant_id]);
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),invite.tenant_id,user.id,'WORKSPACE_INVITATION_ACCEPTED','INVITATION',invite.id,JSON.stringify({email:identityEmail,role:invite.role}),stamp]);
  return {tenantId:invite.tenant_id,tenantSlug:invite.tenant_slug,role:invite.role,userId:user.id};
}

export async function updateWorkspaceConfiguration(db,tenantId,userId,input,{platform=false}={}){
  const tenant=await safeFirst(db,`SELECT * FROM tenants WHERE id=?`,[tenantId]);if(!tenant)throw Object.assign(new Error('Workspace not found'),{status:404});
  const stamp=nowIso(),name=text(input.name,160)||tenant.name,timezone=text(input.timezone,100)||tenant.timezone,logoUrl=text(input.logoUrl,1000)||null,baseCurrency=upper(input.baseCurrency||tenant.base_currency).slice(0,8);
  const planCode=platform?normalizePlanCode(input.planCode||tenant.plan_code):tenant.plan_code;
  const userLimit=platform?int(input.userLimit,1,10000,Number(tenant.user_limit||3)):Number(tenant.user_limit||3);
  const storageLimitMb=platform?int(input.storageLimitMb,1,10000000,Number(tenant.storage_limit_mb||500)):Number(tenant.storage_limit_mb||500);
  const status=platform?normalizeWorkspaceStatus(input.status||tenant.status):tenant.status;
  await run(db,`UPDATE tenants SET name=?,timezone=?,logo_url=?,base_currency=?,plan_code=?,user_limit=?,storage_limit_mb=?,status=?,updated_at=? WHERE id=?`,[name,timezone,logoUrl,baseCurrency,planCode,userLimit,storageLimitMb,status,stamp,tenantId]);
  if(input.modules!==undefined){const modules=normalizeModules(input.modules,{allowEmpty:true});await run(db,`INSERT INTO tenant_settings (tenant_id,enabled_modules_json,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled_modules_json=excluded.enabled_modules_json,updated_at=excluded.updated_at`,[tenantId,JSON.stringify(modules),stamp]);}
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId||null,platform?'PLATFORM_WORKSPACE_UPDATED':'WORKSPACE_CONFIGURATION_UPDATED','TENANT',tenantId,JSON.stringify({name:tenant.name,status:tenant.status,planCode:tenant.plan_code,userLimit:tenant.user_limit,storageLimitMb:tenant.storage_limit_mb}),JSON.stringify({name,status,planCode,userLimit,storageLimitMb,modules:input.modules}),stamp]);
  return workspaceSnapshot(db,tenantId);
}

export async function provisionWorkspace(db,actorUserId,input,{origin=''}={}){
  const name=text(input.name,160);if(!name)throw Object.assign(new Error('Workspace name is required'),{status:422});
  const slug=normalizeWorkspaceSlug(input.slug||name),existing=await safeFirst(db,`SELECT id FROM tenants WHERE slug=?`,[slug]);if(existing)throw Object.assign(new Error('Workspace slug is already in use'),{status:409});
  const ownerEmail=email(input.ownerEmail);if(!ownerEmail||!ownerEmail.includes('@'))throw Object.assign(new Error('Workspace owner email is required'),{status:422});
  const planCode=normalizePlanCode(input.planCode||'FOUNDING'),userLimit=int(input.userLimit,1,10000,3),storageLimitMb=int(input.storageLimitMb,1,10000000,500),modules=normalizeModules(input.modules),stamp=nowIso(),tenantId=makeId('tenant');
  const status=normalizeWorkspaceStatus(input.status||'TRIAL'),timezone=text(input.timezone,100)||'Europe/Berlin',baseCurrency=upper(input.baseCurrency||'USD').slice(0,8);
  await run(db,`INSERT INTO tenants (id,name,slug,status,organisation_type,base_currency,timezone,logo_url,plan_code,user_limit,storage_limit_mb,trial_start_at,trial_end_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[tenantId,name,slug,status,text(input.organisationType,100)||null,baseCurrency,timezone,text(input.logoUrl,1000)||null,planCode,userLimit,storageLimitMb,status==='TRIAL'?stamp:null,status==='TRIAL'?addDays(int(input.trialDays,1,90,14)):null,stamp,stamp]);
  await run(db,`INSERT INTO tenant_settings (tenant_id,enabled_modules_json,feature_flags_json,updated_at) VALUES (?,?,?,?)`,[tenantId,JSON.stringify(modules),'{}',stamp]);
  const invitation=await createInvitation(db,tenantId,actorUserId,{email:ownerEmail,role:'OWNER',financeAccess:true,expiresInDays:int(input.inviteExpiresInDays,1,30,7)},{origin});
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,actorUserId||null,'PLATFORM_WORKSPACE_PROVISIONED','TENANT',tenantId,JSON.stringify({name,slug,status,planCode,userLimit,storageLimitMb,modules,ownerEmail}),stamp]);
  return {workspace:(await workspaceSnapshot(db,tenantId)).workspace,ownerInvitation:invitation};
}

export async function listPlatformWorkspaces(db){
  const tenants=await safeAll(db,`SELECT t.id,t.name,t.slug,t.status,t.plan_code,t.user_limit,t.storage_limit_mb,t.base_currency,t.timezone,t.logo_url,t.created_at,s.enabled_modules_json FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id=t.id ORDER BY t.created_at DESC`,[]);
  const result=[];
  for(const tenant of tenants){const usage=await workspaceUsage(db,tenant.id);result.push({...tenant,modules:normalizeModules(tenant.enabled_modules_json),usage});}
  return result;
}

export async function addPlatformAdmin(db,actorUserId,input){
  const targetEmail=email(input.email);if(!targetEmail)throw Object.assign(new Error('Platform admin email is required'),{status:422});
  const user=await safeFirst(db,`SELECT id,full_name,email,status FROM users WHERE lower(email)=?`,[targetEmail]);if(!user||user.status!=='ACTIVE')throw Object.assign(new Error('Platform admin must already be an active CRM user'),{status:404});
  const stamp=nowIso(),existing=await safeFirst(db,`SELECT id FROM platform_admins WHERE user_id=?`,[user.id]);
  if(existing)await run(db,`UPDATE platform_admins SET status='ACTIVE',updated_at=? WHERE id=?`,[stamp,existing.id]);
  else await run(db,`INSERT INTO platform_admins (id,user_id,status,created_by,created_at,updated_at) VALUES (?,?, 'ACTIVE', ?,?,?)`,[makeId('padmin'),user.id,actorUserId,stamp,stamp]);
  return user;
}

export async function revokePlatformAdmin(db,actorUserId,platformAdminId){
  const current=await safeFirst(db,`SELECT id,user_id,status FROM platform_admins WHERE id=?`,[platformAdminId]);if(!current)throw Object.assign(new Error('Platform admin not found'),{status:404});
  if(current.user_id===actorUserId)throw Object.assign(new Error('You cannot revoke your own platform administration access'),{status:409});
  const active=await safeFirst(db,`SELECT COUNT(*) count FROM platform_admins WHERE status='ACTIVE'`);if(Number(active?.count||0)<=1)throw Object.assign(new Error('At least one active platform administrator is required'),{status:409});
  await run(db,`UPDATE platform_admins SET status='REVOKED',updated_at=? WHERE id=?`,[nowIso(),platformAdminId]);
  return current;
}
