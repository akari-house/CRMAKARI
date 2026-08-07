const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const pct = (current, previous) => previous ? ((number(current) - number(previous)) / Math.abs(number(previous))) * 100 : null;
const signed = (value) => `${number(value) > 0 ? '+' : ''}${number(value).toLocaleString('en-US', { maximumFractionDigits:1 })}`;
const signedPct = (value) => value === null ? 'n/a' : `${number(value) > 0 ? '+' : ''}${number(value).toFixed(1)}%`;

const PERIOD_TYPES = new Set(['WEEKLY','MONTHLY']);

function snapshotsFor(history, type) {
  const wanted = String(type || 'WEEKLY').toUpperCase();
  if (!PERIOD_TYPES.has(wanted)) return [];
  return [...(history.snapshots || [])]
    .filter((item) => item.type === wanted)
    .sort((a,b) => String(b.periodDate).localeCompare(String(a.periodDate)) || String(b.capturedAt).localeCompare(String(a.capturedAt)));
}

function metric(label, current, previous, higherIsBetter = true) {
  const delta = number(current) - number(previous);
  const percent = pct(current, previous);
  const direction = delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'FLAT';
  const positive = direction === 'FLAT' ? null : higherIsBetter ? direction === 'UP' : direction === 'DOWN';
  return { label, current:number(current), previous:number(previous), delta, percent, direction, positive };
}

function strongest(metrics) {
  return [...metrics]
    .filter((item) => item.positive === true && item.percent !== null)
    .sort((a,b) => Math.abs(number(b.percent)) - Math.abs(number(a.percent)))[0] || null;
}
function weakest(metrics) {
  return [...metrics]
    .filter((item) => item.positive === false && item.percent !== null)
    .sort((a,b) => Math.abs(number(b.percent)) - Math.abs(number(a.percent)))[0] || null;
}

