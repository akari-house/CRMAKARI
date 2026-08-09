import { parseCampaignTracking, creatorTrackingSummary } from './campaign-tracking.js';
import { parseCampaignPlanning, buildCampaignPlanSummary } from './campaign-planning.js';
import { parseCampaignTalentOutreach, buildCampaignTalentOutreachSummary } from './campaign-talent-outreach.js';
import { parseCampaignActivation, buildCampaignActivationSummary } from './campaign-activation.js';
import { parseCampaignSettlement, buildCampaignSettlementSummary } from './campaign-settlement.js';

export const CAMPAIGN_EXECUTION_COMMAND_VERSION = 'R8.5L-1';
export const CAMPAIGN_RISK_LEVELS = ['CRITICAL','HIGH','MEDIUM','LOW','HEALTHY'];

const number=(value)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?parsed:0;};
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const upper=(value)=>text(value,80).toUpperCase();
const CLOSED_TASKS=new Set(['DONE','CANCELLED','ARCHIVED']);
const ACTIVE_CAMPAIGN_STATUSES=new Set(['PLANNED','CONFIRMED','ONBOARDING','LIVE','ACTIVE','PAUSED','IN_PROGRESS']);

function dateValue(value){
  if(!value)return null;
  const raw=String(value).slice(0,10);
  const date=new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())?date:null;
}
function daysBetween(from,to){return Math.floor((to.getTime()-from.getTime())/86400000);}
function riskWeight(level){return {CRITICAL:5,HIGH:4,MEDIUM:3,LOW:2,HEALTHY:1}[level]||0;}
function taskOpen(task){return !CLOSED_TASKS.has(upper(task?.status));}
function taskOverdue(task,today){const due=dateValue(task?.due_at??task?.dueAt);return taskOpen(task)&&due&&due<today;}
function taskDueToday(task,today){const due=dateValue(task?.due_at??task?.dueAt);return taskOpen(task)&&due&&due.getTime()===today.getTime();}
function taskBlocked(task){return taskOpen(task)&&upper(task?.status)==='BLOCKED';}
function campaignTaskRows(tasks,campaignId){return (tasks||[]).filter((task)=>String(task.campaign_id??task.campaignId||'')===String(campaignId||''));}

function pacing(startDate,endDate,today){
  const start=dateValue(startDate),end=dateValue(endDate);
  if(!start||!end||end<start)return {elapsedPercent:0,daysToStart:null,daysToEnd:null,ended:false,started:false};
  const total=Math.max(1,daysBetween(start,end)+1);
  const elapsed=Math.max(0,Math.min(total,daysBetween(start,today)+1));
  return {
    elapsedPercent:Math.min(100,(elapsed/total)*100),
    daysToStart:daysBetween(today,start),
    daysToEnd:daysBetween(today,end),
    ended:today>end,
    started:today>=start,
  };
}

function action(code,label,detail,route='CAMPAIGNS'){return {code,label,detail,route};}

