import { json,error,readJson } from '../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../lib/db.js';
import { requireTenant,requireRole } from '../../lib/permissions.js';
import { FOUNDER_ONBOARDING_KEYS,normalizeOnboardingItem,sanitizeOnboardingItem,onboardingReadiness } from '../../lib/founder-onboarding.js';

const WRITE_ROLES=['OWNER','ADMIN','BD_MANAGER'];
const MISSING_SCHEMA=/(no such table.*founder_onboarding_items|D1_ERROR.*founder_onboarding_items|SQLITE_ERROR.*founder_onboarding_items)/i;
const text=(value,max=8000)=>String(value??'').trim().slice(0,max);
const number=(value)=>Math.max(0,Number(value||0));

async function ensureSchema(db){
  try{await first(db,'SELECT id FROM founder_onboarding_items LIMIT 1');}
  catch(cause){if(MISSING_SCHEMA.test(String(cause?.message||''))){const e=new Error('Founder onboarding migration 0004 must be applied before R71 is available');e.status=503;throw e;}throw cause;}
}

async function tenantRound(db,tenantId,roundId){
  return first(db,`SELECT r.*,p.name AS project_name,p.region AS project_region,p.country AS project_country,p.website AS project_website
    FROM fundraising_rounds r JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.id=? LIMIT 1`,[tenantId,roundId]);
}

async function tenantRounds(db,tenantId){
  return all(db,`SELECT r.*,p.name AS project_name,p.region AS project_region,p.country AS project_country,p.website AS project_website
    FROM fundraising_rounds r JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
    WHERE r.tenant_id=? ORDER BY CASE r.stage WHEN 'OPEN' THEN 0 WHEN 'OUTREACH' THEN 1 WHEN 'DILIGENCE' THEN 2 WHEN 'COMMITMENTS' THEN 3 ELSE 4 END,r.updated_at DESC`,[tenantId]);
}

async function rowsForRound(db,tenantId,roundId){
  return all(db,`SELECT * FROM founder_onboarding_items WHERE tenant_id=? AND round_id=? ORDER BY item_key`,[tenantId,roundId]);
}

function projectShape(round){return {id:round.project_id,name:round.project_name,region:round.project_region,country:round.project_country,website:round.project_website};}
function roundShape(round){return {id:round.id,projectId:round.project_id,projectName:round.project_name,roundName:round.round_name,stage:round.stage,instrument:round.instrument||'',fundingStage:round.funding_stage||'',currency:round.currency||'USD',targetAmount:Number(round.target_amount||0),valuation:Number(round.valuation||0),targetCloseDate:round.target_close_date||null,readinessScore:Number(round.readiness_score||0)};}

async function audit(db,auth,action,entityId,before,after){
  await run(db,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[
    makeId('aud'),auth.tenantId,auth.userId,action,'FOUNDER_ONBOARDING',entityId,JSON.stringify(before||{}),JSON.stringify(after||{}),nowIso(),
  ]);
}

async function buildRound(db,tenantId,round){
  const rows=await rowsForRound(db,tenantId,round.id);const project=projectShape(round);const readiness=onboardingReadiness(rows,round,project);
  const rowMap=new Map(rows.map(row=>[row.item_key,normalizeOnboardingItem(row)]));
  return {round:roundShape(round),project,readiness:{score:readiness.score,complete:readiness.complete,applicable:readiness.applicable,total:readiness.total},items:FOUNDER_ONBOARDING_KEYS.map(key=>readiness.checks.find(item=>item.key===key)||rowMap.get(key)||{key,status:'NOT_STARTED',data:{},evidenceUrl:'',notes:''})};
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;const tenantId=requireTenant(auth);if(!context.env.DB)return error('D1 binding DB is not configured',500);await ensureSchema(context.env.DB);
    const url=new URL(context.request.url),roundId=text(url.searchParams.get('roundId'),120);
    if(roundId){const round=await tenantRound(context.env.DB,tenantId,roundId);if(!round)return error('Fundraising round was not found in this workspace',404);return json({...await buildRound(context.env.DB,tenantId,round),permissions:{canWrite:WRITE_ROLES.includes(auth?.role)}});}
    const rounds=await tenantRounds(context.env.DB,tenantId);const items=await Promise.all(rounds.map(round=>buildRound(context.env.DB,tenantId,round)));
    return json({items,summary:{rounds:items.length,averageReadiness:items.length?Math.round(items.reduce((sum,item)=>sum+item.readiness.score,0)/items.length):0},permissions:{canWrite:WRITE_ROLES.includes(auth?.role)}});
  }catch(cause){console.error('Founder onboarding read failed',cause);return error(cause.message||'Founder onboarding could not be loaded',Number(cause.status||500));}
}

