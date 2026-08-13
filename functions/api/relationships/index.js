import { json,error,readJson } from '../../lib/response.js';
import { all,first,run,makeId,nowIso } from '../../lib/db.js';
import { requireTenant,requireRole } from '../../lib/permissions.js';
import { entityType,sanitizeProfile,sanitizePath,sanitizeInteraction,strongestPath } from '../../lib/relationship-intelligence.js';

const WRITE_ROLES=['OWNER','ADMIN','BD_MANAGER','BD_MEMBER'];
const MISSING_SCHEMA=/(no such table.*relationship_|D1_ERROR.*relationship_|SQLITE_ERROR.*relationship_)/i;
const text=(value,max=8000)=>String(value??'').trim().slice(0,max);

async function ensureSchema(db){
  try{await first(db,'SELECT id FROM relationship_profiles LIMIT 1');}
  catch(cause){
    if(MISSING_SCHEMA.test(String(cause?.message||''))){
      const e=new Error('Relationship Intelligence migration 0006 must be applied before R73 is available');
      e.status=503;
      throw e;
    }
    throw cause;
  }
}

async function member(db,tenantId,userId){
  if(!userId)return null;
  return first(db,"SELECT u.id,u.full_name FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' AND u.id=? LIMIT 1",[tenantId,userId]);
}

async function audit(db,auth,action,entityTypeValue,entityId,before,after){
  await run(db,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,[
    makeId('aud'),auth.tenantId,auth.userId,action,entityTypeValue,entityId,JSON.stringify(before||{}),JSON.stringify(after||{}),nowIso(),
  ]);
}

async function resolveEntity(db,tenantId,type,id){
  if(type==='PROJECT')return first(db,`SELECT p.id,p.name AS display_name,p.category,p.lifecycle_status,p.website,p.country,p.region,p.owner_user_id,u.full_name AS owner_name,p.relationship_health,p.last_activity_at,p.next_follow_up_at FROM projects p LEFT JOIN users u ON u.id=p.owner_user_id WHERE p.tenant_id=? AND p.id=? LIMIT 1`,[tenantId,id]);
  if(type==='CONTACT')return first(db,`SELECT c.id,c.full_name AS display_name,c.job_title,c.contact_role,c.email,c.telegram,c.x_handle,c.linkedin_url,c.relationship_strength,c.last_contacted_at,c.next_follow_up_at,c.project_id,p.name AS company_name,p.owner_user_id,u.full_name AS owner_name FROM contacts c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id LEFT JOIN users u ON u.id=p.owner_user_id WHERE c.tenant_id=? AND c.id=? LIMIT 1`,[tenantId,id]);
  if(type==='PARTNER')return first(db,`SELECT p.id,p.name AS display_name,p.partner_type,p.status,p.website,p.contact_name,p.contact_email,p.agreement_status FROM partners p WHERE p.tenant_id=? AND p.id=? LIMIT 1`,[tenantId,id]);
  if(type==='INVESTOR_ORGANISATION')return first(db,`SELECT o.id,o.name AS display_name,o.investor_type,o.website,o.headquarters,o.description,o.conflict_status,o.status FROM investor_organisations o WHERE o.tenant_id=? AND o.id=? LIMIT 1`,[tenantId,id]);
  if(type==='INVESTOR_PERSON')return first(db,`SELECT p.id,p.full_name AS display_name,p.title,p.city,p.bio,p.is_decision_maker,p.organisation_id,o.name AS company_name,o.conflict_status FROM investor_people p LEFT JOIN investor_organisations o ON o.id=p.organisation_id AND o.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.id=? LIMIT 1`,[tenantId,id]);
  return first(db,"SELECT entity_id AS id,display_name,company_name FROM relationship_profiles WHERE tenant_id=? AND entity_type='CREATOR' AND entity_id=? LIMIT 1",[tenantId,id]);
}

async function requireEntity(db,tenantId,type,id){
  const entity=await resolveEntity(db,tenantId,type,id);
  if(!entity){const e=new Error('Relationship entity was not found in this workspace');e.status=404;throw e;}
  return entity;
}