function chooseNextAction({planning,planSummary,outreachSummary,activationSummary,delivery,tasksSummary,pacing,settlementSummary}){
  if(planSummary.approvalDrift||activationSummary.activationDrift)return action('RECONCILE_PLAN','Reconcile approved campaign plan','The approved plan changed. Reconcile the basket/economics and reapprove before execution continues.');
  if(activationSummary.outreachDrift)return action('RECONFIRM_TALENT','Reconfirm Creator/KOL participation','Confirmed talent evidence changed after activation. Reconcile acceptance evidence before continuing execution.');
  if(outreachSummary.declinedCount>0)return action('REPLACE_DECLINED_TALENT','Replace declined Creator/KOL','One or more selected Creator/KOLs declined. Replace or reopen the campaign basket before launch/delivery.');
  if(planning.status!=='APPROVED')return action('COMPLETE_PLAN_APPROVAL','Complete campaign plan approval','Finish the talent basket, compensation and approval workflow before execution.');
  if(!outreachSummary.readyForActivation&&activationSummary.status==='NOT_ACTIVATED')return action('CONFIRM_TALENT','Confirm Creator/KOL participation',`${outreachSummary.confirmedCount} of ${outreachSummary.talentCount} active talent are confirmed for execution.`);
  if(activationSummary.status==='NOT_ACTIVATED'&&activationSummary.governanceReady)return action('ACTIVATE_CAMPAIGN','Activate campaign execution','The approved plan and Creator/KOL confirmations are ready for Work OS handoff.');
  if(tasksSummary.blocked>0)return action('UNBLOCK_WORK','Resolve blocked Work OS task',`${tasksSummary.blocked} campaign task${tasksSummary.blocked===1?' is':'s are'} blocked.`,'TASKS');
  if(tasksSummary.overdue>0)return action('RESOLVE_OVERDUE_TASKS','Resolve overdue Work OS tasks',`${tasksSummary.overdue} open campaign task${tasksSummary.overdue===1?' is':'s are'} overdue.`,'TASKS');
  if(delivery.holdingPosts>0)return action('REVIEW_HOLDING_POSTS','Review Holding Creator/KOL posts',`${delivery.holdingPosts} submitted post${delivery.holdingPosts===1?' is':'s are'} in Holding and do not count toward performance.`);
  if(delivery.rejectedPosts>0)return action('RECOVER_REJECTED_POSTS','Recover Rejected Creator/KOL delivery',`${delivery.rejectedPosts} rejected post${delivery.rejectedPosts===1?' requires':'s require'} rework or replacement.`);
  if(pacing.ended&&delivery.publishedPosts<delivery.plannedPosts)return action('RECOVER_MISSING_DELIVERY','Recover missing Creator/KOL delivery',`${delivery.publishedPosts} of ${delivery.plannedPosts} planned Approved posts were delivered by campaign end.`);
  if(activationSummary.status==='PAUSED')return action('RESUME_OR_REPLAN','Resolve pause and resume execution','Campaign execution is paused. Clear the recorded blocker or replan before delivery continues.');
  if(activationSummary.status==='ACTIVE'&&tasksSummary.dueToday>0)return action('EXECUTE_TODAY','Complete today’s campaign work',`${tasksSummary.dueToday} open Work OS task${tasksSummary.dueToday===1?' is':'s are'} due today.`,'TASKS');
  if(activationSummary.status==='ACTIVE'&&delivery.publishedPosts<delivery.plannedPosts)return action('CHASE_DELIVERY','Progress Creator/KOL delivery',`${Math.max(0,delivery.plannedPosts-delivery.publishedPosts)} Approved post${Math.max(0,delivery.plannedPosts-delivery.publishedPosts)===1?' remains':'s remain'} against plan.`);
  if(activationSummary.status==='COMPLETED'&&settlementSummary.outstandingUsdt>0)return action('COMPLETE_SETTLEMENT','Complete Creator/KOL settlement',`${settlementSummary.outstandingUsdt.toFixed(2)} USDT remains outstanding after approved settlement.`);
  if(activationSummary.status==='COMPLETED'&&settlementSummary.disputedCount>0)return action('RESOLVE_SETTLEMENT_DISPUTE','Resolve Creator/KOL settlement dispute',`${settlementSummary.disputedCount} Creator/KOL settlement record${settlementSummary.disputedCount===1?' is':'s are'} disputed.`);
  if(activationSummary.status==='COMPLETED')return action('PREPARE_CLOSEOUT','Prepare campaign closeout','Execution is complete. Finalize reporting, client sign-off and renewal handoff.');
  return action('MONITOR_EXECUTION','Monitor campaign execution','No critical operational blocker is currently detected. Continue monitoring delivery, tasks and approved performance.');
}

