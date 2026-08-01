export const FUNDRAISING_STAGES=['PREPARING','OPEN','OUTREACH','DILIGENCE','COMMITMENTS','CLOSING','CLOSED','PAUSED'];
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const number=(value)=>Math.max(0,Number(value||0));
export function parseFundraisingFlags(raw){
  let flags={}; try{flags=raw?JSON.parse(raw):{};}catch{}
  return {flags,rooms:Array.isArray(flags.fundraisingCapitalRooms)?flags.fundraisingCapitalRooms:[]};
}
export function sanitizeCapitalRoom(input={},existing={}){
  const stage=String(input.stage||existing.stage||'PREPARING').toUpperCase();
  if(!FUNDRAISING_STAGES.includes(stage)) throw Object.assign(new Error('Fundraising stage is invalid'),{status:422});
  const target=number(input.targetAmount??existing.targetAmount);
  const committed=Math.min(number(input.committedAmount??existing.committedAmount),target||Number.MAX_SAFE_INTEGER);
  return {
    id:text(existing.id||input.id||`raise_${crypto.randomUUID()}`,120), projectId:text(input.projectId||existing.projectId,120),
    projectName:text(input.projectName||existing.projectName,500), ownerUserId:text(input.ownerUserId||existing.ownerUserId,120),
    roundName:text(input.roundName||existing.roundName||'Current round',300), stage,
    roundType:text(input.roundType||existing.roundType||'SAFE',100), fundingStage:text(input.fundingStage||existing.fundingStage,100),
    currency:text(input.currency||existing.currency||'USD',12).toUpperCase(), targetAmount:target,
    committedAmount:committed, valuation:number(input.valuation??existing.valuation), minimumTicket:number(input.minimumTicket??existing.minimumTicket),
    leadInvestor:text(input.leadInvestor||existing.leadInvestor,300), launchDate:text(input.launchDate||existing.launchDate,30),
    targetCloseDate:text(input.targetCloseDate||existing.targetCloseDate,30), nextAction:text(input.nextAction||existing.nextAction,2000),
    thesis:text(input.thesis||existing.thesis,8000), readinessScore:Math.min(100,Math.max(0,Number(input.readinessScore??existing.readinessScore||0))),
    deckUrl:text(input.deckUrl||existing.deckUrl,2000), dataRoomUrl:text(input.dataRoomUrl||existing.dataRoomUrl,2000),
    updatedAt:new Date().toISOString(), createdAt:existing.createdAt||new Date().toISOString(),
  };
}
export function capitalRoomSummary(rooms=[]){
  const active=rooms.filter(r=>!['CLOSED','PAUSED'].includes(r.stage));
  const target=active.reduce((sum,r)=>sum+number(r.targetAmount),0);
  const committed=active.reduce((sum,r)=>sum+number(r.committedAmount),0);
  return {active:active.length,total:rooms.length,target,committed,remaining:Math.max(target-committed,0),averageReadiness:active.length?Math.round(active.reduce((s,r)=>s+number(r.readinessScore),0)/active.length):0};
}
