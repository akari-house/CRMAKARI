import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';
import { parseFundraisingFlags } from '../../lib/fundraising-os.js';
import { cleanText, nonNegativeNumber, parseJson, percentage } from '../../lib/fundraising-intelligence.js';

const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER'];
const APPROVAL_ROLES = ['OWNER','ADMIN'];
const TARGET_STAGES = ['RESEARCHING','READY','INTRO_REQUESTED','CONTACTED','MEETING','DILIGENCE','PARTNER_MEETING','SOFT_CIRCLE','COMMITTED','PASSED','NOT_NOW'];
const RELATIONSHIP_STRENGTHS = ['STRONG','MEDIUM','WEAK','UNKNOWN'];
const VERIFICATION_STATES = ['UNVERIFIED','RESEARCHING','VERIFIED','STALE','REJECTED'];
const CONSENT_STATES = ['NOT_REQUESTED','REQUESTED','GRANTED','DECLINED','REVOKED'];
const REQUEST_STATES = ['PLANNED','REQUESTED','ACCEPTED','COMPLETED','DECLINED','CANCELLED'];
const MISSING_SCHEMA = /(no such table|no such column|D1_ERROR.*fundraising_|SQLITE_ERROR.*fundraising_)/i;
const TECHNICAL_DB_ERROR = /(D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY|at offset \d+)/i;

const STAGE_TRANSITIONS = {
  RESEARCHING:['READY','PASSED','NOT_NOW'],
  READY:['RESEARCHING','INTRO_REQUESTED','CONTACTED','PASSED','NOT_NOW'],
  INTRO_REQUESTED:['READY','CONTACTED','MEETING','PASSED','NOT_NOW'],
  CONTACTED:['READY','MEETING','PASSED','NOT_NOW'],
  MEETING:['CONTACTED','DILIGENCE','PARTNER_MEETING','SOFT_CIRCLE','PASSED','NOT_NOW'],
  DILIGENCE:['MEETING','PARTNER_MEETING','SOFT_CIRCLE','COMMITTED','PASSED','NOT_NOW'],
  PARTNER_MEETING:['MEETING','DILIGENCE','SOFT_CIRCLE','COMMITTED','PASSED','NOT_NOW'],
  SOFT_CIRCLE:['DILIGENCE','PARTNER_MEETING','COMMITTED','PASSED','NOT_NOW'],
  COMMITTED:['SOFT_CIRCLE'],
  PASSED:['RESEARCHING','READY'],
  NOT_NOW:['RESEARCHING','READY'],
};

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
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
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
    await first(db, 'SELECT id FROM fundraising_targets LIMIT 1');
    await first(db, 'SELECT id FROM fundraising_introduction_paths LIMIT 1');
  } catch (cause) {
    if (MISSING_SCHEMA.test(String(cause?.message || ''))) throw statusError('Fundraising intelligence migration 0002 must be applied before targeting and introduction writes are enabled', 503);
    throw cause;
  }
}

async function tenantRound(db, tenantId, id) {
  return first(db, `
    SELECT r.*, p.name AS project_name
    FROM fundraising_rounds r
    JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.id=?
    LIMIT 1
  `, [tenantId, id]);
}

async function tenantTarget(db, tenantId, id) {
  return first(db, `
    SELECT t.*, r.project_id, r.round_name, r.currency, r.minimum_ticket, r.maximum_ticket,
      o.name AS organisation_name, o.minimum_check, o.maximum_check, o.typical_check, o.conflict_status
    FROM fundraising_targets t
    JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id
    JOIN investor_organisations o ON o.id=t.organisation_id AND o.tenant_id=t.tenant_id
    WHERE t.tenant_id=? AND t.id=?
    LIMIT 1
  `, [tenantId, id]);
}

