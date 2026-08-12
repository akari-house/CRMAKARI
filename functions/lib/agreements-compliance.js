export const AGREEMENT_TYPES=['SERVICE_AGREEMENT','FUNDRAISING_MANDATE','NDA','PARTNERSHIP_AGREEMENT','ADVISORY_AGREEMENT','OTHER'];
export const AGREEMENT_STATUSES=['DRAFT','REVIEW','APPROVED','SENT','SIGNED','ACTIVE','EXPIRED','TERMINATED','CANCELLED'];
export const REVIEW_TYPES=['JURISDICTION','CONFLICT','PRIVACY','COMPLIANCE','COMMERCIAL','OTHER'];
export const REVIEW_STATUSES=['NOT_STARTED','IN_REVIEW','CLEAR','ISSUES','BLOCKED','NOT_REQUIRED'];
export const EXCLUSIVITY=['NONE','NON_EXCLUSIVE','EXCLUSIVE','UNKNOWN'];

const text=(value,max=5000)=>String(value??'').trim().slice(0,max);
const upper=(value)=>text(value,100).toUpperCase();
const number=(value)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;};

export function normalizeAgreementInput(body={}){
  const agreementType=upper(body.agreementType||body.agreement_type);
  if(!AGREEMENT_TYPES.includes(agreementType))throw issue('Agreement type is invalid',422);
  const title=text(body.title,500),counterpartyName=text(body.counterpartyName||body.counterparty_name,500);
  if(!title)throw issue('Agreement title is required',422);
  if(!counterpartyName)throw issue('Counterparty name is required',422);
  const exclusivity=upper(body.exclusivity||'UNKNOWN');
  if(!EXCLUSIVITY.includes(exclusivity))throw issue('Exclusivity value is invalid',422);
  const successFeePercentage=number(body.successFeePercentage??body.success_fee_percentage);
  if(successFeePercentage>100)throw issue('Success fee percentage cannot exceed 100%',422);
  const startDate=text(body.startDate||body.start_date,40)||null,endDate=text(body.endDate||body.end_date,40)||null,renewalDate=text(body.renewalDate||body.renewal_date,40)||null;
  for(const [label,value] of [['Start date',startDate],['End date',endDate],['Renewal date',renewalDate]])if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw issue(`${label} must use YYYY-MM-DD`,422);
  if(startDate&&endDate&&endDate<startDate)throw issue('Agreement end date cannot be before the start date',422);
  return {
    agreementType,title,counterpartyName,
    jurisdiction:text(body.jurisdiction,300)||null,governingLawNote:text(body.governingLawNote||body.governing_law_note,2000)||null,scopeSummary:text(body.scopeSummary||body.scope_summary,5000)||null,
    currency:upper(body.currency||'USD').slice(0,12)||'USD',retainerAmount:number(body.retainerAmount??body.retainer_amount),successFeePercentage,successFeeNote:text(body.successFeeNote||body.success_fee_note,2000)||null,exclusivity,
    confidentialityRequired:Boolean(body.confidentialityRequired??body.confidentiality_required??agreementType==='NDA'),
    conflictReviewRequired:Boolean(body.conflictReviewRequired??body.conflict_review_required??['FUNDRAISING_MANDATE','PARTNERSHIP_AGREEMENT','ADVISORY_AGREEMENT'].includes(agreementType)),
    privacyReviewRequired:Boolean(body.privacyReviewRequired??body.privacy_review_required??['FUNDRAISING_MANDATE','NDA'].includes(agreementType)),
    complianceReviewRequired:Boolean(body.complianceReviewRequired??body.compliance_review_required??agreementType==='FUNDRAISING_MANDATE'),
    startDate,endDate,renewalDate,notes:text(body.notes,10000)||null,
  };
}

export function requiredReviewTypes(agreement={}){
  const out=new Set();
  if(agreement.jurisdiction||agreement.agreementType==='FUNDRAISING_MANDATE'||agreement.agreement_type==='FUNDRAISING_MANDATE')out.add('JURISDICTION');
  if(agreement.conflictReviewRequired||agreement.conflict_review_required)out.add('CONFLICT');
  if(agreement.privacyReviewRequired||agreement.privacy_review_required)out.add('PRIVACY');
  if(agreement.complianceReviewRequired||agreement.compliance_review_required)out.add('COMPLIANCE');
  if(number(agreement.retainerAmount??agreement.retainer_amount)>0||number(agreement.successFeePercentage??agreement.success_fee_percentage)>0)out.add('COMMERCIAL');
  return [...out];
}