function assessRisk({planning,planSummary,outreachSummary,activationSummary,delivery,tasksSummary,pacing,reachAchievement}){
  const reasons=[];
  let score=0;
  const add=(points,code,label)=>{score+=points;reasons.push({code,label,points});};
  if(planSummary.approvalDrift){add(45,'PLAN_APPROVAL_DRIFT','Approved plan changed');}
  if(activationSummary.activationDrift){add(45,'ACTIVATION_PLAN_DRIFT','Approved plan changed after activation');}
  if(activationSummary.outreachDrift){add(40,'TALENT_CONFIRMATION_DRIFT','Confirmed talent evidence changed after activation');}
  if(outreachSummary.declinedCount>0)add(Math.min(30,15+outreachSummary.declinedCount*5),'DECLINED_TALENT',`${outreachSummary.declinedCount} Creator/KOL declined`);
  if(tasksSummary.blocked>0)add(Math.min(30,15+tasksSummary.blocked*5),'BLOCKED_TASKS',`${tasksSummary.blocked} Work OS task${tasksSummary.blocked===1?'':'s'} blocked`);
  if(tasksSummary.overdue>0)add(Math.min(30,10+tasksSummary.overdue*4),'OVERDUE_TASKS',`${tasksSummary.overdue} Work OS task${tasksSummary.overdue===1?'':'s'} overdue`);
  if(pacing.ended&&delivery.publishedPosts<delivery.plannedPosts)add(30,'DELIVERY_MISSED','Campaign ended before planned Approved delivery was completed');
  if(delivery.holdingPosts>0)add(Math.min(18,8+delivery.holdingPosts*3),'HOLDING_POSTS',`${delivery.holdingPosts} post${delivery.holdingPosts===1?'':'s'} in Holding`);
  if(delivery.rejectedPosts>0)add(Math.min(20,10+delivery.rejectedPosts*3),'REJECTED_POSTS',`${delivery.rejectedPosts} post${delivery.rejectedPosts===1?'':'s'} rejected`);
  if(planning.status==='APPROVED'&&activationSummary.status==='NOT_ACTIVATED'&&pacing.daysToStart!==null&&pacing.daysToStart<=3&&pacing.daysToStart>=0&&!outreachSummary.readyForActivation)add(20,'LAUNCH_TALENT_PENDING','Launch is near but Creator/KOL confirmations are incomplete');
  if(pacing.started&&!pacing.ended&&pacing.elapsedPercent>=50&&delivery.plannedPosts>0&&delivery.postCompletionPercent+20<pacing.elapsedPercent)add(16,'DELIVERY_PACING','Approved post delivery is materially behind campaign pacing');
  if(pacing.started&&!pacing.ended&&pacing.elapsedPercent>=50&&reachAchievement<50)add(10,'REACH_PACING','Approved reach is below 50% after campaign midpoint');
  if(activationSummary.status==='PAUSED')add(12,'EXECUTION_PAUSED','Campaign execution is paused');
  let level='HEALTHY';
  if(score>=45)level='CRITICAL';else if(score>=30)level='HIGH';else if(score>=18)level='MEDIUM';else if(score>0)level='LOW';
  return {level,score:Math.min(100,score),reasons:reasons.sort((a,b)=>b.points-a.points||a.code.localeCompare(b.code))};
}

export function buildCampaignExecutionRow(campaign,tasks=[],todayIso=new Date().toISOString().slice(0,10)){
  const {root,tracking}=parseCampaignTracking(campaign.notes);
  const planning=parseCampaignPlanning(root);
  const outreach=parseCampaignTalentOutreach(root);
  const activation=parseCampaignActivation(root);
  const settlement=parseCampaignSettlement(root);
  const planSummary=buildCampaignPlanSummary(tracking,planning);
  const outreachSummary=buildCampaignTalentOutreachSummary(tracking,outreach);
  const taskRows=campaignTaskRows(tasks,campaign.id);
  const activationSummary=buildCampaignActivationSummary(tracking,planning,activation,taskRows,outreach);
  const settlementSummary=buildCampaignSettlementSummary(tracking,planning,settlement);
  const delivery=creatorTrackingSummary(tracking);
  const today=dateValue(todayIso)||new Date();
  const pace=pacing(campaign.start_date??campaign.startDate,campaign.end_date??campaign.endDate,today);
  const openTasks=taskRows.filter(taskOpen);
  const overdue=openTasks.filter((task)=>taskOverdue(task,today));
  const dueToday=openTasks.filter((task)=>taskDueToday(task,today));
  const blocked=openTasks.filter(taskBlocked);
  const tasksSummary={
    total:taskRows.length,open:openTasks.length,done:taskRows.length-openTasks.length,
    overdue:overdue.length,dueToday:dueToday.length,blocked:blocked.length,
    overdueItems:overdue.slice().sort((a,b)=>String(a.due_at||'').localeCompare(String(b.due_at||''))).slice(0,5).map((task)=>({id:task.id,title:task.title,status:task.status,priority:task.priority,dueAt:task.due_at,ownerName:task.owner_name||null})),
  };
  const expectedReach=(tracking.creatorAssignments||[]).filter((item)=>item.active!==false).reduce((sum,item)=>sum+number(item.expectedReach),0);
  const reachAchievement=expectedReach>0?Math.min(100,(delivery.creatorReach/expectedReach)*100):(delivery.creatorReach>0?100:0);
  const risk=assessRisk({planning,planSummary,outreachSummary,activationSummary,delivery,tasksSummary,pacing:pace,reachAchievement});
  const nextAction=chooseNextAction({planning,planSummary,outreachSummary,activationSummary,delivery,tasksSummary,pacing:pace,settlementSummary});
  return {
    id:campaign.id,name:campaign.name,projectId:campaign.project_id??campaign.projectId,projectName:campaign.project_name??campaign.projectName||'',
    ownerUserId:campaign.campaign_owner_id??campaign.ownerUserId||null,ownerName:campaign.owner_name??campaign.ownerName||null,
    campaignStatus:upper(campaign.status),startDate:campaign.start_date??campaign.startDate||null,endDate:campaign.end_date??campaign.endDate||null,region:campaign.region||'',
    active:ACTIVE_CAMPAIGN_STATUSES.has(upper(campaign.status))||['ACTIVE','PAUSED'].includes(activation.status),
    planning:{status:planning.status,approvalDrift:Boolean(planSummary.approvalDrift),budgetUsd:planSummary.budgetUsd,estimatedPlanCost:planSummary.estimatedPlanCost,budgetReconciled:Boolean(planSummary.budgetReconciled),budgetUtilization:planSummary.budgetUtilization},
    outreach:{talentCount:outreachSummary.talentCount,confirmedCount:outreachSummary.confirmedCount,pendingCount:outreachSummary.pendingCount,declinedCount:outreachSummary.declinedCount,readyForActivation:outreachSummary.readyForActivation},
    activation:{status:activation.status,effectiveStatus:activationSummary.effectiveStatus,activationDrift:Boolean(activationSummary.activationDrift),outreachDrift:Boolean(activationSummary.outreachDrift)},
    delivery:{plannedPosts:delivery.plannedPosts,approvedPosts:delivery.publishedPosts,holdingPosts:delivery.holdingPosts,rejectedPosts:delivery.rejectedPosts,remainingPosts:Math.max(0,delivery.plannedPosts-delivery.publishedPosts),postCompletionPercent:delivery.postCompletionPercent,approvedReach:delivery.creatorReach,approvedEngagements:delivery.creatorEngagements,expectedReach,reachAchievement},
    tasks:tasksSummary,
    settlement:{outstandingUsdt:settlementSummary.outstandingUsdt,disputedCount:settlementSummary.disputedCount,paidUsdt:settlementSummary.paidUsdt},
    pacing:pace,
    risk,
    nextAction,
  };
}

