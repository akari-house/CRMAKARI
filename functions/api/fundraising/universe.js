import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';
import { parseFundraisingFlags } from '../../lib/fundraising-os.js';
import { cleanText, normalizeName, nonNegativeNumber, parseJson, percentage } from '../../lib/fundraising-intelligence.js';

const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER'];
const MISSING_SCHEMA = /(no such table|no such column|D1_ERROR.*investor_|SQLITE_ERROR.*investor_)/i;
const TECHNICAL_DB_ERROR = /(D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY|at offset \d+)/i;
const INVESTOR_TYPES = ['VC','FUND','ANGEL','CORPORATE_VC','FAMILY_OFFICE','ACCELERATOR','DAO','SYNDICATE','OTHER'];
const CONFLICT_STATES = ['NONE','POSSIBLE','CONFIRMED','UNKNOWN'];
const EVIDENCE_STATES = ['ASSERTED','VERIFIED','STALE','DISPUTED'];
const REDISTRIBUTION_STATES = ['ALLOWED','ATTRIBUTION_REQUIRED','UNKNOWN','PROHIBITED'];
const CONTACT_KINDS = ['WORK_EMAIL','PERSONAL_EMAIL','PHONE','LINKEDIN','X','TELEGRAM','WEBSITE','OTHER'];

function statusError(message, status = 422) {
  const cause = new Error(message);
  cause.status = status;
  return cause;
}

function enumValue(value, allowed, fallback, label) {
  const normalized = cleanText(value || fallback, 100).toUpperCase();
  if (!allowed.includes(normalized)) throw statusError(`${label} is invalid`);
  return normalized;
}

function boolValue(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 1 : 0;
}

function secureUrl(value, required = false) {
  const url = cleanText(value, 2000);
  if (!url && !required) return '';
  if (!url) throw statusError('A complete HTTPS URL is required');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe');
    return parsed.toString();
  } catch {
    throw statusError('Use a complete credential-free HTTPS URL');
  }
}

function normalizedContact(value, kind) {
  const cleaned = cleanText(value, 1000);
  if (!cleaned) throw statusError('Contact value is required');
  if (['WORK_EMAIL','PERSONAL_EMAIL'].includes(kind)) {
    const email = cleaned.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw statusError('Use a valid email address');
    return email;
  }
  if (['LINKEDIN','WEBSITE'].includes(kind)) return secureUrl(cleaned, true).toLowerCase();
  if (kind === 'X') return cleaned.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').toLowerCase();
  if (kind === 'TELEGRAM') return cleaned.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').toLowerCase();
  return cleaned.toLowerCase().replace(/\s+/g, ' ');
}

async function audit(db, auth, action, entityType, entityId, before, after) {
  await run(db, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [makeId('aud'), auth.tenantId, auth.userId, action, entityType, entityId, JSON.stringify(before || {}), JSON.stringify(after || {}), nowIso()]);
}

async function ensureSchema(db) {
  try {
    await first(db, 'SELECT id FROM investor_organisations LIMIT 1');
  } catch (cause) {
    if (MISSING_SCHEMA.test(String(cause?.message || ''))) throw statusError('Fundraising intelligence migration 0002 must be applied before Investor Universe writes are enabled', 503);
    throw cause;
  }
}