async function searchEntities(db,tenantId,q){
  const like=`%${q.replace(/[%_]/g,'')}%`,limit=10;
  const [projects,contacts,partners,orgs,people,creators]=await Promise.all([
    all(db,`SELECT 'PROJECT' AS entity_type,id,name AS display_name,category AS subtitle FROM projects WHERE tenant_id=? AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?`,[tenantId,like,limit]),
    all(db,`SELECT 'CONTACT' AS entity_type,c.id,c.full_name AS display_name,p.name AS subtitle FROM contacts c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.full_name LIKE ? COLLATE NOCASE ORDER BY c.full_name LIMIT ?`,[tenantId,like,limit]),
    all(db,`SELECT 'PARTNER' AS entity_type,id,name AS display_name,partner_type AS subtitle FROM partners WHERE tenant_id=? AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?`,[tenantId,like,limit]),
    all(db,`SELECT 'INVESTOR_ORGANISATION' AS entity_type,id,name AS display_name,investor_type AS subtitle FROM investor_organisations WHERE tenant_id=? AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?`,[tenantId,like,limit]),
    all(db,`SELECT 'INVESTOR_PERSON' AS entity_type,p.id,p.full_name AS display_name,o.name AS subtitle FROM investor_people p LEFT JOIN investor_organisations o ON o.id=p.organisation_id AND o.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.full_name LIKE ? COLLATE NOCASE ORDER BY p.full_name LIMIT ?`,[tenantId,like,limit]),
    all(db,`SELECT 'CREATOR' AS entity_type,entity_id AS id,display_name,company_name AS subtitle FROM relationship_profiles WHERE tenant_id=? AND entity_type='CREATOR' AND display_name LIKE ? COLLATE NOCASE ORDER BY display_name LIMIT ?`,[tenantId,like,limit]),
  ]);
  return [...projects,...contacts,...partners,...orgs,...people,...creators].slice(0,40);
}

async function genericBundle(db,tenantId,type,id){
  const [profile,pathsOut,pathsIn,interactions,linksOut,linksIn]=await Promise.all([
    first(db,'SELECT * FROM relationship_profiles WHERE tenant_id=? AND entity_type=? AND entity_id=? LIMIT 1',[tenantId,type,id]),
    all(db,'SELECT * FROM relationship_paths WHERE tenant_id=? AND subject_entity_type=? AND subject_entity_id=? ORDER BY updated_at DESC LIMIT 100',[tenantId,type,id]),
    all(db,'SELECT * FROM relationship_paths WHERE tenant_id=? AND target_entity_type=? AND target_entity_id=? ORDER BY updated_at DESC LIMIT 100',[tenantId,type,id]),
    all(db,'SELECT * FROM relationship_interactions WHERE tenant_id=? AND entity_type=? AND entity_id=? ORDER BY occurred_at DESC LIMIT 150',[tenantId,type,id]),
    all(db,"SELECT * FROM relationship_entity_links WHERE tenant_id=? AND source_entity_type=? AND source_entity_id=? AND status!='DISPUTED' ORDER BY updated_at DESC LIMIT 100",[tenantId,type,id]),
    all(db,"SELECT * FROM relationship_entity_links WHERE tenant_id=? AND target_entity_type=? AND target_entity_id=? AND status!='DISPUTED' ORDER BY updated_at DESC LIMIT 100",[tenantId,type,id]),
  ]);
  return{profile,paths:[...pathsOut,...pathsIn],interactions,links:[...linksOut,...linksIn]};
}

