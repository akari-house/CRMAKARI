import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';
import { parseFundraisingFlags } from '../../lib/fundraising-os.js';
import { cleanText, parseJson } from '../../lib/fundraising-intelligence.js';

const WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER'];
const APPROVAL_ROLES = ['OWNER','ADMIN'];
const DRAFT_TYPE = 'FUNDRAISING_OUTREACH_DRAFT';
const MEETING_TYPE = 'FUNDRAISING_INVESTOR_MEETING';
const CHANNELS = ['EMAIL','LINKEDIN','TELEGRAM','X','OTHER'];
const PURPOSES = ['INTRODUCTION_DRAFT','FOLLOW_UP_DRAFT','DILIGENCE_RESPONSE','MEETING_FOLLOW_UP','OTHER'];
const DISCLOSURES = ['INTERNAL','SAFE_FOR_OUTREACH','MEETING_ONLY','DILIGENCE_ONLY'];
const DRAFT_STATES = ['DRAFT','FOUNDER_APPROVED','FULLY_APPROVED','EXPORTED','SENT','REPLIED','CLOSED'];
const REPLY_STATES = ['NONE','POSITIVE','NEUTRAL','NEGATIVE','MEETING_BOOKED','NOT_NOW','PASSED'];
const MEETING_STATES = ['SCHEDULED','COMPLETED','CANCELLED','NO_SHOW'];
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

function boolValue(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function validDate(value, label, required = false) {
  const text = cleanText(value, 50);
  if (!text && !required) return '';
  if (!text || Number.isNaN(Date.parse(text))) throw statusError(`${label} must be a valid date and time`);
  return new Date(text).toISOString();
}

function validateRecipient(value, channel) {
  const recipient = cleanText(value, 1000);
  if (!recipient) throw statusError('A recipient identity is required');
  if (channel === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw statusError('Use a valid recipient email address');
  return recipient;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,'0')).join('');
}

async function messageHash(item) {
  return sha256(JSON.stringify({
    recipient:String(item.recipient || '').trim().toLowerCase(),
    channel:item.channel,
    subject:item.subject || '',
    body:item.body || '',
    disclosurePolicy:item.disclosurePolicy,
  }));
}

async function audit(db, auth, action, entityType, entityId, before, after) {
  await run(db, `
    INSERT INTO audit_logs
      (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `, [makeId('aud'),auth.tenantId,auth.userId,action,entityType,entityId,JSON.stringify(before || {}),JSON.stringify(after || {}),nowIso()]);
}

async function tenantProject(db, tenantId, id) {
  return first(db, 'SELECT id,name FROM projects WHERE tenant_id=? AND id=? LIMIT 1', [tenantId,id]);
}

async function activeMember(db, tenantId, id) {
  return first(db, `
    SELECT u.id,u.full_name,tm.role
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id=u.id
    WHERE tm.tenant_id=? AND tm.user_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE'
    LIMIT 1
  `, [tenantId,id]);
}

async function activity(db, tenantId, id, type) {
  return first(db, 'SELECT * FROM activities WHERE tenant_id=? AND id=? AND activity_type=? LIMIT 1', [tenantId,id,type]);
}

function decodeActivity(row) {
  if (!row) return null;
  const data = parseJson(row.description, {});
  return {
    ...data,
    id:row.id,
    projectId:row.project_id || data.projectId || '',
    activityType:row.activity_type,
    status:row.outcome || data.status || '',
    occurredAt:row.occurred_at,
    followUpAt:row.follow_up_at || data.followUpAt || '',
    createdAt:data.createdAt || row.created_at,
  };
}

