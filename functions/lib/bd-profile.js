const ENTITY_TYPES = new Set([
  'PROJECT','VENTURE_CAPITAL','FUND','EXCHANGE','LAUNCHPAD','PROTOCOL','AGENCY','CREATOR_NETWORK','SERVICE_PROVIDER','OTHER',
]);
const BD_STAGES = new Set([
  'NEW','RESEARCHING','PROFILE_READY','READY_TO_CONTACT','CONTACTED','REPLIED','MEETING_BOOKED','QUALIFIED','DISQUALIFIED','ON_HOLD',
]);
const MEETING_STATUSES = new Set(['NOT_BOOKED','PROPOSED','BOOKED','COMPLETED','NO_SHOW','CANCELLED']);
const CALENDAR_STATUSES = new Set(['NOT_CONNECTED','PENDING_INTEGRATION','SYNCED','SYNC_FAILED']);

const cleanText = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};

const optionalNumber = (value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    const validationError = new Error(`${label} must be a valid number`);
    validationError.status = 422;
    throw validationError;
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
};

export function parseLegacyData(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return structuredClone(parsed);
    return { sourceData: parsed };
  } catch {
    return { sourceDataRaw: String(value).slice(0, 20000) };
  }
}

export function readBdProfile(value, project = {}) {
  const legacy = parseLegacyData(value);
  const stored = legacy.bdProfile && typeof legacy.bdProfile === 'object' ? legacy.bdProfile : {};
  const funding = stored.funding && typeof stored.funding === 'object' ? stored.funding : {};
  const capital = stored.capital && typeof stored.capital === 'object' ? stored.capital : {};
  const qualification = stored.qualification && typeof stored.qualification === 'object' ? stored.qualification : {};
  const meeting = stored.meeting && typeof stored.meeting === 'object' ? stored.meeting : {};
  return {
    version: 1,
    entityType: ENTITY_TYPES.has(String(stored.entityType || '').toUpperCase()) ? String(stored.entityType).toUpperCase() : 'PROJECT',
    funding: {
      stage: funding.stage || project.funding_status || null,
      amountRaised: funding.amountRaised ?? project.funding_amount ?? null,
      currency: String(funding.currency || 'USD').toUpperCase(),
      valuation: funding.valuation ?? project.valuation ?? null,
    },
    capital: {
      aumAmount: capital.aumAmount ?? null,
      currency: String(capital.currency || 'USD').toUpperCase(),
      checkSizeMin: capital.checkSizeMin ?? null,
      checkSizeMax: capital.checkSizeMax ?? null,
      investmentFocus: capital.investmentFocus || null,
    },
    qualification: {
      bdStage: BD_STAGES.has(String(qualification.bdStage || '').toUpperCase()) ? String(qualification.bdStage).toUpperCase() : 'NEW',
      serviceInterest: qualification.serviceInterest || null,
      nextAction: qualification.nextAction || null,
    },
    meeting: {
      status: MEETING_STATUSES.has(String(meeting.status || '').toUpperCase()) ? String(meeting.status).toUpperCase() : 'NOT_BOOKED',
      scheduledAt: meeting.scheduledAt || null,
      durationMinutes: Number(meeting.durationMinutes || 30),
      timezone: meeting.timezone || 'Europe/Berlin',
      locationUrl: meeting.locationUrl || null,
      calendarProvider: meeting.calendarProvider || null,
      externalEventId: meeting.externalEventId || null,
      syncStatus: CALENDAR_STATUSES.has(String(meeting.syncStatus || '').toUpperCase()) ? String(meeting.syncStatus).toUpperCase() : 'NOT_CONNECTED',
    },
  };
}