async function projectBundle(db,tenantId,projectId){
  const [contacts,opportunities,campaigns,rounds,activities,payments]=await Promise.all([
    all(db,'SELECT id,full_name,job_title,contact_role,relationship_strength,last_contacted_at,next_follow_up_at FROM contacts WHERE tenant_id=? AND project_id=? ORDER BY is_primary_contact DESC,full_name',[tenantId,projectId]),
    all(db,'SELECT id,name,service_type,stage,estimated_value,currency,probability_percentage,expected_close_date,next_action,next_follow_up_at,won_at FROM opportunities WHERE tenant_id=? AND project_id=? ORDER BY updated_at DESC',[tenantId,projectId]),
    all(db,'SELECT id,name,status,start_date,end_date,gross_revenue,currency,akari_net_revenue,amount_received,next_action FROM campaigns WHERE tenant_id=? AND project_id=? ORDER BY updated_at DESC',[tenantId,projectId]),
    all(db,'SELECT id,round_name,stage,currency,target_amount,valuation,readiness_score,target_close_date FROM fundraising_rounds WHERE tenant_id=? AND project_id=? ORDER BY updated_at DESC',[tenantId,projectId]),
    all(db,'SELECT id,activity_type,subject,description,outcome,occurred_at,next_action,follow_up_at,user_id FROM activities WHERE tenant_id=? AND project_id=? ORDER BY occurred_at DESC LIMIT 150',[tenantId,projectId]),
    all(db,'SELECT amount,currency,status,received_date FROM payments WHERE tenant_id=? AND project_id=?',[tenantId,projectId]),
  ]);
  const collectedRevenue=payments.filter(p=>p.status==='PAID').reduce((s,p)=>s+Number(p.amount||0),0);
  const wonValue=opportunities.filter(o=>o.stage==='WON').reduce((s,o)=>s+Number(o.estimated_value||0),0);
  const campaignNetRevenue=campaigns.reduce((s,c)=>s+Number(c.akari_net_revenue||0),0);
  return{contacts,opportunities,campaigns,rounds,activities,value:{collectedRevenue,wonValue,campaignNetRevenue,paymentCurrencies:[...new Set(payments.map(p=>p.currency).filter(Boolean))]}};
}

async function contactBundle(db,tenantId,contactId,projectId){
  const [activities,opportunities,project]=await Promise.all([
    all(db,'SELECT id,activity_type,subject,description,outcome,occurred_at,next_action,follow_up_at,user_id FROM activities WHERE tenant_id=? AND contact_id=? ORDER BY occurred_at DESC LIMIT 150',[tenantId,contactId]),
    all(db,'SELECT id,name,stage,estimated_value,currency,probability_percentage,next_action,next_follow_up_at FROM opportunities WHERE tenant_id=? AND primary_contact_id=? ORDER BY updated_at DESC',[tenantId,contactId]),
    projectId?projectBundle(db,tenantId,projectId):null,
  ]);
  return{activities,opportunities,project};
}

async function investorBundle(db,tenantId,type,id){
  let targets=[];
  if(type==='INVESTOR_ORGANISATION')targets=await all(db,`SELECT t.id,t.round_id,t.stage,t.priority,t.fit_score,t.expected_check,t.probability_percentage,t.warm_intro_source,t.introduction_status,t.last_contact_at,t.next_follow_up_at,t.next_action,r.round_name,r.project_id,p.name AS project_name FROM fundraising_targets t JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id WHERE t.tenant_id=? AND t.organisation_id=? ORDER BY t.updated_at DESC`,[tenantId,id]);
  else targets=await all(db,`SELECT t.id,t.round_id,t.stage,t.priority,t.fit_score,t.expected_check,t.probability_percentage,t.warm_intro_source,t.introduction_status,t.last_contact_at,t.next_follow_up_at,t.next_action,r.round_name,r.project_id,p.name AS project_name FROM fundraising_targets t JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id WHERE t.tenant_id=? AND t.primary_person_id=? ORDER BY t.updated_at DESC`,[tenantId,id]);
  const targetIds=targets.map(t=>t.id);
  let commitments=[],intro=[];
  if(targetIds.length){
    const marks=targetIds.map(()=>'?').join(',');
    commitments=await all(db,`SELECT id,target_id,status,committed_amount,allocated_amount,received_amount,currency,committed_at,received_at FROM fundraising_commitments WHERE tenant_id=? AND target_id IN (${marks}) ORDER BY updated_at DESC`,[tenantId,...targetIds]);
    intro=await all(db,`SELECT id,target_id,connector_contact_id,connector_name,relationship_owner_user_id,relationship_strength,verification_status,consent_status,request_status,last_verified_at,outcome FROM fundraising_introduction_paths WHERE tenant_id=? AND target_id IN (${marks}) ORDER BY updated_at DESC`,[tenantId,...targetIds]);
  }
  return{targets,commitments,introductionPaths:intro,value:{committed:commitments.reduce((s,c)=>s+Number(c.committed_amount||0),0),received:commitments.reduce((s,c)=>s+Number(c.received_amount||0),0),currencies:[...new Set(commitments.map(c=>c.currency).filter(Boolean))]}};
}