async function tenantOrganisation(db, tenantId, id) {
  return first(db, 'SELECT * FROM investor_organisations WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
}

async function tenantPerson(db, tenantId, id) {
  return first(db, 'SELECT * FROM investor_people WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
}

async function tenantSource(db, tenantId, id) {
  return first(db, 'SELECT * FROM investor_sources WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
}

async function tenantClaim(db, tenantId, id) {
  return first(db, 'SELECT * FROM investor_claims WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
}

function websiteDomain(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function nameTokens(value) {
  const ignored = new Set(['capital','ventures','venture','partners','partner','fund','funds','management','group','holdings','investment','investments','the']);
  return normalizeName(value).split(' ').filter((token) => token.length > 1 && !ignored.has(token));
}

function similarity(left, right) {
  const a = new Set(nameTokens(left));
  const b = new Set(nameTokens(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

function duplicateCandidates(organisations) {
  const candidates = [];
  for (let leftIndex = 0; leftIndex < organisations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < organisations.length; rightIndex += 1) {
      const left = organisations[leftIndex];
      const right = organisations[rightIndex];
      const leftDomain = websiteDomain(left.website);
      const rightDomain = websiteDomain(right.website);
      const score = leftDomain && rightDomain && leftDomain === rightDomain ? 1 : similarity(left.name, right.name);
      if (score < 0.66) continue;
      candidates.push({
        id:`${left.id}:${right.id}`,
        left:{ id:left.id, name:left.name, website:left.website || '' },
        right:{ id:right.id, name:right.name, website:right.website || '' },
        score:Math.round(score * 100),
        reason:leftDomain && leftDomain === rightDomain ? `Same website domain: ${leftDomain}` : 'Similar investor organisation names',
        action:'REVIEW_REQUIRED',
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 50);
}

function sourceReviewReason(item) {
  const reasons = [];
  if (item.confidence_status !== 'VERIFIED') reasons.push(`Source is ${String(item.confidence_status || 'ASSERTED').toLowerCase()}`);
  if (['UNKNOWN','PROHIBITED'].includes(item.redistribution_status)) reasons.push(`Redistribution is ${String(item.redistribution_status).toLowerCase()}`);
  const observed = Date.parse(item.observed_at || '');
  if (Number.isFinite(observed) && Date.now() - observed > 365 * 86400000) reasons.push('Observed more than 12 months ago');
  return reasons;
}

function normalizedReviewQueue(organisations, sources, claims) {
  const queue = [];
  sources.forEach((item) => {
    const reasons = sourceReviewReason(item);
    if (reasons.length) queue.push({ id:`source:${item.id}`, kind:'SOURCE', entityId:item.id, label:item.title || item.canonical_url, status:item.confidence_status, priority:item.redistribution_status === 'PROHIBITED' ? 100 : item.confidence_status === 'DISPUTED' ? 90 : 55, reasons });
  });
  claims.forEach((item) => {
    if (item.status !== 'VERIFIED') queue.push({ id:`claim:${item.id}`, kind:'CLAIM', entityId:item.id, organisationId:item.entity_type === 'ORGANISATION' ? item.entity_id : null, label:`${item.field}: ${cleanText(typeof item.value === 'string' ? item.value : JSON.stringify(item.value), 180)}`, status:item.status, priority:item.status === 'DISPUTED' ? 95 : item.status === 'STALE' ? 80 : 50, reasons:[`Claim is ${String(item.status).toLowerCase()}`] });
  });
  organisations.forEach((item) => {
    if (item.conflict_status !== 'NONE') queue.push({ id:`conflict:${item.id}`, kind:'CONFLICT', entityId:item.id, organisationId:item.id, label:item.name, status:item.conflict_status, priority:item.conflict_status === 'CONFIRMED' ? 100 : item.conflict_status === 'POSSIBLE' ? 85 : 45, reasons:[item.conflict_status === 'UNKNOWN' ? 'Portfolio conflict review is incomplete' : `${item.conflict_status.toLowerCase()} portfolio conflict requires review`] });
  });
  return queue.sort((a, b) => b.priority - a.priority).slice(0, 250);
}

async function normalizedResponse(db, tenantId, auth) {
  const [organisations, people, contacts, sources, claimRows, portfolio, targets] = await Promise.all([
    all(db, `
      SELECT o.*,
        (SELECT COUNT(*) FROM investor_people p WHERE p.tenant_id=o.tenant_id AND p.organisation_id=o.id AND p.status='ACTIVE') AS people_count,
        (SELECT COUNT(*) FROM investor_claims c WHERE c.tenant_id=o.tenant_id AND c.entity_type='ORGANISATION' AND c.entity_id=o.id) AS claim_count,
        (SELECT COUNT(*) FROM investor_claims c WHERE c.tenant_id=o.tenant_id AND c.entity_type='ORGANISATION' AND c.entity_id=o.id AND c.status='VERIFIED') AS verified_claim_count,
        (SELECT COUNT(*) FROM investor_portfolio_evidence pe WHERE pe.tenant_id=o.tenant_id AND pe.organisation_id=o.id AND pe.confidence_status!='DISPUTED') AS portfolio_count,
        (SELECT COUNT(*) FROM fundraising_targets t WHERE t.tenant_id=o.tenant_id AND t.organisation_id=o.id) AS target_count,
        (SELECT MAX(t.fit_score) FROM fundraising_targets t WHERE t.tenant_id=o.tenant_id AND t.organisation_id=o.id) AS best_fit_score
      FROM investor_organisations o
      WHERE o.tenant_id = ? AND o.status != 'ARCHIVED'
      ORDER BY o.updated_at DESC, o.name
    `, [tenantId]),
    all(db, `
      SELECT p.*, o.name AS organisation_name,
        (SELECT COUNT(*) FROM investor_contact_methods cm WHERE cm.tenant_id=p.tenant_id AND cm.person_id=p.id) AS contact_count
      FROM investor_people p
      LEFT JOIN investor_organisations o ON o.id=p.organisation_id AND o.tenant_id=p.tenant_id
      WHERE p.tenant_id = ? AND p.status != 'ARCHIVED'
      ORDER BY p.is_decision_maker DESC, p.full_name
    `, [tenantId]),
    all(db, `
      SELECT cm.id,cm.person_id,cm.kind,cm.value,cm.label,cm.visibility,cm.contribution_eligible,cm.is_primary,cm.source_id
      FROM investor_contact_methods cm
      JOIN investor_people p ON p.id=cm.person_id AND p.tenant_id=cm.tenant_id
      WHERE cm.tenant_id = ?
      ORDER BY cm.is_primary DESC, cm.kind
    `, [tenantId]),
    all(db, `
      SELECT * FROM investor_sources
      WHERE tenant_id = ?
      ORDER BY COALESCE(reviewed_at, observed_at) DESC, updated_at DESC
      LIMIT 500
    `, [tenantId]),
    all(db, `
      SELECT c.*, s.title AS source_title, s.publisher AS source_publisher, s.canonical_url AS source_url
      FROM investor_claims c
      LEFT JOIN investor_sources s ON s.id=c.source_id AND s.tenant_id=c.tenant_id
      WHERE c.tenant_id = ?
      ORDER BY CASE c.status WHEN 'DISPUTED' THEN 0 WHEN 'STALE' THEN 1 WHEN 'ASSERTED' THEN 2 ELSE 3 END, c.updated_at DESC
      LIMIT 1000
    `, [tenantId]),
    all(db, `
      SELECT pe.*, o.name AS organisation_name, s.canonical_url AS source_url, s.title AS source_title
      FROM investor_portfolio_evidence pe
      JOIN investor_organisations o ON o.id=pe.organisation_id AND o.tenant_id=pe.tenant_id
      LEFT JOIN investor_sources s ON s.id=pe.source_id AND s.tenant_id=pe.tenant_id
      WHERE pe.tenant_id = ?
      ORDER BY pe.updated_at DESC
      LIMIT 1000
    `, [tenantId]),
    all(db, `
      SELECT t.id,t.round_id,t.organisation_id,t.primary_person_id,t.stage,t.priority,t.fit_score,t.fit_components_json,t.fit_reasons_json,t.fit_warnings_json,t.conflict_signal,t.expected_check,t.probability_percentage,t.next_follow_up_at,t.next_action,
        r.round_name,p.name AS project_name
      FROM fundraising_targets t
      JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id
      JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
      WHERE t.tenant_id = ?
      ORDER BY t.updated_at DESC
    `, [tenantId]),
  ]);

  const contactsByPerson = new Map();
  contacts.forEach((item) => {
    if (!contactsByPerson.has(item.person_id)) contactsByPerson.set(item.person_id, []);
    contactsByPerson.get(item.person_id).push(item);
  });
  const peopleWithContacts = people.map((item) => ({ ...item, contacts:contactsByPerson.get(item.id) || [] }));
  const claims = claimRows.map((item) => ({ ...item, value:parseJson(item.value_json, item.value_json) }));
  const hydratedTargets = targets.map((item) => ({
    ...item,
    fit_components:parseJson(item.fit_components_json, {}),
    fit_reasons:parseJson(item.fit_reasons_json, []),
    fit_warnings:parseJson(item.fit_warnings_json, []),
  }));
  const reviewQueue = normalizedReviewQueue(organisations, sources, claims);
  const duplicates = duplicateCandidates(organisations);

  return {
    storageMode:'NORMALIZED_D1',
    migrationRequired:false,
    readOnly:false,
    organisations,
    people:peopleWithContacts,
    sources,
    claims,
    portfolio,
    targets:hydratedTargets,
    reviewQueue,
    duplicates,
    summary:{
      organisations:organisations.length,
      people:people.length,
      decisionMakers:people.filter((item) => Number(item.is_decision_maker) === 1).length,
      sources:sources.length,
      verifiedSources:sources.filter((item) => item.confidence_status === 'VERIFIED').length,
      claims:claims.length,
      verifiedClaims:claims.filter((item) => item.status === 'VERIFIED').length,
      portfolioEvidence:portfolio.length,
      possibleConflicts:organisations.filter((item) => ['POSSIBLE','CONFIRMED'].includes(item.conflict_status)).length,
      reviewItems:reviewQueue.length,
      duplicateCandidates:duplicates.length,
    },
    permissions:{ canWrite:WRITE_ROLES.includes(auth?.role), canReview:['OWNER','ADMIN'].includes(auth?.role) },
  };
}

async function legacyResponse(db, tenantId, auth) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const { rooms } = parseFundraisingFlags(row?.feature_flags_json);
  const organisationsById = new Map();
  const people = [];
  const targets = [];
  rooms.forEach((room) => {
    (Array.isArray(room.investorPipeline) ? room.investorPipeline : []).forEach((item) => {
      const organisationId = item.investorProjectId || `legacy_${normalizeName(item.investorName).replaceAll(' ','_')}`;
      if (!organisationsById.has(organisationId)) organisationsById.set(organisationId, {
        id:organisationId,
        name:item.investorName || 'Unnamed investor',
        investor_type:'OTHER',
        website:'',
        headquarters:'',
        current_fund:'',
        minimum_check:null,
        maximum_check:null,
        typical_check:null,
        conflict_status:'UNKNOWN',
        status:'ACTIVE',
        people_count:0,
        claim_count:0,
        verified_claim_count:0,
        portfolio_count:0,
        target_count:0,
        best_fit_score:0,
        storage_mode:'LEGACY_COMPATIBILITY',
      });
      const organisation = organisationsById.get(organisationId);
      organisation.target_count += 1;
      organisation.best_fit_score = Math.max(Number(organisation.best_fit_score || 0), percentage(item.fitScore));
      if (item.decisionMaker) {
        const personId = `${organisationId}:person:${normalizeName(item.decisionMaker).replaceAll(' ','_')}`;
        if (!people.some((person) => person.id === personId)) {
          people.push({ id:personId, organisation_id:organisationId, organisation_name:organisation.name, full_name:item.decisionMaker, title:'', is_decision_maker:1, status:'ACTIVE', contacts:item.contactEmail ? [{ id:`${personId}:email`, kind:'WORK_EMAIL', value:item.contactEmail, visibility:'PRIVATE', is_primary:1 }] : [], storage_mode:'LEGACY_COMPATIBILITY' });
          organisation.people_count += 1;
        }
      }
      targets.push({ id:item.id, round_id:room.id, organisation_id:organisationId, stage:item.stage, fit_score:percentage(item.fitScore), fit_reasons:[], fit_warnings:['Legacy score has not yet been converted to evidence-backed scoring.'], expected_check:nonNegativeNumber(item.estimatedTicket), probability_percentage:percentage(item.probability), next_follow_up_at:item.nextFollowUpAt || '', next_action:item.nextAction || '', round_name:room.roundName || 'Current round', project_name:room.projectName || '' });
    });
  });
  const organisations = [...organisationsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    storageMode:'LEGACY_COMPATIBILITY',
    migrationRequired:true,
    readOnly:true,
    organisations,
    people,
    sources:[],
    claims:[],
    portfolio:[],
    targets,
    reviewQueue:[{ id:'migration:0002', kind:'MIGRATION', entityId:'0002', label:'Enable normalized Investor Universe', status:'BLOCKED', priority:100, reasons:['Apply migration 0002 after a production backup and sanitized preview validation.'] }],
    duplicates:duplicateCandidates(organisations),
    summary:{ organisations:organisations.length, people:people.length, decisionMakers:people.length, sources:0, verifiedSources:0, claims:0, verifiedClaims:0, portfolioEvidence:0, possibleConflicts:0, reviewItems:1, duplicateCandidates:0 },
    permissions:{ canWrite:false, canReview:false, roleCanWrite:WRITE_ROLES.includes(auth?.role) },
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    try {
      return json(await normalizedResponse(context.env.DB, tenantId, auth));
    } catch (cause) {
      if (MISSING_SCHEMA.test(String(cause?.message || ''))) return json(await legacyResponse(context.env.DB, tenantId, auth));
      throw cause;
    }
  } catch (cause) {
    console.error('Investor Universe read failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Investor Universe could not be loaded' : (message || 'Investor Universe could not be loaded'), Number(cause?.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    requireRole(auth, WRITE_ROLES);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const action = cleanText(body.action, 80).toLowerCase();
    await ensureSchema(context.env.DB);

    if (action === 'upsert-organisation') return upsertOrganisation(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-person') return upsertPerson(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-contact') return upsertContact(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-source') return upsertSource(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-claim') return upsertClaim(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-portfolio') return upsertPortfolio(context.env.DB, auth, tenantId, body);
    if (action === 'review-source') return reviewSource(context.env.DB, auth, tenantId, body);
    if (action === 'review-claim') return reviewClaim(context.env.DB, auth, tenantId, body);
    if (action === 'set-conflict') return setConflict(context.env.DB, auth, tenantId, body);
    return error('Investor Universe action is not supported', 404);
  } catch (cause) {
    console.error('Investor Universe write failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Investor Universe action failed' : (message || 'Investor Universe action failed'), Number(cause?.status || 500));
  }
}

async function upsertOrganisation(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('inv_org');
  const existing = await tenantOrganisation(db, tenantId, id);
  const name = cleanText(body.name ?? existing?.name, 500);
  if (!name) throw statusError('Investor organisation name is required');
  const normalized = normalizeName(name);
  const duplicate = await first(db, 'SELECT id,name FROM investor_organisations WHERE tenant_id = ? AND normalized_name = ? AND id != ? LIMIT 1', [tenantId, normalized, id]);
  if (duplicate) throw statusError(`A matching investor organisation already exists: ${duplicate.name}`, 409);
  const item = {
    id,
    name,
    normalized_name:normalized,
    investor_type:enumValue(body.investorType ?? existing?.investor_type, INVESTOR_TYPES, 'OTHER', 'Investor type'),
    website:secureUrl(body.website ?? existing?.website),
    headquarters:cleanText(body.headquarters ?? existing?.headquarters, 300),
    description:cleanText(body.description ?? existing?.description),
    current_fund:cleanText(body.currentFund ?? existing?.current_fund, 500),
    minimum_check:body.minimumCheck === '' ? null : nonNegativeNumber(body.minimumCheck ?? existing?.minimum_check, null),
    maximum_check:body.maximumCheck === '' ? null : nonNegativeNumber(body.maximumCheck ?? existing?.maximum_check, null),
    typical_check:body.typicalCheck === '' ? null : nonNegativeNumber(body.typicalCheck ?? existing?.typical_check, null),
    lead_behavior:cleanText(body.leadBehavior ?? existing?.lead_behavior, 500),
    conflict_status:enumValue(body.conflictStatus ?? existing?.conflict_status, CONFLICT_STATES, 'UNKNOWN', 'Conflict status'),
    data_origin:existing?.data_origin || 'LOCAL',
    status:enumValue(body.status ?? existing?.status, ['ACTIVE','DORMANT','ARCHIVED'], 'ACTIVE', 'Organisation status'),
  };
  if (item.minimum_check !== null && item.maximum_check !== null && item.minimum_check > item.maximum_check) throw statusError('Minimum cheque cannot exceed maximum cheque');
  const now = nowIso();
  if (existing) {
    await run(db, `UPDATE investor_organisations SET name=?,normalized_name=?,investor_type=?,website=?,headquarters=?,description=?,current_fund=?,minimum_check=?,maximum_check=?,typical_check=?,lead_behavior=?,conflict_status=?,status=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [item.name,item.normalized_name,item.investor_type,item.website,item.headquarters,item.description,item.current_fund,item.minimum_check,item.maximum_check,item.typical_check,item.lead_behavior,item.conflict_status,item.status,now,auth.userId,tenantId,id]);
  } else {
    await run(db, `INSERT INTO investor_organisations (id,tenant_id,name,normalized_name,investor_type,website,headquarters,description,current_fund,minimum_check,maximum_check,typical_check,lead_behavior,conflict_status,data_origin,status,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.name,item.normalized_name,item.investor_type,item.website,item.headquarters,item.description,item.current_fund,item.minimum_check,item.maximum_check,item.typical_check,item.lead_behavior,item.conflict_status,item.data_origin,item.status,now,now,auth.userId,auth.userId]);
  }
  await audit(db, auth, existing ? 'INVESTOR_ORGANISATION_UPDATED' : 'INVESTOR_ORGANISATION_CREATED', 'INVESTOR_ORGANISATION', id, existing, item);
  return json({ item, created:!existing });
}

async function upsertPerson(db, auth, tenantId, body) {
  const organisationId = cleanText(body.organisationId, 120);
  if (organisationId && !(await tenantOrganisation(db, tenantId, organisationId))) throw statusError('Investor organisation was not found in this workspace', 404);
  const id = cleanText(body.id, 120) || makeId('inv_person');
  const existing = await tenantPerson(db, tenantId, id);
  const fullName = cleanText(body.fullName ?? existing?.full_name, 500);
  if (!fullName) throw statusError('Investor person name is required');
  const normalized = normalizeName(fullName);
  const duplicate = await first(db, 'SELECT id,full_name FROM investor_people WHERE tenant_id = ? AND COALESCE(organisation_id,\'\') = COALESCE(?,\'\') AND normalized_name = ? AND id != ? LIMIT 1', [tenantId, organisationId || null, normalized, id]);
  if (duplicate) throw statusError(`A matching investor person already exists: ${duplicate.full_name}`, 409);
  const item = { id, organisation_id:organisationId || null, full_name:fullName, normalized_name:normalized, title:cleanText(body.title ?? existing?.title, 500), city:cleanText(body.city ?? existing?.city, 300), bio:cleanText(body.bio ?? existing?.bio), is_decision_maker:boolValue(body.isDecisionMaker ?? existing?.is_decision_maker), origin:existing?.origin || 'LOCAL', status:enumValue(body.status ?? existing?.status, ['ACTIVE','DORMANT','ARCHIVED'], 'ACTIVE', 'Person status') };
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_people SET organisation_id=?,full_name=?,normalized_name=?,title=?,city=?,bio=?,is_decision_maker=?,status=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [item.organisation_id,item.full_name,item.normalized_name,item.title,item.city,item.bio,item.is_decision_maker,item.status,now,auth.userId,tenantId,id]);
  else await run(db, `INSERT INTO investor_people (id,tenant_id,organisation_id,full_name,normalized_name,title,city,bio,is_decision_maker,origin,status,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.organisation_id,item.full_name,item.normalized_name,item.title,item.city,item.bio,item.is_decision_maker,item.origin,item.status,now,now,auth.userId,auth.userId]);
  await audit(db, auth, existing ? 'INVESTOR_PERSON_UPDATED' : 'INVESTOR_PERSON_CREATED', 'INVESTOR_PERSON', id, existing, item);
  return json({ item, created:!existing });
}

async function upsertContact(db, auth, tenantId, body) {
  const personId = cleanText(body.personId, 120);
  if (!(await tenantPerson(db, tenantId, personId))) throw statusError('Investor person was not found in this workspace', 404);
  const id = cleanText(body.id, 120) || makeId('inv_contact');
  const existing = await first(db, 'SELECT * FROM investor_contact_methods WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const kind = enumValue(body.kind ?? existing?.kind, CONTACT_KINDS, 'WORK_EMAIL', 'Contact kind');
  const value = cleanText(body.value ?? existing?.value, 1000);
  const normalized = normalizedContact(value, kind);
  const duplicate = await first(db, 'SELECT id FROM investor_contact_methods WHERE tenant_id = ? AND person_id = ? AND kind = ? AND normalized_value = ? AND id != ? LIMIT 1', [tenantId, personId, kind, normalized, id]);
  if (duplicate) throw statusError('This contact method is already recorded', 409);
  const item = { id, person_id:personId, kind, value, normalized_value:normalized, label:cleanText(body.label ?? existing?.label, 300), source_id:cleanText(body.sourceId ?? existing?.source_id, 120) || null, visibility:enumValue(body.visibility ?? existing?.visibility, ['PRIVATE','PUBLIC'], 'PRIVATE', 'Contact visibility'), contribution_eligible:boolValue(body.contributionEligible ?? existing?.contribution_eligible), is_primary:boolValue(body.isPrimary ?? existing?.is_primary) };
  if (item.source_id && !(await tenantSource(db, tenantId, item.source_id))) throw statusError('Evidence source was not found in this workspace', 404);
  const now = nowIso();
  if (item.is_primary) await run(db, 'UPDATE investor_contact_methods SET is_primary = 0, updated_at = ? WHERE tenant_id = ? AND person_id = ? AND kind = ?', [now, tenantId, personId, kind]);
  if (existing) await run(db, `UPDATE investor_contact_methods SET person_id=?,kind=?,value=?,normalized_value=?,label=?,source_id=?,visibility=?,contribution_eligible=?,is_primary=?,updated_at=? WHERE tenant_id=? AND id=?`, [item.person_id,item.kind,item.value,item.normalized_value,item.label,item.source_id,item.visibility,item.contribution_eligible,item.is_primary,now,tenantId,id]);
  else await run(db, `INSERT INTO investor_contact_methods (id,tenant_id,person_id,kind,value,normalized_value,label,source_id,visibility,contribution_eligible,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.person_id,item.kind,item.value,item.normalized_value,item.label,item.source_id,item.visibility,item.contribution_eligible,item.is_primary,now,now]);
  await audit(db, auth, existing ? 'INVESTOR_CONTACT_UPDATED' : 'INVESTOR_CONTACT_CREATED', 'INVESTOR_CONTACT', id, existing ? { ...existing, value:'[REDACTED]' } : null, { ...item, value:'[REDACTED]' });
  return json({ item, created:!existing });
}

async function upsertSource(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('inv_source');
  const existing = await tenantSource(db, tenantId, id);
  const canonicalUrl = secureUrl(body.canonicalUrl ?? existing?.canonical_url, true);
  const duplicate = await first(db, 'SELECT id,title FROM investor_sources WHERE tenant_id = ? AND canonical_url = ? AND id != ? LIMIT 1', [tenantId, canonicalUrl, id]);
  if (duplicate) throw statusError(`This source is already recorded${duplicate.title ? `: ${duplicate.title}` : ''}`, 409);
  const item = { id, canonical_url:canonicalUrl, title:cleanText(body.title ?? existing?.title, 1000), publisher:cleanText(body.publisher ?? existing?.publisher, 500), source_type:cleanText(body.sourceType ?? existing?.source_type ?? 'OTHER', 100).toUpperCase(), observed_at:cleanText(body.observedAt ?? existing?.observed_at ?? nowIso(), 40), published_on:cleanText(body.publishedOn ?? existing?.published_on, 40), rights_class:cleanText(body.rightsClass ?? existing?.rights_class, 300), redistribution_status:enumValue(body.redistributionStatus ?? existing?.redistribution_status, REDISTRIBUTION_STATES, 'UNKNOWN', 'Redistribution status'), confidence_status:enumValue(body.confidenceStatus ?? existing?.confidence_status, EVIDENCE_STATES, 'ASSERTED', 'Source confidence'), attribution:cleanText(body.attribution ?? existing?.attribution, 2000), excerpt:cleanText(body.excerpt ?? existing?.excerpt, 4000) };
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_sources SET canonical_url=?,title=?,publisher=?,source_type=?,observed_at=?,published_on=?,rights_class=?,redistribution_status=?,confidence_status=?,attribution=?,excerpt=?,updated_at=? WHERE tenant_id=? AND id=?`, [item.canonical_url,item.title,item.publisher,item.source_type,item.observed_at,item.published_on,item.rights_class,item.redistribution_status,item.confidence_status,item.attribution,item.excerpt,now,tenantId,id]);
  else await run(db, `INSERT INTO investor_sources (id,tenant_id,canonical_url,title,publisher,source_type,observed_at,published_on,rights_class,redistribution_status,confidence_status,attribution,excerpt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.canonical_url,item.title,item.publisher,item.source_type,item.observed_at,item.published_on,item.rights_class,item.redistribution_status,item.confidence_status,item.attribution,item.excerpt,now,now]);
  await audit(db, auth, existing ? 'INVESTOR_SOURCE_UPDATED' : 'INVESTOR_SOURCE_CREATED', 'INVESTOR_SOURCE', id, existing, item);
  return json({ item, created:!existing });
}

async function upsertClaim(db, auth, tenantId, body) {
  const entityType = enumValue(body.entityType, ['ORGANISATION','PERSON'], 'ORGANISATION', 'Claim entity type');
  const entityId = cleanText(body.entityId, 120);
  const entity = entityType === 'ORGANISATION' ? await tenantOrganisation(db, tenantId, entityId) : await tenantPerson(db, tenantId, entityId);
  if (!entity) throw statusError('Claim entity was not found in this workspace', 404);
  const sourceId = cleanText(body.sourceId, 120) || null;
  if (sourceId && !(await tenantSource(db, tenantId, sourceId))) throw statusError('Evidence source was not found in this workspace', 404);
  const id = cleanText(body.id, 120) || makeId('inv_claim');
  const existing = await tenantClaim(db, tenantId, id);
  const field = cleanText(body.field ?? existing?.field, 200).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (!field) throw statusError('Claim field is required');
  const value = body.value ?? parseJson(existing?.value_json, existing?.value_json ?? '');
  const valueJson = JSON.stringify(value);
  if (valueJson.length > 10000) throw statusError('Claim value is too large');
  const item = { id, entity_type:entityType, entity_id:entityId, field, value_json:valueJson, source_id:sourceId, confidence:body.confidence === '' ? null : Math.min(1, Math.max(0, Number(body.confidence ?? existing?.confidence ?? 0.5))), observed_at:cleanText(body.observedAt ?? existing?.observed_at ?? nowIso(), 40), status:enumValue(body.status ?? existing?.status, EVIDENCE_STATES, 'ASSERTED', 'Claim status'), visibility:enumValue(body.visibility ?? existing?.visibility, ['PRIVATE','PUBLIC'], 'PRIVATE', 'Claim visibility'), contribution_eligible:boolValue(body.contributionEligible ?? existing?.contribution_eligible) };
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_claims SET entity_type=?,entity_id=?,field=?,value_json=?,source_id=?,confidence=?,observed_at=?,status=?,visibility=?,contribution_eligible=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [item.entity_type,item.entity_id,item.field,item.value_json,item.source_id,item.confidence,item.observed_at,item.status,item.visibility,item.contribution_eligible,now,auth.userId,tenantId,id]);
  else await run(db, `INSERT INTO investor_claims (id,tenant_id,entity_type,entity_id,field,value_json,source_id,confidence,observed_at,status,visibility,contribution_eligible,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.entity_type,item.entity_id,item.field,item.value_json,item.source_id,item.confidence,item.observed_at,item.status,item.visibility,item.contribution_eligible,now,now,auth.userId,auth.userId]);
  await audit(db, auth, existing ? 'INVESTOR_CLAIM_UPDATED' : 'INVESTOR_CLAIM_CREATED', 'INVESTOR_CLAIM', id, existing, item);
  return json({ item:{ ...item, value }, created:!existing });
}

async function upsertPortfolio(db, auth, tenantId, body) {
  const organisationId = cleanText(body.organisationId, 120);
  if (!(await tenantOrganisation(db, tenantId, organisationId))) throw statusError('Investor organisation was not found in this workspace', 404);
  const sourceId = cleanText(body.sourceId, 120) || null;
  if (sourceId && !(await tenantSource(db, tenantId, sourceId))) throw statusError('Evidence source was not found in this workspace', 404);
  const id = cleanText(body.id, 120) || makeId('inv_portfolio');
  const existing = await first(db, 'SELECT * FROM investor_portfolio_evidence WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const item = { id, organisation_id:organisationId, company_name:cleanText(body.companyName ?? existing?.company_name, 500), round_name:cleanText(body.roundName ?? existing?.round_name, 300), sector:cleanText(body.sector ?? existing?.sector, 300), announced_at:cleanText(body.announcedAt ?? existing?.announced_at, 40), source_id:sourceId, confidence_status:enumValue(body.confidenceStatus ?? existing?.confidence_status, EVIDENCE_STATES, 'ASSERTED', 'Portfolio evidence status'), notes:cleanText(body.notes ?? existing?.notes) };
  if (!item.company_name) throw statusError('Portfolio company name is required');
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_portfolio_evidence SET organisation_id=?,company_name=?,round_name=?,sector=?,announced_at=?,source_id=?,confidence_status=?,notes=?,updated_at=? WHERE tenant_id=? AND id=?`, [item.organisation_id,item.company_name,item.round_name,item.sector,item.announced_at,item.source_id,item.confidence_status,item.notes,now,tenantId,id]);
  else await run(db, `INSERT INTO investor_portfolio_evidence (id,tenant_id,organisation_id,company_name,round_name,sector,announced_at,source_id,confidence_status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.organisation_id,item.company_name,item.round_name,item.sector,item.announced_at,item.source_id,item.confidence_status,item.notes,now,now]);
  await audit(db, auth, existing ? 'INVESTOR_PORTFOLIO_UPDATED' : 'INVESTOR_PORTFOLIO_CREATED', 'INVESTOR_PORTFOLIO', id, existing, item);
  return json({ item, created:!existing });
}

async function reviewSource(db, auth, tenantId, body) {
  requireRole(auth, ['OWNER','ADMIN']);
  const id = cleanText(body.id, 120);
  const existing = await tenantSource(db, tenantId, id);
  if (!existing) throw statusError('Evidence source was not found in this workspace', 404);
  const next = { confidence_status:enumValue(body.confidenceStatus, EVIDENCE_STATES, existing.confidence_status, 'Source confidence'), redistribution_status:enumValue(body.redistributionStatus, REDISTRIBUTION_STATES, existing.redistribution_status, 'Redistribution status'), reviewed_by:auth.userId, reviewed_at:nowIso() };
  await run(db, 'UPDATE investor_sources SET confidence_status=?,redistribution_status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE tenant_id=? AND id=?', [next.confidence_status,next.redistribution_status,next.reviewed_by,next.reviewed_at,next.reviewed_at,tenantId,id]);
  await audit(db, auth, 'INVESTOR_SOURCE_REVIEWED', 'INVESTOR_SOURCE', id, existing, { ...existing, ...next });
  return json({ item:{ ...existing, ...next } });
}

async function reviewClaim(db, auth, tenantId, body) {
  requireRole(auth, ['OWNER','ADMIN']);
  const id = cleanText(body.id, 120);
  const existing = await tenantClaim(db, tenantId, id);
  if (!existing) throw statusError('Investor claim was not found in this workspace', 404);
  const status = enumValue(body.status, EVIDENCE_STATES, existing.status, 'Claim status');
  const confidence = body.confidence === undefined ? existing.confidence : Math.min(1, Math.max(0, Number(body.confidence)));
  const now = nowIso();
  await run(db, 'UPDATE investor_claims SET status=?,confidence=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?', [status,confidence,now,auth.userId,tenantId,id]);
  await audit(db, auth, 'INVESTOR_CLAIM_REVIEWED', 'INVESTOR_CLAIM', id, existing, { ...existing, status, confidence });
  return json({ item:{ ...existing, status, confidence } });
}

async function setConflict(db, auth, tenantId, body) {
  requireRole(auth, ['OWNER','ADMIN']);
  const id = cleanText(body.id, 120);
  const existing = await tenantOrganisation(db, tenantId, id);
  if (!existing) throw statusError('Investor organisation was not found in this workspace', 404);
  const conflictStatus = enumValue(body.conflictStatus, CONFLICT_STATES, existing.conflict_status, 'Conflict status');
  const note = cleanText(body.note, 2000);
  if (['NONE','CONFIRMED'].includes(conflictStatus) && !note) throw statusError('A conflict review note is required for a final decision');
  const now = nowIso();
  await run(db, 'UPDATE investor_organisations SET conflict_status=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?', [conflictStatus,now,auth.userId,tenantId,id]);
  await audit(db, auth, 'INVESTOR_CONFLICT_REVIEWED', 'INVESTOR_ORGANISATION', id, existing, { ...existing, conflict_status:conflictStatus, review_note:note });
  return json({ item:{ ...existing, conflict_status:conflictStatus }, reviewNote:note });
}