async function tenantPath(db, tenantId, id) {
  return first(db, 'SELECT * FROM fundraising_introduction_paths WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, id]);
}

async function tenantPerson(db, tenantId, id) {
  return first(db, 'SELECT * FROM investor_people WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, id]);
}

async function tenantContact(db, tenantId, id) {
  return first(db, `
    SELECT c.id,c.full_name,c.project_id,p.name AS project_name
    FROM contacts c
    JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id
    WHERE c.tenant_id=? AND c.id=?
    LIMIT 1
  `, [tenantId, id]);
}

async function tenantSource(db, tenantId, id) {
  return first(db, 'SELECT id,title,canonical_url,confidence_status FROM investor_sources WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, id]);
}

async function activeMember(db, tenantId, id) {
  return first(db, `
    SELECT u.id,u.full_name,tm.role
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id=u.id
    WHERE tm.tenant_id=? AND tm.user_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE'
    LIMIT 1
  `, [tenantId, id]);
}

function hydrateTarget(row) {
  return {
    ...row,
    fit_components:parseJson(row.fit_components_json, {}),
    fit_reasons:parseJson(row.fit_reasons_json, []),
    fit_warnings:parseJson(row.fit_warnings_json, []),
  };
}

function dayStart(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0,0,0,0);
  return date;
}

function focusedLists(targets, pathsByTarget) {
  const today = dayStart();
  const inSevenDays = new Date(today.getTime() + 7 * 86400000);
  const list = {
    researchNeeded:[],
    readyForIntroduction:[],
    consentRequired:[],
    overdueFollowUps:[],
    followUpsThisWeek:[],
    highFitNoAction:[],
    softCircle:[],
  };
  targets.forEach((target) => {
    const paths = pathsByTarget.get(target.id) || [];
    const verifiedConsentPath = paths.some((path) => path.verification_status === 'VERIFIED' && path.consent_status === 'GRANTED');
    const needsConsent = paths.some((path) => path.verification_status === 'VERIFIED' && !['GRANTED','DECLINED','REVOKED'].includes(path.consent_status));
    const due = target.next_follow_up_at ? new Date(target.next_follow_up_at) : null;
    if (target.stage === 'RESEARCHING' || Number(target.evidence_verified || 0) === 0) list.researchNeeded.push(target);
    if (target.stage === 'READY' && verifiedConsentPath) list.readyForIntroduction.push(target);
    if (needsConsent) list.consentRequired.push(target);
    if (due && !Number.isNaN(due.getTime()) && dayStart(due) < today && !['PASSED','COMMITTED'].includes(target.stage)) list.overdueFollowUps.push(target);
    else if (due && !Number.isNaN(due.getTime()) && dayStart(due) <= inSevenDays && !['PASSED','COMMITTED'].includes(target.stage)) list.followUpsThisWeek.push(target);
    if (Number(target.fit_score || 0) >= 75 && !target.next_action && !['PASSED','COMMITTED'].includes(target.stage)) list.highFitNoAction.push(target);
    if (['SOFT_CIRCLE','COMMITTED'].includes(target.stage)) list.softCircle.push(target);
  });
  return Object.fromEntries(Object.entries(list).map(([key, items]) => [key, items.sort((a,b) => Number(b.priority || 0) - Number(a.priority || 0)).slice(0,100)]));
}

function stageSummary(targets) {
  return TARGET_STAGES.map((stage) => {
    const items = targets.filter((item) => item.stage === stage);
    return {
      stage,
      count:items.length,
      expectedCheck:items.reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
      weightedExpected:items.reduce((sum,item) => sum + nonNegativeNumber(item.expected_check) * percentage(item.probability_percentage) / 100,0),
    };
  });
}

async function normalizedResponse(db, tenantId, auth) {
  const [rounds, targetRows, paths, people, connectors, members, sources] = await Promise.all([
    all(db, `
      SELECT r.*,p.name AS project_name
      FROM fundraising_rounds r
      JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
      WHERE r.tenant_id=?
      ORDER BY CASE r.stage WHEN 'OPEN' THEN 0 WHEN 'OUTREACH' THEN 1 WHEN 'DILIGENCE' THEN 2 WHEN 'COMMITMENTS' THEN 3 ELSE 4 END,
        COALESCE(r.target_close_date,'9999-12-31'),r.updated_at DESC
    `, [tenantId]),
    all(db, `
      SELECT t.*,o.name AS organisation_name,o.investor_type,o.minimum_check,o.maximum_check,o.typical_check,o.conflict_status,
        p.full_name AS primary_person_name,p.title AS primary_person_title,
        r.project_id,r.round_name,r.currency,r.minimum_ticket,r.maximum_ticket,r.target_amount,r.project_id,
        (SELECT COUNT(*) FROM investor_claims c WHERE c.tenant_id=t.tenant_id AND c.entity_type='ORGANISATION' AND c.entity_id=t.organisation_id) AS evidence_count,
        (SELECT COUNT(*) FROM investor_claims c WHERE c.tenant_id=t.tenant_id AND c.entity_type='ORGANISATION' AND c.entity_id=t.organisation_id AND c.status='VERIFIED') AS evidence_verified,
        (SELECT COUNT(*) FROM tasks task WHERE task.tenant_id=t.tenant_id AND task.status NOT IN ('DONE','CANCELLED','ARCHIVED') AND task.description LIKE '%[Fundraising Target:' || t.id || ']%') AS open_task_count
      FROM fundraising_targets t
      JOIN investor_organisations o ON o.id=t.organisation_id AND o.tenant_id=t.tenant_id
      JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id
      LEFT JOIN investor_people p ON p.id=t.primary_person_id AND p.tenant_id=t.tenant_id
      WHERE t.tenant_id=?
      ORDER BY t.priority DESC,t.updated_at DESC
    `, [tenantId]),
    all(db, `
      SELECT ip.*,tp.full_name AS target_person_name,c.full_name AS connector_contact_name,cp.name AS connector_project_name,
        u.full_name AS relationship_owner_name,s.title AS evidence_source_title
      FROM fundraising_introduction_paths ip
      LEFT JOIN investor_people tp ON tp.id=ip.target_person_id AND tp.tenant_id=ip.tenant_id
      LEFT JOIN contacts c ON c.id=ip.connector_contact_id AND c.tenant_id=ip.tenant_id
      LEFT JOIN projects cp ON cp.id=c.project_id AND cp.tenant_id=c.tenant_id
      LEFT JOIN users u ON u.id=ip.relationship_owner_user_id
      LEFT JOIN investor_sources s ON s.id=ip.evidence_source_id AND s.tenant_id=ip.tenant_id
      WHERE ip.tenant_id=?
      ORDER BY CASE ip.verification_status WHEN 'VERIFIED' THEN 0 WHEN 'RESEARCHING' THEN 1 ELSE 2 END,ip.updated_at DESC
    `, [tenantId]),
    all(db, `
      SELECT p.id,p.organisation_id,p.full_name,p.title,p.is_decision_maker
      FROM investor_people p
      WHERE p.tenant_id=? AND p.status='ACTIVE'
      ORDER BY p.is_decision_maker DESC,p.full_name
    `, [tenantId]),
    all(db, `
      SELECT c.id,c.full_name,c.project_id,p.name AS project_name,c.relationship_strength
      FROM contacts c
      JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id
      WHERE c.tenant_id=?
      ORDER BY CASE c.relationship_strength WHEN 'STRONG' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'WEAK' THEN 2 ELSE 3 END,c.full_name
      LIMIT 1000
    `, [tenantId]),
    all(db, `
      SELECT u.id,u.full_name,tm.role
      FROM tenant_memberships tm
      JOIN users u ON u.id=tm.user_id
      WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE'
      ORDER BY u.full_name
    `, [tenantId]),
    all(db, `
      SELECT id,title,canonical_url,confidence_status
      FROM investor_sources
      WHERE tenant_id=? AND confidence_status!='DISPUTED'
      ORDER BY CASE confidence_status WHEN 'VERIFIED' THEN 0 ELSE 1 END,updated_at DESC
      LIMIT 500
    `, [tenantId]),
  ]);

  const targets = targetRows.map(hydrateTarget);
  const pathsByTarget = new Map();
  paths.forEach((path) => {
    if (!pathsByTarget.has(path.target_id)) pathsByTarget.set(path.target_id, []);
    pathsByTarget.get(path.target_id).push(path);
  });
  const roundsWithTargets = rounds.map((round) => {
    const roundTargets = targets.filter((target) => target.round_id === round.id).map((target) => ({ ...target, introduction_paths:pathsByTarget.get(target.id) || [] }));
    return {
      ...round,
      targets:roundTargets,
      stageSummary:stageSummary(roundTargets),
      expectedChecks:{
        researched:roundTargets.reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
        softCircle:roundTargets.filter((item) => ['SOFT_CIRCLE','COMMITTED'].includes(item.stage)).reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
        committed:roundTargets.filter((item) => item.stage === 'COMMITTED').reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
      },
    };
  });

  const lists = focusedLists(targets, pathsByTarget);
  return {
    storageMode:'NORMALIZED_D1',
    migrationRequired:false,
    readOnly:false,
    stages:TARGET_STAGES,
    rounds:roundsWithTargets,
    people,
    connectors,
    members,
    sources,
    focusedLists:lists,
    summary:{
      rounds:rounds.length,
      targets:targets.length,
      warmPaths:paths.length,
      verifiedPaths:paths.filter((path) => path.verification_status === 'VERIFIED').length,
      consentGranted:paths.filter((path) => path.consent_status === 'GRANTED').length,
      overdueFollowUps:lists.overdueFollowUps.length,
      expectedPipeline:targets.reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
      softCircle:targets.filter((item) => ['SOFT_CIRCLE','COMMITTED'].includes(item.stage)).reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
    },
    permissions:{ canWrite:WRITE_ROLES.includes(auth?.role), canApprove:APPROVAL_ROLES.includes(auth?.role) },
  };
}

async function legacyResponse(db, tenantId, auth) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id=? LIMIT 1', [tenantId]);
  const { rooms } = parseFundraisingFlags(row?.feature_flags_json);
  const rounds = rooms.map((room) => ({
    id:room.id,
    legacy_room_id:room.id,
    project_id:room.projectId,
    project_name:room.projectName,
    round_name:room.roundName || 'Current round',
    stage:room.stage || 'PREPARING',
    currency:room.currency || 'USD',
    target_amount:nonNegativeNumber(room.targetAmount),
    minimum_ticket:nonNegativeNumber(room.minimumTicket),
    maximum_ticket:nonNegativeNumber(room.maximumTicket),
    targets:(Array.isArray(room.investorPipeline) ? room.investorPipeline : []).map((item) => ({
      id:item.id,
      round_id:room.id,
      organisation_id:item.investorProjectId,
      organisation_name:item.investorName || 'Unnamed investor',
      primary_person_name:item.decisionMaker || '',
      stage:item.stage || 'RESEARCHING',
      priority:Number(item.priority || 50),
      fit_score:percentage(item.fitScore),
      expected_check:nonNegativeNumber(item.estimatedTicket),
      probability_percentage:percentage(item.probability),
      next_follow_up_at:item.nextFollowUpAt || '',
      next_action:item.nextAction || '',
      introduction_status:item.introductionStatus || 'NOT_REQUESTED',
      introduction_paths:item.warmIntroSource ? [{ id:`legacy_${item.id}`, target_id:item.id, connector_name:item.warmIntroSource, verification_status:'UNVERIFIED', consent_status:'NOT_REQUESTED', request_status:item.introductionStatus || 'PLANNED' }] : [],
      fit_reasons:[],
      fit_warnings:['Legacy target has not yet been converted to normalized evidence and consent controls.'],
      evidence_count:0,
      evidence_verified:0,
      open_task_count:0,
    })),
  }));
  rounds.forEach((round) => {
    round.stageSummary = stageSummary(round.targets);
    round.expectedChecks = {
      researched:round.targets.reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
      softCircle:round.targets.filter((item) => ['SOFT_CIRCLE','COMMITTED'].includes(item.stage)).reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
      committed:round.targets.filter((item) => item.stage === 'COMMITTED').reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0),
    };
  });
  const targets = rounds.flatMap((round) => round.targets);
  const pathsByTarget = new Map(targets.map((target) => [target.id,target.introduction_paths || []]));
  return {
    storageMode:'LEGACY_COMPATIBILITY',
    migrationRequired:true,
    readOnly:true,
    stages:TARGET_STAGES,
    rounds,
    people:[],
    connectors:[],
    members:[],
    sources:[],
    focusedLists:focusedLists(targets, pathsByTarget),
    summary:{ rounds:rounds.length, targets:targets.length, warmPaths:targets.filter((item) => item.introduction_paths?.length).length, verifiedPaths:0, consentGranted:0, overdueFollowUps:0, expectedPipeline:targets.reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0), softCircle:targets.filter((item) => ['SOFT_CIRCLE','COMMITTED'].includes(item.stage)).reduce((sum,item) => sum + nonNegativeNumber(item.expected_check),0) },
    permissions:{ canWrite:false, canApprove:false, roleCanWrite:WRITE_ROLES.includes(auth?.role) },
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
    console.error('Fundraising targeting read failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising targeting could not be loaded' : (message || 'Fundraising targeting could not be loaded'), Number(cause?.status || 500));
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

    if (action === 'update-target') return await updateTarget(context.env.DB, auth, tenantId, body);
    if (action === 'move-target') return await moveTarget(context.env.DB, auth, tenantId, body);
    if (action === 'upsert-introduction') return await upsertIntroduction(context.env.DB, auth, tenantId, body);
    if (action === 'set-consent') return await setConsent(context.env.DB, auth, tenantId, body);
    if (action === 'set-request-status') return await setRequestStatus(context.env.DB, auth, tenantId, body);
    if (action === 'create-follow-up-task') return await createFollowUpTask(context.env.DB, auth, tenantId, body);
    return error('Fundraising targeting action is not supported', 404);
  } catch (cause) {
    console.error('Fundraising targeting write failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising targeting action failed' : (message || 'Fundraising targeting action failed'), Number(cause?.status || 500));
  }
}

