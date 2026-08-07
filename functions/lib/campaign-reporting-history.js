import { makeId, nowIso } from './db.js';

export const REPORTING_SNAPSHOT_TYPES = ['WEEKLY','MONTHLY','AD_HOC'];

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value, max = 500) => String(value || '').trim().slice(0, max);
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const asDate = (value) => { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? new Date(parsed) : null; };

export function parseCampaignReportingHistory(notes) {
  let root = {};
  try { root = notes ? JSON.parse(notes) : {}; } catch { root = {}; }
  if (!root || Array.isArray(root) || typeof root !== 'object') root = {};
  const existing = root.campaignReportingHistory && typeof root.campaignReportingHistory === 'object' ? root.campaignReportingHistory : {};
  return {
    root,
    history: {
      version: 1,
      snapshots: Array.isArray(existing.snapshots) ? existing.snapshots : [],
      createdAt: existing.createdAt || null,
      createdBy: existing.createdBy || null,
      updatedAt: existing.updatedAt || null,
      updatedBy: existing.updatedBy || null,
    },
  };
}

export function serializeCampaignReportingHistory(root, history) {
  return JSON.stringify({ ...root, campaignReportingHistory: history });
}

export function rollingTrackedReach(tracking, gtmTracking, periodDate, days = 28) {
  const end = asDate(periodDate) || new Date();
  const cutoff = end.getTime() - (days - 1) * 86400000;
  const within = (value) => {
    const point = asDate(value);
    return point && point.getTime() >= cutoff && point.getTime() <= end.getTime() + 86399999;
  };
  const owned = (tracking.socialUpdates || []).filter((item) => within(item.dataDate)).reduce((sum, item) => sum + number(item.reach), 0);
  const creators = (tracking.creatorPosts || []).filter((item) => within(item.dataDate)).reduce((sum, item) => sum + number(item.reach), 0);
  const gtm = (gtmTracking.activities || []).filter((item) => item.status !== 'CANCELLED' && within(item.dataDate)).reduce((sum, item) => sum + number(item.reach), 0);
  return { owned, creators, gtm, total: owned + creators + gtm };
}

export function buildCampaignSnapshot({ type, label, periodDate, campaignStartDate, tracking, trackingSummary, gtmTracking, gtmSummary, capturedBy }) {
  const snapshotType = text(type || 'WEEKLY', 20).toUpperCase();
  if (!REPORTING_SNAPSHOT_TYPES.includes(snapshotType)) {
    const cause = new Error('Reporting snapshot type is invalid');
    cause.status = 422;
    throw cause;
  }
  const date = dateOnly(periodDate) || nowIso().slice(0, 10);
  const creator = trackingSummary.creatorTracking || {};
  const scorecard = trackingSummary.scorecard || [];
  const targetRows = scorecard.filter((row) => number(row.targetAudience) > number(row.baselineAudience));
  const socialProgress = targetRows.length ? targetRows.reduce((sum, row) => sum + number(row.targetProgress), 0) / targetRows.length : 0;
  const reach28 = rollingTrackedReach(tracking, gtmTracking, date, 28);
  const start = asDate(campaignStartDate);
  const point = asDate(date);
  const daysRunning = start && point ? Math.max(0, Math.floor((point.getTime() - start.getTime()) / 86400000)) : 0;
  const week = Math.floor(daysRunning / 7) + 1;
  const month = Math.floor((week - 1) / 4) + 1;

  return {
    id: makeId('crs'),
    type: snapshotType,
    label: text(label || `${snapshotType === 'WEEKLY' ? `Week ${week}` : snapshotType === 'MONTHLY' ? `Month ${month}` : 'Campaign snapshot'}`, 200),
    periodDate: date,
    campaignWeek: week,
    campaignMonth: month,
    ownedAudience: number(trackingSummary.totalOwnedAudience),
    ownedSocialProgress: socialProgress,
    ownedReachTotal: number(trackingSummary.totalOwnedReach),
    ownedEngagementsTotal: number(trackingSummary.totalOwnedEngagements),
    sorsaScore: number(trackingSummary.currentSorsaScore),
    xScore: number(trackingSummary.currentXScore),
    creatorCount: number(creator.creatorCount),
    creatorPlannedPosts: number(creator.plannedPosts),
    creatorPublishedPosts: number(creator.publishedPosts),
    creatorReach: number(creator.creatorReach),
    creatorEngagements: number(creator.creatorEngagements),
    creatorAllocatedUsd: number(creator.allocatedUsd),
    gtmActivities: number(gtmSummary.activityCount),
    gtmCompleted: number(gtmSummary.completedCount),
    gtmClicks: number(gtmSummary.totalClicks),
    gtmLeads: number(gtmSummary.totalLeads),
    gtmApplications: number(gtmSummary.totalApplications),
    gtmMeetings: number(gtmSummary.totalMeetings),
    rollingReach28: reach28,
    capturedBy: capturedBy || null,
    capturedAt: nowIso(),
  };
}

const delta = (current, previous, field) => number(current?.[field]) - number(previous?.[field]);

export function reportingHistorySummary(history) {
  const snapshots = [...(history.snapshots || [])].sort((a, b) => String(b.periodDate).localeCompare(String(a.periodDate)) || String(b.capturedAt).localeCompare(String(a.capturedAt)));
  const enriched = snapshots.map((snapshot) => {
    const previous = snapshots.find((candidate) => candidate.type === snapshot.type && candidate.periodDate < snapshot.periodDate);
    return {
      ...snapshot,
      delta: previous ? {
        ownedAudience: delta(snapshot, previous, 'ownedAudience'),
        rollingReach28: number(snapshot.rollingReach28?.total) - number(previous.rollingReach28?.total),
        creatorPublishedPosts: delta(snapshot, previous, 'creatorPublishedPosts'),
        creatorReach: delta(snapshot, previous, 'creatorReach'),
        gtmLeads: delta(snapshot, previous, 'gtmLeads'),
        gtmMeetings: delta(snapshot, previous, 'gtmMeetings'),
      } : null,
    };
  });
  return {
    snapshotCount: snapshots.length,
    latest: enriched[0] || null,
    weeklyCount: snapshots.filter((item) => item.type === 'WEEKLY').length,
    monthlyCount: snapshots.filter((item) => item.type === 'MONTHLY').length,
    snapshots: enriched,
    trend: [...enriched].reverse().slice(-12),
  };
}
