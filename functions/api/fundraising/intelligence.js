import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole, canViewFinance } from '../../lib/permissions.js';
import { parseFundraisingFlags } from '../../lib/fundraising-os.js';
import {
  ROUND_STAGES,
  NORMALIZED_TARGET_STAGES,
  assessInvestorFit,
  calculateRoundEconomics,
  cleanText,
  legacyCompatibilitySnapshot,
  nonNegativeNumber,
  normalizeName,
  parseJson,
  percentage,
  textList,
} from '../../lib/fundraising-intelligence.js';

const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER'];
const MISSING_SCHEMA = /(no such table|no such column|D1_ERROR.*fundraising_|SQLITE_ERROR.*fundraising_)/i;
const TECHNICAL_DB_ERROR = /(D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY|at offset \d+)/i;

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

function secureUrl(value, required = false) {
  const url = cleanText(value, 2000);
  if (!url && !required) return '';
  if (!url) throw statusError('A source URL is required');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe');
    return parsed.toString();
  } catch {
    throw statusError('Use a complete credential-free HTTPS URL');
  }
}

async function audit(db, auth, action, entityType, entityId, before, after) {
  await run(db, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    makeId('aud'), auth.tenantId, auth.userId, action, entityType, entityId,
    JSON.stringify(before || {}), JSON.stringify(after || {}), nowIso(),
  ]);
}

async function activeMember(db, tenantId, userId) {
  if (!userId) return null;
  return first(db, `
    SELECT u.id, tm.role
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    WHERE tm.tenant_id = ? AND tm.user_id = ?
      AND tm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  `, [tenantId, userId]);
}

async function tenantProject(db, tenantId, projectId) {
  return first(db, `
    SELECT id, name, category, region, funding_status, funding_amount, valuation, legacy_import_data
    FROM projects
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `, [tenantId, projectId]);
}

async function legacyResponse(db, tenantId, auth) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const { rooms } = parseFundraisingFlags(row?.feature_flags_json);
  return {
    ...legacyCompatibilitySnapshot(rooms),
    permissions:{ canWrite:WRITE_ROLES.includes(auth?.role), canFinance:canViewFinance(auth) },
  };
}

function targetFromRow(row) {
  return {
    ...row,
    fit_components:parseJson(row.fit_components_json, {}),
    fit_reasons:parseJson(row.fit_reasons_json, []),
    fit_warnings:parseJson(row.fit_warnings_json, []),
  };
}

