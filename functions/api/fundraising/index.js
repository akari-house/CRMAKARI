import { json,error,readJson } from '../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../lib/db.js';
import { requireTenant,canViewFinance } from '../../lib/permissions.js';
import { parseFundraisingFlags,sanitizeCapitalRoom,capitalRoomSummary } from '../../lib/fundraising-os.js';
const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER']);
async function settings(db,tenantId){return first(db,'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1',[tenantId]);}
async function projects(db,tenantId){return all(db,'SELECT id,name,category,region,website,funding_stage,total_funds_raised,currency,valuation,owner_user_id FROM projects WHERE tenant_id = ? ORDER BY name COLLATE NOCASE',[tenantId]);}
async function member(db,tenantId,userId){if(!userId)return null;return first(db,"SELECT u.id FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' AND u.id=? LIMIT 1",[tenantId,userId]);}
async function persist(db,auth,tenantId,flags,action,entityId,before,after){
  const payload=JSON.stringify(flags); const row=await settings(db,tenantId);
  if(row) await run(db,'UPDATE tenant_settings SET feature_flags_json = ?, updated_at = ? WHERE tenant_id = ?',[payload,nowIso(),tenantId]);
  else await run(db,'INSERT INTO tenant_settings (tenant_id,feature_flags_json,created_at,updated_at) VALUES (?, ?, ?, ?)',[tenantId,payload,nowIso(),nowIso()]);
  await run(db,"INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?, ?, ?, ?, 'FUNDRAISING_CAPITAL_ROOM', ?, ?, ?, ?)",[makeId('aud'),tenantId,auth.userId,action,entityId,JSON.stringify(before||{}),JSON.stringify(after||{}),nowIso()]);
}
export async function onRequestGet(context){try{
  const auth=context.data.auth; const tenantId=requireTenant(auth); if(!context.env.DB)return error('D1 binding DB is not configured',500);
  const [settingRow,projectRows]=await Promise.all([settings(context.env.DB,tenantId),projects(context.env.DB,tenantId)]);
  const {rooms}=parseFundraisingFlags(settingRow?.feature_flags_json); const projectMap=new Map(projectRows.map(p=>[p.id,p]));
  const items=rooms.filter(r=>projectMap.has(r.projectId)).map(r=>({...r,project:projectMap.get(r.projectId)}));
  return json({items,projects:projectRows,summary:capitalRoomSummary(items),permissions:{canWrite:WRITE_ROLES.has(auth?.role),canFinance:canViewFinance(auth)}});
}catch(cause){return error(cause.message||'Fundraising workspace could not be loaded',Number(cause.status||500));}}
export async function onRequestPost(context){try{
  const auth=context.data.auth; const tenantId=requireTenant(auth); if(!WRITE_ROLES.has(auth?.role))return error('Owner, Admin or BD Manager permission is required',403);
  const body=await readJson(context.request); if(!context.env.DB)return json({updated:true,demo:true});
  const project=await first(context.env.DB,'SELECT id,name FROM projects WHERE tenant_id = ? AND id = ? LIMIT 1',[tenantId,String(body.projectId||'')]);
  if(!project)return error('Selected project was not found in this workspace',404);
  if(body.ownerUserId && !(await member(context.env.DB,tenantId,String(body.ownerUserId))))return error('Selected fundraising owner is not an active workspace member',422);
  const settingRow=await settings(context.env.DB,tenantId); const parsed=parseFundraisingFlags(settingRow?.feature_flags_json); const index=parsed.rooms.findIndex(r=>r.id===body.id||r.projectId===project.id);
  const existing=index>=0?parsed.rooms[index]:{}; const room=sanitizeCapitalRoom({...body,projectId:project.id,projectName:project.name},existing);
  if(index>=0)parsed.rooms[index]=room;else parsed.rooms.push(room); parsed.flags.fundraisingCapitalRooms=parsed.rooms.slice(0,250);
  await persist(context.env.DB,auth,tenantId,parsed.flags,index>=0?'FUNDRAISING_ROOM_UPDATED':'FUNDRAISING_ROOM_CREATED',room.id,existing,room);
  return json({updated:true,item:room,summary:capitalRoomSummary(parsed.rooms)});
}catch(cause){return error(cause.message||'Capital Room could not be saved',Number(cause.status||500));}}