async function partnerBundle(db,tenantId,id){
  const [referrals,projects]=await Promise.all([
    all(db,'SELECT id,project_id,opportunity_id,campaign_id,referral_amount,currency,payment_status,due_date,paid_date FROM referrals WHERE tenant_id=? AND partner_id=? ORDER BY updated_at DESC',[tenantId,id]),
    all(db,'SELECT id,name,lifecycle_status,customer_since FROM projects WHERE tenant_id=? AND referral_partner_id=? ORDER BY updated_at DESC',[tenantId,id]),
  ]);
  return{referrals,projects,value:{referralValue:referrals.reduce((s,r)=>s+Number(r.referral_amount||0),0),paidReferralValue:referrals.filter(r=>r.payment_status==='PAID').reduce((s,r)=>s+Number(r.referral_amount||0),0),currencies:[...new Set(referrals.map(r=>r.currency).filter(Boolean))]}};
}

function canonicalCandidates(generic,domain={}){
  const paths=[...(generic.paths||[])];
  for(const p of domain.introductionPaths||[])paths.push({
    id:`fundraise:${p.id}`,source:'FUNDRAISING_INTRO_PATH',subject_entity_type:'AKARI_CONNECTOR',
    subject_entity_id:p.relationship_owner_user_id||p.connector_contact_id||p.connector_name||'',
    target_entity_type:'INVESTOR',target_entity_id:'',connector_user_id:p.relationship_owner_user_id,
    connector_contact_id:p.connector_contact_id,connector_name:p.connector_name,path_type:'WARM_INTRO',
    strength:p.relationship_strength,verification_status:p.verification_status,consent_status:p.consent_status,
    evidence_note:p.outcome,last_verified_at:p.last_verified_at,
  });
  if(generic.profile?.relationship_owner_user_id)paths.push({
    id:'profile-owner',source:'RELATIONSHIP_PROFILE',connector_user_id:generic.profile.relationship_owner_user_id,
    connector_name:null,path_type:'DIRECT',strength:generic.profile.strength,verification_status:'VERIFIED',
    consent_status:generic.profile.consent_status,evidence_note:generic.profile.introduction_source,
  });
  return paths;
}

async function decorateConnectorNames(db,tenantId,paths=[]){
  const userIds=[...new Set(paths.map(p=>p.connector_user_id||p.connectorUserId).filter(Boolean))];
  const contactIds=[...new Set(paths.map(p=>p.connector_contact_id||p.connectorContactId).filter(Boolean))];
  let users=[],contacts=[];
  if(userIds.length){
    const marks=userIds.map(()=>'?').join(',');
    users=await all(db,`SELECT u.id,u.full_name FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' AND u.id IN (${marks})`,[tenantId,...userIds]);
  }
  if(contactIds.length){
    const marks=contactIds.map(()=>'?').join(',');
    contacts=await all(db,`SELECT id,full_name FROM contacts WHERE tenant_id=? AND id IN (${marks})`,[tenantId,...contactIds]);
  }
  const userMap=new Map(users.map(row=>[row.id,row.full_name]));
  const contactMap=new Map(contacts.map(row=>[row.id,row.full_name]));
  return paths.map(path=>({
    ...path,
    connector_name:path.connector_name||path.connectorName||userMap.get(path.connector_user_id||path.connectorUserId)||contactMap.get(path.connector_contact_id||path.connectorContactId)||null,
  }));
}

