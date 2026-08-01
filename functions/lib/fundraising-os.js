export const FUNDRAISING_STAGES=['PREPARING','OPEN','OUTREACH','DILIGENCE','COMMITMENTS','CLOSING','CLOSED','PAUSED'];
export const INVESTOR_PIPELINE_STAGES=['TARGET','INTRO_REQUESTED','INTRO_MADE','CONTACTED','REPLIED','MEETING','FOLLOW_UP','DILIGENCE','SOFT_COMMITMENT','CONFIRMED','PASSED','DECLINED'];
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const number=(value)=>Math.max(0,Number(value||0));
const list=(value,max=20)=>Array.isArray(value)?value.map(item=>text(item,120)).filter(Boolean).slice(0,max):text(value,2000).split(/[,\n]/).map(item=>item.trim()).filter(Boolean).slice(0,max);
export function parseFundraisingFlags(raw){
  let flags={}; try{flags=raw?JSON.parse(raw):{};}catch{}
  return {flags,rooms:Array.isArray(flags.fundraisingCapitalRooms)?flags.fundraisingCapitalRooms:[]};
}
export function sanitizeCapitalRoom(input={},existing={}){
  const stage=String(input.stage||existing.stage||'PREPARING').toUpperCase();
  if(!FUNDRAISING_STAGES.includes(stage)) throw Object.assign(new Error('Fundraising stage is invalid'),{status:422});
  const target=number(input.targetAmount??existing.targetAmount);
  const committed=Math.min(number(input.committedAmount??existing.committedAmount),target||Number.MAX_SAFE_INTEGER);
  const readinessSource=input.readinessScore??existing.readinessScore??0;
  return {
    id:text(existing.id||input.id||`raise_${crypto.randomUUID()}`,120), projectId:text(input.projectId||existing.projectId,120),
    projectName:text(input.projectName||existing.projectName,500), ownerUserId:text(input.ownerUserId||existing.ownerUserId,120),
    roundName:text(input.roundName||existing.roundName||'Current round',300), stage,
    roundType:text(input.roundType||existing.roundType||'SAFE',100), fundingStage:text(input.fundingStage||existing.fundingStage,100),
    currency:text(input.currency||existing.currency||'USD',12).toUpperCase(), targetAmount:target,
    committedAmount:committed, valuation:number(input.valuation??existing.valuation), minimumTicket:number(input.minimumTicket??existing.minimumTicket),
    leadInvestor:text(input.leadInvestor||existing.leadInvestor,300), launchDate:text(input.launchDate||existing.launchDate,30),
    targetCloseDate:text(input.targetCloseDate||existing.targetCloseDate,30), nextAction:text(input.nextAction||existing.nextAction,2000),
    thesis:text(input.thesis||existing.thesis,8000), readinessScore:Math.min(100,Math.max(0,Number(readinessSource))),
    deckUrl:text(input.deckUrl||existing.deckUrl,2000), dataRoomUrl:text(input.dataRoomUrl||existing.dataRoomUrl,2000),
    investorPipeline:Array.isArray(existing.investorPipeline)?existing.investorPipeline:[],
    updatedAt:new Date().toISOString(), createdAt:existing.createdAt||new Date().toISOString(),
  };
}
export function investorFitScore(room={},investor={}){
  let score=30;
  const targetTicket=number(room.minimumTicket);
  const minCheque=number(investor.minimumCheque);
  const maxCheque=number(investor.maximumCheque);
  if(targetTicket&&(!minCheque||targetTicket>=minCheque)&&(!maxCheque||targetTicket<=maxCheque))score+=25;
  const stage=text(room.fundingStage,100).toLowerCase();
  if(stage&&list(investor.investmentStages).some(value=>stage.includes(value.toLowerCase())||value.toLowerCase().includes(stage)))score+=20;
  const projectRegion=text(room.projectRegion,100).toLowerCase();
  if(projectRegion&&list(investor.geographies).some(value=>projectRegion.includes(value.toLowerCase())||value.toLowerCase().includes(projectRegion)))score+=15;
  const category=text(room.projectCategory,100).toLowerCase();
  if(category&&list(investor.sectors).some(value=>category.includes(value.toLowerCase())||value.toLowerCase().includes(category)))score+=10;
  return Math.min(score,100);
}
export function sanitizeInvestorPipelineItem(input={},existing={},room={},investor={}){
  const stage=String(input.stage||existing.stage||'TARGET').toUpperCase();
  if(!INVESTOR_PIPELINE_STAGES.includes(stage))throw Object.assign(new Error('Investor pipeline stage is invalid'),{status:422});
  const manualFit=input.fitScore!==undefined&&input.fitScore!==''?Number(input.fitScore):null;
  return {
    id:text(existing.id||input.id||`inv_${crypto.randomUUID()}`,120),
    investorProjectId:text(input.investorProjectId||existing.investorProjectId,120),
    investorName:text(investor.name||input.investorName||existing.investorName,500),
    stage, fitScore:Math.min(100,Math.max(0,manualFit===null?investorFitScore(room,investor):manualFit)),
    warmIntroSource:text(input.warmIntroSource||existing.warmIntroSource,500),
    introductionStatus:text(input.introductionStatus||existing.introductionStatus||'NOT_REQUESTED',80).toUpperCase(),
    decisionMaker:text(input.decisionMaker||existing.decisionMaker,300), contactEmail:text(input.contactEmail||existing.contactEmail,500),
    estimatedTicket:number(input.estimatedTicket??existing.estimatedTicket), probability:Math.min(100,Math.max(0,Number(input.probability??existing.probability??0))),
    lastContactAt:text(input.lastContactAt||existing.lastContactAt,100), nextFollowUpAt:text(input.nextFollowUpAt||existing.nextFollowUpAt,100),
    nextAction:text(input.nextAction||existing.nextAction,2000), notes:text(input.notes||existing.notes,8000),
    updatedAt:new Date().toISOString(), createdAt:existing.createdAt||new Date().toISOString(),
  };
}
export function investorPipelineSummary(items=[]){
  const active=items.filter(item=>!['PASSED','DECLINED'].includes(item.stage));
  return {total:items.length,active:active.length,meetings:items.filter(item=>item.stage==='MEETING').length,diligence:items.filter(item=>item.stage==='DILIGENCE').length,softCommitments:items.filter(item=>item.stage==='SOFT_COMMITMENT').length,confirmed:items.filter(item=>item.stage==='CONFIRMED').length,weightedValue:Math.round(active.reduce((sum,item)=>sum+number(item.estimatedTicket)*(number(item.probability)/100),0))};
}
export function capitalRoomSummary(rooms=[]){
  const active=rooms.filter(r=>!['CLOSED','PAUSED'].includes(r.stage));
  const target=active.reduce((sum,r)=>sum+number(r.targetAmount),0);
  const committed=active.reduce((sum,r)=>sum+number(r.committedAmount),0);
  return {active:active.length,total:rooms.length,target,committed,remaining:Math.max(target-committed,0),averageReadiness:active.length?Math.round(active.reduce((s,r)=>s+number(r.readinessScore),0)/active.length):0,investors:rooms.reduce((sum,r)=>sum+(r.investorPipeline?.length||0),0)};
}
