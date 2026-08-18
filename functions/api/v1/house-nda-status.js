import { json,error } from '../../lib/response.js';
import { first } from '../../lib/db.js';

const text=(value,max=500)=>String(value??'').trim().slice(0,max);

async function tableExists(db,name){
  return Boolean(await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",[name]));
}

export async function onRequestGet(context){
  try{
    const auth=context.data.auth;
    const url=new URL(context.request.url);
    const houseProjectId=text(url.searchParams.get('houseProjectId'),160);
    const houseMemberId=text(url.searchParams.get('houseMemberId'),160);

    if(!houseProjectId||!houseMemberId){
      return error('houseProjectId and houseMemberId are required',422);
    }

    if(!await tableExists(context.env.DB,'external_entity_links')||!await tableExists(context.env.DB,'agreement_counterparty_identity')){
      return error('House boundary bridge migration 0010 is required',503);
    }

    const projectLink=await first(
      context.env.DB,
      `SELECT eel.local_entity_id AS project_id
         FROM external_entity_links eel
         JOIN projects p
           ON p.id=eel.local_entity_id
          AND p.tenant_id=eel.tenant_id
        WHERE eel.tenant_id=?
          AND eel.external_system='AKARI_HOUSE'
          AND eel.external_entity_type='PROJECT'
          AND eel.external_entity_id=?
          AND eel.local_entity_type='PROJECT'
        LIMIT 1`,
      [auth.tenantId,houseProjectId],
    );

    const checkedAt=new Date().toISOString();
    if(!projectLink){
      return json({
        signed:false,
        authoritative:true,
        source:'CRM_BY_AKARI',
        reason:'PROJECT_NOT_LINKED',
        checkedAt,
      });
    }

    const nda=await first(
      context.env.DB,
      `SELECT a.id,a.status,a.signed_at,a.activated_at,a.end_date
         FROM agreements a
         JOIN agreement_counterparty_identity aci
           ON aci.agreement_id=a.id
          AND aci.tenant_id=a.tenant_id
        WHERE a.tenant_id=?
          AND a.project_id=?
          AND a.agreement_type='NDA'
          AND a.status IN ('SIGNED','ACTIVE')
          AND (a.end_date IS NULL OR a.end_date > datetime('now'))
          AND aci.external_system='AKARI_HOUSE'
          AND aci.external_member_id=?
        ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                 COALESCE(a.activated_at,a.signed_at,a.updated_at) DESC
        LIMIT 1`,
      [auth.tenantId,projectLink.project_id,houseMemberId],
    );

    if(!nda){
      return json({
        signed:false,
        authoritative:true,
        source:'CRM_BY_AKARI',
        reason:'NO_ACTIVE_NDA',
        checkedAt,
      });
    }

    return json({
      signed:true,
      authoritative:true,
      source:'CRM_BY_AKARI',
      reason:'SIGNED_NDA',
      checkedAt,
      provenance:{
        agreementId:nda.id,
        status:nda.status,
        signedAt:nda.signed_at||null,
        activatedAt:nda.activated_at||null,
        expiresAt:nda.end_date||null,
      },
    });
  }catch(cause){
    console.error('R84 House NDA bridge read failed',cause);
    return error(cause.message||'NDA status could not be loaded',Number(cause.status||500));
  }
}
