export const CAMPAIGN_TALENT_OUTREACH_STATUSES = ['NOT_CONTACTED','CONTACTED','NEGOTIATING','ACCEPTED','DECLINED','CONFIRMED'];

const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const bool = (value) => value === true;

function status(value) {
  const next = text(value, 40).toUpperCase();
  return CAMPAIGN_TALENT_OUTREACH_STATUSES.includes(next) ? next : 'NOT_CONTACTED';
}

function record(input = {}) {
  return {
    assignmentId:text(input.assignmentId, 120),
    status:status(input.status),
    channel:text(input.channel, 80),
    contactReference:text(input.contactReference, 1000),
    outreachOwnerId:text(input.outreachOwnerId, 120) || null,
    firstContactedAt:text(input.firstContactedAt, 80) || null,
    lastContactedAt:text(input.lastContactedAt, 80) || null,
    quotedUsd:number(input.quotedUsd),
    quotedTokens:number(input.quotedTokens),
    agreedUsd:number(input.agreedUsd),
    agreedTokens:number(input.agreedTokens),
    deliverablesConfirmed:bool(input.deliverablesConfirmed),
    scheduleConfirmed:bool(input.scheduleConfirmed),
    compensationConfirmed:bool(input.compensationConfirmed),
    agencyConfirmed:bool(input.agencyConfirmed),
    termsConfirmed:bool(input.termsConfirmed),
    consentConfirmed:bool(input.consentConfirmed),
    evidenceReference:text(input.evidenceReference, 1500),
    notes:text(input.notes, 5000),
    nextFollowUpAt:text(input.nextFollowUpAt, 80) || null,
    acceptedAt:text(input.acceptedAt, 80) || null,
    acceptedBy:text(input.acceptedBy, 120) || null,
    declinedAt:text(input.declinedAt, 80) || null,
    declinedBy:text(input.declinedBy, 120) || null,
    declinedReason:text(input.declinedReason, 2000),
    replacementAssignmentId:text(input.replacementAssignmentId, 120) || null,
    confirmedAt:text(input.confirmedAt, 80) || null,
    confirmedBy:text(input.confirmedBy, 120) || null,
    reopenedAt:text(input.reopenedAt, 80) || null,
    reopenedBy:text(input.reopenedBy, 120) || null,
    reopenReason:text(input.reopenReason, 2000),
    updatedAt:text(input.updatedAt, 80) || null,
    updatedBy:text(input.updatedBy, 120) || null,
  };
}

export function parseCampaignTalentOutreach(root = {}) {
  const existing = root?.campaignTalentOutreach && typeof root.campaignTalentOutreach === 'object' && !Array.isArray(root.campaignTalentOutreach)
    ? root.campaignTalentOutreach
    : {};
  const seen = new Set();
  const records = [];
  for (const item of Array.isArray(existing.records) ? existing.records : []) {
    const next = record(item);
    if (!next.assignmentId || seen.has(next.assignmentId)) continue;
    seen.add(next.assignmentId);
    records.push(next);
  }
  return {
    version:1,
    records,
    updatedAt:text(existing.updatedAt, 80) || null,
    updatedBy:text(existing.updatedBy, 120) || null,
  };
}

export function defaultTalentOutreachRecord(assignmentId) {
  return record({ assignmentId, status:'NOT_CONTACTED' });
}

export function upsertTalentOutreachRecord(outreachInput = {}, assignmentId, patch = {}) {
  const outreach = parseCampaignTalentOutreach({ campaignTalentOutreach:outreachInput });
  const current = outreach.records.find((item) => item.assignmentId === assignmentId) || defaultTalentOutreachRecord(assignmentId);
  const next = record({ ...current, ...patch, assignmentId });
  outreach.records = [...outreach.records.filter((item) => item.assignmentId !== assignmentId), next];
  return { outreach, record:next, previous:current };
}

function usdEqual(a, b) {
  return Math.round(number(a) * 100) === Math.round(number(b) * 100);
}

function tokenEqual(a, b) {
  return Math.abs(number(a) - number(b)) < 0.00000001;
}

function activationFields(row) {
  return {
    assignmentId:row.assignmentId,
    status:row.status,
    agreedUsd:number(row.agreedUsd),
    agreedTokens:number(row.agreedTokens),
    deliverablesConfirmed:Boolean(row.deliverablesConfirmed),
    scheduleConfirmed:Boolean(row.scheduleConfirmed),
    compensationConfirmed:Boolean(row.compensationConfirmed),
    agencyConfirmed:Boolean(row.agencyConfirmed),
    termsConfirmed:Boolean(row.termsConfirmed),
    consentConfirmed:Boolean(row.consentConfirmed),
    evidenceReference:text(row.evidenceReference, 1500),
  };
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `cto_${(hash >>> 0).toString(16).padStart(8,'0')}`;
}