async function normalizedResponse(db, tenantId, auth) {
  const [roundRows, targetRows, commitmentRows, peopleCounts, claimCounts, sourceCount] = await Promise.all([
    all(db, `
      SELECT r.*, p.name AS project_name
      FROM fundraising_rounds r
      JOIN projects p ON p.id = r.project_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = ?
      ORDER BY CASE r.stage WHEN 'OPEN' THEN 0 WHEN 'OUTREACH' THEN 1 WHEN 'DILIGENCE' THEN 2 WHEN 'COMMITMENTS' THEN 3 ELSE 4 END,
        COALESCE(r.target_close_date, '9999-12-31'), r.updated_at DESC
    `, [tenantId]),
    all(db, `
      SELECT t.*, o.name AS organisation_name, o.investor_type, o.website,
        o.current_fund, o.minimum_check, o.maximum_check, o.typical_check,
        o.lead_behavior, o.conflict_status,
        ip.full_name AS primary_person_name, ip.title AS primary_person_title
      FROM fundraising_targets t
      JOIN investor_organisations o ON o.id = t.organisation_id AND o.tenant_id = t.tenant_id
      LEFT JOIN investor_people ip ON ip.id = t.primary_person_id AND ip.tenant_id = t.tenant_id
      WHERE t.tenant_id = ?
      ORDER BY t.priority DESC, t.updated_at DESC
    `, [tenantId]),
    canViewFinance(auth) ? all(db, `
      SELECT id, round_id, target_id, status, committed_amount, allocated_amount,
        received_amount, currency, instrument, committed_at, signed_at, received_at
      FROM fundraising_commitments
      WHERE tenant_id = ? AND status != 'CANCELLED'
      ORDER BY updated_at DESC
    `, [tenantId]) : Promise.resolve([]),
    all(db, `
      SELECT organisation_id, COUNT(*) AS count
      FROM investor_people
      WHERE tenant_id = ? AND status = 'ACTIVE'
      GROUP BY organisation_id
    `, [tenantId]),
    all(db, `
      SELECT entity_id AS organisation_id, COUNT(*) AS count,
        SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_count
      FROM investor_claims
      WHERE tenant_id = ? AND entity_type = 'ORGANISATION'
      GROUP BY entity_id
    `, [tenantId]),
    first(db, 'SELECT COUNT(*) AS count FROM investor_sources WHERE tenant_id = ?', [tenantId]),
  ]);

  const targets = targetRows.map(targetFromRow);
  const peopleByOrganisation = new Map(peopleCounts.map((row) => [row.organisation_id, Number(row.count || 0)]));
  const claimsByOrganisation = new Map(claimCounts.map((row) => [row.organisation_id, {
    count:Number(row.count || 0), verified:Number(row.verified_count || 0),
  }]));
  const commitmentsByRound = new Map();
  commitmentRows.forEach((item) => {
    if (!commitmentsByRound.has(item.round_id)) commitmentsByRound.set(item.round_id, []);
    commitmentsByRound.get(item.round_id).push(item);
  });

  const rounds = roundRows.map((round) => {
    const roundTargets = targets.filter((target) => target.round_id === round.id).map((target) => ({
      ...target,
      people_count:peopleByOrganisation.get(target.organisation_id) || 0,
      evidence:claimsByOrganisation.get(target.organisation_id) || { count:0, verified:0 },
    }));
    const commitments = commitmentsByRound.get(round.id) || [];
    return {
      ...round,
      targets:roundTargets,
      commitments:canViewFinance(auth) ? commitments : undefined,
      economics:calculateRoundEconomics(round, roundTargets, commitments),
    };
  });

  return {
    storageMode:'NORMALIZED_D1',
    migrationRequired:false,
    readOnly:false,
    rounds,
    summary:{
      rounds:rounds.length,
      activeRounds:rounds.filter((round) => !['CLOSED','PAUSED'].includes(round.stage)).length,
      targets:targets.length,
      investorOrganisations:new Set(targets.map((target) => target.organisation_id)).size,
      evidenceSources:Number(sourceCount?.count || 0),
      targetAmount:rounds.reduce((sum, round) => sum + round.economics.targetAmount, 0),
      weightedPipeline:rounds.reduce((sum, round) => sum + round.economics.weightedPipeline, 0),
      confirmedCommitments:rounds.reduce((sum, round) => sum + round.economics.confirmedCommitments, 0),
      fundsReceived:rounds.reduce((sum, round) => sum + round.economics.fundsReceived, 0),
    },
    permissions:{ canWrite:WRITE_ROLES.includes(auth?.role), canFinance:canViewFinance(auth) },
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
    console.error('Fundraising intelligence read failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising intelligence could not be loaded' : (message || 'Fundraising intelligence could not be loaded'), Number(cause?.status || 500));
  }
}

async function ensureNormalizedSchema(db) {
  try {
    await first(db, 'SELECT id FROM fundraising_rounds LIMIT 1');
  } catch (cause) {
    if (MISSING_SCHEMA.test(String(cause?.message || ''))) {
      throw statusError('Fundraising intelligence migration 0002 must be applied before normalized writes are enabled', 503);
    }
    throw cause;
  }
}

async function organisationClaims(db, tenantId, organisationId) {
  const rows = await all(db, `
    SELECT field, value_json, status, confidence
    FROM investor_claims
    WHERE tenant_id = ? AND entity_type = 'ORGANISATION' AND entity_id = ?
      AND status IN ('ASSERTED','VERIFIED')
    ORDER BY CASE status WHEN 'VERIFIED' THEN 0 ELSE 1 END, updated_at DESC
  `, [tenantId, organisationId]);
  const values = {};
  rows.forEach((row) => {
    if (values[row.field] === undefined) values[row.field] = parseJson(row.value_json, row.value_json);
  });
  const confidence = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + (Number(row.confidence) || (row.status === 'VERIFIED' ? 1 : 0.5)), 0) / rows.length * 100)
    : 0;
  return { values, confidence };
}

