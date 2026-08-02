import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { readBdProfile } from '../../lib/bd-profile.js';
import {
  parseFundraisingFlags,
  sanitizeCapitalRoom,
  capitalRoomSummary,
  sanitizeInvestorPipelineItem,
  investorPipelineSummary,
  sanitizeDataRoomDocument,
  sanitizeInvestorAccess,
  sanitizeDiligenceRequest,
  sanitizeInvestorQuestion,
  diligenceSummary,
} from '../../lib/fundraising-os.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'BD_MANAGER']);
const TECHNICAL_DB_ERROR = /(D1_ERROR|SQLITE_ERROR|no such column|database is locked|SQLITE_BUSY|at offset \d+)/i;

async function settings(db, tenantId) {
  return first(db, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
}

function decorateProject(raw = {}) {
  const profile = readBdProfile(raw.legacy_import_data, raw);
  const project = {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    region: raw.region,
    website: raw.website,
    owner_user_id: raw.owner_user_id,
    funding_stage: profile.funding.stage,
    total_funds_raised: profile.funding.amountRaised,
    currency: profile.funding.currency,
    valuation: profile.funding.valuation,
  };
  return project;
}

async function projects(db, tenantId) {
  const rows = await all(db, `
    SELECT id, name, category, region, website,
      funding_status, funding_amount, valuation, owner_user_id, legacy_import_data
    FROM projects
    WHERE tenant_id = ?
    ORDER BY name COLLATE NOCASE
  `, [tenantId]);
  return rows.map(decorateProject);
}

async function projectById(db, tenantId, projectId) {
  const row = await first(db, `
    SELECT id, name, category, region, website,
      funding_status, funding_amount, valuation, owner_user_id, legacy_import_data
    FROM projects
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `, [tenantId, projectId]);
  return row ? decorateProject(row) : null;
}

async function member(db, tenantId, userId) {
  if (!userId) return null;
  return first(db, `
    SELECT u.id
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    WHERE tm.tenant_id = ?
      AND tm.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
      AND u.id = ?
    LIMIT 1
  `, [tenantId, userId]);
}

async function persist(db, auth, tenantId, flags, action, entityId, before, after) {
  const payload = JSON.stringify(flags);
  const row = await settings(db, tenantId);
  if (row) {
    await run(db, 'UPDATE tenant_settings SET feature_flags_json = ?, updated_at = ? WHERE tenant_id = ?', [payload, nowIso(), tenantId]);
  } else {
    await run(db, 'INSERT INTO tenant_settings (tenant_id, feature_flags_json, created_at, updated_at) VALUES (?, ?, ?, ?)', [tenantId, payload, nowIso(), nowIso()]);
  }
  await run(db, `
    INSERT INTO audit_logs
      (id, tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (?, ?, ?, ?, 'FUNDRAISING', ?, ?, ?, ?)
  `, [makeId('aud'), tenantId, auth.userId, action, entityId, JSON.stringify(before || {}), JSON.stringify(after || {}), nowIso()]);
}

const investorCategory = (value) => /(venture|vc|fund|investor|angel|capital)/i.test(String(value || ''));

function normalizeRoom(room) {
  return {
    ...room,
    investorPipeline: Array.isArray(room.investorPipeline) ? room.investorPipeline : [],
    dataRoomDocuments: Array.isArray(room.dataRoomDocuments) ? room.dataRoomDocuments : [],
    investorAccess: Array.isArray(room.investorAccess) ? room.investorAccess : [],
    diligenceRequests: Array.isArray(room.diligenceRequests) ? room.diligenceRequests : [],
    investorQuestions: Array.isArray(room.investorQuestions) ? room.investorQuestions : [],
  };
}

function decorateRooms(rooms, projectMap) {
  return rooms
    .filter((room) => projectMap.has(room.projectId))
    .map((raw) => {
      const room = normalizeRoom(raw);
      const project = projectMap.get(room.projectId);
      return {
        ...room,
        project,
        projectCategory: project.category,
        projectRegion: project.region,
        investorSummary: investorPipelineSummary(room.investorPipeline),
        diligenceSummary: diligenceSummary(room),
      };
    });
}

function technicalFailure(cause, fallback) {
  const message = String(cause?.message || '');
  console.error(fallback, cause);
  if (TECHNICAL_DB_ERROR.test(message)) return error(fallback, 500);
  return error(message || fallback, Number(cause?.status || 500));
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const [settingRow, projectRows] = await Promise.all([
      settings(context.env.DB, tenantId),
      projects(context.env.DB, tenantId),
    ]);
    const { rooms } = parseFundraisingFlags(settingRow?.feature_flags_json);
    const projectMap = new Map(projectRows.map((project) => [project.id, project]));
    const items = decorateRooms(rooms, projectMap);
    const investorProjects = projectRows.filter((project) => investorCategory(project.category));

    return json({
      items,
      projects: projectRows,
      investorProjects,
      summary: capitalRoomSummary(items),
      permissions: {
        canWrite: WRITE_ROLES.has(auth?.role),
        canFinance: canViewFinance(auth),
      },
    });
  } catch (cause) {
    return technicalFailure(cause, 'Fundraising workspace could not be loaded');
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!WRITE_ROLES.has(auth?.role)) return error('Owner, Admin or BD Manager permission is required', 403);
    const body = await readJson(context.request);
    if (!context.env.DB) return json({ updated: true, demo: true });

    const action = String(body.action || 'save-room').toLowerCase();
    const settingRow = await settings(context.env.DB, tenantId);
    const parsed = parseFundraisingFlags(settingRow?.feature_flags_json);

    if (action === 'save-room') {
      const project = await first(context.env.DB, 'SELECT id, name, category, region FROM projects WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, String(body.projectId || '')]);
      if (!project) return error('Selected project was not found in this workspace', 404);
      if (body.ownerUserId && !(await member(context.env.DB, tenantId, String(body.ownerUserId)))) {
        return error('Selected fundraising owner is not an active workspace member', 422);
      }
      const index = parsed.rooms.findIndex((room) => room.id === body.id || room.projectId === project.id);
      const existing = index >= 0 ? parsed.rooms[index] : {};
      const room = sanitizeCapitalRoom({ ...body, projectId: project.id, projectName: project.name }, existing);
      room.projectCategory = project.category;
      room.projectRegion = project.region;
      if (index >= 0) parsed.rooms[index] = room;
      else parsed.rooms.push(room);
      parsed.flags.fundraisingCapitalRooms = parsed.rooms.slice(0, 250);
      await persist(context.env.DB, auth, tenantId, parsed.flags, index >= 0 ? 'FUNDRAISING_ROOM_UPDATED' : 'FUNDRAISING_ROOM_CREATED', room.id, existing, room);
      return json({ updated: true, item: room, summary: capitalRoomSummary(parsed.rooms) });
    }

    const roomIndex = parsed.rooms.findIndex((room) => room.id === String(body.roomId || ''));
    if (roomIndex < 0) return error('Capital Room was not found in this workspace', 404);
    const room = normalizeRoom(parsed.rooms[roomIndex]);

    if (action === 'upsert-investor') {
      const investor = await projectById(context.env.DB, tenantId, String(body.item?.investorProjectId || ''));
      if (!investor) return error('Selected investor organisation was not found in this workspace', 404);
      if (!investorCategory(investor.category)) return error('Selected organisation is not classified as an investor, fund or venture-capital profile', 422);
      const itemIndex = room.investorPipeline.findIndex((item) => item.id === body.item?.id || item.investorProjectId === investor.id);
      const existing = itemIndex >= 0 ? room.investorPipeline[itemIndex] : {};
      const item = sanitizeInvestorPipelineItem(body.item || {}, existing, room, {
        ...investor,
        investmentStages: investor.funding_stage ? [investor.funding_stage] : [],
        geographies: investor.region ? [investor.region] : [],
      });
      if (itemIndex >= 0) room.investorPipeline[itemIndex] = item;
      else room.investorPipeline.push(item);
      return saveRoom('INVESTOR_PIPELINE', itemIndex, item, existing);
    }

    if (action === 'remove-investor') {
      const itemIndex = room.investorPipeline.findIndex((item) => item.id === String(body.itemId || ''));
      if (itemIndex < 0) return error('Investor pipeline record was not found', 404);
      const [removed] = room.investorPipeline.splice(itemIndex, 1);
      return saveRoom('INVESTOR_PIPELINE_REMOVED', itemIndex, {}, removed, true);
    }

    if (action === 'upsert-document') {
      const list = room.dataRoomDocuments;
      const index = list.findIndex((item) => item.id === body.item?.id);
      const existing = index >= 0 ? list[index] : {};
      const item = sanitizeDataRoomDocument(body.item || {}, existing);
      if (!item.title || !item.url) return error('Document title and secure link are required', 422);
      if (index >= 0) list[index] = item;
      else list.push(item);
      return saveRoom('DATA_ROOM_DOCUMENT', index, item, existing);
    }

    if (action === 'upsert-access') {
      const list = room.investorAccess;
      const investorId = String(body.item?.investorPipelineId || '');
      if (!room.investorPipeline.some((item) => item.id === investorId)) return error('Investor pipeline record was not found in this Capital Room', 404);
      const index = list.findIndex((item) => item.id === body.item?.id || item.investorPipelineId === investorId);
      const existing = index >= 0 ? list[index] : {};
      const item = sanitizeInvestorAccess(body.item || {}, existing);
      if (item.accessStatus === 'GRANTED' && !['SIGNED', 'NOT_REQUIRED'].includes(item.ndaStatus)) {
        return error('NDA must be signed or not required before data-room access is granted', 409);
      }
      if (index >= 0) list[index] = item;
      else list.push(item);
      return saveRoom('INVESTOR_DATA_ROOM_ACCESS', index, item, existing);
    }

    if (action === 'upsert-diligence') {
      const list = room.diligenceRequests;
      const investorId = String(body.item?.investorPipelineId || '');
      if (investorId && !room.investorPipeline.some((item) => item.id === investorId)) return error('Investor pipeline record was not found in this Capital Room', 404);
      const index = list.findIndex((item) => item.id === body.item?.id);
      const existing = index >= 0 ? list[index] : {};
      const item = sanitizeDiligenceRequest(body.item || {}, existing);
      if (item.ownerUserId && !(await member(context.env.DB, tenantId, item.ownerUserId))) return error('Diligence owner is not an active workspace member', 422);
      if (!item.title) return error('Diligence request title is required', 422);
      if (index >= 0) list[index] = item;
      else list.push(item);
      return saveRoom('DILIGENCE_REQUEST', index, item, existing);
    }

    if (action === 'upsert-question') {
      const list = room.investorQuestions;
      const investorId = String(body.item?.investorPipelineId || '');
      if (!room.investorPipeline.some((item) => item.id === investorId)) return error('Investor pipeline record was not found in this Capital Room', 404);
      const index = list.findIndex((item) => item.id === body.item?.id);
      const existing = index >= 0 ? list[index] : {};
      const item = sanitizeInvestorQuestion(body.item || {}, existing);
      if (!item.question) return error('Investor question is required', 422);
      if (index >= 0) list[index] = item;
      else list.push(item);
      return saveRoom('INVESTOR_QUESTION', index, item, existing);
    }

    return error('Fundraising action is not supported', 404);

    async function saveRoom(prefix, index, item, before, removed = false) {
      room.updatedAt = nowIso();
      parsed.rooms[roomIndex] = room;
      parsed.flags.fundraisingCapitalRooms = parsed.rooms;
      const actionName = removed ? prefix : (index >= 0 ? `${prefix}_UPDATED` : `${prefix}_CREATED`);
      await persist(context.env.DB, auth, tenantId, parsed.flags, actionName, item.id || before.id, before, item);
      return json({ updated: true, item, room, diligenceSummary: diligenceSummary(room) });
    }
  } catch (cause) {
    return technicalFailure(cause, 'Fundraising action failed');
  }
}