async function updateTarget(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120);
  const existing = await tenantTarget(db, tenantId, id);
  if (!existing) throw statusError('Fundraising target was not found in this workspace', 404);
  const primaryPersonId = cleanText(body.primaryPersonId ?? existing.primary_person_id, 120) || null;
  if (primaryPersonId) {
    const person = await tenantPerson(db, tenantId, primaryPersonId);
    if (!person || person.organisation_id !== existing.organisation_id) throw statusError('Primary investor person must belong to this target organisation');
  }
  const expectedCheck = body.expectedCheck === '' ? null : nonNegativeNumber(body.expectedCheck ?? existing.expected_check, null);
  const priority = Math.min(100, Math.max(0, Number(body.priority ?? existing.priority ?? 50)));
  const probability = percentage(body.probabilityPercentage ?? existing.probability_percentage);
  const next = {
    primary_person_id:primaryPersonId,
    expected_check:expectedCheck,
    priority,
    probability_percentage:probability,
    next_follow_up_at:cleanText(body.nextFollowUpAt ?? existing.next_follow_up_at, 40),
    next_action:cleanText(body.nextAction ?? existing.next_action, 2000),
    notes:cleanText(body.notes ?? existing.notes),
  };
  const now = nowIso();
  await run(db, `
    UPDATE fundraising_targets
    SET primary_person_id=?,expected_check=?,priority=?,probability_percentage=?,next_follow_up_at=?,next_action=?,notes=?,updated_at=?,updated_by=?
    WHERE tenant_id=? AND id=?
  `, [next.primary_person_id,next.expected_check,next.priority,next.probability_percentage,next.next_follow_up_at,next.next_action,next.notes,now,auth.userId,tenantId,id]);
  await audit(db, auth, 'FUNDRAISING_TARGET_UPDATED', 'FUNDRAISING_TARGET', id, existing, { ...existing, ...next });
  return json({ item:{ ...existing, ...next } });
}

