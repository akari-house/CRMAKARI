import { nowIso } from './db.js';
import { parseCampaignTracking } from './campaign-tracking.js';
import { parseCampaignGtmTracking } from './campaign-gtm-tracking.js';

export const CAMPAIGN_PERIOD_VIEWS = ['THIS_WEEK','PREVIOUS_WEEK','THIS_MONTH','PREVIOUS_MONTH','LIFETIME','CUSTOM'];
const number = (value) => { const parsed=Number(value); return Number.isFinite(parsed)&&parsed>=0?parsed:0; };
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const addDays = (date,days) => { const point=new Date(`${date}T00:00:00.000Z`); point.setUTCDate(point.getUTCDate()+days); return point.toISOString().slice(0,10); };
const minDate = (a,b) => !a ? b : !b ? a : a < b ? a : b;
const maxDate = (a,b) => !a ? b : !b ? a : a > b ? a : b;
const within = (date,start,end) => dateOnly(date) && date >= start && date <= end;
const approved = (post) => !post.status || post.status === 'APPROVED';

function bounds(startDate, view, today, customStart, customEnd) {
  const campaignStart = dateOnly(startDate) || today;
  const elapsed = Math.max(0, Math.floor((new Date(`${today}T00:00:00.000Z`) - new Date(`${campaignStart}T00:00:00.000Z`)) / 86400000));
  const weekIndex = Math.floor(elapsed / 7);
  const monthIndex = Math.floor(weekIndex / 4);
  if (view === 'THIS_WEEK') return { start:addDays(campaignStart,weekIndex*7), end:today, label:`Campaign week ${weekIndex+1}` };
  if (view === 'PREVIOUS_WEEK') {
    const index=Math.max(0,weekIndex-1); return { start:addDays(campaignStart,index*7), end:addDays(campaignStart,index*7+6), label:`Campaign week ${index+1}` };
  }
  if (view === 'THIS_MONTH') return { start:addDays(campaignStart,monthIndex*28), end:today, label:`Campaign month ${monthIndex+1}` };
  if (view === 'PREVIOUS_MONTH') {
    const index=Math.max(0,monthIndex-1); return { start:addDays(campaignStart,index*28), end:addDays(campaignStart,index*28+27), label:`Campaign month ${index+1}` };
  }
  if (view === 'CUSTOM') {
    const start=maxDate(campaignStart,dateOnly(customStart) || campaignStart);
    const end=minDate(today,dateOnly(customEnd) || today);
    if (end < start) { const cause=new Error('Custom reporting end date must be on or after the start date'); cause.status=422; throw cause; }
    return { start,end,label:`${start} to ${end}` };
  }
  return { start:campaignStart,end:today,label:'Campaign lifetime' };
}

function latestAtOrBefore(items,end,platform) {
  return [...items].filter((item)=>item.dataDate<=end && (!platform || item.platform===platform)).sort((a,b)=>String(b.dataDate).localeCompare(String(a.dataDate)))[0] || null;
}
function latestBefore(items,start,platform) {
  return [...items].filter((item)=>item.dataDate<start && (!platform || item.platform===platform)).sort((a,b)=>String(b.dataDate).localeCompare(String(a.dataDate)))[0] || null;
}

export function buildCampaignPeriodView(notes,campaignStartDate,requestedView='THIS_WEEK',today=nowIso().slice(0,10),customStart=null,customEnd=null) {
  const view=String(requestedView||'THIS_WEEK').toUpperCase();
  if(!CAMPAIGN_PERIOD_VIEWS.includes(view)){const cause=new Error('Campaign reporting period is invalid');cause.status=422;throw cause;}
  const range=bounds(campaignStartDate,view,today,customStart,customEnd);
  const { tracking }=parseCampaignTracking(notes);
  const { tracking:gtm }=parseCampaignGtmTracking(notes);
  const social=(tracking.socialUpdates||[]).filter((item)=>within(item.dataDate,range.start,range.end));
  const creatorPosts=(tracking.creatorPosts||[]).filter((item)=>approved(item)&&within(item.dataDate,range.start,range.end));
  const gtmActivities=(gtm.activities||[]).filter((item)=>item.status!=='CANCELLED'&&within(item.dataDate,range.start,range.end));
  const platforms=[...new Set((tracking.targets||[]).map((item)=>item.platform).concat((tracking.socialUpdates||[]).map((item)=>item.platform)))];
  const platformGrowth=platforms.map((platform)=>{
    const current=latestAtOrBefore(tracking.socialUpdates||[],range.end,platform);
    const previous=latestBefore(tracking.socialUpdates||[],range.start,platform);
    const target=(tracking.targets||[]).find((item)=>item.platform===platform);
    const startAudience=number(previous?.audience ?? target?.baselineAudience);
    const endAudience=number(current?.audience ?? startAudience);
    const growth=endAudience-startAudience;
    return { platform,startAudience,endAudience,growth,growthPercent:startAudience>0?(growth/startAudience)*100:0,targetAudience:number(target?.targetAudience) };
  });
  const xAtEnd=latestAtOrBefore(tracking.socialUpdates||[],range.end,'X');
  const socialReach=social.reduce((sum,item)=>sum+number(item.reach),0);
  const socialEngagements=social.reduce((sum,item)=>sum+number(item.totalEngagements),0);
  const creatorReach=creatorPosts.reduce((sum,item)=>sum+number(item.reach),0);
  const creatorEngagements=creatorPosts.reduce((sum,item)=>sum+number(item.totalEngagements),0);
  const gtmReach=gtmActivities.reduce((sum,item)=>sum+number(item.reach),0);
  const gtmEngagements=gtmActivities.reduce((sum,item)=>sum+number(item.engagements),0);
  return {
    view,range,
    ownedSocial:{ updates:social.length, reach:socialReach, engagements:socialEngagements, audienceGrowth:platformGrowth.reduce((sum,item)=>sum+item.growth,0), platformGrowth, sorsaScore:number(xAtEnd?.sorsaScore), xScore:number(xAtEnd?.xScore) },
    creators:{ approvedPosts:creatorPosts.length, reach:creatorReach, engagements:creatorEngagements, creatorPosts:creatorPosts.filter((post)=>tracking.creatorAssignments.find((item)=>item.id===post.assignmentId)?.creatorType!=='KOL').length, kolPosts:creatorPosts.filter((post)=>tracking.creatorAssignments.find((item)=>item.id===post.assignmentId)?.creatorType==='KOL').length },
    gtm:{ activities:gtmActivities.length, completed:gtmActivities.filter((item)=>item.status==='COMPLETED').length, reach:gtmReach, engagements:gtmEngagements, leads:gtmActivities.reduce((sum,item)=>sum+number(item.leads),0), applications:gtmActivities.reduce((sum,item)=>sum+number(item.applications),0), meetings:gtmActivities.reduce((sum,item)=>sum+number(item.meetings),0) },
    totals:{ trackedReach:socialReach+creatorReach+gtmReach, trackedEngagements:socialEngagements+creatorEngagements+gtmEngagements },
  };
}