export function campaignTalentOutreachFingerprint(tracking = {}, outreachInput = {}) {
  const outreach = parseCampaignTalentOutreach({ campaignTalentOutreach:outreachInput });
  const byAssignment = new Map(outreach.records.map((item) => [item.assignmentId, item]));
  const payload = (tracking.creatorAssignments || [])
    .filter((item) => item.active !== false)
    .map((assignment) => {
      const row = byAssignment.get(assignment.id) || defaultTalentOutreachRecord(assignment.id);
      return {
        assignmentId:String(assignment.id || ''),
        allocatedUsd:number(assignment.allocatedUsd),
        allocatedTokens:number(assignment.allocatedTokens),
        agencyName:text(assignment.agencyName, 300),
        ...activationFields(row),
      };
    })
    .sort((a,b) => a.assignmentId.localeCompare(b.assignmentId));
  return fnv1a(JSON.stringify(payload));
}

export function buildCampaignTalentOutreachSummary(tracking = {}, outreachInput = {}) {
  const outreach = parseCampaignTalentOutreach({ campaignTalentOutreach:outreachInput });
  const byAssignment = new Map(outreach.records.map((item) => [item.assignmentId, item]));
  const assignments = (tracking.creatorAssignments || []).filter((item) => item.active !== false);
  const talent = assignments.map((assignment) => {
    const current = byAssignment.get(assignment.id) || defaultTalentOutreachRecord(assignment.id);
    const commercialMatch = usdEqual(current.agreedUsd, assignment.allocatedUsd)
      && tokenEqual(current.agreedTokens, assignment.allocatedTokens);
    const agencyRequired = Boolean(text(assignment.agencyName, 300));
    const confirmationEvidenceComplete = Boolean(current.evidenceReference)
      && current.deliverablesConfirmed
      && current.scheduleConfirmed
      && current.compensationConfirmed
      && current.termsConfirmed
      && current.consentConfirmed
      && (!agencyRequired || current.agencyConfirmed);
    const confirmed = current.status === 'CONFIRMED' && commercialMatch && confirmationEvidenceComplete;
    return {
      assignmentId:assignment.id,
      creatorType:assignment.creatorType,
      name:assignment.name,
      handle:assignment.handle,
      platform:assignment.platform,
      agencyName:assignment.agencyName || '',
      allocatedUsd:number(assignment.allocatedUsd),
      allocatedTokens:number(assignment.allocatedTokens),
      record:current,
      commercialMatch,
      agencyRequired,
      confirmationEvidenceComplete,
      confirmed,
    };
  });
  return {
    talent,
    talentCount:talent.length,
    confirmedCount:talent.filter((item) => item.confirmed).length,
    contactedCount:talent.filter((item) => ['CONTACTED','NEGOTIATING','ACCEPTED','CONFIRMED'].includes(item.record.status)).length,
    negotiatingCount:talent.filter((item) => item.record.status === 'NEGOTIATING').length,
    acceptedCount:talent.filter((item) => ['ACCEPTED','CONFIRMED'].includes(item.record.status)).length,
    declinedCount:talent.filter((item) => item.record.status === 'DECLINED').length,
    commercialMismatchCount:talent.filter((item) => ['ACCEPTED','CONFIRMED'].includes(item.record.status) && !item.commercialMatch).length,
    pendingCount:talent.filter((item) => !item.confirmed && item.record.status !== 'DECLINED').length,
    readyForActivation:talent.length > 0 && talent.every((item) => item.confirmed),
    currentFingerprint:campaignTalentOutreachFingerprint(tracking, outreach),
  };
}

export function assertTalentConfirmationReady(item = {}) {
  if (!item?.record || item.record.status !== 'ACCEPTED') {
    const cause = new Error('Record Creator/KOL acceptance before confirming campaign participation');
    cause.status = 409;
    throw cause;
  }
  if (!item.commercialMatch) {
    const cause = new Error('Agreed compensation does not match the approved campaign allocation; update and reapprove the campaign plan first');
    cause.status = 409;
    throw cause;
  }
  if (!item.record.deliverablesConfirmed || !item.record.scheduleConfirmed || !item.record.compensationConfirmed || !item.record.termsConfirmed || !item.record.consentConfirmed) {
    const cause = new Error('Deliverables, schedule, compensation, terms and consent must all be confirmed');
    cause.status = 422;
    throw cause;
  }
  if (item.agencyRequired && !item.record.agencyConfirmed) {
    const cause = new Error('Agency confirmation is required for this Creator/KOL');
    cause.status = 422;
    throw cause;
  }
  if (!item.record.evidenceReference) {
    const cause = new Error('Acceptance evidence reference is required before confirmation');
    cause.status = 422;
    throw cause;
  }
  return true;
}
