import { json, error, readJson } from '../../../lib/response.js';
import { makeId, nowIso } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';

const IMPORT_ROLES = new Set(['OWNER', 'ADMIN']);
const MAX_RECORDS_PER_REQUEST = 100;

function value(row, key) {
  return row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null;
}

function text(input, max = 10000) {
  if (input === null || input === undefined) return null;
  const normalized = String(input).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function stablePart(input, fallback = 'record') {
  return String(input || fallback)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function slugify(input) {
  return String(input || 'lead')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'lead';
}

function excelDateToIso(input, includeTime = false) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    const milliseconds = Math.round((input - 25569) * 86400 * 1000);
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return includeTime ? date.toISOString() : date.toISOString().slice(0, 10);
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return includeTime ? date.toISOString() : date.toISOString().slice(0, 10);
}

function combineDateAndTime(dateValue, timeValue) {
  const date = excelDateToIso(dateValue, false);
  if (!date) return null;
  if (timeValue === null || timeValue === undefined || timeValue === '') return `${date}T09:00:00.000Z`;
  if (typeof timeValue === 'number' && Number.isFinite(timeValue)) {
    const seconds = Math.round((timeValue % 1) * 86400);
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    return `${date}T${hours}:${minutes}:00.000Z`;
  }
  const normalized = String(timeValue).trim();
  if (/^\d{1,2}:\d{2}/.test(normalized)) return `${date}T${normalized.padStart(5, '0')}:00.000Z`;
  return `${date}T09:00:00.000Z`;
}

function priority(input) {
  const normalized = String(input || '').trim().toUpperCase();
  if (normalized === 'NORMAL') return 'MEDIUM';
  return ['URGENT', 'HIGH', 'MEDIUM', 'LOW'].includes(normalized) ? normalized : 'MEDIUM';
}

function taskStatus(input) {
  const normalized = String(input || '').trim().toUpperCase().replace(/\s+/g, '_');
  const map = {
    NOT_STARTED: 'TODO',
    OPEN: 'TODO',
    STARTED: 'IN_PROGRESS',
    IN_PROGRESS: 'IN_PROGRESS',
    WAITING: 'WAITING',
    COMPLETED: 'DONE',
    DONE: 'DONE',
    CANCELLED: 'CANCELLED',
  };
  return map[normalized] || 'TODO';
}

function fallbackContactName(row) {
  return text(value(row, 'Contact Name'), 300)
    || text(value(row, 'Email'), 300)
    || text(value(row, 'Telegram'), 300)
    || text(value(row, 'X Profile'), 300)
    || text(value(row, 'Other Contact'), 300)
    || `Unknown contact - ${text(value(row, 'Project / Organization'), 200) || 'AKARI Lead'}`;
}

function projectStatement(db, tenantId, userId, row, batchId, fileName, now) {
  const leadId = text(value(row, 'Lead ID'), 100);
  const name = text(value(row, 'Project / Organization'), 300);
  if (!leadId || !name) return null;
  const id = `prj_akari_${stablePart(leadId)}`;
  const slug = `${slugify(name)}-${stablePart(leadId).slice(-18)}`;
  const originalStatus = [
    text(value(row, 'Pipeline Stage'), 200),
    text(value(row, 'Lead Status'), 200),
    text(value(row, 'Follow-Up Status'), 200),
    text(value(row, 'Legacy Classification'), 1000),
  ].filter(Boolean).join(' | ') || 'Imported AKARI Lead';
  const originalNotes = [
    text(value(row, 'Legacy Status / Notes'), 10000),
    text(value(row, 'Notes'), 20000),
    text(value(row, 'Source References'), 10000),
  ].filter(Boolean).join('\n\n') || null;
  const legacy = JSON.stringify({
    batchId,
    collection: 'AKARI Leads',
    sourceLeadId: leadId,
    additionalCategories: value(row, 'Additional Categories / Tags'),
    partnershipScope: value(row, 'Partnership Scope'),
    primaryPoc: value(row, 'Primary POC'),
    email: value(row, 'Email'),
    otherContact: value(row, 'Other Contact'),
    expectedDealValue: value(row, 'Expected Deal Value'),
    probabilityPercentage: value(row, 'Probability %'),
    weightedPipeline: value(row, 'Weighted Pipeline'),
    valuationMetric: value(row, 'Valuation / Metric'),
    dataCompletenessPercentage: value(row, 'Data Completeness %'),
    active: value(row, 'Active'),
  });
  const createdAt = excelDateToIso(value(row, 'Date Added'), true) || now;

  return db.prepare(`
    INSERT OR IGNORE INTO projects (
      id, tenant_id, name, slug, lifecycle_status, website, x_url, telegram,
      category, region, description, funding_status, tge_status, priority,
      source_type, source_name, owner_user_id, last_activity_at, next_follow_up_at,
      original_import_source, original_status, original_notes, legacy_import_data,
      created_at, updated_at, created_by, updated_by
    ) VALUES (?, ?, ?, ?, 'LEAD', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKARI_LEADS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    tenantId,
    name,
    slug,
    text(value(row, 'Website'), 1000),
    text(value(row, 'X Profile'), 1000),
    text(value(row, 'Telegram'), 500),
    text(value(row, 'Primary Category'), 300),
    text(value(row, 'Country / Region'), 500),
    text(value(row, 'Partnership Scope'), 5000),
    text(value(row, 'Funding'), 1000),
    text(value(row, 'TGE Status'), 500),
    priority(value(row, 'Priority')),
    text(value(row, 'Lead Source'), 1000) || 'AKARI Workbook Import',
    String(value(row, 'Owner') || '').trim().toLowerCase() === 'muaz' ? userId : null,
    excelDateToIso(value(row, 'Last Contacted'), true),
    excelDateToIso(value(row, 'Next Follow-Up'), true),
    `${fileName}#${batchId}`,
    originalStatus,
    originalNotes,
    legacy,
    createdAt,
    now,
    userId,
    userId,
  );
}

function contactStatement(db, tenantId, userId, row, batchId, now) {
  const contactId = text(value(row, 'Contact ID'), 100);
  const leadId = text(value(row, 'Lead ID'), 100);
  if (!contactId || !leadId) return null;
  const id = `con_akari_${stablePart(contactId)}`;
  const projectId = `prj_akari_${stablePart(leadId)}`;
  const notes = [
    text(value(row, 'Notes'), 10000),
    text(value(row, 'Source Reference'), 10000),
    `[AKARI_IMPORT:${batchId}]`,
  ].filter(Boolean).join('\n\n');

  return db.prepare(`
    INSERT OR IGNORE INTO contacts (
      id, tenant_id, project_id, full_name, job_title, email, telegram, x_handle,
      phone, is_primary_contact, notes, created_at, updated_at, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    tenantId,
    projectId,
    fallbackContactName(row),
    text(value(row, 'Role / Title'), 500),
    text(value(row, 'Email'), 500),
    text(value(row, 'Telegram'), 500),
    text(value(row, 'X Profile'), 1000),
    text(value(row, 'Other Contact'), 500),
    String(value(row, 'Primary Contact?') || '').trim().toLowerCase() === 'yes' ? 1 : 0,
    notes,
    now,
    now,
    userId,
    userId,
  );
}

function taskStatement(db, tenantId, userId, row, batchId, now) {
  const taskId = text(value(row, 'Task ID'), 100);
  const title = text(value(row, 'Task'), 500);
  if (!taskId || !title) return null;
  const id = `tsk_akari_${stablePart(taskId)}`;
  const leadId = text(value(row, 'Lead ID'), 100);
  const description = [
    text(value(row, 'Notes'), 10000),
    text(value(row, 'Project / Organization'), 500),
    `[AKARI_IMPORT:${batchId}]`,
  ].filter(Boolean).join('\n\n');
  const completedAt = excelDateToIso(value(row, 'Completed Date'), true);
  return db.prepare(`
    INSERT OR IGNORE INTO tasks (
      id, tenant_id, title, description, owner_user_id, created_by, status, priority,
      due_at, completed_at, project_id, activity_type, recurrence_rule, show_on_home,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).bind(
    id,
    tenantId,
    title,
    description,
    userId,
    userId,
    taskStatus(value(row, 'Status')),
    priority(value(row, 'Priority')),
    combineDateAndTime(value(row, 'Due Date'), value(row, 'Due Time')),
    completedAt,
    leadId ? `prj_akari_${stablePart(leadId)}` : null,
    text(value(row, 'Task Type'), 300),
    text(value(row, 'Recurrence'), 500),
    excelDateToIso(value(row, 'Created Date'), true) || now,
    now,
  );
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!IMPORT_ROLES.has(auth?.role)) return error('Owner or Admin permission is required', 403);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);

    const body = await readJson(context.request);
    const batchId = text(body.batchId, 120);
    const fileName = text(body.fileName, 300) || 'AKARI Leads workbook';
    const entityType = String(body.entityType || '').toLowerCase();
    const records = Array.isArray(body.records) ? body.records : [];

    if (!batchId) return error('Import batch ID is required', 422);
    if (!['projects', 'contacts', 'tasks', 'complete'].includes(entityType)) return error('Unsupported import entity type', 422);
    if (records.length > MAX_RECORDS_PER_REQUEST) return error(`Maximum ${MAX_RECORDS_PER_REQUEST} records per import request`, 413);

    const now = nowIso();
    if (entityType === 'complete') {
      const summary = body.summary && typeof body.summary === 'object' ? body.summary : {};
      await context.env.DB.prepare(`
        INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, 'AKARI_LEADS_IMPORT_COMPLETE', 'IMPORT_BATCH', ?, ?, ?, ?, ?)
      `).bind(
        makeId('aud'), tenantId, auth.userId, batchId,
        JSON.stringify({ batchId, fileName, summary }),
        context.request.headers.get('cf-connecting-ip'),
        context.request.headers.get('user-agent'),
        now,
      ).run();
      return json({ batchId, completed: true, summary });
    }

    const statementFactory = entityType === 'projects'
      ? (row) => projectStatement(context.env.DB, tenantId, auth.userId, row, batchId, fileName, now)
      : entityType === 'contacts'
        ? (row) => contactStatement(context.env.DB, tenantId, auth.userId, row, batchId, now)
        : (row) => taskStatement(context.env.DB, tenantId, auth.userId, row, batchId, now);

    const statements = records.map(statementFactory).filter(Boolean);
    if (!statements.length) return json({ batchId, entityType, processed: 0, inserted: 0, skipped: records.length });

    statements.push(context.env.DB.prepare(`
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, 'AKARI_LEADS_IMPORT_CHUNK', 'IMPORT_BATCH', ?, ?, ?, ?, ?)
    `).bind(
      makeId('aud'), tenantId, auth.userId, batchId,
      JSON.stringify({ batchId, fileName, entityType, recordCount: records.length }),
      context.request.headers.get('cf-connecting-ip'),
      context.request.headers.get('user-agent'),
      now,
    ));

    const results = await context.env.DB.batch(statements);
    const dataResults = results.slice(0, -1);
    const inserted = dataResults.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0);

    return json({
      batchId,
      entityType,
      processed: records.length,
      inserted,
      skipped: Math.max(records.length - inserted, 0),
    });
  } catch (cause) {
    console.error('AKARI Leads import commit error', cause);
    return error(cause.message || 'AKARI Leads import failed', Number(cause.status || 500));
  }
}
