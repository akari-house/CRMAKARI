import { all,first,run,makeId,nowIso } from './db.js';

export const CSV_ENTITIES=Object.freeze(['projects','contacts','opportunities','campaigns','fundraising_rounds']);
export const CSV_IMPORT_ENTITIES=Object.freeze(['projects','contacts']);
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const safeCell=value=>{const raw=String(value??'');return /^[=+\-@]/.test(raw)?`'${raw}`:raw;};
const quote=value=>{const raw=safeCell(value);return /[",\r\n]/.test(raw)?`"${raw.replaceAll('"','""')}"`:raw;};

export function parseCsv(input,{maxRows=5000,maxColumns=80}={}){
  const source=String(input||'');if(source.length>5_000_000)throw Object.assign(new Error('CSV file is too large'),{status:413});
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){if(ch==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;continue;}
    if(ch==='"'){quoted=true;continue;}
    if(ch===','){row.push(cell);cell='';if(row.length>maxColumns)throw Object.assign(new Error('CSV has too many columns'),{status:422});continue;}
    if(ch==='\n'||ch==='\r'){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(value=>value!==''))rows.push(row);row=[];if(rows.length>maxRows+1)throw Object.assign(new Error(`CSV exceeds ${maxRows} data rows`),{status:413});continue;}
    cell+=ch;
  }
  row.push(cell);if(row.some(value=>value!==''))rows.push(row);
  if(!rows.length)return{headers:[],records:[]};
  const headers=rows[0].map(value=>text(value,100).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));
  if(headers.some((value,index)=>!value||headers.indexOf(value)!==index))throw Object.assign(new Error('CSV headers must be unique and non-empty'),{status:422});
  return{headers,records:rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,text(values[index],2000)])))};
}

export function toCsv(rows,columns){
  const header=columns.map(column=>quote(column.label||column.key)).join(',');
  return `${header}\r\n${rows.map(row=>columns.map(column=>quote(row[column.key])).join(',')).join('\r\n')}\r\n`;
}

const EXPORTS={
  projects:{sql:`SELECT id,name,domain,category,lifecycle_status,relationship_health,owner_user_id,last_activity_at,next_follow_up_at,created_at,updated_at FROM projects WHERE tenant_id=? ORDER BY updated_at DESC`,columns:['id','name','domain','category','lifecycle_status','relationship_health','owner_user_id','last_activity_at','next_follow_up_at','created_at','updated_at']},
  contacts:{sql:`SELECT c.id,c.project_id,p.name project_name,c.full_name,c.email,c.telegram,c.role_title,c.role_category,c.is_decision_maker,c.is_primary_contact,c.last_contacted_at,c.next_follow_up_at,c.created_at FROM contacts c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? ORDER BY c.created_at DESC`,columns:['id','project_id','project_name','full_name','email','telegram','role_title','role_category','is_decision_maker','is_primary_contact','last_contacted_at','next_follow_up_at','created_at']},
  opportunities:{sql:`SELECT id,project_id,name,service_type,stage,estimated_value,currency,probability_percentage,expected_close_date,next_action,next_follow_up_at,owner_user_id,created_at,updated_at FROM opportunities WHERE tenant_id=? ORDER BY updated_at DESC`,columns:['id','project_id','name','service_type','stage','estimated_value','currency','probability_percentage','expected_close_date','next_action','next_follow_up_at','owner_user_id','created_at','updated_at']},
  campaigns:{sql:`SELECT id,project_id,opportunity_id,name,status,region,start_date,end_date,reporting_due_date,currency,gross_revenue,amount_received,payment_status,next_action,campaign_owner_id,created_at,updated_at FROM campaigns WHERE tenant_id=? ORDER BY updated_at DESC`,columns:['id','project_id','opportunity_id','name','status','region','start_date','end_date','reporting_due_date','currency','gross_revenue','amount_received','payment_status','next_action','campaign_owner_id','created_at','updated_at']},
  fundraising_rounds:{sql:`SELECT id,project_id,round_name,stage,target_amount,currency,valuation,readiness_score,target_close_date,next_action,owner_user_id,created_at,updated_at FROM fundraising_rounds WHERE tenant_id=? ORDER BY updated_at DESC`,columns:['id','project_id','round_name','stage','target_amount','currency','valuation','readiness_score','target_close_date','next_action','owner_user_id','created_at','updated_at']},
};