async function normalizedTargets(db, tenantId) {
  try {
    return await all(db, `
      SELECT t.id,t.round_id,t.organisation_id,t.primary_person_id,t.stage,t.fit_score,t.expected_check,t.next_action,t.next_follow_up_at,
        r.project_id,r.round_name,r.currency,p.name AS project_name,o.name AS investor_name,ip.full_name AS person_name,
        (SELECT cm.value FROM investor_contact_methods cm WHERE cm.tenant_id=t.tenant_id AND cm.person_id=t.primary_person_id AND cm.is_primary=1 ORDER BY CASE cm.kind WHEN 'WORK_EMAIL' THEN 0 ELSE 1 END LIMIT 1) AS primary_contact,
        (SELECT cm.kind FROM investor_contact_methods cm WHERE cm.tenant_id=t.tenant_id AND cm.person_id=t.primary_person_id AND cm.is_primary=1 ORDER BY CASE cm.kind WHEN 'WORK_EMAIL' THEN 0 ELSE 1 END LIMIT 1) AS primary_contact_kind
      FROM fundraising_targets t
      JOIN fundraising_rounds r ON r.id=t.round_id AND r.tenant_id=t.tenant_id
      JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
      JOIN investor_organisations o ON o.id=t.organisation_id AND o.tenant_id=t.tenant_id
      LEFT JOIN investor_people ip ON ip.id=t.primary_person_id AND ip.tenant_id=t.tenant_id
      WHERE t.tenant_id=?
      ORDER BY CASE t.stage WHEN 'MEETING' THEN 0 WHEN 'DILIGENCE' THEN 1 WHEN 'CONTACTED' THEN 2 WHEN 'INTRO_REQUESTED' THEN 3 ELSE 4 END,t.priority DESC
    `, [tenantId]);
  } catch (cause) {
    if (!/(no such table|no such column|D1_ERROR|SQLITE_ERROR)/i.test(String(cause?.message || ''))) throw cause;
    return null;
  }
}

async function legacyTargets(db, tenantId) {
  const row = await first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id=? LIMIT 1', [tenantId]);
  const { rooms } = parseFundraisingFlags(row?.feature_flags_json);
  return rooms.flatMap((room) => (Array.isArray(room.investorPipeline) ? room.investorPipeline : []).map((item) => ({
    id:item.id,
    round_id:room.id,
    organisation_id:item.investorProjectId || '',
    primary_person_id:'',
    stage:item.stage || 'TARGET',
    fit_score:Number(item.fitScore || 0),
    expected_check:Number(item.estimatedTicket || 0),
    next_action:item.nextAction || '',
    next_follow_up_at:item.nextFollowUpAt || '',
    project_id:room.projectId,
    project_name:room.projectName,
    round_name:room.roundName || 'Current round',
    currency:room.currency || 'USD',
    investor_name:item.investorName || 'Unnamed investor',
    person_name:item.decisionMaker || '',
    primary_contact:item.contactEmail || '',
    primary_contact_kind:item.contactEmail ? 'WORK_EMAIL' : '',
    storage_mode:'LEGACY_COMPATIBILITY',
  })));
}

async function targets(db, tenantId) {
  const normalized = await normalizedTargets(db,tenantId);
  if (normalized) return { storageMode:'NORMALIZED_D1',items:normalized };
  return { storageMode:'LEGACY_COMPATIBILITY',items:await legacyTargets(db,tenantId) };
}

async function targetById(db, tenantId, id) {
  const result = await targets(db,tenantId);
  const item = result.items.find((target) => target.id === id);
  return item ? { ...item,storageMode:result.storageMode } : null;
}

function approvalValid(approval, hash) {
  return approval?.status === 'APPROVED' && approval?.contentHash === hash;
}