export function reviewReadiness(agreement={},reviews=[]){
  const required=requiredReviewTypes(agreement);
  const byType=new Map((reviews||[]).map(review=>[upper(review.reviewType||review.review_type),upper(review.status)]));
  const pending=required.filter(type=>!['CLEAR','NOT_REQUIRED'].includes(byType.get(type)||'NOT_STARTED'));
  const blocked=required.filter(type=>['ISSUES','BLOCKED'].includes(byType.get(type)||''));
  return {required,pending,blocked,ready:required.length===0||pending.length===0};
}

export function agreementSummary(agreement={},reviews=[],today=new Date().toISOString().slice(0,10)){
  const readiness=reviewReadiness(agreement,reviews);
  const status=upper(agreement.status||'DRAFT');
  const endDate=text(agreement.endDate||agreement.end_date,40)||null;
  const renewalDate=text(agreement.renewalDate||agreement.renewal_date,40)||null;
  const days=(date)=>date?Math.ceil((new Date(`${date}T00:00:00Z`).getTime()-new Date(`${today}T00:00:00Z`).getTime())/86400000):null;
  const daysToEnd=days(endDate),daysToRenewal=days(renewalDate);
  const expiringSoon=status==='ACTIVE'&&daysToEnd!==null&&daysToEnd>=0&&daysToEnd<=30;
  const renewalDueSoon=status==='ACTIVE'&&daysToRenewal!==null&&daysToRenewal>=0&&daysToRenewal<=30;
  const signatureEvidence=Boolean((agreement.signedDocumentUrl||agreement.signed_document_url)||(agreement.signatureEvidenceReference||agreement.signature_evidence_reference));
  return {status,reviewReadiness:readiness,signatureEvidence,daysToEnd,daysToRenewal,expiringSoon,renewalDueSoon,attention:readiness.blocked.length?'BLOCKED':expiringSoon||renewalDueSoon?'DUE_SOON':readiness.pending.length&&['REVIEW','APPROVED','SENT','SIGNED','ACTIVE'].includes(status)?'REVIEW_REQUIRED':'CLEAR'};
}

export function assertAgreementApproval(agreement,reviews){const readiness=reviewReadiness(agreement,reviews);if(!readiness.ready)throw issue(`Agreement cannot be approved until required reviews are clear or not required: ${readiness.pending.join(', ')}`,409);return true;}
export function assertAgreementSignature(body={}){const signedBy=text(body.signedByName,500),signedAt=text(body.signedAt,80),document=text(body.signedDocumentUrl,1500),evidence=text(body.signatureEvidenceReference,1500);if(!signedBy||!signedAt||(!document&&!evidence))throw issue('Signed by, signed date and signed document or signature evidence are required',422);return{signedBy,signedAt,document:document||null,evidence:evidence||null,signatureMethod:text(body.signatureMethod,200)||null};}
export function assertAgreementActivation(agreement,reviews){if(upper(agreement.status)!=='SIGNED')throw issue('Only a signed agreement can be activated',409);assertAgreementApproval(agreement,reviews);const summary=agreementSummary(agreement,reviews);if(summary.daysToEnd!==null&&summary.daysToEnd<0)throw issue('An agreement that has already ended cannot be activated',409);return true;}
export function sanitizeReview(body={}){const reviewType=upper(body.reviewType);const status=upper(body.status);if(!REVIEW_TYPES.includes(reviewType))throw issue('Review type is invalid',422);if(!REVIEW_STATUSES.includes(status))throw issue('Review status is invalid',422);const decisionNote=text(body.decisionNote,3000),evidenceReference=text(body.evidenceReference,1500);if(['CLEAR','ISSUES','BLOCKED','NOT_REQUIRED'].includes(status)&&decisionNote.length<5)throw issue('A written review decision note is required',422);return{reviewType,status,decisionNote:decisionNote||null,evidenceReference:evidenceReference||null,expiresAt:text(body.expiresAt,40)||null};}
export function issue(message,status=400){const error=new Error(message);error.status=status;return error;}