async function moveTarget(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120);
  const existing = await tenantTarget(db, tenantId, id);
  if (!existing) throw statusError('Fundraising target was not found in this workspace', 404);
  const nextStage = enumValue(body.stage, TARGET_STAGES, existing.stage, 'Target stage');
  if (nextStage === existing.stage) return json({ item:existing, unchanged:true });
  if (!(STAGE_TRANSITIONS[existing.stage] || []).includes(nextStage)) throw statusError(`Target cannot move directly from ${existing.stage} to ${nextStage}`, 409);
  const reason = cleanText(body.reason, 2000);
  if (['PASSED','NOT_NOW'].includes(nextStage) && !reason) throw statusError('A reason is required when moving an investor to Passed or Not now');
  if (nextStage === 'INTRO_REQUESTED') {
    const path = await first(db, `
      SELECT id FROM fundraising_introduction_paths
      WHERE tenant_id=? AND target_id=? AND verification_status='VERIFIED' AND consent_status='GRANTED'
      LIMIT 1
    `, [tenantId, id]);
    if (!path) throw statusError('A verified introduction path with granted consent is required before moving to Intro requested', 409);
  }
  const now = nowIso();
  await run(db, 'UPDATE fundraising_targets SET stage=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?', [nextStage,now,auth.userId,tenantId,id]);
  await run(db, `
    INSERT INTO fundraising_pipeline_events (id,tenant_id,target_id,previous_stage,new_stage,reason,occurred_by,occurred_at)
    VALUES (?,?,?,?,?,?,?,?)
  `, [makeId('fpe'),tenantId,id,existing.stage,nextStage,reason,auth.userId,now]);
  await audit(db, auth, 'FUNDRAISING_TARGET_STAGE_MOVED', 'FUNDRAISING_TARGET', id, existing, { ...existing, stage:nextStage, reason });
  return json({ item:{ ...existing, stage:nextStage }, previousStage:existing.stage });
}

