import { json,error,readJson } from '../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../lib/db.js';

const text=(value,max=1000)=>String(value??'').trim().slice(0,max);

export async function onRequestGet(context){
  try{
    const auth=context.data.auth,url=new URL(context.request.url),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||50))),cursor=url.searchParams.get('cursor')||'';
    const bindings=[auth.tenantId];let where='tenant_id=?';
    if(cursor){where+=' AND id > ?';bindings.push(cursor);}
    bindings.push(limit+1);
    const rows=await all(context.env.DB,`SELECT id,name,slug,website,category,ecosystem,country,region,lifecycle_status,relationship_health,last_activity_at,next_follow_up_at,created_at,updated_at FROM projects WHERE ${where} ORDER BY id ASC LIMIT ?`,bindings),hasMore=rows.length>limit,items=rows.slice(0,limit);
    return json({items,nextCursor:hasMore?items.at(-1)?.id||null:null});
  }catch(cause){console.error('R76 external projects read failed',cause);return error(cause.message||'Projects could not be loaded',Number(cause.status||500));}
}

export async function onRequestPost(context){
  try{
    const auth=context.data.auth,body=await readJson(context.request),name=text(body.name,200);if(!name)return error('Project name is required',422);
    const website=text(body.website,500)||null;
    const duplicate=website?await first(context.env.DB,`SELECT id FROM projects WHERE tenant_id=? AND lower(website)=lower(?)`,[auth.tenantId,website]):await first(context.env.DB,`SELECT id FROM projects WHERE tenant_id=? AND lower(name)=lower(?)`,[auth.tenantId,name]);
    if(duplicate)return error('Project already exists',409,{projectId:duplicate.id});
    const id=makeId('project'),stamp=nowIso();
    await run(context.env.DB,`INSERT INTO projects (id,tenant_id,name,website,category,ecosystem,country,region,lifecycle_status,relationship_health,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'PROSPECT','WARM',?,?,?)`,[id,auth.tenantId,name,website,text(body.category,100)||null,text(body.ecosystem,100)||null,text(body.country,100)||null,text(body.region,100)||null,text(body.description,4000)||null,stamp,stamp]);
    return json({created:true,project:{id,name,website,category:text(body.category,100)||null,lifecycleStatus:'PROSPECT'}},201);
  }catch(cause){console.error('R76 external projects write failed',cause);return error(cause.message||'Project could not be created',Number(cause.status||500));}
}