export async function exportEntityCsv(db,tenantId,entity){
  const key=String(entity||'').toLowerCase(),config=EXPORTS[key];if(!config)throw Object.assign(new Error('CSV export entity is not supported'),{status:422});
  const rows=await all(db,config.sql,[tenantId]);return{entity:key,rowCount:rows.length,csv:toCsv(rows,config.columns.map(key=>({key,label:key})))};
}

function truthy(value){return['1','true','yes','y'].includes(String(value||'').toLowerCase())?1:0;}
async function resolveProject(db,tenantId,record){
  const id=text(record.project_id,160);if(id){const project=await first(db,`SELECT id,name FROM projects WHERE tenant_id=? AND id=?`,[tenantId,id]);if(project)return project;}
  const name=text(record.project_name,200);if(name)return first(db,`SELECT id,name FROM projects WHERE tenant_id=? AND lower(name)=lower(?)`,[tenantId,name]);
  return null;
}

export async function previewCsvImport(db,tenantId,entity,csv){
  const key=String(entity||'').toLowerCase();if(!CSV_IMPORT_ENTITIES.includes(key))throw Object.assign(new Error('CSV import supports projects and contacts in V1'),{status:422});
  const parsed=parseCsv(csv),errors=[],accepted=[];
  for(let index=0;index<parsed.records.length;index++){
    const record=parsed.records[index],row=index+2;
    if(key==='projects'){
      const name=text(record.name,200);if(!name){errors.push({row,error:'name is required'});continue;}
      const domain=text(record.domain,300).toLowerCase();const duplicate=domain?await first(db,`SELECT id FROM projects WHERE tenant_id=? AND lower(domain)=?`,[tenantId,domain]):await first(db,`SELECT id FROM projects WHERE tenant_id=? AND lower(name)=lower(?)`,[tenantId,name]);
      if(duplicate){errors.push({row,error:'project already exists'});continue;}
      accepted.push({row,record:{name,domain:domain||null,category:text(record.category,100)||null,lifecycleStatus:text(record.lifecycle_status,40).toUpperCase()||'PROSPECT',relationshipHealth:text(record.relationship_health,40).toUpperCase()||'WARM',notes:text(record.notes,4000)||null}});continue;
    }
    const fullName=text(record.full_name||record.name,200),contactEmail=text(record.email,320).toLowerCase();if(!fullName||!contactEmail.includes('@')){errors.push({row,error:'full_name and valid email are required'});continue;}
    const project=await resolveProject(db,tenantId,record);if(!project){errors.push({row,error:'project_id or matching project_name is required'});continue;}
    const duplicate=await first(db,`SELECT id FROM contacts WHERE tenant_id=? AND project_id=? AND lower(email)=?`,[tenantId,project.id,contactEmail]);if(duplicate){errors.push({row,error:'contact already exists for project'});continue;}
    accepted.push({row,record:{projectId:project.id,fullName,email:contactEmail,telegram:text(record.telegram,200)||null,roleTitle:text(record.role_title,200)||null,roleCategory:text(record.role_category,100)||null,isDecisionMaker:truthy(record.is_decision_maker),isPrimaryContact:truthy(record.is_primary_contact)}});
  }
  return{entity:key,totalRows:parsed.records.length,acceptedCount:accepted.length,errorCount:errors.length,accepted,errors};
}

export async function commitCsvImport(db,tenantId,userId,entity,csv){
  const preview=await previewCsvImport(db,tenantId,entity,csv),stamp=nowIso();if(preview.errors.length)throw Object.assign(new Error('CSV import contains errors; fix them before commit'),{status:422,details:preview.errors.slice(0,100)});
  for(const item of preview.accepted){const r=item.record;if(preview.entity==='projects')await run(db,`INSERT INTO projects (id,tenant_id,name,domain,category,lifecycle_status,relationship_health,notes,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[makeId('project'),tenantId,r.name,r.domain,r.category,r.lifecycleStatus,r.relationshipHealth,r.notes,stamp,stamp,userId,userId]);else await run(db,`INSERT INTO contacts (id,tenant_id,project_id,full_name,email,telegram,role_title,role_category,is_decision_maker,is_primary_contact,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[makeId('contact'),tenantId,r.projectId,r.fullName,r.email,r.telegram,r.roleTitle,r.roleCategory,r.isDecisionMaker,r.isPrimaryContact,stamp,stamp,userId,userId]);}
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES (?,?,?,?,?,?,?,?)`,[makeId('audit'),tenantId,userId,'CSV_IMPORT_COMMITTED','CSV_IMPORT',preview.entity,JSON.stringify({entity:preview.entity,rowCount:preview.acceptedCount}),stamp]);
  return{entity:preview.entity,imported:preview.acceptedCount};
}