async function upsertIntroduction(db, auth, tenantId, body) {
  const targetId = cleanText(body.targetId, 120);
  const target = await tenantTarget(db, tenantId, targetId);
  if (!target) throw statusError('Fundraising target was not found in this workspace', 404);
  const id = cleanText(body.id, 120) || makeId('intro');
  const existing = await tenantPath(db, tenantId, id);
  if (existing && existing.target_id !== targetId) throw statusError('Introduction path does not belong to this target');
  const targetPersonId = cleanText(body.targetPersonId ?? existing?.target_person_id, 120) || null;
  if (targetPersonId) {
    const person = await tenantPerson(db, tenantId, targetPersonId);
    if (!person || person.organisation_id !== target.organisation_id) throw statusError('Target person must belong to this investor organisation');
  }
  const connectorContactId = cleanText(body.connectorContactId ?? existing?.connector_contact_id, 120) || null;
  let connectorName = cleanText(body.connectorName ?? existing?.connector_name, 500);
  if (connectorContactId) {
    const contact = await tenantContact(db, tenantId, connectorContactId);
    if (!contact) throw statusError('Connector contact was not found in this workspace', 404);
    connectorName = connectorName || contact.full_name;
  }
  if (!connectorContactId && !connectorName) throw statusError('Choose a connector contact or record a connector name');
  const ownerUserId = cleanText(body.relationshipOwnerUserId ?? existing?.relationship_owner_user_id, 120) || auth.userId;
  if (!(await activeMember(db, tenantId, ownerUserId))) throw statusError('Relationship owner must be an active workspace member');
  const evidenceSourceId = cleanText(body.evidenceSourceId ?? existing?.evidence_source_id, 120) || null;
  if (evidenceSourceId && !(await tenantSource(db, tenantId, evidenceSourceId))) throw statusError('Introduction evidence source was not found in this workspace', 404);
  const verificationStatus = enumValue(body.verificationStatus ?? existing?.verification_status, VERIFICATION_STATES, 'UNVERIFIED', 'Verification status');
  const notes = cleanText(body.notes ?? existing?.notes);
  if (verificationStatus === 'VERIFIED' && !evidenceSourceId && !notes) throw statusError('Verified introduction paths require evidence or a verification note');
  const item = {
    id,
    round_id:target.round_id,
    target_id:targetId,
    target_person_id:targetPersonId,
    connector_contact_id:connectorContactId,
    connector_name:connectorName,
    relationship_owner_user_id:ownerUserId,
    relationship_strength:enumValue(body.relationshipStrength ?? existing?.relationship_strength, RELATIONSHIP_STRENGTHS, 'UNKNOWN', 'Relationship strength'),
    evidence_source_id:evidenceSourceId,
    verification_status:verificationStatus,
    consent_status:existing?.consent_status || 'NOT_REQUESTED',
    request_status:existing?.request_status || 'PLANNED',
    last_verified_at:verificationStatus === 'VERIFIED' ? nowIso() : (existing?.last_verified_at || null),
    notes,
  };
  const now = nowIso();
  if (existing) {
    await run(db, `
      UPDATE fundraising_introduction_paths
      SET target_person_id=?,connector_contact_id=?,connector_name=?,relationship_owner_user_id=?,relationship_strength=?,evidence_source_id=?,verification_status=?,last_verified_at=?,notes=?,updated_at=?,updated_by=?
      WHERE tenant_id=? AND id=?
    `, [item.target_person_id,item.connector_contact_id,item.connector_name,item.relationship_owner_user_id,item.relationship_strength,item.evidence_source_id,item.verification_status,item.last_verified_at,item.notes,now,auth.userId,tenantId,id]);
  } else {
    await run(db, `
      INSERT INTO fundraising_introduction_paths
        (id,tenant_id,round_id,target_id,target_person_id,connector_contact_id,connector_name,relationship_owner_user_id,relationship_strength,evidence_source_id,verification_status,consent_status,request_status,last_verified_at,notes,created_at,updated_at,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [id,tenantId,item.round_id,item.target_id,item.target_person_id,item.connector_contact_id,item.connector_name,item.relationship_owner_user_id,item.relationship_strength,item.evidence_source_id,item.verification_status,item.consent_status,item.request_status,item.last_verified_at,item.notes,now,now,auth.userId,auth.userId]);
  }
  await audit(db, auth, existing ? 'FUNDRAISING_INTRO_PATH_UPDATED' : 'FUNDRAISING_INTRO_PATH_CREATED', 'FUNDRAISING_INTRO_PATH', id, existing, item);
  return json({ item, created:!existing });
}

async function setConsent(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120);
  const existing = await tenantPath(db, tenantId, id);
  if (!existing) throw statusError('Introduction path was not found in this workspace', 404);
  const consentStatus = enumValue(body.consentStatus, CONSENT_STATES, existing.consent_status, 'Consent status');
  if (consentStatus !== 'REQUESTED') requireRole(auth, APPROVAL_ROLES);
  const note = cleanText(body.note, 2000);
  if (['GRANTED','DECLINED','REVOKED'].includes(consentStatus) && !note) throw statusError('A consent decision note is required');
  const now = nowIso();
  await run(db, 'UPDATE fundraising_introduction_paths SET consent_status=?,notes=?,updated_at=?,updated_by=? WHERE tenant_id=? AND id=?', [consentStatus,[existing.notes,note].filter(Boolean).join('\n'),now,auth.userId,tenantId,id]);
  await audit(db, auth, 'FUNDRAISING_INTRO_CONSENT_UPDATED', 'FUNDRAISING_INTRO_PATH', id, existing, { ...existing, consent_status:consentStatus, consent_note:note });
  return json({ item:{ ...existing, consent_status:consentStatus } });
}

async function setRequestStatus(db, auth, tenantId, body) {
  const id = cleanText(body.id, 120);
  const existing = await tenantPath(db, tenantId, id);
  if (!existing) throw statusError('Introduction path was not found in this workspace', 404);
  const requestStatus = enumValue(body.requestStatus, REQUEST_STATES, existing.request_status, 'Introduction request status');
  if (['REQUESTED','ACCEPTED','COMPLETED'].includes(requestStatus) && (existing.verification_status !== 'VERIFIED' || existing.consent_status !== 'GRANTED')) {
    throw statusError('Verification and granted consent are required before requesting or completing an introduction', 409);
  }
  const outcome = cleanText(body.outcome ?? existing.outcome, 2000);
  if (['DECLINED','CANCELLED','COMPLETED'].includes(requestStatus) && !outcome) throw statusError('An outcome note is required for this introduction status');
  const now = nowIso();
  const requestedAt = requestStatus === 'REQUESTED' ? (existing.requested_at || now) : existing.requested_at;
  const completedAt = requestStatus === 'COMPLETED' ? now : existing.completed_at;
  await run(db, `
    UPDATE fundraising_introduction_paths
    SET request_status=?,requested_at=?,completed_at=?,outcome=?,updated_at=?,updated_by=?
    WHERE tenant_id=? AND id=?
  `, [requestStatus,requestedAt,completedAt,outcome,now,auth.userId,tenantId,id]);
  if (requestStatus === 'REQUESTED') {
    const target = await tenantTarget(db, tenantId, existing.target_id);
    if (target && ['READY','RESEARCHING'].includes(target.stage)) {
      await run(db, 'UPDATE fundraising_targets SET stage=\'INTRO_REQUESTED\',introduction_status=\'REQUESTED\',updated_at=?,updated_by=? WHERE tenant_id=? AND id=?', [now,auth.userId,tenantId,target.id]);
      await run(db, `INSERT INTO fundraising_pipeline_events (id,tenant_id,target_id,previous_stage,new_stage,reason,occurred_by,occurred_at) VALUES (?,?,?,?,?,?,?,?)`, [makeId('fpe'),tenantId,target.id,target.stage,'INTRO_REQUESTED','Verified and consented introduction requested',auth.userId,now]);
    }
  }
  await audit(db, auth, 'FUNDRAISING_INTRO_REQUEST_UPDATED', 'FUNDRAISING_INTRO_PATH', id, existing, { ...existing, request_status:requestStatus, requested_at:requestedAt, completed_at:completedAt, outcome });
  return json({ item:{ ...existing, request_status:requestStatus, requested_at:requestedAt, completed_at:completedAt, outcome } });
}

async function createFollowUpTask(db, auth, tenantId, body) {
  const targetId = cleanText(body.targetId, 120);
  const target = await tenantTarget(db, tenantId, targetId);
  if (!target) throw statusError('Fundraising target was not found in this workspace', 404);
  const ownerUserId = cleanText(body.ownerUserId, 120) || auth.userId;
  if (!(await activeMember(db, tenantId, ownerUserId))) throw statusError('Task owner must be an active workspace member');
  const dueAt = cleanText(body.dueAt || target.next_follow_up_at, 40);
  if (!dueAt || Number.isNaN(Date.parse(dueAt))) throw statusError('A valid follow-up date is required');
  const marker = `[Fundraising Target:${targetId}]`;
  const existing = await first(db, `
    SELECT id FROM tasks
    WHERE tenant_id=? AND status NOT IN ('DONE','CANCELLED','ARCHIVED') AND description LIKE ?
    LIMIT 1
  `, [tenantId, `%${marker}%`]);
  if (existing && !boolValue(body.allowDuplicate)) throw statusError('An open follow-up task already exists for this investor target', 409);
  const taskId = makeId('tsk');
  const now = nowIso();
  const title = cleanText(body.title || `Investor follow-up · ${target.organisation_name}`, 500);
  const description = `${cleanText(body.description || target.next_action || 'Complete the next fundraising action.', 3000)}\n\n${marker}`;
  await run(db, `
    INSERT INTO tasks
      (id,tenant_id,title,description,owner_user_id,created_by,status,priority,due_at,project_id,activity_type,show_on_home,created_at,updated_at)
    VALUES (?,?,?,?,?,?, 'TODO', ?, ?, ?, 'FUNDRAISING_FOLLOW_UP', 1, ?, ?)
  `, [taskId,tenantId,title,description,ownerUserId,auth.userId,Number(target.priority || 50) >= 80 ? 'HIGH' : 'MEDIUM',dueAt,target.project_id,now,now]);
  await audit(db, auth, 'FUNDRAISING_FOLLOW_UP_TASK_CREATED', 'TASK', taskId, null, { targetId, ownerUserId, dueAt, projectId:target.project_id });
  return json({ item:{ id:taskId,title,owner_user_id:ownerUserId,due_at:dueAt,project_id:target.project_id }, targetId });
}
