import { nowIso } from './db.js';
import { parseCampaignTracking } from './campaign-tracking.js';
import { parseCampaignGtmTracking } from './campaign-gtm-tracking.js';
import { parseCampaignReportingHistory } from './campaign-reporting-history.js';

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const addDays = (date, days) => {
  const point = new Date(`${date}T00:00:00.000Z`);
  point.setUTCDate(point.getUTCDate() + days);
  return point.toISOString().slice(0,10);
};
const daysBetween = (from, to) => Math.floor((new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) / 86400000);
const latestDate = (items, field = 'dataDate') => (items || []).map((item) => dateOnly(item?.[field])).filter(Boolean).sort().at(-1) || null;

export function parseReportingControl(notes) {
  let root = {};
  try { root = notes ? JSON.parse(notes) : {}; } catch { root = {}; }
  if (!root || Array.isArray(root) || typeof root !== 'object') root = {};
  const existing = root.campaignReportingControl && typeof root.campaignReportingControl === 'object' ? root.campaignReportingControl : {};
  return {
    root,
    control: {
      version: 1,
      weeklyEnabled: existing.weeklyEnabled !== false,
      weeklyCadenceDays: Math.max(1, Math.min(31, number(existing.weeklyCadenceDays, 7))),
      monthlyEnabled: existing.monthlyEnabled !== false,
      monthlyCadenceDays: Math.max(7, Math.min(62, number(existing.monthlyCadenceDays, 28))),
      freshnessWarningDays: Math.max(1, Math.min(30, number(existing.freshnessWarningDays, 7))),
      freshnessCriticalDays: Math.max(2, Math.min(60, number(existing.freshnessCriticalDays, 14))),
      updatedAt: existing.updatedAt || null,
      updatedBy: existing.updatedBy || null,
    },
  };
}

export function serializeReportingControl(root, control) {
  return JSON.stringify({ ...root, campaignReportingControl: control });
}

export function sanitizeReportingControl(input = {}, previous = {}) {
  const warning = Math.max(1, Math.min(30, number(input.freshnessWarningDays ?? previous.freshnessWarningDays, 7)));
  const critical = Math.max(warning + 1, Math.min(60, number(input.freshnessCriticalDays ?? previous.freshnessCriticalDays, 14)));
  return {
    ...previous,
    version: 1,
    weeklyEnabled: input.weeklyEnabled === undefined ? previous.weeklyEnabled !== false : Boolean(input.weeklyEnabled),
    weeklyCadenceDays: Math.max(1, Math.min(31, number(input.weeklyCadenceDays ?? previous.weeklyCadenceDays, 7))),
    monthlyEnabled: input.monthlyEnabled === undefined ? previous.monthlyEnabled !== false : Boolean(input.monthlyEnabled),
    monthlyCadenceDays: Math.max(7, Math.min(62, number(input.monthlyCadenceDays ?? previous.monthlyCadenceDays, 28))),
    freshnessWarningDays: warning,
    freshnessCriticalDays: critical,
    updatedAt: nowIso(),
  };
}

function cadenceState(history, campaignStartDate, type, cadenceDays, enabled, today) {
  if (!enabled) return { enabled:false, type, status:'DISABLED', lastSubmitted:null, nextDue:null, daysUntilDue:null, overdueDays:0, sla:'DISABLED' };
  const snapshots = (history.snapshots || []).filter((item) => item.type === type).sort((a,b) => String(b.periodDate).localeCompare(String(a.periodDate)));
  const lastSubmitted = snapshots[0]?.periodDate || null;
  const anchor = lastSubmitted || dateOnly(campaignStartDate) || today;
  const nextDue = addDays(anchor, cadenceDays);
  const daysUntilDue = daysBetween(today, nextDue);
  const overdueDays = daysUntilDue < 0 ? Math.abs(daysUntilDue) : 0;
  const status = overdueDays > 0 ? 'OVERDUE' : daysUntilDue === 0 ? 'DUE_TODAY' : daysUntilDue <= 2 ? 'DUE_SOON' : 'ON_TRACK';
  const sla = overdueDays > cadenceDays ? 'MISSED' : overdueDays > 0 ? 'LATE' : 'ON_TIME';
  return { enabled:true, type, status, lastSubmitted, nextDue, daysUntilDue, overdueDays, sla };
}

function freshnessState(lastUpdate, control, today) {
  if (!lastUpdate) return { lastUpdate:null, ageDays:null, status:'MISSING' };
  const ageDays = Math.max(0, daysBetween(lastUpdate, today));
  const status = ageDays >= control.freshnessCriticalDays ? 'CRITICAL' : ageDays >= control.freshnessWarningDays ? 'STALE' : 'HEALTHY';
  return { lastUpdate, ageDays, status };
}

export function buildReportingControlSummary(notes, campaignStartDate, today = nowIso().slice(0,10)) {
  const { control } = parseReportingControl(notes);
  const { tracking } = parseCampaignTracking(notes);
  const { tracking:gtm } = parseCampaignGtmTracking(notes);
  const { history } = parseCampaignReportingHistory(notes);
  const weekly = cadenceState(history, campaignStartDate, 'WEEKLY', control.weeklyCadenceDays, control.weeklyEnabled, today);
  const monthly = cadenceState(history, campaignStartDate, 'MONTHLY', control.monthlyCadenceDays, control.monthlyEnabled, today);
  const freshness = {
    ownedSocial: freshnessState(latestDate(tracking.socialUpdates), control, today),
    creators: freshnessState(latestDate(tracking.creatorPosts), control, today),
    gtm: freshnessState(latestDate(gtm.activities), control, today),
  };
  const freshnessValues = Object.values(freshness);
  let score = 100;
  [weekly, monthly].filter((item) => item.enabled).forEach((item) => {
    if (item.status === 'OVERDUE') score -= Math.min(25, 10 + item.overdueDays * 2);
    else if (item.status === 'DUE_TODAY') score -= 4;
    else if (item.status === 'DUE_SOON') score -= 2;
  });
  freshnessValues.forEach((item) => {
    if (item.status === 'MISSING') score -= 12;
    else if (item.status === 'CRITICAL') score -= 15;
    else if (item.status === 'STALE') score -= 7;
  });
  score = Math.max(0, Math.min(100, score));
  const health = score >= 85 ? 'HEALTHY' : score >= 65 ? 'WARNING' : 'CRITICAL';
  const priorities = [];
  if (weekly.status === 'OVERDUE') priorities.push(`Weekly report overdue by ${weekly.overdueDays} day${weekly.overdueDays === 1 ? '' : 's'}.`);
  if (monthly.status === 'OVERDUE') priorities.push(`Monthly report overdue by ${monthly.overdueDays} day${monthly.overdueDays === 1 ? '' : 's'}.`);
  for (const [key, item] of Object.entries(freshness)) {
    if (item.status === 'MISSING') priorities.push(`${key === 'ownedSocial' ? 'Owned-social' : key === 'creators' ? 'Creator/KOL' : 'GTM'} reporting data is missing.`);
    else if (item.status === 'CRITICAL') priorities.push(`${key === 'ownedSocial' ? 'Owned-social' : key === 'creators' ? 'Creator/KOL' : 'GTM'} data is ${item.ageDays} days old.`);
  }
  return { control, weekly, monthly, freshness, healthScore:score, health, priorities:priorities.slice(0,6) };
}