async function portfolioMatchCount(db, tenantId, organisationId, sectors) {
  const rows = await all(db, `
    SELECT sector
    FROM investor_portfolio_evidence
    WHERE tenant_id = ? AND organisation_id = ? AND confidence_status != 'DISPUTED'
  `, [tenantId, organisationId]);
  const wanted = textList(sectors).map((item) => item.toLowerCase());
  if (!wanted.length) return rows.length;
  return rows.filter((row) => wanted.some((item) => cleanText(row.sector, 200).toLowerCase().includes(item) || item.includes(cleanText(row.sector, 200).toLowerCase()))).length;
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    requireRole(auth, WRITE_ROLES);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    const action = cleanText(body.action, 80).toLowerCase();
    await ensureNormalizedSchema(context.env.DB);

    if (action === 'upsert-round') return upsertRound(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-organisation') return upsertOrganisation(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-person') return upsertPerson(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-source') return upsertSource(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-claim') return upsertClaim(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-target') return upsertTarget(context.env.DB, auth, tenantId, body);
    if (action === 'move-target') return moveTarget(context.env.DB, auth, tenantId, body);
    return error('Fundraising intelligence action is not supported', 404);
  } catch (cause) {
    console.error('Fundraising intelligence write failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising intelligence action failed' : (message || 'Fundraising intelligence action failed'), Number(cause?.status || 500));
  }
}