export function buildBdProfile(existingLegacy, body = {}, project = {}) {
  const legacy = parseLegacyData(existingLegacy);
  const current = readBdProfile(existingLegacy, project);
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const entityType = has('entityType') ? String(body.entityType || '').toUpperCase() : current.entityType;
  const bdStage = has('bdStage') ? String(body.bdStage || '').toUpperCase() : current.qualification.bdStage;
  const meetingStatus = has('meetingStatus') ? String(body.meetingStatus || '').toUpperCase() : current.meeting.status;
  const calendarSyncStatus = has('calendarSyncStatus') ? String(body.calendarSyncStatus || '').toUpperCase() : current.meeting.syncStatus;
  if (!ENTITY_TYPES.has(entityType)) {
    const err = new Error('Organisation type is invalid'); err.status = 422; throw err;
  }
  if (!BD_STAGES.has(bdStage)) {
    const err = new Error('BD stage is invalid'); err.status = 422; throw err;
  }
  if (!MEETING_STATUSES.has(meetingStatus)) {
    const err = new Error('Meeting status is invalid'); err.status = 422; throw err;
  }
  if (!CALENDAR_STATUSES.has(calendarSyncStatus)) {
    const err = new Error('Calendar sync status is invalid'); err.status = 422; throw err;
  }
  const checkSizeMin = has('checkSizeMin') ? optionalNumber(body.checkSizeMin, 'Minimum cheque size') : current.capital.checkSizeMin;
  const checkSizeMax = has('checkSizeMax') ? optionalNumber(body.checkSizeMax, 'Maximum cheque size') : current.capital.checkSizeMax;
  if (checkSizeMin !== null && checkSizeMax !== null && checkSizeMax < checkSizeMin) {
    const err = new Error('Maximum cheque size must be greater than or equal to minimum cheque size'); err.status = 422; throw err;
  }
  const duration = has('meetingDurationMinutes') ? optionalNumber(body.meetingDurationMinutes, 'Meeting duration', { min: 5, max: 480 }) : current.meeting.durationMinutes;
  const profile = {
    version: 1,
    entityType,
    funding: {
      stage: has('fundingStage') ? cleanText(body.fundingStage, 200) : current.funding.stage,
      amountRaised: has('fundingAmount') ? optionalNumber(body.fundingAmount, 'Funding raised') : current.funding.amountRaised,
      currency: String(has('fundingCurrency') ? (body.fundingCurrency || 'USD') : current.funding.currency || 'USD').toUpperCase().slice(0, 10),
      valuation: has('valuation') ? optionalNumber(body.valuation, 'Valuation') : current.funding.valuation,
    },
    capital: {
      aumAmount: has('aumAmount') ? optionalNumber(body.aumAmount, 'Assets under management') : current.capital.aumAmount,
      currency: String(has('aumCurrency') ? (body.aumCurrency || 'USD') : current.capital.currency || 'USD').toUpperCase().slice(0, 10),
      checkSizeMin,
      checkSizeMax,
      investmentFocus: has('investmentFocus') ? cleanText(body.investmentFocus, 3000) : current.capital.investmentFocus,
    },
    qualification: {
      bdStage,
      serviceInterest: has('serviceInterest') ? cleanText(body.serviceInterest, 1000) : current.qualification.serviceInterest,
      nextAction: has('nextAction') ? cleanText(body.nextAction, 2000) : current.qualification.nextAction,
    },
    meeting: {
      status: meetingStatus,
      scheduledAt: has('meetingScheduledAt') ? cleanText(body.meetingScheduledAt, 100) : current.meeting.scheduledAt,
      durationMinutes: duration || 30,
      timezone: has('meetingTimezone') ? (cleanText(body.meetingTimezone, 100) || 'Europe/Berlin') : current.meeting.timezone,
      locationUrl: has('meetingLocationUrl') ? cleanText(body.meetingLocationUrl, 1000) : current.meeting.locationUrl,
      calendarProvider: has('calendarProvider') ? cleanText(body.calendarProvider, 100) : current.meeting.calendarProvider,
      externalEventId: has('calendarEventId') ? cleanText(body.calendarEventId, 500) : current.meeting.externalEventId,
      syncStatus: calendarSyncStatus,
    },
  };
  legacy.bdProfile = profile;
  return { legacy, profile, serialized: JSON.stringify(legacy) };
}

export function profileCompleteness(project = {}, contacts = [], profile = readBdProfile(project.legacy_import_data, project)) {
  const primary = contacts.find((item) => item.is_primary_contact) || contacts[0] || {};
  const common = [project.name, project.category, project.website, project.x_url, project.telegram, project.region, project.owner_user_id, project.source_name, primary.full_name, primary.x_handle, primary.telegram, profile.qualification.nextAction];
  const specific = ['VENTURE_CAPITAL','FUND'].includes(profile.entityType)
    ? [profile.capital.aumAmount, profile.capital.investmentFocus, profile.capital.checkSizeMin, profile.capital.checkSizeMax]
    : [profile.funding.stage, profile.funding.amountRaised, profile.funding.valuation];
  const fields = [...common, ...specific];
  const completed = fields.filter((value) => value !== null && value !== undefined && String(value).trim() !== '').length;
  return Math.round(completed / fields.length * 100);
}

export { ENTITY_TYPES, BD_STAGES, MEETING_STATUSES };