async function ownerDisplayName(db,tenantId,profile){
  if(!profile?.relationship_owner_user_id)return null;
  return (await member(db,tenantId,profile.relationship_owner_user_id))?.full_name||null;
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth,tenantId=requireTenant(auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    await ensureSchema(context.env.DB);
    const url=new URL(context.request.url),q=text(url.searchParams.get('q'),200),rawType=text(url.searchParams.get('entityType'),80),id=text(url.searchParams.get('entityId'),120);
    if(!rawType||!id){
      const items=q?await searchEntities(context.env.DB,tenantId,q):[];
      return json({items,permissions:{canWrite:WRITE_ROLES.includes(auth.role)}});
    }
    const type=entityType(rawType),entity=await requireEntity(context.env.DB,tenantId,type,id),generic=await genericBundle(context.env.DB,tenantId,type,id);
    let domain={};
    if(type==='PROJECT')domain=await projectBundle(context.env.DB,tenantId,id);
    else if(type==='CONTACT')domain=await contactBundle(context.env.DB,tenantId,id,entity.project_id);
    else if(['INVESTOR_ORGANISATION','INVESTOR_PERSON'].includes(type))domain=await investorBundle(context.env.DB,tenantId,type,id);
    else if(type==='PARTNER')domain=await partnerBundle(context.env.DB,tenantId,id);
    const candidates=await decorateConnectorNames(context.env.DB,tenantId,canonicalCandidates(generic,domain));
    const strongest=strongestPath(candidates);
    const recent=[...(generic.interactions||[]),...(domain.activities||[])].sort((a,b)=>String(b.occurred_at||'').localeCompare(String(a.occurred_at||''))).slice(0,100);
    const profile=generic.profile?{...generic.profile,relationship_owner_name:await ownerDisplayName(context.env.DB,tenantId,generic.profile)}:null;
    return json({entityType:type,entity,profile,paths:candidates,strongestRelationship:strongest,interactions:recent,links:generic.links,domain,value:domain.value||domain.project?.value||{},permissions:{canWrite:WRITE_ROLES.includes(auth.role)}});
  }catch(cause){
    console.error('R73 relationship 360 read failed',cause);
    return error(cause.message||'Relationship 360 could not be loaded',Number(cause.status||500));
  }
}