async function upsertRound(db, auth, tenantId, body) {
  const projectId = cleanText(body.projectId, 120);
  const project = await tenantProject(db, tenantId, projectId);
  if (!project) throw statusError('Selected project was not found in this workspace', 404);
  const ownerUserId = cleanText(body.ownerUserId, 120);
  if (ownerUserId && !(await activeMember(db, tenantId, ownerUserId))) throw statusError('Selected fundraising owner is not an active workspace member');
  const id = cleanText(body.id, 120) || makeId('raise');
  const existing = await first(db, 'SELECT * FROM fundraising_rounds WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const item = {
    id,
    project_id:project.id,
    owner_user_id:ownerUserId || existing?.owner_user_id || null,
    round_name:cleanText(body.roundName ?? existing?.round_name ?? 'Current round', 300),
    stage:enumValue(body.stage ?? existing?.stage, ROUND_STAGES, 'PREPARING', 'Fundraising stage'),
    instrument:cleanText(body.instrument ?? body.roundType ?? existing?.instrument, 100),
    funding_stage:cleanText(body.fundingStage ?? existing?.funding_stage, 100),
    currency:cleanText(body.currency ?? existing?.currency ?? 'USD', 12).toUpperCase(),
    target_amount:nonNegativeNumber(body.targetAmount ?? existing?.target_amount),
    valuation:nonNegativeNumber(body.valuation ?? existing?.valuation),
    minimum_ticket:nonNegativeNumber(body.minimumTicket ?? existing?.minimum_ticket),
    maximum_ticket:nonNegativeNumber(body.maximumTicket ?? existing?.maximum_ticket),
    launch_date:cleanText(body.launchDate ?? existing?.launch_date, 30),
    target_close_date:cleanText(body.targetCloseDate ?? existing?.target_close_date, 30),
    thesis:cleanText(body.thesis ?? existing?.thesis),
    next_action:cleanText(body.nextAction ?? existing?.next_action, 2000),
    readiness_score:percentage(body.readinessScore ?? existing?.readiness_score),
  };
  if (!item.round_name) throw statusError('Round name is required');
  if (item.maximum_ticket && item.minimum_ticket > item.maximum_ticket) throw statusError('Minimum ticket cannot exceed maximum ticket');
  const now = nowIso();
  if (existing) {
    await run(db, `UPDATE fundraising_rounds SET project_id=?, owner_user_id=?, round_name=?, stage=?, instrument=?, funding_stage=?, currency=?, target_amount=?, valuation=?, minimum_ticket=?, maximum_ticket=?, launch_date=?, target_close_date=?, thesis=?, next_action=?, readiness_score=?, updated_at=?, updated_by=? WHERE tenant_id=? AND id=?`, [
      item.project_id,item.owner_user_id,item.round_name,item.stage,item.instrument,item.funding_stage,item.currency,item.target_amount,item.valuation,item.minimum_ticket,item.maximum_ticket,item.launch_date,item.target_close_date,item.thesis,item.next_action,item.readiness_score,now,auth.userId,tenantId,id,
    ]);
  } else {
    await run(db, `INSERT INTO fundraising_rounds (id,tenant_id,project_id,owner_user_id,round_name,stage,instrument,funding_stage,currency,target_amount,valuation,minimum_ticket,maximum_ticket,launch_date,target_close_date,thesis,next_action,readiness_score,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      id,tenantId,item.project_id,item.owner_user_id,item.round_name,item.stage,item.instrument,item.funding_stage,item.currency,item.target_amount,item.valuation,item.minimum_ticket,item.maximum_ticket,item.launch_date,item.target_close_date,item.thesis,item.next_action,item.readiness_score,now,now,auth.userId,auth.userId,
    ]);
  }
  await audit(db, auth, existing ? 'FUNDRAISING_ROUND_UPDATED' : 'FUNDRAISING_ROUND_CREATED', 'FUNDRAISING_ROUND', id, existing, item);
  return json({ updated:true, item:{ ...item, id, project_name:project.name } });
}

async function upsertOrganisation(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('investor_org');
  const existing = await first(db, 'SELECT * FROM investor_organisations WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const canonicalProjectId = cleanText(body.canonicalProjectId ?? existing?.canonical_project_id, 120);
  if (canonicalProjectId && !(await tenantProject(db, tenantId, canonicalProjectId))) throw statusError('Linked CRM organisation was not found in this workspace', 404);
  const name = cleanText(body.name ?? existing?.name, 500);
  if (!name) throw statusError('Investor organisation name is required');
  const item = {
    id,
    canonical_project_id:canonicalProjectId || null,
    name,
    normalized_name:normalizeName(name),
    investor_type:cleanText(body.investorType ?? existing?.investor_type ?? 'OTHER', 100).toUpperCase(),
    website:body.website === undefined ? cleanText(existing?.website, 2000) : secureUrl(body.website, false),
    headquarters:cleanText(body.headquarters ?? existing?.headquarters, 300),
    description:cleanText(body.description ?? existing?.description),
    current_fund:cleanText(body.currentFund ?? existing?.current_fund, 500),
    minimum_check:body.minimumCheck === undefined ? existing?.minimum_check ?? null : nonNegativeNumber(body.minimumCheck),
    maximum_check:body.maximumCheck === undefined ? existing?.maximum_check ?? null : nonNegativeNumber(body.maximumCheck),
    typical_check:body.typicalCheck === undefined ? existing?.typical_check ?? null : nonNegativeNumber(body.typicalCheck),
    lead_behavior:cleanText(body.leadBehavior ?? existing?.lead_behavior, 500),
    conflict_status:enumValue(body.conflictStatus ?? existing?.conflict_status, ['NONE','POSSIBLE','CONFIRMED','UNKNOWN'], 'UNKNOWN', 'Conflict status'),
    data_origin:enumValue(body.dataOrigin ?? existing?.data_origin, ['LOCAL','CRM_PROJECT','IMPORT','PUBLIC_RESEARCH'], canonicalProjectId ? 'CRM_PROJECT' : 'LOCAL', 'Data origin'),
    status:enumValue(body.status ?? existing?.status, ['ACTIVE','DORMANT','ARCHIVED'], 'ACTIVE', 'Investor status'),
  };
  if (item.minimum_check !== null && item.maximum_check !== null && item.maximum_check > 0 && item.minimum_check > item.maximum_check) throw statusError('Minimum cheque cannot exceed maximum cheque');
  const duplicate = await first(db, 'SELECT id FROM investor_organisations WHERE tenant_id = ? AND normalized_name = ? AND id != ? LIMIT 1', [tenantId, item.normalized_name, id]);
  if (duplicate) throw statusError('An investor organisation with this name already exists', 409);
  const now = nowIso();
  if (existing) {
    await run(db, `UPDATE investor_organisations SET canonical_project_id=?,name=?,normalized_name=?,investor_type=?,website=?,headquarters=?,description=?,current_fund=?,minimum_check=?,maximum_check=?,typical_check=?,lead_behavior=?,conflict_status=?,data_origin=?,status=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [
      item.canonical_project_id,item.name,item.normalized_name,item.investor_type,item.website,item.headquarters,item.description,item.current_fund,item.minimum_check,item.maximum_check,item.typical_check,item.lead_behavior,item.conflict_status,item.data_origin,item.status,now,auth.userId,tenantId,id,
    ]);
  } else {
    await run(db, `INSERT INTO investor_organisations (id,tenant_id,canonical_project_id,name,normalized_name,investor_type,website,headquarters,description,current_fund,minimum_check,maximum_check,typical_check,lead_behavior,conflict_status,data_origin,status,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      id,tenantId,item.canonical_project_id,item.name,item.normalized_name,item.investor_type,item.website,item.headquarters,item.description,item.current_fund,item.minimum_check,item.maximum_check,item.typical_check,item.lead_behavior,item.conflict_status,item.data_origin,item.status,now,now,auth.userId,auth.userId,
    ]);
  }
  await audit(db, auth, existing ? 'INVESTOR_ORGANISATION_UPDATED' : 'INVESTOR_ORGANISATION_CREATED', 'INVESTOR_ORGANISATION', id, existing, item);
  return json({ updated:true, item });
}

async function upsertPerson(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('investor_person');
  const existing = await first(db, 'SELECT * FROM investor_people WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const organisationId = cleanText(body.organisationId ?? existing?.organisation_id, 120);
  if (organisationId && !(await first(db, 'SELECT id FROM investor_organisations WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, organisationId]))) throw statusError('Investor organisation was not found in this workspace', 404);
  const fullName = cleanText(body.fullName ?? existing?.full_name, 500);
  if (!fullName) throw statusError('Investor person name is required');
  const item = {
    id, organisation_id:organisationId || null, full_name:fullName, normalized_name:normalizeName(fullName),
    title:cleanText(body.title ?? existing?.title, 300), city:cleanText(body.city ?? existing?.city, 300),
    bio:cleanText(body.bio ?? existing?.bio), is_decision_maker:Boolean(body.isDecisionMaker ?? existing?.is_decision_maker) ? 1 : 0,
    origin:enumValue(body.origin ?? existing?.origin, ['LOCAL','CRM_CONTACT','IMPORT','PUBLIC_RESEARCH'], 'LOCAL', 'Person origin'),
    status:enumValue(body.status ?? existing?.status, ['ACTIVE','DORMANT','ARCHIVED'], 'ACTIVE', 'Person status'),
  };
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_people SET organisation_id=?,full_name=?,normalized_name=?,title=?,city=?,bio=?,is_decision_maker=?,origin=?,status=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [item.organisation_id,item.full_name,item.normalized_name,item.title,item.city,item.bio,item.is_decision_maker,item.origin,item.status,now,auth.userId,tenantId,id]);
  else await run(db, `INSERT INTO investor_people (id,tenant_id,organisation_id,full_name,normalized_name,title,city,bio,is_decision_maker,origin,status,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.organisation_id,item.full_name,item.normalized_name,item.title,item.city,item.bio,item.is_decision_maker,item.origin,item.status,now,now,auth.userId,auth.userId]);
  await audit(db, auth, existing ? 'INVESTOR_PERSON_UPDATED' : 'INVESTOR_PERSON_CREATED', 'INVESTOR_PERSON', id, existing, item);
  return json({ updated:true, item });
}

async function upsertSource(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('investor_source');
  const existing = await first(db, 'SELECT * FROM investor_sources WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const item = {
    id, canonical_url:secureUrl(body.url ?? body.canonicalUrl ?? existing?.canonical_url, true),
    title:cleanText(body.title ?? existing?.title, 500), publisher:cleanText(body.publisher ?? existing?.publisher, 300),
    source_type:cleanText(body.sourceType ?? existing?.source_type ?? 'OTHER', 100).toUpperCase(),
    observed_at:cleanText(body.observedAt ?? existing?.observed_at ?? nowIso(), 100), published_on:cleanText(body.publishedOn ?? existing?.published_on, 30),
    rights_class:cleanText(body.rightsClass ?? existing?.rights_class, 200),
    redistribution_status:enumValue(body.redistributionStatus ?? existing?.redistribution_status, ['ALLOWED','ATTRIBUTION_REQUIRED','UNKNOWN','PROHIBITED'], 'UNKNOWN', 'Redistribution status'),
    confidence_status:enumValue(body.confidenceStatus ?? existing?.confidence_status, ['ASSERTED','VERIFIED','STALE','DISPUTED'], 'ASSERTED', 'Confidence status'),
    attribution:cleanText(body.attribution ?? existing?.attribution, 2000), excerpt:cleanText(body.excerpt ?? existing?.excerpt, 2000),
  };
  const duplicate = await first(db, 'SELECT id FROM investor_sources WHERE tenant_id = ? AND canonical_url = ? AND id != ? LIMIT 1', [tenantId, item.canonical_url, id]);
  if (duplicate) throw statusError('This source already exists in the investor evidence ledger', 409);
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_sources SET canonical_url=?,title=?,publisher=?,source_type=?,observed_at=?,published_on=?,rights_class=?,redistribution_status=?,confidence_status=?,attribution=?,excerpt=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE tenant_id=? AND id=?`, [item.canonical_url,item.title,item.publisher,item.source_type,item.observed_at,item.published_on,item.rights_class,item.redistribution_status,item.confidence_status,item.attribution,item.excerpt,auth.userId,now,now,tenantId,id]);
  else await run(db, `INSERT INTO investor_sources (id,tenant_id,canonical_url,title,publisher,source_type,observed_at,published_on,rights_class,redistribution_status,confidence_status,attribution,excerpt,reviewed_by,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.canonical_url,item.title,item.publisher,item.source_type,item.observed_at,item.published_on,item.rights_class,item.redistribution_status,item.confidence_status,item.attribution,item.excerpt,auth.userId,now,now,now]);
  await audit(db, auth, existing ? 'INVESTOR_SOURCE_UPDATED' : 'INVESTOR_SOURCE_CREATED', 'INVESTOR_SOURCE', id, existing, item);
  return json({ updated:true, item });
}

