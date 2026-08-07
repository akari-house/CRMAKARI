import { error } from '../../../lib/response.js';
import { first } from '../../../lib/db.js';
import { requireTenant, canViewFinance } from '../../../lib/permissions.js';
import { parseEngagement } from '../../../lib/revenue-lifecycle.js';
import { parseCampaignTracking, campaignTrackingSummary } from '../../../lib/campaign-tracking.js';
import { parseCampaignGtmTracking, gtmTrackingSummary } from '../../../lib/campaign-gtm-tracking.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const fmt = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits:digits });
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;
const date = (value) => value ? esc(String(value).slice(0, 10)) : '-';
const status = (value) => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value, currency) => new Intl.NumberFormat('en-US', { style:'currency', currency:currency || 'USD', maximumFractionDigits:2 }).format(Number(value || 0));
const asDate = (value) => { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? new Date(parsed) : null; };

function rollingReach(tracking, gtmTracking, days = 28) {
  const cutoff = Date.now() - days * 86400000;
  const within = (value) => { const point = asDate(value); return point && point.getTime() >= cutoff; };
  const owned = tracking.socialUpdates.filter((item) => within(item.dataDate)).reduce((sum, item) => sum + Number(item.reach || 0), 0);
  const creators = tracking.creatorPosts.filter((item) => within(item.dataDate)).reduce((sum, item) => sum + Number(item.reach || 0), 0);
  const gtm = gtmTracking.activities.filter((item) => item.status !== 'CANCELLED' && within(item.dataDate)).reduce((sum, item) => sum + Number(item.reach || 0), 0);
  return { owned, creators, gtm, total:owned + creators + gtm };
}

function averageSocialProgress(summary) {
  const rows = summary.scorecard.filter((row) => Number(row.targetAudience || 0) > Number(row.baselineAudience || 0));
  return rows.length ? rows.reduce((sum, row) => sum + Number(row.targetProgress || 0), 0) / rows.length : 0;
}

function campaignPace(row, summary) {
  if (row.start_date && row.end_date) {
    const start = new Date(`${row.start_date}T00:00:00.000Z`).getTime();
    const end = new Date(`${row.end_date}T00:00:00.000Z`).getTime();
    return Math.max(0, Math.min(100, ((Date.now() - start) / Math.max(1, end - start)) * 100));
  }
  return Math.min(100, Math.max(0, Number(summary.currentWeek || 1) / 4 * 100));
}

function intelligence(row, tracking, summary, gtmTracking, gtmSummary) {
  const creator = summary.creatorTracking;
  const socialProgress = averageSocialProgress(summary);
  const creatorProgress = Number(creator.postCompletionPercent || 0);
  const pace = campaignPace(row, summary);
  const risks = [];
  const lastUpdate = asDate(summary.lastDataUpdate);
  const freshnessDays = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 86400000) : null;
  if (!lastUpdate) risks.push(['High', 'Owned-social reporting data has not been recorded yet.']);
  else if (freshnessDays > 7) risks.push(['Medium', `Owned-social reporting data is ${freshnessDays} days old.`]);
  if (socialProgress + 15 < pace) risks.push(['High', `Owned-social target progress (${pct(socialProgress)}) is behind campaign pace (${pct(pace)}).`]);
  if (Number(creator.plannedPosts || 0) > 0 && creatorProgress + 15 < pace) risks.push(['High', `Creator publishing progress (${pct(creatorProgress)}) is behind campaign pace (${pct(pace)}).`]);
  const overdue = gtmTracking.activities.filter((item) => item.status === 'PLANNED' && asDate(item.dataDate)?.getTime() < Date.now()).length;
  if (overdue) risks.push(['Medium', `${overdue} planned GTM activit${overdue === 1 ? 'y is' : 'ies are'} past the tracked date.`]);
  if (!risks.length) risks.push(['Low', 'No material tracking risk is currently visible from the recorded campaign data.']);

  const recommendations = [];
  if (freshnessDays === null || freshnessDays > 7) recommendations.push('Refresh owned-social metrics before the next client update.');
  if (socialProgress + 15 < pace) recommendations.push('Prioritize channels furthest behind their configured audience targets.');
  if (Number(creator.plannedPosts || 0) > 0 && creatorProgress + 15 < pace) recommendations.push('Follow up on outstanding creator/KOL deliverables and confirm revised publishing dates.');
  if (overdue) recommendations.push('Review overdue GTM activities and either complete, reschedule or cancel them so reporting reflects reality.');
  if (Number(gtmSummary.totalLeads || 0) > 0 && Number(gtmSummary.totalMeetings || 0) === 0) recommendations.push('Convert campaign-generated leads into qualified meetings and record the outcome.');
  if (!recommendations.length) recommendations.push('Maintain the current reporting cadence and continue recording results at source level.');
  return { risks, recommendations, socialProgress, creatorProgress, pace };
}