export async function onRequestPost(context){
  try{
    const auth=context.data.auth,tenantId=requireTenant(auth);
    requireRole(auth,WRITE_ROLES);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    await ensureSchema(context.env.DB);
    const body=await readJson(context.request),action=text(body.action,80).toLowerCase();

    if(action==='save-profile'){
      const type=entityType(body.item?.entityType),id=text(body.item?.entityId,120);
      let canonical=null;
      if(type!=='CREATOR')canonical=await requireEntity(context.env.DB,tenantId,type,id);
      const existing=await first(context.env.DB,'SELECT * FROM relationship_profiles WHERE tenant_id=? AND entity_type=? AND entity_id=? LIMIT 1',[tenantId,type,id]);
      const item=sanitizeProfile({...body.item,displayName:body.item?.displayName||canonical?.display_name,companyName:body.item?.companyName||canonical?.company_name},existing||{});
      if(type==='CREATOR'&&!item.displayName)return error('Creator display name is required',422);
      if(item.relationshipOwnerUserId&&!await member(context.env.DB,tenantId,item.relationshipOwnerUserId))return error('Relationship owner is not an active workspace member',422);
      if(item.introductionSourceContactId&&!await first(context.env.DB,'SELECT id FROM contacts WHERE tenant_id=? AND id=? LIMIT 1',[tenantId,item.introductionSourceContactId]))return error('Introduction source contact was not found in this workspace',404);
      const rowId=existing?.id||makeId('rel'),now=nowIso();
      if(existing)await run(context.env.DB,'UPDATE relationship_profiles SET display_name=?,company_name=?,relationship_owner_user_id=?,strength=?,strength_score=?,introduction_source=?,introduction_source_contact_id=?,consent_status=?,conflict_status=?,last_interaction_at=?,next_action=?,next_action_at=?,notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[item.displayName||null,item.companyName||null,item.relationshipOwnerUserId||null,item.strength,item.strengthScore,item.introductionSource||null,item.introductionSourceContactId||null,item.consentStatus,item.conflictStatus,item.lastInteractionAt||null,item.nextAction||null,item.nextActionAt||null,item.notes||null,now,auth.userId,tenantId,rowId]);
      else await run(context.env.DB,'INSERT INTO relationship_profiles(id,tenant_id,entity_type,entity_id,display_name,company_name,relationship_owner_user_id,strength,strength_score,introduction_source,introduction_source_contact_id,consent_status,conflict_status,last_interaction_at,next_action,next_action_at,notes,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[rowId,tenantId,item.entityType,item.entityId,item.displayName||null,item.companyName||null,item.relationshipOwnerUserId||null,item.strength,item.strengthScore,item.introductionSource||null,item.introductionSourceContactId||null,item.consentStatus,item.conflictStatus,item.lastInteractionAt||null,item.nextAction||null,item.nextActionAt||null,item.notes||null,now,now,auth.userId,auth.userId]);
      await audit(context.env.DB,auth,existing?'RELATIONSHIP_PROFILE_UPDATED':'RELATIONSHIP_PROFILE_CREATED','RELATIONSHIP_PROFILE',rowId,existing||{},item);
      return json({updated:true,id:rowId});
    }

    if(action==='save-path'){
      const existing=body.item?.id?await first(context.env.DB,'SELECT * FROM relationship_paths WHERE tenant_id=? AND id=? LIMIT 1',[tenantId,text(body.item.id,120)]):null;
      const item=sanitizePath(body.item||{},existing||{});
      await requireEntity(context.env.DB,tenantId,item.subjectEntityType,item.subjectEntityId);
      await requireEntity(context.env.DB,tenantId,item.targetEntityType,item.targetEntityId);
      if(item.connectorUserId&&!await member(context.env.DB,tenantId,item.connectorUserId))return error('Connector user is not an active workspace member',422);
      if(item.connectorContactId&&!await first(context.env.DB,'SELECT id FROM contacts WHERE tenant_id=? AND id=? LIMIT 1',[tenantId,item.connectorContactId]))return error('Connector contact was not found in this workspace',404);
      const id=existing?.id||makeId('rpath'),now=nowIso();
      if(existing)await run(context.env.DB,'UPDATE relationship_paths SET subject_entity_type=?,subject_entity_id=?,target_entity_type=?,target_entity_id=?,connector_user_id=?,connector_contact_id=?,connector_name=?,path_type=?,strength=?,verification_status=?,consent_status=?,evidence_note=?,last_verified_at=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?',[item.subjectEntityType,item.subjectEntityId,item.targetEntityType,item.targetEntityId,item.connectorUserId||null,item.connectorContactId||null,item.connectorName||null,item.pathType,item.strength,item.verificationStatus,item.consentStatus,item.evidenceNote||null,item.lastVerifiedAt||null,now,auth.userId,tenantId,id]);
      else await run(context.env.DB,'INSERT INTO relationship_paths(id,tenant_id,subject_entity_type,subject_entity_id,target_entity_type,target_entity_id,connector_user_id,connector_contact_id,connector_name,path_type,strength,verification_status,consent_status,evidence_note,last_verified_at,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,tenantId,item.subjectEntityType,item.subjectEntityId,item.targetEntityType,item.targetEntityId,item.connectorUserId||null,item.connectorContactId||null,item.connectorName||null,item.pathType,item.strength,item.verificationStatus,item.consentStatus,item.evidenceNote||null,item.lastVerifiedAt||null,now,now,auth.userId,auth.userId]);
      await audit(context.env.DB,auth,existing?'RELATIONSHIP_PATH_UPDATED':'RELATIONSHIP_PATH_CREATED','RELATIONSHIP_PATH',id,existing||{},item);
      return json({updated:true,id});
    }

    if(action==='log-interaction'){
      const item=sanitizeInteraction(body.item||{});
      await requireEntity(context.env.DB,tenantId,item.entityType,item.entityId);
      for(const [table,key] of [['projects','projectId'],['contacts','contactId'],['opportunities','opportunityId'],['campaigns','campaignId'],['fundraising_rounds','roundId']]){
        if(item[key]&&!await first(context.env.DB,`SELECT id FROM ${table} WHERE tenant_id=? AND id=? LIMIT 1`,[tenantId,item[key]]))return error(`Linked ${key} was not found in this workspace`,404);
      }
      const id=makeId('rint'),now=nowIso();
      await run(context.env.DB,'INSERT INTO relationship_interactions(id,tenant_id,entity_type,entity_id,interaction_type,subject,summary,outcome,occurred_at,next_action,next_action_at,project_id,contact_id,opportunity_id,campaign_id,round_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,tenantId,item.entityType,item.entityId,item.interactionType,item.subject||null,item.summary,item.outcome||null,item.occurredAt,item.nextAction||null,item.nextActionAt||null,item.projectId||null,item.contactId||null,item.opportunityId||null,item.campaignId||null,item.roundId||null,now,auth.userId]);
      await run(context.env.DB,`INSERT INTO relationship_profiles(id,tenant_id,entity_type,entity_id,last_interaction_at,next_action,next_action_at,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET last_interaction_at=excluded.last_interaction_at,next_action=CASE WHEN excluded.next_action IS NOT NULL THEN excluded.next_action ELSE relationship_profiles.next_action END,next_action_at=CASE WHEN excluded.next_action_at IS NOT NULL THEN excluded.next_action_at ELSE relationship_profiles.next_action_at END,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,[makeId('rel'),tenantId,item.entityType,item.entityId,item.occurredAt,item.nextAction||null,item.nextActionAt||null,now,now,auth.userId,auth.userId]);
      await audit(context.env.DB,auth,'RELATIONSHIP_INTERACTION_LOGGED','RELATIONSHIP_INTERACTION',id,{},item);
      return json({updated:true,id});
    }

    if(action==='save-link'){
      const item=body.item||{},sourceType=entityType(item.sourceEntityType),targetType=entityType(item.targetEntityType),sourceId=text(item.sourceEntityId,120),targetId=text(item.targetEntityId,120),linkType=text(item.linkType||'OTHER',80).toUpperCase();
      if(!['WORKS_AT','FOUNDER_OF','INVESTOR_AT','ADVISOR_TO','CREATOR_FOR','PARTNER_WITH','CLIENT_OF','INTRODUCED_BY','OTHER'].includes(linkType))return error('Relationship link type is invalid',422);
      await requireEntity(context.env.DB,tenantId,sourceType,sourceId);
      await requireEntity(context.env.DB,tenantId,targetType,targetId);
      const id=makeId('rlink'),now=nowIso();
      await run(context.env.DB,'INSERT INTO relationship_entity_links(id,tenant_id,source_entity_type,source_entity_id,target_entity_type,target_entity_id,link_type,status,source_note,started_at,ended_at,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,tenantId,sourceType,sourceId,targetType,targetId,linkType,'ACTIVE',text(item.sourceNote,4000)||null,text(item.startedAt,100)||null,text(item.endedAt,100)||null,now,now,auth.userId,auth.userId]);
      await audit(context.env.DB,auth,'RELATIONSHIP_ENTITY_LINK_CREATED','RELATIONSHIP_LINK',id,{},item);
      return json({updated:true,id});
    }

    return error('Relationship Intelligence action is not supported',404);
  }catch(cause){
    console.error('R73 relationship write failed',cause);
    return error(cause.message||'Relationship Intelligence update failed',Number(cause.status||500));
  }
}