async function upsertClaim(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('investor_claim');
  const existing = await first(db, 'SELECT * FROM investor_claims WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const entityType = enumValue(body.entityType ?? existing?.entity_type, ['ORGANISATION','PERSON'], 'ORGANISATION', 'Claim entity type');
  const entityId = cleanText(body.entityId ?? existing?.entity_id, 120);
  const entityTable = entityType === 'PERSON' ? 'investor_people' : 'investor_organisations';
  if (!entityId || !(await first(db, `SELECT id FROM ${entityTable} WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenantId, entityId]))) throw statusError('Claim entity was not found in this workspace', 404);
  const sourceId = cleanText(body.sourceId ?? existing?.source_id, 120);
  let source = null;
  if (sourceId) {
    source = await first(db, 'SELECT id, redistribution_status FROM investor_sources WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, sourceId]);
    if (!source) throw statusError('Evidence source was not found in this workspace', 404);
  }
  const field = cleanText(body.field ?? existing?.field, 200);
  if (!field) throw statusError('Claim field is required');
  const value = body.value === undefined ? parseJson(existing?.value_json, null) : body.value;
  if (value === undefined || value === null || value === '') throw statusError('Claim value is required');
  const visibility = enumValue(body.visibility ?? existing?.visibility, ['PRIVATE','PUBLIC'], 'PRIVATE', 'Claim visibility');
  const contributionEligible = Boolean(body.contributionEligible ?? existing?.contribution_eligible);
  if (contributionEligible && (!source || ['UNKNOWN','PROHIBITED'].includes(source.redistribution_status))) throw statusError('Public contribution requires a source with redistribution permission');
  const item = {
    id, entity_type:entityType, entity_id:entityId, field, value_json:JSON.stringify(value), source_id:sourceId || null,
    confidence:body.confidence === undefined ? existing?.confidence ?? null : Math.min(1, Math.max(0, Number(body.confidence))),
    observed_at:cleanText(body.observedAt ?? existing?.observed_at ?? nowIso(), 100),
    status:enumValue(body.status ?? existing?.status, ['ASSERTED','VERIFIED','STALE','DISPUTED'], 'ASSERTED', 'Claim status'),
    visibility, contribution_eligible:contributionEligible ? 1 : 0,
  };
  const now = nowIso();
  if (existing) await run(db, `UPDATE investor_claims SET entity_type=?,entity_id=?,field=?,value_json=?,source_id=?,confidence=?,observed_at=?,status=?,visibility=?,contribution_eligible=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [item.entity_type,item.entity_id,item.field,item.value_json,item.source_id,item.confidence,item.observed_at,item.status,item.visibility,item.contribution_eligible,now,auth.userId,tenantId,id]);
  else await run(db, `INSERT INTO investor_claims (id,tenant_id,entity_type,entity_id,field,value_json,source_id,confidence,observed_at,status,visibility,contribution_eligible,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.entity_type,item.entity_id,item.field,item.value_json,item.source_id,item.confidence,item.observed_at,item.status,item.visibility,item.contribution_eligible,now,now,auth.userId,auth.userId]);
  await audit(db, auth, existing ? 'INVESTOR_CLAIM_UPDATED' : 'INVESTOR_CLAIM_CREATED', 'INVESTOR_CLAIM', id, existing, item);
  return json({ updated:true, item:{ ...item, value } });
}

async function upsertTarget(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120) || makeId('fundraising_target');
  const existing = await first(db, 'SELECT * FROM fundraising_targets WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  const roundId = cleanText(body.roundId ?? existing?.round_id, 120);
  const organisationId = cleanText(body.organisationId ?? existing?.organisation_id, 120);
  const round = await first(db, `SELECT r.*, p.category AS project_category, p.region AS project_region, p.legacy_import_data FROM fundraising_rounds r JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.id=? LIMIT 1`, [tenantId, roundId]);
  if (!round) throw statusError('Fundraising round was not found in this workspace', 404);
  const organisation = await first(db, 'SELECT * FROM investor_organisations WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, organisationId]);
  if (!organisation) throw statusError('Investor organisation was not found in this workspace', 404);
  const primaryPersonId = cleanText(body.primaryPersonId ?? existing?.primary_person_id, 120);
  if (primaryPersonId && !(await first(db, 'SELECT id FROM investor_people WHERE tenant_id=? AND id=? AND organisation_id=? LIMIT 1', [tenantId, primaryPersonId, organisationId]))) throw statusError('Selected investor person does not belong to this organisation and workspace');
  const claims = await organisationClaims(db, tenantId, organisationId);
  const projectProfile = parseJson(round.legacy_import_data, {});
  const companySectors = body.companySectors ?? projectProfile?.bdProfile?.organisation?.categories ?? round.project_category;
  const companyGeographies = body.companyGeographies ?? round.project_region;
  const portfolioMatches = await portfolioMatchCount(db, tenantId, organisationId, companySectors);
  const assessment = assessInvestorFit({
    funding_stage:round.funding_stage,
    minimum_ticket:round.minimum_ticket,
    sectors:companySectors,
    geographies:companyGeographies,
  }, {
    ...organisation,
    stages:claims.values.investment_stages ?? claims.values.stages,
    sectors:claims.values.sectors ?? claims.values.investment_focus,
    geographies:claims.values.geographies,
    fundVintageYear:claims.values.fund_vintage_year,
    evidenceConfidence:claims.confidence,
  }, {
    portfolioMatchCount:portfolioMatches,
    warmPathStatus:body.warmPathStatus ?? existing?.introduction_status,
    conflictStatus:body.conflictSignal ?? organisation.conflict_status,
    evidenceConfidence:claims.confidence,
    fundVintageYear:claims.values.fund_vintage_year,
  });
  let fitScore = assessment.score;
  let fitOverrideReason = '';
  if (body.fitScore !== undefined && body.fitScore !== '') {
    fitOverrideReason = cleanText(body.fitOverrideReason, 1000);
    if (!fitOverrideReason) throw statusError('A reason is required when overriding the evidence-backed fit score');
    fitScore = percentage(body.fitScore);
    assessment.warnings.unshift(`Manual fit override applied: ${fitOverrideReason}`);
  }
  const item = {
    id, round_id:roundId, organisation_id:organisationId, primary_person_id:primaryPersonId || null,
    stage:enumValue(body.stage ?? existing?.stage, NORMALIZED_TARGET_STAGES, 'RESEARCHING', 'Investor pipeline stage'),
    priority:Math.round(percentage(body.priority ?? existing?.priority ?? 50)),
    fit_score:fitScore, fit_components_json:JSON.stringify(assessment.components), fit_reasons_json:JSON.stringify(assessment.reasons), fit_warnings_json:JSON.stringify(assessment.warnings), fit_override_reason:fitOverrideReason || existing?.fit_override_reason || null,
    conflict_signal:enumValue(body.conflictSignal ?? existing?.conflict_signal ?? organisation.conflict_status, ['NONE','POSSIBLE','CONFIRMED','UNKNOWN'], 'UNKNOWN', 'Conflict signal'),
    expected_check:body.expectedCheck === undefined ? existing?.expected_check ?? null : nonNegativeNumber(body.expectedCheck),
    probability_percentage:percentage(body.probabilityPercentage ?? body.probability ?? existing?.probability_percentage),
    warm_intro_source:cleanText(body.warmIntroSource ?? existing?.warm_intro_source, 500),
    introduction_status:cleanText(body.introductionStatus ?? existing?.introduction_status ?? 'NOT_REQUESTED', 80).toUpperCase(),
    last_contact_at:cleanText(body.lastContactAt ?? existing?.last_contact_at, 100),
    next_follow_up_at:cleanText(body.nextFollowUpAt ?? existing?.next_follow_up_at, 100),
    next_action:cleanText(body.nextAction ?? existing?.next_action, 2000), notes:cleanText(body.notes ?? existing?.notes),
  };
  const now = nowIso();
  if (existing) await run(db, `UPDATE fundraising_targets SET round_id=?,organisation_id=?,primary_person_id=?,stage=?,priority=?,fit_score=?,fit_components_json=?,fit_reasons_json=?,fit_warnings_json=?,fit_override_reason=?,conflict_signal=?,expected_check=?,probability_percentage=?,warm_intro_source=?,introduction_status=?,last_contact_at=?,next_follow_up_at=?,next_action=?,notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?`, [item.round_id,item.organisation_id,item.primary_person_id,item.stage,item.priority,item.fit_score,item.fit_components_json,item.fit_reasons_json,item.fit_warnings_json,item.fit_override_reason,item.conflict_signal,item.expected_check,item.probability_percentage,item.warm_intro_source,item.introduction_status,item.last_contact_at,item.next_follow_up_at,item.next_action,item.notes,now,auth.userId,tenantId,id]);
  else await run(db, `INSERT INTO fundraising_targets (id,tenant_id,round_id,organisation_id,primary_person_id,stage,priority,fit_score,fit_components_json,fit_reasons_json,fit_warnings_json,fit_override_reason,conflict_signal,expected_check,probability_percentage,warm_intro_source,introduction_status,last_contact_at,next_follow_up_at,next_action,notes,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,item.round_id,item.organisation_id,item.primary_person_id,item.stage,item.priority,item.fit_score,item.fit_components_json,item.fit_reasons_json,item.fit_warnings_json,item.fit_override_reason,item.conflict_signal,item.expected_check,item.probability_percentage,item.warm_intro_source,item.introduction_status,item.last_contact_at,item.next_follow_up_at,item.next_action,item.notes,now,now,auth.userId,auth.userId]);
  await audit(db, auth, existing ? 'FUNDRAISING_TARGET_UPDATED' : 'FUNDRAISING_TARGET_CREATED', 'FUNDRAISING_TARGET', id, existing, item);
  return json({ updated:true, item:{ ...targetFromRow(item), organisation_name:organisation.name } });
}

async function moveTarget(db, auth, tenantId, body) {
  const id = cleanText(body.targetId ?? body.id, 120);
  const existing = await first(db, 'SELECT * FROM fundraising_targets WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!existing) throw statusError('Fundraising target was not found in this workspace', 404);
  const stage = enumValue(body.stage, NORMALIZED_TARGET_STAGES, existing.stage, 'Investor pipeline stage');
  if (stage === existing.stage) return json({ updated:false, item:targetFromRow(existing) });
  const reason = cleanText(body.reason, 1000);
  const now = nowIso();
  await run(db, 'UPDATE fundraising_targets SET stage=?, updated_at=?, updated_by=? WHERE tenant_id=? AND id=?', [stage,now,auth.userId,tenantId,id]);
  await run(db, 'INSERT INTO fundraising_pipeline_events (id,tenant_id,target_id,previous_stage,new_stage,reason,occurred_by,occurred_at) VALUES (?,?,?,?,?,?,?,?)', [makeId('fund_evt'),tenantId,id,existing.stage,stage,reason,auth.userId,now]);
  await audit(db, auth, 'FUNDRAISING_TARGET_STAGE_CHANGED', 'FUNDRAISING_TARGET', id, existing, { ...existing, stage });
  return json({ updated:true, item:{ ...targetFromRow(existing), stage } });
}