function publicDraft(item) {
  return {
    ...item,
    approvalState:{
      founder:approvalValid(item.founderApproval,item.contentHash),
      akari:approvalValid(item.akariApproval,item.contentHash),
      fullyApproved:approvalValid(item.founderApproval,item.contentHash) && approvalValid(item.akariApproval,item.contentHash),
    },
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);
    const [rows,targetResult,members] = await Promise.all([
      all(context.env.DB, `
        SELECT a.*,p.name AS project_name,u.full_name AS actor_name
        FROM activities a
        LEFT JOIN projects p ON p.id=a.project_id AND p.tenant_id=a.tenant_id
        LEFT JOIN users u ON u.id=a.user_id
        WHERE a.tenant_id=? AND a.activity_type IN (?,?)
        ORDER BY a.occurred_at DESC,a.created_at DESC
        LIMIT 1000
      `, [tenantId,DRAFT_TYPE,MEETING_TYPE]),
      targets(context.env.DB,tenantId),
      all(context.env.DB, `
        SELECT u.id,u.full_name,tm.role
        FROM tenant_memberships tm
        JOIN users u ON u.id=tm.user_id
        WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE'
        ORDER BY u.full_name
      `, [tenantId]),
    ]);
    const decoded = rows.map((row) => ({ ...decodeActivity(row),projectName:row.project_name || '',actorName:row.actor_name || '' }));
    const drafts = decoded.filter((item) => item.activityType === DRAFT_TYPE).map(publicDraft);
    const meetings = decoded.filter((item) => item.activityType === MEETING_TYPE);
    return json({
      storageMode:targetResult.storageMode,
      targets:targetResult.items,
      drafts,
      meetings,
      members,
      summary:{
        drafts:drafts.length,
        awaitingFounder:drafts.filter((item) => !item.approvalState.founder && !['SENT','REPLIED','CLOSED'].includes(item.status)).length,
        awaitingAkari:drafts.filter((item) => item.approvalState.founder && !item.approvalState.akari && !['SENT','REPLIED','CLOSED'].includes(item.status)).length,
        approved:drafts.filter((item) => item.approvalState.fullyApproved && !['SENT','REPLIED','CLOSED'].includes(item.status)).length,
        sent:drafts.filter((item) => ['SENT','REPLIED','CLOSED'].includes(item.status)).length,
        upcomingMeetings:meetings.filter((item) => item.status === 'SCHEDULED' && Date.parse(item.meetingAt || item.occurredAt) >= Date.now()).length,
        followUpsDue:[...drafts,...meetings].filter((item) => item.followUpAt && Date.parse(item.followUpAt) < Date.now() && !['CLOSED','COMPLETED','CANCELLED'].includes(item.status)).length,
      },
      permissions:{ canWrite:WRITE_ROLES.includes(auth?.role),canApprove:APPROVAL_ROLES.includes(auth?.role) },
      controls:{ channels:CHANNELS,purposes:PURPOSES,disclosures:DISCLOSURES,draftStates:DRAFT_STATES,replyStates:REPLY_STATES,meetingStates:MEETING_STATES },
      safety:{ directSend:false,approvalRequired:true,exactContentApproval:true },
    });
  } catch (cause) {
    console.error('Fundraising outreach read failed',cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising outreach could not be loaded' : (message || 'Fundraising outreach could not be loaded'),Number(cause?.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    requireRole(auth,WRITE_ROLES);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);
    const body = await readJson(context.request);
    const action = cleanText(body.action,80).toLowerCase();
    if (action === 'save-draft') return await saveDraft(context.env.DB,auth,tenantId,body);
    if (action === 'approve-founder') return await approveDraft(context.env.DB,auth,tenantId,body,'FOUNDER');
    if (action === 'approve-akari') return await approveDraft(context.env.DB,auth,tenantId,body,'AKARI');
    if (action === 'mark-exported') return await markDraft(context.env.DB,auth,tenantId,body,'EXPORTED');
    if (action === 'mark-sent') return await markDraft(context.env.DB,auth,tenantId,body,'SENT');
    if (action === 'record-reply') return await recordReply(context.env.DB,auth,tenantId,body);
    if (action === 'close-draft') return await markDraft(context.env.DB,auth,tenantId,body,'CLOSED');
    if (action === 'save-meeting') return await saveMeeting(context.env.DB,auth,tenantId,body);
    if (action === 'complete-meeting') return await completeMeeting(context.env.DB,auth,tenantId,body);
    if (action === 'create-follow-up-task') return await createFollowUpTask(context.env.DB,auth,tenantId,body);
    return error('Fundraising outreach action is not supported',404);
  } catch (cause) {
    console.error('Fundraising outreach write failed',cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising outreach action failed' : (message || 'Fundraising outreach action failed'),Number(cause?.status || 500));
  }
}

async function saveDraft(db,auth,tenantId,body) {
  const id = cleanText(body.id,120) || makeId('fra_draft');
  const existingRow = await activity(db,tenantId,id,DRAFT_TYPE);
  const existing = decodeActivity(existingRow);
  const targetId = cleanText(body.targetId ?? existing?.targetId,120);
  const target = await targetById(db,tenantId,targetId);
  if (!target) throw statusError('Fundraising target was not found in this workspace',404);
  if (!(await tenantProject(db,tenantId,target.project_id))) throw statusError('Founder project was not found in this workspace',404);
  const channel = enumValue(body.channel ?? existing?.channel,CHANNELS,'EMAIL','Outreach channel');
  const purpose = enumValue(body.purpose ?? existing?.purpose,PURPOSES,'FOLLOW_UP_DRAFT','Draft purpose');
  const disclosurePolicy = enumValue(body.disclosurePolicy ?? existing?.disclosurePolicy,DISCLOSURES,'SAFE_FOR_OUTREACH','Disclosure policy');
  if (disclosurePolicy === 'INTERNAL') throw statusError('Internal-only knowledge cannot be used in an outreach draft');
  if (purpose !== 'DILIGENCE_RESPONSE' && disclosurePolicy === 'DILIGENCE_ONLY') throw statusError('Diligence-only knowledge can only be used for a diligence response');
  const recipient = validateRecipient(body.recipient ?? existing?.recipient ?? target.primary_contact,channel);
  const subject = cleanText(body.subject ?? existing?.subject,1000);
  const messageBody = cleanText(body.body ?? existing?.body,20000);
  if (!messageBody) throw statusError('Draft message body is required');
  if (channel === 'EMAIL' && !subject) throw statusError('Email subject is required');
  const next = {
    id,
    projectId:target.project_id,
    roundId:target.round_id,
    targetId,
    organisationId:target.organisation_id,
    investorName:target.investor_name,
    personId:cleanText(body.personId ?? existing?.personId ?? target.primary_person_id,120),
    personName:cleanText(body.personName ?? existing?.personName ?? target.person_name,500),
    recipient,
    channel,
    purpose,
    disclosurePolicy,
    subject,
    body:messageBody,
    status:'DRAFT',
    founderApproval:existing?.founderApproval || null,
    akariApproval:existing?.akariApproval || null,
    ai:body.ai && typeof body.ai === 'object' ? {
      provider:cleanText(body.ai.provider,100),model:cleanText(body.ai.model,300),fallbackUsed:boolValue(body.ai.fallbackUsed),requestId:cleanText(body.ai.requestId,300),
    } : (existing?.ai || null),
    followUpAt:validDate(body.followUpAt ?? existing?.followUpAt,'Follow-up date'),
    createdAt:existing?.createdAt || nowIso(),
    updatedAt:nowIso(),
  };
  next.contentHash = await messageHash(next);
  if (existing?.contentHash !== next.contentHash) {
    next.founderApproval = null;
    next.akariApproval = null;
  }
  const encoded = JSON.stringify(next);
  if (existingRow) {
    await run(db, `
      UPDATE activities SET subject=?,description=?,outcome='DRAFT',occurred_at=?,follow_up_at=?,user_id=?
      WHERE tenant_id=? AND id=? AND activity_type=?
    `, [subject,encoded,next.updatedAt,next.followUpAt || null,auth.userId,tenantId,id,DRAFT_TYPE]);
  } else {
    await run(db, `
      INSERT INTO activities
        (id,tenant_id,project_id,user_id,activity_type,subject,description,outcome,occurred_at,follow_up_at,created_at)
      VALUES (?,?,?,?,?,?,?,'DRAFT',?,?,?)
    `, [id,tenantId,target.project_id,auth.userId,DRAFT_TYPE,subject,encoded,next.updatedAt,next.followUpAt || null,next.createdAt]);
  }
  await audit(db,auth,existingRow ? 'FUNDRAISING_OUTREACH_DRAFT_UPDATED' : 'FUNDRAISING_OUTREACH_DRAFT_CREATED','FUNDRAISING_OUTREACH_DRAFT',id,existing ? { ...existing,bodyHash:await sha256(existing.body || ''),body:'[REDACTED]' } : null,{ ...next,bodyHash:await sha256(next.body),body:'[REDACTED]' });
  return json({ item:publicDraft(next),created:!existingRow });
}

async function approveDraft(db,auth,tenantId,body,kind) {
  requireRole(auth,APPROVAL_ROLES);
  const id = cleanText(body.id,120);
  const row = await activity(db,tenantId,id,DRAFT_TYPE);
  const existing = decodeActivity(row);
  if (!existing) throw statusError('Outreach draft was not found in this workspace',404);
  if (!existing.contentHash || existing.contentHash !== await messageHash(existing)) throw statusError('Draft content changed and must be saved before approval',409);
  const note = cleanText(body.note,2000);
  const approval = { status:'APPROVED',by:auth.userId,at:nowIso(),note,contentHash:existing.contentHash };
  const next = {
    ...existing,
    founderApproval:kind === 'FOUNDER' ? approval : existing.founderApproval,
    akariApproval:kind === 'AKARI' ? approval : existing.akariApproval,
    updatedAt:nowIso(),
  };
  const founder = approvalValid(next.founderApproval,next.contentHash);
  const akari = approvalValid(next.akariApproval,next.contentHash);
  next.status = founder && akari ? 'FULLY_APPROVED' : founder ? 'FOUNDER_APPROVED' : 'DRAFT';
  await run(db, `UPDATE activities SET description=?,outcome=?,occurred_at=?,user_id=? WHERE tenant_id=? AND id=? AND activity_type=?`, [JSON.stringify(next),next.status,next.updatedAt,auth.userId,tenantId,id,DRAFT_TYPE]);
  await audit(db,auth,kind === 'FOUNDER' ? 'FUNDRAISING_DRAFT_FOUNDER_APPROVED' : 'FUNDRAISING_DRAFT_AKARI_APPROVED','FUNDRAISING_OUTREACH_DRAFT',id,{ status:existing.status,contentHash:existing.contentHash },{ status:next.status,contentHash:next.contentHash,approval:{ ...approval,noteHash:await sha256(note) } });
  return json({ item:publicDraft(next) });
}

async function markDraft(db,auth,tenantId,body,status) {
  const id = cleanText(body.id,120);
  const row = await activity(db,tenantId,id,DRAFT_TYPE);
  const existing = decodeActivity(row);
  if (!existing) throw statusError('Outreach draft was not found in this workspace',404);
  if (['EXPORTED','SENT'].includes(status)) {
    if (!approvalValid(existing.founderApproval,existing.contentHash) || !approvalValid(existing.akariApproval,existing.contentHash)) throw statusError('Exact draft content requires both founder and AKARI approval before export or sending',409);
    if (existing.contentHash !== await messageHash(existing)) throw statusError('Approved content changed and requires fresh approval',409);
  }
  const reference = cleanText(body.reference,1000);
  if (status === 'SENT' && !reference) throw statusError('A manual-send reference or message identifier is required');
  const now = nowIso();
  const next = {
    ...existing,status,updatedAt:now,
    exportedAt:status === 'EXPORTED' ? now : existing.exportedAt,
    sentAt:status === 'SENT' ? now : existing.sentAt,
    sentBy:status === 'SENT' ? auth.userId : existing.sentBy,
    sendReference:status === 'SENT' ? reference : existing.sendReference,
    closedAt:status === 'CLOSED' ? now : existing.closedAt,
  };
  await run(db, `UPDATE activities SET description=?,outcome=?,occurred_at=?,user_id=? WHERE tenant_id=? AND id=? AND activity_type=?`, [JSON.stringify(next),status,now,auth.userId,tenantId,id,DRAFT_TYPE]);
  await audit(db,auth,`FUNDRAISING_DRAFT_${status}`,'FUNDRAISING_OUTREACH_DRAFT',id,{ status:existing.status },{ status,referenceHash:reference ? await sha256(reference) : '' });
  return json({ item:publicDraft(next) });
}

async function recordReply(db,auth,tenantId,body) {
  const id = cleanText(body.id,120);
  const row = await activity(db,tenantId,id,DRAFT_TYPE);
  const existing = decodeActivity(row);
  if (!existing) throw statusError('Outreach draft was not found in this workspace',404);
  if (!['SENT','REPLIED'].includes(existing.status)) throw statusError('A reply can only be recorded after the message is sent',409);
  const replyStatus = enumValue(body.replyStatus,REPLY_STATES,'NONE','Reply status');
  if (replyStatus === 'NONE') throw statusError('Select the reply outcome');
  const replySummary = cleanText(body.replySummary,5000);
  if (!replySummary) throw statusError('Reply summary is required');
  const followUpAt = validDate(body.followUpAt,'Follow-up date');
  const now = nowIso();
  const next = { ...existing,status:'REPLIED',replyStatus,replySummary,replyRecordedAt:now,followUpAt,updatedAt:now };
  await run(db, `UPDATE activities SET description=?,outcome='REPLIED',occurred_at=?,follow_up_at=?,user_id=? WHERE tenant_id=? AND id=? AND activity_type=?`, [JSON.stringify(next),now,followUpAt || null,auth.userId,tenantId,id,DRAFT_TYPE]);
  await audit(db,auth,'FUNDRAISING_REPLY_RECORDED','FUNDRAISING_OUTREACH_DRAFT',id,{ status:existing.status },{ status:'REPLIED',replyStatus,replySummaryHash:await sha256(replySummary),followUpAt });
  return json({ item:publicDraft(next) });
}

async function saveMeeting(db,auth,tenantId,body) {
  const id = cleanText(body.id,120) || makeId('fra_meeting');
  const existingRow = await activity(db,tenantId,id,MEETING_TYPE);
  const existing = decodeActivity(existingRow);
  const targetId = cleanText(body.targetId ?? existing?.targetId,120);
  const target = await targetById(db,tenantId,targetId);
  if (!target) throw statusError('Fundraising target was not found in this workspace',404);
  if (!(await tenantProject(db,tenantId,target.project_id))) throw statusError('Founder project was not found in this workspace',404);
  const ownerUserId = cleanText(body.ownerUserId ?? existing?.ownerUserId,120) || auth.userId;
  if (!(await activeMember(db,tenantId,ownerUserId))) throw statusError('Meeting owner must be an active workspace member');
  const meetingAt = validDate(body.meetingAt ?? existing?.meetingAt,'Meeting date',true);
  const title = cleanText((body.title ?? existing?.title) || `Investor meeting · ${target.investor_name}`,1000);
  const next = {
    id,
    projectId:target.project_id,
    roundId:target.round_id,
    targetId,
    organisationId:target.organisation_id,
    investorName:target.investor_name,
    personId:cleanText(body.personId ?? existing?.personId ?? target.primary_person_id,120),
    personName:cleanText(body.personName ?? existing?.personName ?? target.person_name,500),
    title,
    meetingAt,
    durationMinutes:Math.min(480,Math.max(15,Number(body.durationMinutes ?? existing?.durationMinutes ?? 30))),
    timezone:cleanText((body.timezone ?? existing?.timezone) || 'Europe/Berlin',100),
    meetingLink:cleanText(body.meetingLink ?? existing?.meetingLink,2000),
    agenda:cleanText(body.agenda ?? existing?.agenda,10000),
    brief:cleanText(body.brief ?? existing?.brief,20000),
    status:enumValue(body.status ?? existing?.status,MEETING_STATES,'SCHEDULED','Meeting status'),
    ownerUserId,
    followUpAt:validDate(body.followUpAt ?? existing?.followUpAt,'Follow-up date'),
    notes:existing?.notes || '',
    outcome:existing?.outcome || '',
    nextSteps:existing?.nextSteps || '',
    createdAt:existing?.createdAt || nowIso(),
    updatedAt:nowIso(),
    ai:body.ai && typeof body.ai === 'object' ? { provider:cleanText(body.ai.provider,100),model:cleanText(body.ai.model,300),fallbackUsed:boolValue(body.ai.fallbackUsed),requestId:cleanText(body.ai.requestId,300) } : (existing?.ai || null),
  };
  if (next.meetingLink && !/^https:\/\//i.test(next.meetingLink)) throw statusError('Meeting link must use HTTPS');
  const encoded = JSON.stringify(next);
  if (existingRow) {
    await run(db, `UPDATE activities SET subject=?,description=?,outcome=?,occurred_at=?,follow_up_at=?,user_id=? WHERE tenant_id=? AND id=? AND activity_type=?`, [title,encoded,next.status,meetingAt,next.followUpAt || null,auth.userId,tenantId,id,MEETING_TYPE]);
  } else {
    await run(db, `INSERT INTO activities (id,tenant_id,project_id,user_id,activity_type,subject,description,outcome,occurred_at,follow_up_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id,tenantId,target.project_id,auth.userId,MEETING_TYPE,title,encoded,next.status,meetingAt,next.followUpAt || null,next.createdAt]);
  }
  await audit(db,auth,existingRow ? 'FUNDRAISING_MEETING_UPDATED' : 'FUNDRAISING_MEETING_CREATED','FUNDRAISING_INVESTOR_MEETING',id,existing ? { ...existing,brief:'[REDACTED]',notes:'[REDACTED]' } : null,{ ...next,briefHash:await sha256(next.brief),brief:'[REDACTED]',notes:'[REDACTED]' });
  return json({ item:next,created:!existingRow });
}

async function completeMeeting(db,auth,tenantId,body) {
  const id = cleanText(body.id,120);
  const row = await activity(db,tenantId,id,MEETING_TYPE);
  const existing = decodeActivity(row);
  if (!existing) throw statusError('Investor meeting was not found in this workspace',404);
  const notes = cleanText(body.notes,20000);
  const outcome = cleanText(body.outcome,5000);
  const nextSteps = cleanText(body.nextSteps,10000);
  if (!notes || !outcome || !nextSteps) throw statusError('Meeting notes, outcome and next steps are required');
  const followUpAt = validDate(body.followUpAt,'Follow-up date');
  const now = nowIso();
  const next = { ...existing,status:'COMPLETED',notes,outcome,nextSteps,completedAt:now,followUpAt,updatedAt:now };
  await run(db, `UPDATE activities SET description=?,outcome='COMPLETED',occurred_at=?,follow_up_at=?,user_id=? WHERE tenant_id=? AND id=? AND activity_type=?`, [JSON.stringify(next),existing.meetingAt || now,followUpAt || null,auth.userId,tenantId,id,MEETING_TYPE]);
  await audit(db,auth,'FUNDRAISING_MEETING_COMPLETED','FUNDRAISING_INVESTOR_MEETING',id,{ status:existing.status },{ status:'COMPLETED',outcomeHash:await sha256(outcome),notesHash:await sha256(notes),nextStepsHash:await sha256(nextSteps),followUpAt });
  return json({ item:next });
}

async function createFollowUpTask(db,auth,tenantId,body) {
  const entityType = enumValue(body.entityType,['DRAFT','MEETING'],'DRAFT','Follow-up entity type');
  const activityType = entityType === 'DRAFT' ? DRAFT_TYPE : MEETING_TYPE;
  const id = cleanText(body.id,120);
  const row = await activity(db,tenantId,id,activityType);
  const item = decodeActivity(row);
  if (!item) throw statusError('Fundraising outreach record was not found in this workspace',404);
  const ownerUserId = cleanText(body.ownerUserId,120) || auth.userId;
  if (!(await activeMember(db,tenantId,ownerUserId))) throw statusError('Task owner must be an active workspace member');
  const dueAt = validDate(body.dueAt || item.followUpAt,'Task due date',true);
  const marker = `[Fundraising Outreach:${id}]`;
  const duplicate = await first(db, `SELECT id FROM tasks WHERE tenant_id=? AND status NOT IN ('DONE','CANCELLED','ARCHIVED') AND description LIKE ? LIMIT 1`, [tenantId,`%${marker}%`]);
  if (duplicate && !boolValue(body.allowDuplicate)) throw statusError('An open follow-up task already exists for this outreach record',409);
  const taskId = makeId('tsk');
  const now = nowIso();
  const title = cleanText(body.title || `${entityType === 'MEETING' ? 'Investor meeting follow-up' : 'Investor outreach follow-up'} · ${item.investorName}`,500);
  const description = `${cleanText(body.description || item.nextSteps || item.replySummary || 'Complete the next investor follow-up action.',5000)}\n\n${marker}`;
  await run(db, `INSERT INTO tasks (id,tenant_id,title,description,owner_user_id,created_by,status,priority,due_at,project_id,activity_type,show_on_home,created_at,updated_at) VALUES (?,?,?,?,?,?, 'TODO','HIGH',?,?, 'FUNDRAISING_FOLLOW_UP',1,?,?)`, [taskId,tenantId,title,description,ownerUserId,auth.userId,dueAt,item.projectId,now,now]);
  await audit(db,auth,'FUNDRAISING_OUTREACH_TASK_CREATED','TASK',taskId,null,{ sourceActivityId:id,entityType,ownerUserId,dueAt,projectId:item.projectId });
  return json({ item:{ id:taskId,title,due_at:dueAt,owner_user_id:ownerUserId,project_id:item.projectId } });
}