export function buildCampaignExecutionCommandCenter(campaigns=[],tasks=[],todayIso=new Date().toISOString().slice(0,10),scopeUserId=null){
  const rows=(campaigns||[]).map((campaign)=>buildCampaignExecutionRow(campaign,tasks,todayIso));
  const scoped=scopeUserId?rows.filter((row)=>row.ownerUserId===scopeUserId||campaignTaskRows(tasks,row.id).some((task)=>task.owner_user_id===scopeUserId&&taskOpen(task))):rows;
  const ordered=scoped.sort((a,b)=>riskWeight(b.risk.level)-riskWeight(a.risk.level)||b.risk.score-a.risk.score||b.tasks.overdue-a.tasks.overdue||String(a.endDate||'9999').localeCompare(String(b.endDate||'9999'))||a.name.localeCompare(b.name));
  const active=ordered.filter((row)=>row.active&&row.activation.status!=='COMPLETED');
  const attention=ordered.filter((row)=>['CRITICAL','HIGH','MEDIUM'].includes(row.risk.level));
  return {
    version:CAMPAIGN_EXECUTION_COMMAND_VERSION,today:todayIso,scope:scopeUserId?'MINE':'TEAM',
    metrics:{
      campaigns:ordered.length,activeCampaigns:active.length,critical:ordered.filter((row)=>row.risk.level==='CRITICAL').length,highRisk:ordered.filter((row)=>row.risk.level==='HIGH').length,
      overdueTasks:ordered.reduce((sum,row)=>sum+row.tasks.overdue,0),dueTodayTasks:ordered.reduce((sum,row)=>sum+row.tasks.dueToday,0),blockedTasks:ordered.reduce((sum,row)=>sum+row.tasks.blocked,0),
      pendingTalent:ordered.reduce((sum,row)=>sum+row.outreach.pendingCount,0),declinedTalent:ordered.reduce((sum,row)=>sum+row.outreach.declinedCount,0),holdingPosts:ordered.reduce((sum,row)=>sum+row.delivery.holdingPosts,0),rejectedPosts:ordered.reduce((sum,row)=>sum+row.delivery.rejectedPosts,0),
      plannedPosts:ordered.reduce((sum,row)=>sum+row.delivery.plannedPosts,0),approvedPosts:ordered.reduce((sum,row)=>sum+row.delivery.approvedPosts,0),approvedReach:ordered.reduce((sum,row)=>sum+row.delivery.approvedReach,0),
      outstandingSettlementUsdt:ordered.reduce((sum,row)=>sum+row.settlement.outstandingUsdt,0),
    },
    attention:attention.slice(0,12),
    items:ordered,
  };
}
