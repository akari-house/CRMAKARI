export const FOUNDER_ONBOARDING_KEYS = Object.freeze([
  'COMPANY','TEAM','TRACTION','RAISE','USE_OF_FUNDS','FINANCIALS','CAP_TABLE','DECK','ONE_PAGER','LEGAL','TOKENOMICS',
]);

export const FOUNDER_ONBOARDING_WEIGHTS = Object.freeze({
  COMPANY:10,TEAM:10,TRACTION:10,RAISE:15,USE_OF_FUNDS:10,FINANCIALS:10,CAP_TABLE:10,DECK:10,ONE_PAGER:5,LEGAL:5,TOKENOMICS:5,
});

const text=(value,max=8000)=>String(value??'').trim().slice(0,max);
const number=(value)=>Math.max(0,Number(value||0));
const object=(value)=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const list=(value)=>Array.isArray(value)?value:[];

export function safeHttpsUrl(value){
  const url=text(value,2000);if(!url)return '';
  try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('unsafe');return parsed.toString();}
  catch{const cause=new Error('Evidence links must use a complete credential-free HTTPS URL');cause.status=422;throw cause;}
}

export function parseOnboardingData(raw){try{return object(raw?JSON.parse(raw):{});}catch{return {};}}

export function normalizeOnboardingItem(row={}){
  return {
    id:row.id||'',projectId:row.project_id||row.projectId||'',roundId:row.round_id||row.roundId||'',
    key:String(row.item_key||row.key||'').toUpperCase(),status:String(row.status||'NOT_STARTED').toUpperCase(),
    data:row.data||parseOnboardingData(row.data_json),evidenceUrl:row.evidence_url||row.evidenceUrl||'',notes:row.notes||'',
    completedAt:row.completed_at||row.completedAt||null,updatedAt:row.updated_at||row.updatedAt||null,
  };
}

export function itemCompletion(key,input={},round={},project={}){
  const data=object(input.data);const evidence=text(input.evidenceUrl||input.evidence_url,2000);const upper=String(key||'').toUpperCase();
  if(upper==='COMPANY')return Boolean(text(data.legalName||project.name,500)&&text(data.jurisdiction||project.country||project.region,300));
  if(upper==='TEAM')return list(data.members).filter(member=>text(member?.name||member,300)).length>0||Boolean(text(data.summary,4000));
  if(upper==='TRACTION')return Boolean(text(data.summary,4000)||list(data.metrics).length);
  if(upper==='RAISE')return number(round.target_amount??round.targetAmount)>0&&Boolean(text(round.instrument,100));
  if(upper==='USE_OF_FUNDS')return Boolean(text(data.summary,4000)||list(data.allocations).length);
  if(upper==='FINANCIALS')return Boolean(text(data.summary,4000)||number(data.runwayMonths)>0||number(data.monthlyBurn)>0||number(data.monthlyRevenue)>0||evidence);
  if(upper==='CAP_TABLE')return Boolean(text(data.summary,4000)||list(data.holders).length||evidence);
  if(upper==='DECK'||upper==='ONE_PAGER')return Boolean(evidence);
  if(upper==='LEGAL')return Boolean(text(data.summary,4000)||evidence);
  if(upper==='TOKENOMICS')return data.web3Relevant===false||Boolean(text(data.summary,4000)||evidence);
  return false;
}

export function sanitizeOnboardingItem(input={},existing={},round={},project={}){
  const key=String(input.key||input.itemKey||existing.key||existing.item_key||'').toUpperCase();
  if(!FOUNDER_ONBOARDING_KEYS.includes(key)){const cause=new Error('Founder onboarding item is invalid');cause.status=422;throw cause;}
  const data=object(input.data!==undefined?input.data:(existing.data||parseOnboardingData(existing.data_json)));
  const evidenceUrl=safeHttpsUrl(input.evidenceUrl!==undefined?input.evidenceUrl:(existing.evidenceUrl||existing.evidence_url||''));
  const notes=text(input.notes!==undefined?input.notes:existing.notes,4000);
  const requested=String(input.status||existing.status||'').toUpperCase();
  const notApplicable=key==='TOKENOMICS'&&data.web3Relevant===false;
  const complete=itemCompletion(key,{data,evidenceUrl},round,project);
  let status=notApplicable?'NOT_APPLICABLE':complete?'COMPLETE':(requested==='IN_PROGRESS'||Object.keys(data).length||evidenceUrl||notes)?'IN_PROGRESS':'NOT_STARTED';
  if(key!=='TOKENOMICS'&&requested==='NOT_APPLICABLE')status=complete?'COMPLETE':'IN_PROGRESS';
  return {key,status,data,evidenceUrl,notes,complete,statusForScore:status==='COMPLETE'||status==='NOT_APPLICABLE'};
}

export function onboardingReadiness(items=[],round={},project={}){
  const byKey=new Map(items.map(raw=>{const item=normalizeOnboardingItem(raw);return [item.key,item];}));
  let earned=0,possible=0,complete=0,applicable=0;
  const checks=FOUNDER_ONBOARDING_KEYS.map(key=>{
    const item=byKey.get(key)||{key,status:'NOT_STARTED',data:{},evidenceUrl:'',notes:''};
    const tokenomicsNotApplicable=key==='TOKENOMICS'&&item.data?.web3Relevant===false;
    const weight=FOUNDER_ONBOARDING_WEIGHTS[key];
    const done=tokenomicsNotApplicable||itemCompletion(key,item,round,project);
    if(!tokenomicsNotApplicable){possible+=weight;applicable+=1;if(done){earned+=weight;complete+=1;}}
    return {...item,key,weight,applicable:!tokenomicsNotApplicable,complete:done,status:tokenomicsNotApplicable?'NOT_APPLICABLE':done?'COMPLETE':item.status==='IN_PROGRESS'?'IN_PROGRESS':'NOT_STARTED'};
  });
  const score=possible?Math.round(earned/possible*100):0;
  return {score,complete,applicable,total:checks.length,checks};
}

export function publicOnboardingItem(item={}){
  const normalized=normalizeOnboardingItem(item);
  return {key:normalized.key,status:normalized.status,data:normalized.data,evidenceUrl:normalized.evidenceUrl,notes:normalized.notes,completedAt:normalized.completedAt,updatedAt:normalized.updatedAt};
}