export function buildCampaignPeriodSummary(history, type = 'WEEKLY') {
  const periodType = String(type || 'WEEKLY').toUpperCase();
  const periods = snapshotsFor(history, periodType);
  const current = periods[0] || null;
  const previous = periods[1] || null;
  if (!current) {
    return {
      type:periodType,
      status:'NO_SNAPSHOT',
      current:null,
      previous:null,
      executiveSummary:`No ${periodType.toLowerCase()} campaign snapshot has been captured yet.`,
      clientSummary:`A ${periodType.toLowerCase()} reporting snapshot is required before period intelligence can be generated.`,
      metrics:[], strengths:[], risks:[], recommendations:['Capture the first reporting snapshot for this period type.'],
      momentum:'NO_DATA', momentumScore:0,
    };
  }
  if (!previous) {
    return {
      type:periodType,
      status:'BASELINE_ONLY',
      current,
      previous:null,
      executiveSummary:`${current.label} is the first ${periodType.toLowerCase()} reporting baseline. Capture the next comparable snapshot to unlock period-over-period intelligence.`,
      clientSummary:`${current.label} establishes the campaign's first ${periodType.toLowerCase()} reporting baseline.`,
      metrics:[], strengths:[], risks:[], recommendations:[`Capture the next ${periodType.toLowerCase()} snapshot on schedule so progress can be compared against this baseline.`],
      momentum:'BASELINE', momentumScore:50,
    };
  }

  const metrics = [
    metric('4-week tracked reach', current.rollingReach28?.total, previous.rollingReach28?.total),
    metric('Owned audience', current.ownedAudience, previous.ownedAudience),
    metric('Owned-social target progress', current.ownedSocialProgress, previous.ownedSocialProgress),
    metric('Sorsa Score', current.sorsaScore, previous.sorsaScore),
    metric('XScore', current.xScore, previous.xScore),
    metric('Creator published posts', current.creatorPublishedPosts, previous.creatorPublishedPosts),
    metric('Creator reach', current.creatorReach, previous.creatorReach),
    metric('Creator engagements', current.creatorEngagements, previous.creatorEngagements),
    metric('GTM leads', current.gtmLeads, previous.gtmLeads),
    metric('GTM applications', current.gtmApplications, previous.gtmApplications),
    metric('GTM meetings', current.gtmMeetings, previous.gtmMeetings),
  ];

  const strengths = [];
  const risks = [];
  const recommendations = [];
  const top = strongest(metrics);
  const weak = weakest(metrics);

  if (top) strengths.push(`${top.label} improved ${signedPct(top.percent)} versus ${previous.label}.`);
  const reach = metrics[0];
  if (reach.delta > 0) strengths.push(`Rolling 4-week tracked reach increased by ${signed(reach.delta)} to ${number(current.rollingReach28?.total).toLocaleString('en-US')}.`);
  const meetings = metrics.find((item) => item.label === 'GTM meetings');
  if (meetings.delta > 0) strengths.push(`GTM meetings increased from ${meetings.previous} to ${meetings.current}.`);
  const creatorPosts = metrics.find((item) => item.label === 'Creator published posts');
  if (creatorPosts.delta > 0) strengths.push(`Creator/KOL publishing increased by ${signed(creatorPosts.delta)} post${Math.abs(creatorPosts.delta) === 1 ? '' : 's'}.`);

  if (weak) risks.push(`${weak.label} declined ${signedPct(weak.percent)} versus ${previous.label}.`);
  if (reach.delta < 0) risks.push(`Rolling 4-week tracked reach fell by ${Math.abs(reach.delta).toLocaleString('en-US')}.`);
  if (number(current.creatorPlannedPosts) > 0 && number(current.creatorPublishedPosts) < number(current.creatorPlannedPosts) * 0.7) risks.push(`Creator delivery is below 70% of planned posts (${current.creatorPublishedPosts}/${current.creatorPlannedPosts}).`);
  if (number(current.gtmLeads) > 0 && number(current.gtmMeetings) === 0) risks.push('Campaign-generated GTM leads have not yet converted into recorded meetings.');
  if (number(current.ownedSocialProgress) < number(previous.ownedSocialProgress)) risks.push('Owned-social target progress moved backwards versus the previous reporting period.');

  if (reach.delta < 0) recommendations.push('Review the channels that contributed most to the reach decline and increase activity on the strongest-performing sources.');
  if (number(current.creatorPlannedPosts) > 0 && number(current.creatorPublishedPosts) < number(current.creatorPlannedPosts) * 0.7) recommendations.push('Reconcile outstanding creator/KOL deliverables and update expected publishing dates.');
  if (number(current.gtmLeads) > 0 && number(current.gtmMeetings) === 0) recommendations.push('Prioritize qualification and meeting conversion for campaign-generated leads.');
  if (number(current.ownedSocialProgress) <= number(previous.ownedSocialProgress)) recommendations.push('Focus the next reporting period on owned channels furthest behind their configured growth targets.');
  if (!recommendations.length) recommendations.push('Maintain the current execution mix and keep the same reporting cadence while scaling the strongest-performing channels.');

  const positive = metrics.filter((item) => item.positive === true).length;
  const negative = metrics.filter((item) => item.positive === false).length;
  const momentumScore = Math.max(0, Math.min(100, 50 + positive * 6 - negative * 7));
  const momentum = momentumScore >= 70 ? 'ACCELERATING' : momentumScore >= 55 ? 'IMPROVING' : momentumScore >= 40 ? 'MIXED' : 'DECLINING';

  const mainMovement = top || weak;
  const executiveSummary = `${current.label} compared with ${previous.label}: campaign momentum is ${momentum.toLowerCase()}. ${mainMovement ? `${mainMovement.label} ${mainMovement.direction === 'UP' ? 'increased' : mainMovement.direction === 'DOWN' ? 'decreased' : 'was unchanged'} ${signedPct(mainMovement.percent)}.` : 'Core KPIs were broadly stable.'} Rolling 4-week tracked reach is ${number(current.rollingReach28?.total).toLocaleString('en-US')}, with ${number(current.creatorPublishedPosts).toLocaleString('en-US')} creator/KOL posts, ${number(current.gtmLeads).toLocaleString('en-US')} GTM leads and ${number(current.gtmMeetings).toLocaleString('en-US')} recorded meetings.`;
  const clientSummary = `${current.label} closed with ${number(current.rollingReach28?.total).toLocaleString('en-US')} tracked, non-deduplicated 4-week reach. Owned audience stands at ${number(current.ownedAudience).toLocaleString('en-US')}, creator/KOL publishing at ${number(current.creatorPublishedPosts).toLocaleString('en-US')} of ${number(current.creatorPlannedPosts).toLocaleString('en-US')} planned posts, and GTM activity generated ${number(current.gtmLeads).toLocaleString('en-US')} leads and ${number(current.gtmMeetings).toLocaleString('en-US')} meetings. ${top ? `The strongest movement was ${top.label.toLowerCase()} at ${signedPct(top.percent)} versus the prior period.` : ''}`.trim();

  return {
    type:periodType,
    status:'COMPARABLE',
    current,
    previous,
    metrics,
    strengths:[...new Set(strengths)].slice(0,4),
    risks:[...new Set(risks)].slice(0,5),
    recommendations:[...new Set(recommendations)].slice(0,5),
    executiveSummary,
    clientSummary,
    momentum,
    momentumScore,
  };
}