function selectedSections(request, financeVisible) {
  const allowed = new Set(['summary','reach','social','creators','gtm','risks','recommendations','finance']);
  const url = new URL(request.url);
  const requested = String(url.searchParams.get('sections') || '').split(',').map((item) => item.trim()).filter(Boolean);
  const defaults = ['summary','reach','social','creators','gtm','risks','recommendations'];
  const sections = new Set((requested.length ? requested : defaults).filter((item) => allowed.has(item)));
  if (financeVisible && requested.includes('finance')) sections.add('finance');
  return sections;
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await first(context.env.DB, `
      SELECT c.*, p.name AS project_name, p.website AS project_website,
        t.name AS tenant_name, u.full_name AS campaign_owner_name
      FROM campaigns c
      JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
      JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN users u ON u.id = c.campaign_owner_id
      WHERE c.tenant_id = ? AND c.id = ?
      LIMIT 1
    `, [tenantId, context.params.id]);
    if (!row) return error('Campaign engagement not found', 404);

    const { tracking } = parseCampaignTracking(row.notes);
    const { tracking:gtmTracking } = parseCampaignGtmTracking(row.notes);
    const summary = campaignTrackingSummary(tracking, row.start_date);
    const creator = summary.creatorTracking;
    const gtmSummary = gtmTrackingSummary(gtmTracking);
    const reach28 = rollingReach(tracking, gtmTracking);
    const intel = intelligence(row, tracking, summary, gtmTracking, gtmSummary);
    const financeVisible = canViewFinance(auth);
    const sections = selectedSections(context.request, financeVisible);
    const engagement = parseEngagement(row);
    const activeSocial = summary.scorecard.filter((item) => item.baselineAudience || item.targetAudience || item.currentAudience);
    const topCreators = [...creator.creators].sort((a,b) => Number(b.totalReach || 0) - Number(a.totalReach || 0)).slice(0, 10);
    const topAgencies = [...creator.agencies].sort((a,b) => Number(b.reach || 0) - Number(a.reach || 0)).slice(0, 10);
    const recentGtm = [...gtmTracking.activities].filter((item) => item.status !== 'CANCELLED').sort((a,b) => String(b.dataDate).localeCompare(String(a.dataDate))).slice(0, 15);

    const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(row.name)} · Campaign report</title><style>
      :root{color-scheme:light;font-family:Inter,Arial,sans-serif;color:#17191d;background:#edf0f4}*{box-sizing:border-box}body{margin:0;padding:28px}.toolbar{max-width:1040px;margin:0 auto 14px;display:flex;justify-content:flex-end;gap:8px}.toolbar button{border:0;border-radius:9px;padding:10px 16px;background:#111827;color:#fff;font-weight:800;cursor:pointer}.sheet{max-width:1040px;margin:auto;background:#fff;padding:50px;border:1px solid #d9dde4;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.08)}header{display:flex;justify-content:space-between;gap:28px;padding-bottom:26px;border-bottom:3px solid #ec77a8}.brand img{max-width:185px;max-height:56px}.brand h1{margin:12px 0 4px;font-size:18px}.meta{text-align:right;color:#68707d;line-height:1.65}.meta strong{display:block;color:#17191d}.hero{padding:30px 0 18px}.eyebrow{font-size:11px;letter-spacing:.16em;color:#b83268;font-weight:850}.hero h2{font-size:38px;line-height:1.08;margin:8px 0}.hero p{margin:0;color:#596170}.note{margin-top:10px;color:#6b7280;font-size:11px}.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:20px 0 28px}.kpi{border:1px solid #e2e5ea;border-radius:12px;padding:14px}.kpi span{display:block;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.kpi strong{display:block;margin-top:7px;font-size:21px}.section{margin-top:28px}.section h3{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:#6b7280}.card{border:1px solid #e2e5ea;border-radius:12px;padding:18px;line-height:1.65}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.table{width:100%;border-collapse:collapse;border:1px solid #e2e5ea}.table th{padding:10px 11px;background:#f7f8fa;color:#6b7280;font-size:10px;text-align:left;text-transform:uppercase;letter-spacing:.07em}.table td{padding:11px;border-top:1px solid #eceef1;font-size:12px;vertical-align:top}.bar{height:6px;background:#edf0f3;border-radius:999px;overflow:hidden;margin-top:5px;min-width:80px}.bar i{display:block;height:100%;background:#ec77a8}.risk{border-left:4px solid #d1d5db}.risk.High{border-left-color:#dc2626}.risk.Medium{border-left-color:#d97706}.risk.Low{border-left-color:#16a34a}.list{display:flex;flex-direction:column;gap:9px}.list .card{padding:13px 15px}.finance{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.finance strong{display:block;font-size:18px;margin-top:5px}.footer{margin-top:38px;padding-top:18px;border-top:1px solid #e2e5ea;color:#6b7280;font-size:11px;display:flex;justify-content:space-between;gap:20px}@media(max-width:760px){body{padding:0}.toolbar{padding:12px}.sheet{border:0;border-radius:0;padding:24px}header{flex-direction:column}.meta{text-align:left}.kpis{grid-template-columns:repeat(2,1fr)}.two,.finance{grid-template-columns:1fr}.hero h2{font-size:30px}.table{display:block;overflow:auto}}@media print{body{padding:0;background:#fff}.toolbar{display:none}.sheet{max-width:none;border:0;border-radius:0;box-shadow:none;padding:16mm}@page{size:A4;margin:0}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header><div class="brand"><img src="/assets/brand/akari-crm-lockup.png" alt="AKARI CRM"/><h1>${esc(row.tenant_name || 'AKARI House')}</h1></div><div class="meta"><strong>Campaign performance report</strong><span>${esc(row.project_name)}</span><span>${date(row.start_date)} - ${date(row.end_date)}</span><span>${esc(status(row.status))}</span></div></header><section class="hero"><div class="eyebrow">CAMPAIGN OPERATIONS & INTELLIGENCE</div><h2>${esc(row.name)}</h2><p>Campaign owner ${esc(row.campaign_owner_name || 'AKARI team')} · Generated ${date(new Date().toISOString())}</p><div class="note">Reach values are tracked and non-deduplicated across channels; they must not be interpreted as unique users.</div></section>
    ${sections.has('summary') ? `<section class="kpis"><article class="kpi"><span>4-week tracked reach</span><strong>${fmt(reach28.total)}</strong></article><article class="kpi"><span>Owned social progress</span><strong>${pct(intel.socialProgress)}</strong></article><article class="kpi"><span>Creator posts</span><strong>${fmt(creator.publishedPosts)}/${fmt(creator.plannedPosts)}</strong></article><article class="kpi"><span>GTM leads</span><strong>${fmt(gtmSummary.totalLeads)}</strong></article><article class="kpi"><span>Campaign pace</span><strong>${pct(intel.pace)}</strong></article></section>` : ''}
    ${sections.has('reach') ? `<section class="section"><h3>Rolling 4-week reach mix</h3><div class="two"><div class="card"><strong>${fmt(reach28.owned)}</strong><br/>Owned social</div><div class="card"><strong>${fmt(reach28.creators)}</strong><br/>Creators / KOLs</div><div class="card"><strong>${fmt(reach28.gtm)}</strong><br/>GTM activities</div><div class="card"><strong>${fmt(reach28.total)}</strong><br/>Total tracked reach</div></div></section>` : ''}
    ${sections.has('social') ? `<section class="section"><h3>Owned-social growth</h3>${activeSocial.length ? `<table class="table"><thead><tr><th>Platform</th><th>Baseline</th><th>Target</th><th>Current</th><th>Growth</th><th>Target progress</th></tr></thead><tbody>${activeSocial.map((item) => `<tr><td><strong>${esc(status(item.platform))}</strong></td><td>${fmt(item.baselineAudience)}</td><td>${fmt(item.targetAudience)}</td><td>${fmt(item.currentAudience)}</td><td>${item.netGrowth >= 0 ? '+' : ''}${fmt(item.netGrowth)}</td><td>${pct(item.targetProgress)}<div class="bar"><i style="width:${Math.max(0,Math.min(100,Number(item.targetProgress||0)))}%"></i></div></td></tr>`).join('')}</tbody></table>` : '<div class="card">No owned-social baseline and target data has been configured.</div>'}</section>` : ''}
    ${sections.has('creators') ? `<section class="section"><h3>Creator / KOL performance</h3>${topCreators.length ? `<table class="table"><thead><tr><th>Creator</th><th>Agency</th><th>Posts</th><th>Tracked reach</th><th>Engagements</th></tr></thead><tbody>${topCreators.map((item) => `<tr><td><strong>${esc(item.name || item.handle || 'Creator')}</strong><br/><small>${esc(item.handle || '')}</small></td><td>${esc(item.agencyName || 'Direct')}</td><td>${fmt(item.publishedPosts)}/${fmt(item.expectedPosts)}</td><td>${fmt(item.totalReach)}</td><td>${fmt(item.totalEngagements)}</td></tr>`).join('')}</tbody></table>` : '<div class="card">No creator/KOL performance has been recorded.</div>'}${topAgencies.length ? `<h3 style="margin-top:20px">Agency roll-up</h3><table class="table"><thead><tr><th>Agency</th><th>Creators</th><th>Posts</th><th>Tracked reach</th><th>Engagements</th></tr></thead><tbody>${topAgencies.map((item) => `<tr><td><strong>${esc(item.agencyName)}</strong></td><td>${fmt(item.creators)}</td><td>${fmt(item.publishedPosts)}/${fmt(item.expectedPosts)}</td><td>${fmt(item.reach)}</td><td>${fmt(item.engagements)}</td></tr>`).join('')}</tbody></table>` : ''}</section>` : ''}
    ${sections.has('gtm') ? `<section class="section"><h3>GTM activity & outcomes</h3><section class="kpis" style="margin-top:0"><article class="kpi"><span>Activities</span><strong>${fmt(gtmSummary.activityCount)}</strong></article><article class="kpi"><span>Completed</span><strong>${fmt(gtmSummary.completedCount)}</strong></article><article class="kpi"><span>Clicks</span><strong>${fmt(gtmSummary.totalClicks)}</strong></article><article class="kpi"><span>Leads</span><strong>${fmt(gtmSummary.totalLeads)}</strong></article><article class="kpi"><span>Meetings</span><strong>${fmt(gtmSummary.totalMeetings)}</strong></article></section>${recentGtm.length ? `<table class="table"><thead><tr><th>Date</th><th>Activity</th><th>Partner</th><th>Status</th><th>Reach</th><th>Outcome</th></tr></thead><tbody>${recentGtm.map((item) => `<tr><td>${date(item.dataDate)}</td><td><strong>${esc(item.title)}</strong><br/><small>${esc(status(item.type))}</small></td><td>${esc(item.partner || '-')}</td><td>${esc(status(item.status))}</td><td>${fmt(item.reach)}</td><td>${fmt(item.leads)} leads · ${fmt(item.meetings)} meetings</td></tr>`).join('')}</tbody></table>` : '<div class="card">No GTM activities have been recorded.</div>'}</section>` : ''}
    ${sections.has('risks') ? `<section class="section"><h3>Management attention</h3><div class="list">${intel.risks.map(([tone, detail]) => `<div class="card risk ${tone}"><strong>${esc(tone)} priority</strong><br/>${esc(detail)}</div>`).join('')}</div></section>` : ''}
    ${sections.has('recommendations') ? `<section class="section"><h3>Recommendations</h3><div class="list">${intel.recommendations.map((item) => `<div class="card">${esc(item)}</div>`).join('')}</div></section>` : ''}
    ${sections.has('finance') && financeVisible ? `<section class="section"><h3>Commercial summary</h3><div class="finance"><div class="card"><span>Contract value</span><strong>${esc(money(engagement.grossRevenue, engagement.currency))}</strong></div><div class="card"><span>Direct costs</span><strong>${esc(money(engagement.directCosts, engagement.currency))}</strong></div><div class="card"><span>Creator allocation</span><strong>${esc(money(creator.allocatedUsd, engagement.currency))}</strong></div><div class="card"><span>Outstanding</span><strong>${esc(money(engagement.outstandingAmount, engagement.currency))}</strong></div></div></section>` : ''}
    <footer class="footer"><span>Generated from the authenticated AKARI CRM workspace.</span><span>${esc(row.project_name)} · ${date(new Date().toISOString())}</span></footer></main></body></html>`;

    return new Response(html, { headers:{ 'content-type':'text/html; charset=utf-8', 'cache-control':'private, no-store', 'x-content-type-options':'nosniff', 'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
  } catch (cause) {
    return error(cause.message || 'Campaign report could not be generated', Number(cause.status || 500));
  }
}
