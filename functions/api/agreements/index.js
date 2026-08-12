import {json,error,readJson} from '../../lib/response.js';
import {all,first,run,makeId,nowIso} from '../../lib/db.js';
import {requireTenant} from '../../lib/permissions.js';
import {normalizeAgreementInput,requiredReviewTypes,agreementSummary,issue} from '../../lib/agreements-compliance.js';

const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER']);
const MANAGER_ROLES=new Set(['OWNER','ADMIN']);
const text=(value,max=5000)=>String(value??'').trim().slice(0,max)||null;

async function ensureSchema(db){const row=await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='agreements' LIMIT 1",[]);if(!row)throw issue('Agreement Registry migration 0003 must be applied before this module is available',503);}
async function validateLinks(db,tenantId,body,input){
  const projectId=text(body.projectId,120);if(!projectId)throw issue('Project is required',422);
  const project=await first(db,'SELECT id,name FROM projects WHERE tenant_id=? AND id=? LIMIT 1',[tenantId,projectId]);if(!project)throw issue('Project was not found in this workspace',404);
  const opportunityId=text(body.opportunityId,120),campaignId=text(body.campaignId,120),partnerId=text(body.partnerId,120),roundId=text(body.fundraisingRoundId,120),ownerUserId=text(body.ownerUserId,120);
  if(opportunityId&&!await first(db,'SELECT id FROM opportunities WHERE tenant_id=? AND id=? AND project_id=? LIMIT 1',[tenantId,opportunityId,projectId]))throw issue('Opportunity does not belong to the selected project and workspace',422);
  if(campaignId&&!await first(db,'SELECT id FROM campaigns WHERE tenant_id=? AND id=? AND project_id=? LIMIT 1',[tenantId,campaignId,projectId]))throw issue('Campaign does not belong to the selected project and workspace',422);
  if(partnerId&&!await first(db,'SELECT id FROM partners WHERE tenant_id=? AND id=? LIMIT 1',[tenantId,partnerId]))throw issue('Partner does not belong to this workspace',422);
  if(roundId&&!await first(db,'SELECT id FROM fundraising_rounds WHERE tenant_id=? AND id=? AND project_id=? LIMIT 1',[tenantId,roundId,projectId]))throw issue('Fundraising round does not belong to the selected project and workspace',422);
  if(ownerUserId&&!await first(db,"SELECT tm.user_id FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? AND tm.user_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' LIMIT 1",[tenantId,ownerUserId]))throw issue('Agreement owner must be an active member of this workspace',422);
  if(input.agreementType==='FUNDRAISING_MANDATE'&&!roundId)throw issue('A fundraising mandate must be linked to a fundraising round',422);
  return{project,projectId,opportunityId,campaignId,partnerId,roundId,ownerUserId};
}
async function syncRequiredReviews(db,tenantId,agreementId,agreement,auth){const now=nowIso();for(const reviewType of requiredReviewTypes(agreement)){await run(db,`INSERT INTO agreement_reviews(id,tenant_id,agreement_id,review_type,status,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?, 'NOT_STARTED',?,?,?,?) ON CONFLICT(tenant_id,agreement_id,review_type) DO NOTHING`,[makeId('agrv'),tenantId,agreementId,reviewType,now,now,auth.userId,auth.userId]);}}
async function listPayload(db,tenantId,auth){
  await ensureSchema(db);
  const rows=await all(db,`SELECT a.*,p.name AS project_name,o.name AS opportunity_name,c.name AS campaign_name,par.name AS partner_name,fr.round_name,u.full_name AS owner_name FROM agreements a JOIN projects p ON p.id=a.project_id AND p.tenant_id=a.tenant_id LEFT JOIN opportunities o ON o.id=a.opportunity_id AND o.tenant_id=a.tenant_id LEFT JOIN campaigns c ON c.id=a.campaign_id AND c.tenant_id=a.tenant_id LEFT JOIN partners par ON par.id=a.partner_id AND par.tenant_id=a.tenant_id LEFT JOIN fundraising_rounds fr ON fr.id=a.fundraising_round_id AND fr.tenant_id=a.tenant_id LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.tenant_id=? ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'SIGNED' THEN 1 WHEN 'SENT' THEN 2 WHEN 'APPROVED' THEN 3 WHEN 'REVIEW' THEN 4 WHEN 'DRAFT' THEN 5 ELSE 6 END,a.renewal_date,a.updated_at DESC`,[tenantId]);
  const reviews=await all(db,`SELECT r.*,u.full_name AS reviewer_name FROM agreement_reviews r LEFT JOIN users u ON u.id=r.reviewer_user_id WHERE r.tenant_id=? ORDER BY r.agreement_id,r.review_type`,[tenantId]);
  const reviewMap=new Map();for(const review of reviews){const items=reviewMap.get(review.agreement_id)||[];items.push(review);reviewMap.set(review.agreement_id,items);}
  const items=rows.map(row=>{const itemReviews=reviewMap.get(row.id)||[];return{...row,reviews:itemReviews,summary:agreementSummary(row,itemReviews)}});
  const [projects,opportunities,campaigns,partners,rounds,members]=await Promise.all([
    all(db,"SELECT id,name,lifecycle_status FROM projects WHERE tenant_id=? AND lifecycle_status<>'ARCHIVED' ORDER BY name",[tenantId]),
    all(db,"SELECT id,project_id,name,stage FROM opportunities WHERE tenant_id=? ORDER BY updated_at DESC",[tenantId]),
    all(db,"SELECT id,project_id,name,status FROM campaigns WHERE tenant_id=? ORDER BY updated_at DESC",[tenantId]),
    all(db,"SELECT id,name,status FROM partners WHERE tenant_id=? AND status<>'ARCHIVED' ORDER BY name",[tenantId]),
    all(db,"SELECT id,project_id,round_name,stage,instrument FROM fundraising_rounds WHERE tenant_id=? ORDER BY updated_at DESC",[tenantId]),
    all(db,"SELECT u.id,u.full_name,u.email,tm.role FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' AND tm.role<>'EXTERNAL_COLLABORATOR' ORDER BY u.full_name",[tenantId]),
  ]);
  const summary={total:items.length,active:items.filter(i=>i.status==='ACTIVE').length,inReview:items.filter(i=>['REVIEW','APPROVED','SENT','SIGNED'].includes(i.status)).length,blocked:items.filter(i=>i.summary.attention==='BLOCKED').length,dueSoon:items.filter(i=>i.summary.expiringSoon||i.summary.renewalDueSoon).length,unsigned:items.filter(i=>['APPROVED','SENT'].includes(i.status)).length};
  return{items,summary,options:{projects,opportunities,campaigns,partners,rounds,members},permissions:{canWrite:WRITE_ROLES.has(auth.role),canFinalise:MANAGER_ROLES.has(auth.role)},methodology:{version:'R70-1',governanceTrackingOnly:true,legalDetermination:false,tenantScoped:true,audited:true}};
}

export async function onRequestGet(context){try{const auth=context.data.auth,tenantId=requireTenant(auth);if(!context.env.DB)return json({items:[],summary:{},options:{projects:[],opportunities:[],campaigns:[],partners:[],rounds:[],members:[]},demo:true});return json(await listPayload(context.env.DB,tenantId,auth));}catch(cause){return error(cause.message||'Agreements could not be loaded',Number(cause.status||500));}}

export async function onRequestPost(context){try{const auth=context.data.auth;if(!WRITE_ROLES.has(auth?.role))return error('Owner, Admin or BD Manager permission is required to create agreements',403);const tenantId=requireTenant(auth);const body=await readJson(context.request),input=normalizeAgreementInput(body);if(!context.env.DB)return json({id:makeId('agr'),created:true,demo:true},201);await ensureSchema(context.env.DB);const links=await validateLinks(context.env.DB,tenantId,body,input),id=makeId('agr'),now=nowIso();
  await run(context.env.DB,`INSERT INTO agreements(id,tenant_id,project_id,opportunity_id,campaign_id,partner_id,fundraising_round_id,agreement_type,title,counterparty_name,owner_user_id,status,jurisdiction,governing_law_note,scope_summary,currency,retainer_amount,success_fee_percentage,success_fee_note,exclusivity,confidentiality_required,conflict_review_required,privacy_review_required,compliance_review_required,start_date,end_date,renewal_date,notes,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    id,tenantId,links.projectId,links.opportunityId,links.campaignId,links.partnerId,links.roundId,input.agreementType,input.title,input.counterpartyName,links.ownerUserId,
    input.jurisdiction,input.governingLawNote,input.scopeSummary,input.currency,input.retainerAmount,input.successFeePercentage,input.successFeeNote,input.exclusivity,input.confidentialityRequired?1:0,input.conflictReviewRequired?1:0,input.privacyReviewRequired?1:0,input.complianceReviewRequired?1:0,input.startDate,input.endDate,input.renewalDate,input.notes,now,now,auth.userId,auth.userId]);
  await syncRequiredReviews(context.env.DB,tenantId,id,{...input,agreementType:input.agreementType},auth);
  await run(context.env.DB,`INSERT INTO audit_logs(id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at) VALUES(?,?,?,'AGREEMENT_CREATED','AGREEMENT',?,?,?)`,[makeId('aud'),tenantId,auth.userId,id,JSON.stringify({projectId:links.projectId,agreementType:input.agreementType,title:input.title,counterpartyName:input.counterpartyName}),now]);
  return json({id,created:true},201);
}catch(cause){return error(cause.message||'Agreement could not be created',Number(cause.status||500));}}
