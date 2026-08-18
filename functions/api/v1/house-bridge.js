import { json,error,readJson } from '../../lib/response.js';
import { first,run,makeId,nowIso } from '../../lib/db.js';

const text=(value,max=1000)=>String(value??'').trim().slice(0,max);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function tableExists(db,name){
  return Boolean(await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",[name]));
}

async function ensureSchema(db){
  if(!await tableExists(db,'external_entity_links')||!await tableExists(db,'agreement_counterparty_identity')){
    throw Object.assign(new Error('House boundary bridge migration 0010 is required'),{status:503});
  }
}

async function validateLocalEntity(db,tenantId,type,id){
  const tables={PROJECT:'projects',CONTACT:'contacts',AGREEMENT:'agreements'};
  const table=tables[type];
  if(!table)return null;
  return first(db,`SELECT id FROM ${table} WHERE tenant_id=? AND id=? LIMIT 1`,[tenantId,id]);
}

async function upsertLink(db,auth,body){
  const externalEntityType=text(body.externalEntityType,40).toUpperCase();
  const externalEntityId=text(body.externalEntityId,160);
  const localEntityType=text(body.localEntityType,40).toUpperCase();
  const localEntityId=text(body.localEntityId,160);
  const allowed=new Set(['PROJECT:PROJECT','MEMBER:CONTACT','AGREEMENT:AGREEMENT']);

  if(!externalEntityId||!localEntityId||!allowed.has(`${externalEntityType}:${localEntityType}`)){
    throw Object.assign(new Error('A supported House-to-CRM entity mapping is required'),{status:422});
  }
  if(!await validateLocalEntity(db,auth.tenantId,localEntityType,localEntityId)){
    throw Object.assign(new Error('The CRM entity does not exist in this workspace'),{status:404});
  }

  const existing=await first(
    db,
    `SELECT id,local_entity_id
       FROM external_entity_links
      WHERE tenant_id=?
        AND external_system='AKARI_HOUSE'
        AND external_entity_type=?
        AND external_entity_id=?
        AND local_entity_type=?
      LIMIT 1`,
    [auth.tenantId,externalEntityType,externalEntityId,localEntityType],
  );
  if(existing&&existing.local_entity_id!==localEntityId){
    throw Object.assign(new Error('This House entity is already linked to a different CRM record'),{status:409});
  }
  if(existing)return{created:false,id:existing.id};

  const id=makeId('xlink'),stamp=nowIso();
  await run(
    db,
    `INSERT INTO external_entity_links
       (id,tenant_id,external_system,external_entity_type,external_entity_id,local_entity_type,local_entity_id,metadata_json,created_at,updated_at)
     VALUES (?,?,'AKARI_HOUSE',?,?,?,?,?,?,?,?)`,
    [
      id,
      auth.tenantId,
      externalEntityType,
      externalEntityId,
      localEntityType,
      localEntityId,
      body.metadata&&typeof body.metadata==='object'?JSON.stringify(body.metadata):null,
      stamp,
      stamp,
    ],
  );
  await run(
    db,
    `INSERT INTO audit_logs
       (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at)
     VALUES (?,?,NULL,'HOUSE_BRIDGE_LINK_CREATED','EXTERNAL_ENTITY_LINK',?,?,?)`,
    [
      makeId('audit'),
      auth.tenantId,
      id,
      JSON.stringify({apiKeyId:auth.apiKeyId,externalEntityType,externalEntityId,localEntityType,localEntityId}),
      stamp,
    ],
  );
  return{created:true,id};
}

async function bindAgreementCounterparty(db,auth,body){
  const agreementId=text(body.agreementId,160);
  const houseMemberId=text(body.houseMemberId,160);
  const contactId=text(body.contactId,160)||null;
  const email=text(body.email,254).toLowerCase()||null;
  if(!agreementId||!houseMemberId)throw Object.assign(new Error('agreementId and houseMemberId are required'),{status:422});
  if(email&&!EMAIL.test(email))throw Object.assign(new Error('Counterparty email is invalid'),{status:422});

  const agreement=await first(db,'SELECT id,project_id FROM agreements WHERE tenant_id=? AND id=? LIMIT 1',[auth.tenantId,agreementId]);
  if(!agreement)throw Object.assign(new Error('Agreement was not found in this workspace'),{status:404});
  if(contactId){
    const contact=await first(db,'SELECT id,project_id FROM contacts WHERE tenant_id=? AND id=? LIMIT 1',[auth.tenantId,contactId]);
    if(!contact)throw Object.assign(new Error('Contact was not found in this workspace'),{status:404});
    if(contact.project_id!==agreement.project_id)throw Object.assign(new Error('Agreement counterparty contact must belong to the agreement project'),{status:422});
  }

  const existing=await first(db,'SELECT external_member_id FROM agreement_counterparty_identity WHERE tenant_id=? AND agreement_id=? LIMIT 1',[auth.tenantId,agreementId]);
  if(existing?.external_member_id&&existing.external_member_id!==houseMemberId){
    throw Object.assign(new Error('Agreement is already bound to a different House member'),{status:409});
  }

  const stamp=nowIso();
  await run(
    db,
    `INSERT INTO agreement_counterparty_identity
       (agreement_id,tenant_id,contact_id,external_system,external_member_id,email,created_at,updated_at)
     VALUES (?, ?, ?, 'AKARI_HOUSE', ?, ?, ?, ?)
     ON CONFLICT(agreement_id) DO UPDATE SET
       contact_id=COALESCE(excluded.contact_id,agreement_counterparty_identity.contact_id),
       external_member_id=excluded.external_member_id,
       email=COALESCE(excluded.email,agreement_counterparty_identity.email),
       updated_at=excluded.updated_at`,
    [agreementId,auth.tenantId,contactId,houseMemberId,email,stamp,stamp],
  );

  await run(
    db,
    `INSERT INTO audit_logs
       (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at)
     VALUES (?,?,NULL,'HOUSE_BRIDGE_COUNTERPARTY_BOUND','AGREEMENT',?,?,?)`,
    [
      makeId('audit'),
      auth.tenantId,
      agreementId,
      JSON.stringify({apiKeyId:auth.apiKeyId,houseMemberId,contactId,emailPresent:Boolean(email)}),
      stamp,
    ],
  );
  return{bound:true,agreementId};
}

export async function onRequestPost(context){
  try{
    const auth=context.data.auth;
    await ensureSchema(context.env.DB);
    const body=await readJson(context.request);
    const operation=text(body.operation,80).toLowerCase();
    if(operation==='link-entity')return json(await upsertLink(context.env.DB,auth,body));
    if(operation==='bind-agreement-counterparty')return json(await bindAgreementCounterparty(context.env.DB,auth,body));
    return error('Unsupported House bridge operation',422);
  }catch(cause){
    console.error('R84 House bridge write failed',cause);
    return error(cause.message||'House bridge update failed',Number(cause.status||500));
  }
}
