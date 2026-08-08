import { makeId, nowIso } from './db.js';

export const GTM_ACTIVITY_TYPES = ['X_SPACE','AMA','PR','PARTNERSHIP','LAUNCHPAD','EXCHANGE','COMMUNITY','EVENT','LISTING','OTHER'];
export const GTM_ACTIVITY_STATUSES = ['PLANNED','LIVE','COMPLETED','CANCELLED'];

const text = (value, max = 3000) => String(value || '').trim().slice(0,max);
const number = (value) => { const parsed=Number(value); return Number.isFinite(parsed)&&parsed>=0?parsed:0; };
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;

export function parseCampaignGtmTracking(notes) {
  let root={};
  try { root=notes?JSON.parse(notes):{}; } catch { root={}; }
  if (!root || Array.isArray(root) || typeof root !== 'object') root={};
  const existing=root.campaignGtmTracking && typeof root.campaignGtmTracking==='object' ? root.campaignGtmTracking : {};
  return {
    root,
    tracking:{
      version:2,
      activities:Array.isArray(existing.activities)?existing.activities:[],
      createdAt:existing.createdAt||null,
      createdBy:existing.createdBy||null,
      updatedAt:existing.updatedAt||null,
      updatedBy:existing.updatedBy||null,
    },
  };
}

export function serializeCampaignGtmTracking(root,tracking){ return JSON.stringify({...root,campaignGtmTracking:tracking}); }

export function sanitizeGtmActivity(input={},campaignStartDate,previous={}){
  const type=text(input.type||previous.type||'OTHER',40).toUpperCase();
  if(!GTM_ACTIVITY_TYPES.includes(type)){const cause=new Error('GTM activity type is invalid');cause.status=422;throw cause;}
  const status=text(input.status||previous.status||'PLANNED',30).toUpperCase();
  if(!GTM_ACTIVITY_STATUSES.includes(status)){const cause=new Error('GTM activity status is invalid');cause.status=422;throw cause;}
  const dataDate=dateOnly(input.dataDate||previous.dataDate);
  if(!dataDate){const cause=new Error('A valid activity date is required');cause.status=422;throw cause;}
  const title=text(input.title??previous.title,400);
  if(!title){const cause=new Error('Activity title is required');cause.status=422;throw cause;}
  let campaignWeek=1,campaignMonth=1;
  if(dateOnly(campaignStartDate)){
    const start=new Date(`${campaignStartDate}T00:00:00.000Z`); const point=new Date(`${dataDate}T00:00:00.000Z`);
    const days=Math.max(0,Math.floor((point-start)/86400000)); campaignWeek=Math.floor(days/7)+1; campaignMonth=Math.floor((campaignWeek-1)/4)+1;
  }
  return {
    id:previous.id||makeId('cga'), type,status,title,dataDate,campaignWeek,campaignMonth,
    partner:text(input.partner??previous.partner,300),
    platform:text(input.platform??previous.platform,120),
    url:text(input.url??previous.url,800),
    ownerName:text(input.ownerName??previous.ownerName,200),
    reach:number(input.reach??previous.reach),
    impressions:number(input.impressions??previous.impressions),
    engagements:number(input.engagements??previous.engagements),
    attendees:number(input.attendees??previous.attendees),
    clicks:number(input.clicks??previous.clicks),
    leads:number(input.leads??previous.leads),
    applications:number(input.applications??previous.applications),
    meetings:number(input.meetings??previous.meetings),
    notes:text(input.notes??previous.notes,5000),
    enteredBy:previous.enteredBy||null,
    createdAt:previous.createdAt||nowIso(),updatedAt:nowIso(),
  };
}

export function gtmTrackingSummary(tracking,today=nowIso().slice(0,10)){
  const activities=tracking.activities||[];
  const active=activities.filter((item)=>item.status!=='CANCELLED');
  const typeMap=new Map();
  active.forEach((item)=>{
    const current=typeMap.get(item.type)||{type:item.type,count:0,completed:0,reach:0,engagements:0,attendees:0,leads:0};
    current.count+=1; if(item.status==='COMPLETED')current.completed+=1; current.reach+=number(item.reach); current.engagements+=number(item.engagements); current.attendees+=number(item.attendees); current.leads+=number(item.leads); typeMap.set(item.type,current);
  });
  return {
    activityCount:active.length,
    completedCount:active.filter((item)=>item.status==='COMPLETED').length,
    upcomingCount:active.filter((item)=>item.status==='PLANNED'&&item.dataDate>=today).length,
    totalReach:active.reduce((sum,item)=>sum+number(item.reach),0),
    totalImpressions:active.reduce((sum,item)=>sum+number(item.impressions),0),
    totalEngagements:active.reduce((sum,item)=>sum+number(item.engagements),0),
    totalAttendees:active.reduce((sum,item)=>sum+number(item.attendees),0),
    totalClicks:active.reduce((sum,item)=>sum+number(item.clicks),0),
    totalLeads:active.reduce((sum,item)=>sum+number(item.leads),0),
    totalApplications:active.reduce((sum,item)=>sum+number(item.applications),0),
    totalMeetings:active.reduce((sum,item)=>sum+number(item.meetings),0),
    typeBreakdown:[...typeMap.values()].sort((a,b)=>b.count-a.count),
    recent:[...active].sort((a,b)=>String(b.dataDate).localeCompare(String(a.dataDate))).slice(0,12),
  };
}