export async function onRequestPost(context){
  try{
    const auth=context.data.auth;const tenantId=requireTenant(auth);requireRole(auth,WRITE_ROLES);if(!context.env.DB)return error('D1 binding DB is not configured',500);await ensureSchema(context.env.DB);
    const body=await readJson(context.request),action=text(body.action,80).toLowerCase();if(action!=='save-item')return error('Founder onboarding action is not supported',404);
    const round=await tenantRound(context.env.DB,tenantId,text(body.roundId,120));if(!round)return error('Fundraising round was not found in this workspace',404);
    const key=String(body.item?.key||body.key||'').toUpperCase();if(!FOUNDER_ONBOARDING_KEYS.includes(key))return error('Founder onboarding item is invalid',422);

    const existing=await first(context.env.DB,'SELECT * FROM founder_onboarding_items WHERE tenant_id=? AND round_id=? AND item_key=? LIMIT 1',[tenantId,round.id,key]);
    let workingRound={...round};
    if(key==='RAISE'){
      const data=body.item?.data||{};const targetAmount=number(data.targetAmount??round.target_amount),valuation=number(data.valuation??round.valuation),instrument=text(data.instrument??round.instrument,100),fundingStage=text(data.fundingStage??round.funding_stage,100);
      if(!instrument&&targetAmount>0)return error('Fundraising instrument is required when a raise target is configured',422);
      await run(context.env.DB,'UPDATE fundraising_rounds SET target_amount=?,valuation=?,instrument=?,funding_stage=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[targetAmount,valuation,instrument||null,fundingStage||null,nowIso(),auth.userId,tenantId,round.id]);
      workingRound={...workingRound,target_amount:targetAmount,valuation,instrument,funding_stage:fundingStage};
    }

    const project=projectShape(workingRound);const item=sanitizeOnboardingItem({...(body.item||{}),key},existing||{},workingRound,project);const now=nowIso(),id=existing?.id||makeId('fonb');
    if(existing){
      await run(context.env.DB,`UPDATE founder_onboarding_items SET status=?,data_json=?,evidence_url=?,notes=?,completed_at=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`,[item.status,JSON.stringify(item.data),item.evidenceUrl||null,item.notes||null,item.complete?existing.completed_at||now:null,now,auth.userId,tenantId,id]);
    }else{
      await run(context.env.DB,`INSERT INTO founder_onboarding_items(id,tenant_id,project_id,round_id,item_key,status,data_json,evidence_url,notes,completed_at,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,tenantId,workingRound.project_id,workingRound.id,key,item.status,JSON.stringify(item.data),item.evidenceUrl||null,item.notes||null,item.complete?now:null,now,now,auth.userId,auth.userId]);
    }

    const savedRows=await rowsForRound(context.env.DB,tenantId,workingRound.id);const readiness=onboardingReadiness(savedRows,workingRound,project);
    await run(context.env.DB,'UPDATE fundraising_rounds SET readiness_score=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[readiness.score,nowIso(),auth.userId,tenantId,workingRound.id]);
    await audit(context.env.DB,auth,existing?'FOUNDER_ONBOARDING_ITEM_UPDATED':'FOUNDER_ONBOARDING_ITEM_CREATED',id,existing?normalizeOnboardingItem(existing):{}, {...item,id,roundId:workingRound.id,projectId:workingRound.project_id,readinessScore:readiness.score});
    const refreshed=await tenantRound(context.env.DB,tenantId,workingRound.id);
    return json({updated:true,item:{...normalizeOnboardingItem({...existing,id,item_key:key,status:item.status,data_json:JSON.stringify(item.data),evidence_url:item.evidenceUrl,notes:item.notes,completed_at:item.complete?(existing?.completed_at||now):null,updated_at:now})},workspace:await buildRound(context.env.DB,tenantId,refreshed)});
  }catch(cause){console.error('Founder onboarding write failed',cause);return error(cause.message||'Founder onboarding update failed',Number(cause.status||500));}
}
