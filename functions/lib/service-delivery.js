import { parseJson, text } from './revenue-lifecycle.js';

export const DELIVERY_MARKER = 'AKARI_SERVICE_DELIVERY_V1';
export const DELIVERY_STAGES = ['CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','COMPLETED','PAUSED','CANCELLED'];
export const ITEM_STATUSES = new Set(['NOT_STARTED','IN_PROGRESS','WAITING','BLOCKED','DONE','COMPLETE','APPROVED','PUBLISHED','CANCELLED']);
export const CREATOR_STATUSES = new Set(['SHORTLISTED','INVITED','CONFIRMED','ACTIVE','SUBMITTED','APPROVED','DECLINED','REMOVED']);
export const CREATOR_PAYMENT_STATUSES = new Set(['NOT_DUE','PENDING','DUE','PAID','DISPUTED','CANCELLED']);

const clamp = (value, min, max) => Math.min(Math.max(Number(value || 0), min), max);
const idText = (value) => text(value, 120);
const cleanUrl = (value) => text(value, 1600);
const cleanDate = (value) => {
  const normalized = text(value, 30);
  if (!normalized) return null;
  const parsed = new Date(`${normalized.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : normalized.slice(0, 10);
};
const bool = (value, fallback = false) => value === undefined ? fallback : Boolean(value);
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function baseItem(input = {}, existing = {}, prefix = 'item') {
  const status = String(input.status ?? existing.status ?? 'NOT_STARTED').toUpperCase();
  if (!ITEM_STATUSES.has(status)) {
    const error = new Error('Delivery item status is invalid');
    error.status = 422;
    throw error;
  }
  const now = new Date().toISOString();
  const complete = ['DONE','COMPLETE','APPROVED','PUBLISHED','CANCELLED'].includes(status);
  return {
    id: idText(input.id ?? existing.id) || `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`,
    status,
    required: bool(input.required, existing.required !== false),
    ownerUserId: idText(input.ownerUserId ?? existing.ownerUserId),
    dueDate: cleanDate(input.dueDate ?? existing.dueDate),
    notes: text(input.notes ?? existing.notes, 6000),
    taskId: idText(existing.taskId),
    completedAt: complete ? (existing.completedAt || now) : null,
    updatedAt: now,
  };
}

export function sanitizeOnboarding(input = {}, existing = {}) {
  const item = baseItem(input, existing, 'onb');
  const label = text(input.label ?? existing.label, 500);
  if (!label) {
    const error = new Error('Onboarding item label is required');
    error.status = 422;
    throw error;
  }
  return { ...item, label };
}

export function sanitizeMilestone(input = {}, existing = {}) {
  const item = baseItem(input, existing, 'mil');
  const title = text(input.title ?? existing.title, 500);
  if (!title) {
    const error = new Error('Milestone title is required');
    error.status = 422;
    throw error;
  }
  return {
    ...item,
    title,
    stage: String(input.stage ?? existing.stage ?? 'PLANNING').toUpperCase().slice(0, 40),
    dependencies: text(input.dependencies ?? existing.dependencies, 3000),
    internalNotes: text(input.internalNotes ?? existing.internalNotes, 6000),
    clientNotes: text(input.clientNotes ?? existing.clientNotes, 6000),
    evidenceUrl: cleanUrl(input.evidenceUrl ?? existing.evidenceUrl),
  };
}

export function sanitizeDeliverable(input = {}, existing = {}) {
  const item = baseItem(input, existing, 'del');
  const title = text(input.title ?? existing.title, 500);
  if (!title) {
    const error = new Error('Deliverable title is required');
    error.status = 422;
    throw error;
  }
  const performanceInput = input.performance || {};
  const performanceExisting = existing.performance || {};
  return {
    ...item,
    title,
    type: text(input.type ?? existing.type, 200) || 'OTHER',
    creatorName: text(input.creatorName ?? existing.creatorName, 300),
    platform: text(input.platform ?? existing.platform, 120),
    draftUrl: cleanUrl(input.draftUrl ?? existing.draftUrl),
    publishedUrl: cleanUrl(input.publishedUrl ?? existing.publishedUrl),
    internalApproval: bool(input.internalApproval, Boolean(existing.internalApproval)),
    clientApproval: bool(input.clientApproval, Boolean(existing.clientApproval)),
    revisions: clamp(input.revisions ?? existing.revisions, 0, 99),
    performance: {
      reach: clamp(performanceInput.reach ?? performanceExisting.reach, 0, Number.MAX_SAFE_INTEGER),
      engagements: clamp(performanceInput.engagements ?? performanceExisting.engagements, 0, Number.MAX_SAFE_INTEGER),
      clicks: clamp(performanceInput.clicks ?? performanceExisting.clicks, 0, Number.MAX_SAFE_INTEGER),
      conversions: clamp(performanceInput.conversions ?? performanceExisting.conversions, 0, Number.MAX_SAFE_INTEGER),
    },
  };
}

export function sanitizeCreator(input = {}, existing = {}) {
  const name = text(input.name ?? existing.name, 300);
  if (!name) {
    const error = new Error('Creator name is required');
    error.status = 422;
    throw error;
  }
  const status = String(input.status ?? existing.status ?? 'SHORTLISTED').toUpperCase();
  const paymentStatus = String(input.paymentStatus ?? existing.paymentStatus ?? 'NOT_DUE').toUpperCase();
  if (!CREATOR_STATUSES.has(status)) {
    const error = new Error('Creator status is invalid');
    error.status = 422;
    throw error;
  }
  if (!CREATOR_PAYMENT_STATUSES.has(paymentStatus)) {
    const error = new Error('Creator payment status is invalid');
    error.status = 422;
    throw error;
  }
  const submittedLinks = Array.isArray(input.submittedLinks)
    ? input.submittedLinks.map(cleanUrl).filter(Boolean).slice(0, 50)
    : Array.isArray(existing.submittedLinks) ? existing.submittedLinks : [];
  return {
    id: idText(input.id ?? existing.id) || `ctr_${crypto.randomUUID().replaceAll('-', '')}`,
    name,
    handle: text(input.handle ?? existing.handle, 300),
    platform: text(input.platform ?? existing.platform, 120),
    status,
    reward: money(input.reward ?? existing.reward),
    currency: String(input.currency ?? existing.currency ?? 'USD').toUpperCase().slice(0, 10),
    postQuantity: clamp(input.postQuantity ?? existing.postQuantity, 0, 1000),
    submittedLinks,
    paymentStatus,
    notes: text(input.notes ?? existing.notes, 6000),
    updatedAt: new Date().toISOString(),
  };
}

export function parseDeliveryRoot(notes) {
  const parsed = parseJson(notes, null);
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : notes ? { legacyNotes:text(notes, 10000) } : {};
  const delivery = root?.serviceDelivery && typeof root.serviceDelivery === 'object'
    ? structuredClone(root.serviceDelivery)
    : {};
  return {
    root,
    delivery: {
      recordType: DELIVERY_MARKER,
      version: 1,
      templateId: idText(delivery.templateId),
      templateName: text(delivery.templateName, 300),
      serviceType: text(delivery.serviceType, 300) || text(root.serviceType, 300) || 'OTHER',
      deliveryOwnerId: idText(delivery.deliveryOwnerId),
      onboarding: Array.isArray(delivery.onboarding) ? delivery.onboarding : [],
      milestones: Array.isArray(delivery.milestones) ? delivery.milestones : [],
      deliverables: Array.isArray(delivery.deliverables) ? delivery.deliverables : [],
      creators: Array.isArray(delivery.creators) ? delivery.creators : [],
      report: delivery.report && typeof delivery.report === 'object' ? delivery.report : {},
      completion: delivery.completion && typeof delivery.completion === 'object' ? delivery.completion : null,
      renewalOpportunityId: idText(delivery.renewalOpportunityId),
      createdAt: delivery.createdAt || null,
      updatedAt: delivery.updatedAt || null,
      updatedBy: idText(delivery.updatedBy),
    },
  };
}

export function serializeDelivery(root, delivery) {
  return JSON.stringify({
    ...(root || {}),
    serviceDelivery: {
      ...(delivery || {}),
      recordType: DELIVERY_MARKER,
      version: 1,
    },
  });
}

export function itemDone(item) {
  return ['DONE','COMPLETE','APPROVED','PUBLISHED','CANCELLED'].includes(String(item?.status || '').toUpperCase());
}

export function deliverySummary(delivery = {}, today = new Date().toISOString().slice(0, 10)) {
  const onboarding = Array.isArray(delivery.onboarding) ? delivery.onboarding : [];
  const milestones = Array.isArray(delivery.milestones) ? delivery.milestones : [];
  const deliverables = Array.isArray(delivery.deliverables) ? delivery.deliverables : [];
  const creators = Array.isArray(delivery.creators) ? delivery.creators : [];
  const tracked = [...onboarding, ...milestones, ...deliverables];
  const required = tracked.filter((item) => item.required !== false);
  const completed = required.filter(itemDone);
  const overdueItems = tracked.filter((item) => item.dueDate && item.dueDate < today && !itemDone(item));
  const blockedItems = tracked.filter((item) => String(item.status).toUpperCase() === 'BLOCKED');
  const published = deliverables.filter((item) => item.publishedUrl || String(item.status).toUpperCase() === 'PUBLISHED');
  const reach = deliverables.reduce((sum, item) => sum + Number(item.performance?.reach || 0), 0);
  const engagements = deliverables.reduce((sum, item) => sum + Number(item.performance?.engagements || 0), 0);
  const progress = required.length ? Math.round(completed.length / required.length * 100) : 0;
  return {
    progress,
    requiredItems: required.length,
    completedItems: completed.length,
    overdue: overdueItems.length,
    blocked: blockedItems.length,
    onboardingDone: onboarding.filter(itemDone).length,
    onboardingTotal: onboarding.length,
    milestoneDone: milestones.filter(itemDone).length,
    milestoneTotal: milestones.length,
    deliverableDone: deliverables.filter(itemDone).length,
    deliverableTotal: deliverables.length,
    publishedDeliverables: published.length,
    creators: creators.length,
    activeCreators: creators.filter((item) => ['CONFIRMED','ACTIVE','SUBMITTED','APPROVED'].includes(String(item.status).toUpperCase())).length,
    reach,
    engagements,
    overdueItems,
    blockedItems,
  };
}

export function completionBlockers(delivery = {}) {
  const blockers = [];
  const onboarding = (delivery.onboarding || []).filter((item) => item.required !== false && !itemDone(item));
  const milestones = (delivery.milestones || []).filter((item) => item.required !== false && !itemDone(item));
  const deliverables = (delivery.deliverables || []).filter((item) => item.required !== false && !itemDone(item));
  if (onboarding.length) blockers.push(`${onboarding.length} required onboarding item${onboarding.length === 1 ? '' : 's'}`);
  if (milestones.length) blockers.push(`${milestones.length} required milestone${milestones.length === 1 ? '' : 's'}`);
  if (deliverables.length) blockers.push(`${deliverables.length} required deliverable${deliverables.length === 1 ? '' : 's'}`);
  const report = delivery.report || {};
  if (!text(report.executiveSummary, 12000) || !text(report.workCompleted, 12000) || !text(report.recommendations, 12000)) blockers.push('final client report');
  else if (!report.approvedAt) blockers.push('approved final client report');
  return blockers;
}

const template = (id, name, serviceType, durationDays, onboarding, milestones, deliverables) => ({
  id, name, serviceType, durationDays, onboarding, milestones, deliverables, system: true, active: true,
});

export const SYSTEM_DELIVERY_TEMPLATES = [
  template('system_creator_campaign','Creator campaign','MARKETING_CAMPAIGN',30,
    ['Contract and billing confirmed','Kickoff completed','Brand assets received','Creator brief approved','Reporting access confirmed'],
    ['Campaign strategy approved','Creator shortlist approved','Content approvals completed','Campaign launched','Final report delivered'],
    ['Campaign strategy','Creator shortlist','Approved content','Published creator posts','Final performance report']),
  template('system_gtm_strategy','GTM strategy','GTM_STRATEGY',45,
    ['Commercial scope confirmed','Kickoff completed','Product materials received','Stakeholder interviews scheduled','Success metrics agreed'],
    ['Discovery completed','Market positioning approved','Channel plan approved','Execution roadmap delivered','Executive review completed'],
    ['Discovery summary','Positioning framework','Channel strategy','90-day execution roadmap','Executive report']),
  template('system_x_spaces','X Spaces campaign','X_SPACES',21,
    ['Topic and speakers confirmed','Host schedule confirmed','Artwork and copy received','Tracking links ready'],
    ['Run of show approved','Promotion launched','Space delivered','Recap published'],
    ['Event artwork','Promotion posts','Live X Space','Recap and analytics']),
  template('system_advisory','Advisory retainer','ADVISORY',90,
    ['Mandate confirmed','Stakeholders mapped','Communication cadence agreed','Shared workspace ready'],
    ['Month 1 review','Month 2 review','Quarterly strategy review'],
    ['Monthly advisory memo','Decision log','Quarterly recommendations']),
  template('system_fundraising','Fundraising support','FUNDRAISING',90,
    ['Raise profile confirmed','Data room reviewed','Investor materials approved','Target investor criteria agreed'],
    ['Investor target list approved','First outreach wave completed','Investor meetings underway','Commitment review completed'],
    ['Investor target list','Outreach tracker','Meeting notes','Investor update','Closing report']),
  template('system_community_growth','Community growth','COMMUNITY_GROWTH',60,
    ['Community audit completed','Access granted','Moderation rules agreed','Growth goals confirmed'],
    ['Growth plan approved','Activation launched','Midpoint review','Final review'],
    ['Community audit','Growth plan','Activation calendar','Performance report']),
  template('system_exchange_launch','Exchange / launch campaign','EXCHANGE_LAUNCH',45,
    ['Launch scope confirmed','Listing or launch date confirmed','Brand assets received','Regional requirements approved'],
    ['Regional plan approved','Creators confirmed','Launch campaign live','Post-launch report delivered'],
    ['Regional activation plan','Creator roster','Launch content','Community events','Post-launch report']),
];

export function instantiateTemplate(source, startDate, ownerUserId) {
  const base = cleanDate(startDate) || new Date().toISOString().slice(0, 10);
  const addDays = (offset) => {
    const date = new Date(`${base}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(offset || 0));
    return date.toISOString().slice(0, 10);
  };
  const onboarding = (source.onboarding || []).map((label, index) => sanitizeOnboarding({
    label: typeof label === 'string' ? label : label.label,
    required: typeof label === 'string' ? true : label.required !== false,
    ownerUserId,
    dueDate: addDays(Math.min(index * 2 + 1, 10)),
  }));
  const milestones = (source.milestones || []).map((title, index, list) => sanitizeMilestone({
    title: typeof title === 'string' ? title : title.title,
    stage: typeof title === 'string' ? ['ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING'][Math.min(index, 4)] : title.stage,
    required: typeof title === 'string' ? true : title.required !== false,
    ownerUserId,
    dueDate: addDays(Math.round((Number(source.durationDays || 30) / Math.max(list.length, 1)) * (index + 1))),
  }));
  const deliverables = (source.deliverables || []).map((title, index, list) => sanitizeDeliverable({
    title: typeof title === 'string' ? title : title.title,
    type: typeof title === 'string' ? 'DELIVERABLE' : title.type,
    required: typeof title === 'string' ? true : title.required !== false,
    ownerUserId,
    dueDate: addDays(Math.round((Number(source.durationDays || 30) / Math.max(list.length, 1)) * (index + 1))),
  }));
  return { onboarding, milestones, deliverables };
}

export function sanitizeCustomTemplate(input = {}, existing = {}) {
  const name = text(input.name ?? existing.name, 300);
  if (!name) {
    const error = new Error('Service template name is required');
    error.status = 422;
    throw error;
  }
  const lines = (value, max) => Array.isArray(value)
    ? value.map((item) => text(typeof item === 'string' ? item : item?.label || item?.title, 500)).filter(Boolean).slice(0, max)
    : String(value || '').split('\n').map((item) => text(item, 500)).filter(Boolean).slice(0, max);
  return {
    id: idText(input.id ?? existing.id) || `sdt_${crypto.randomUUID().replaceAll('-', '')}`,
    name,
    serviceType: text(input.serviceType ?? existing.serviceType, 300) || 'OTHER',
    durationDays: clamp(input.durationDays ?? existing.durationDays ?? 30, 1, 730),
    onboarding: lines(input.onboarding ?? existing.onboarding, 30),
    milestones: lines(input.milestones ?? existing.milestones, 30),
    deliverables: lines(input.deliverables ?? existing.deliverables, 50),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    system: false,
    updatedAt: new Date().toISOString(),
  };
}
