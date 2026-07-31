import { json, error, readJson } from '../lib/response.js';
import { all, first, run, makeId, nowIso } from '../lib/db.js';
import { DEMO_DASHBOARD, DEMO_OPPORTUNITIES, DEMO_PROJECTS, DEMO_TASKS } from '../lib/demo-data.js';
import { canViewFinance, requireTenant } from '../lib/permissions.js';

function pathParts(context) {
  const raw = context.params.path;
  if (Array.isArray(raw)) return raw;
  return String(raw || '').split('/').filter(Boolean);
}

function inDemo(context) {
  return !context.env.DB || (context.env.AUTH_MODE || 'demo') === 'demo';
}

function withFinanceGuard(data, auth) {
  if (canViewFinance(auth)) return data;
  const clone = structuredClone(data);
  if (clone.metrics) {
    for (const key of ['monthlyTarget', 'revenueBooked', 'revenueCollected', 'netRevenue', 'weightedPipeline', 'yearToDateRevenue', 'outstandingPayments', 'referralRewardsDue']) {
      delete clone.metrics[key];
    }
  }
  return clone;
}

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const permissionError = new Error('Finance permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

async function getDashboard(context) {
  const auth = context.data.auth;
  if (inDemo(context)) return json(withFinanceGuard(DEMO_DASHBOARD, auth));
  const tenantId = requireTenant(auth);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const yearStart = new Date(Date.UTC(monthStart.getUTCFullYear(), 0, 1));

  const target = await first(context.env.DB, `
    SELECT gross_revenue_target, net_revenue_target
    FROM monthly_targets
    WHERE tenant_id = ? AND user_id IS NULL AND year = ? AND month = ?
    LIMIT 1
  `, [tenantId, monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1]);

  const campaignTotals = await first(context.env.DB, `
    SELECT
      COALESCE(SUM(gross_revenue), 0) AS booked,
      COALESCE(SUM(akari_net_revenue), 0) AS net,
      COUNT(CASE WHEN status NOT IN ('COMPLETED', 'CANCELLED') THEN 1 END) AS active_campaigns
    FROM campaigns
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
  `, [tenantId, monthStart.toISOString(), nextMonth.toISOString()]);

  const collected = await first(context.env.DB, `
    SELECT COALESCE(SUM(amount), 0) AS value
    FROM payments
    WHERE tenant_id = ? AND status = 'PAID' AND received_date >= ? AND received_date < ?
  `, [tenantId, monthStart.toISOString().slice(0, 10), nextMonth.toISOString().slice(0, 10)]);

  const pipeline = await first(context.env.DB, `
    SELECT COALESCE(SUM(weighted_value), 0) AS value, COUNT(*) AS count
    FROM opportunities
    WHERE tenant_id = ? AND stage NOT IN ('WON', 'LOST')
  `, [tenantId]);

  const ytd = await first(context.env.DB, `
    SELECT COALESCE(SUM(amount), 0) AS value
    FROM payments
    WHERE tenant_id = ? AND status = 'PAID' AND received_date >= ?
  `, [tenantId, yearStart.toISOString().slice(0, 10)]);

  const customerCount = await first(context.env.DB, `
    SELECT COUNT(*) AS value
    FROM projects
    WHERE tenant_id = ? AND lifecycle_status = 'CLIENT'
  `, [tenantId]);

  const partnerCount = await first(context.env.DB, `
    SELECT COUNT(*) AS value
    FROM partners
    WHERE tenant_id = ? AND status = 'ACTIVE'
  `, [tenantId]);

  const outstanding = await first(context.env.DB, `
    SELECT COALESCE(SUM(amount), 0) AS value
    FROM payments
    WHERE tenant_id = ? AND status IN ('INVOICED', 'PARTIALLY_PAID', 'OVERDUE')
  `, [tenantId]);

  const referrals = await first(context.env.DB, `
    SELECT COALESCE(SUM(referral_amount), 0) AS value
    FROM referrals
    WHERE tenant_id = ? AND payment_status IN ('CONFIRMED', 'DUE')
  `, [tenantId]);

  return json(withFinanceGuard({
    month: monthStart.toISOString().slice(0, 7),
    currency: 'USD',
    metrics: {
      monthlyTarget: Number(target?.gross_revenue_target || 0),
      revenueBooked: Number(campaignTotals?.booked || 0),
      revenueCollected: Number(collected?.value || 0),
      netRevenue: Number(campaignTotals?.net || 0),
      weightedPipeline: Number(pipeline?.value || 0),
      activeOpportunities: Number(pipeline?.count || 0),
      yearToDateRevenue: Number(ytd?.value || 0),
      activeCustomers: Number(customerCount?.value || 0),
      activeCampaigns: Number(campaignTotals?.active_campaigns || 0),
      activePartners: Number(partnerCount?.value || 0),
      outstandingPayments: Number(outstanding?.value || 0),
      referralRewardsDue: Number(referrals?.value || 0),
    },
  }, auth));
}

async function getProjects(context) {
  if (inDemo(context)) return json({ items: DEMO_PROJECTS, total: DEMO_PROJECTS.length });
  const auth = context.data.auth;
  const tenantId = requireTenant(auth);
  const url = new URL(context.request.url);
  const search = (url.searchParams.get('search') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
  const like = `%${search}%`;
  const where = search ? 'AND (p.name LIKE ? OR p.website LIKE ? OR p.x_url LIKE ? OR p.category LIKE ?)' : '';
  const bindings = search ? [tenantId, like, like, like, like, limit, offset] : [tenantId, limit, offset];

  const items = await all(context.env.DB, `
    SELECT p.id, p.name, p.category, p.lifecycle_status, p.priority, p.last_activity_at, p.next_follow_up_at,
           u.full_name AS owner,
           c.full_name AS primary_contact,
           COUNT(DISTINCT CASE WHEN o.stage NOT IN ('WON', 'LOST') THEN o.id END) AS open_opportunities,
           COALESCE(SUM(CASE WHEN o.stage NOT IN ('WON', 'LOST') THEN COALESCE(o.estimated_value_base_currency, o.estimated_value, 0) ELSE 0 END), 0) AS pipeline_value,
           p.source_name
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_user_id
    LEFT JOIN contacts c ON c.project_id = p.id AND c.is_primary_contact = 1
    LEFT JOIN opportunities o ON o.project_id = p.id AND o.tenant_id = p.tenant_id
    WHERE p.tenant_id = ? ${where}
    GROUP BY p.id
    ORDER BY COALESCE(p.next_follow_up_at, '9999-12-31') ASC, p.updated_at DESC
    LIMIT ? OFFSET ?
  `, bindings);

  const countBindings = search ? [tenantId, like, like, like, like] : [tenantId];
  const count = await first(context.env.DB, `SELECT COUNT(*) AS total FROM projects p WHERE p.tenant_id = ? ${where}`, countBindings);
  return json({ items, total: Number(count?.total || 0), limit, offset });
}

async function getProject(context, id) {
  if (inDemo(context)) {
    const item = DEMO_PROJECTS.find((project) => project.id === id || project.name.toLowerCase().replaceAll(' ', '-') === id);
    return item ? json(item) : error('Project not found', 404);
  }
  const tenantId = requireTenant(context.data.auth);
  const item = await first(context.env.DB, 'SELECT * FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  if (!item) return error('Project not found', 404);
  const contacts = await all(context.env.DB, 'SELECT * FROM contacts WHERE tenant_id = ? AND project_id = ? ORDER BY is_primary_contact DESC, full_name', [tenantId, id]);
  const opportunities = await all(context.env.DB, 'SELECT * FROM opportunities WHERE tenant_id = ? AND project_id = ? ORDER BY updated_at DESC', [tenantId, id]);
  const activities = await all(context.env.DB, 'SELECT * FROM activities WHERE tenant_id = ? AND project_id = ? ORDER BY occurred_at DESC LIMIT 25', [tenantId, id]);
  return json({ ...item, contacts, opportunities, activities });
}

async function getContacts(context) {
  if (inDemo(context)) return json({ items: [], total: 0, demo: true });
  const tenantId = requireTenant(context.data.auth);
  const url = new URL(context.request.url);
  const search = (url.searchParams.get('search') || '').trim();
  const like = `%${search}%`;
  const where = search ? 'AND (c.full_name LIKE ? OR c.email LIKE ? OR c.telegram LIKE ? OR p.name LIKE ?)' : '';
  const bindings = search ? [tenantId, like, like, like, like] : [tenantId];
  const items = await all(context.env.DB, `
    SELECT c.*, p.name AS project_name
    FROM contacts c
    JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? ${where}
    ORDER BY c.is_primary_contact DESC, c.updated_at DESC
    LIMIT 100
  `, bindings);
  return json({ items, total: items.length });
}

async function getOpportunities(context) {
  if (inDemo(context)) return json({ items: DEMO_OPPORTUNITIES, total: DEMO_OPPORTUNITIES.length });
  const tenantId = requireTenant(context.data.auth);
  const items = await all(context.env.DB, `
    SELECT o.*, p.name AS project_name, u.full_name AS owner_name
    FROM opportunities o
    JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
    LEFT JOIN users u ON u.id = o.owner_user_id
    WHERE o.tenant_id = ?
    ORDER BY CASE o.stage WHEN 'NEGOTIATION' THEN 1 WHEN 'PROPOSAL' THEN 2 WHEN 'QUALIFIED' THEN 3 ELSE 4 END, o.expected_close_date ASC
  `, [tenantId]);
  return json({ items, total: items.length });
}

async function getTasks(context) {
  if (inDemo(context)) return json({ items: DEMO_TASKS, total: DEMO_TASKS.length });
  const tenantId = requireTenant(context.data.auth);
  const auth = context.data.auth;
  const url = new URL(context.request.url);
  const scope = url.searchParams.get('scope') || 'mine';
  const mine = scope === 'mine' ? 'AND t.owner_user_id = ?' : '';
  const bindings = scope === 'mine' ? [tenantId, auth.userId] : [tenantId];
  const items = await all(context.env.DB, `
    SELECT t.*, p.name AS project_name, o.name AS opportunity_name, c.name AS campaign_name, u.full_name AS owner_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
    LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
    LEFT JOIN campaigns c ON c.id = t.campaign_id AND c.tenant_id = t.tenant_id
    LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.tenant_id = ? ${mine} AND t.status NOT IN ('CANCELLED', 'ARCHIVED', 'DONE')
    ORDER BY CASE t.status WHEN 'TODO' THEN 1 WHEN 'IN_PROGRESS' THEN 2 ELSE 3 END, t.due_at ASC
  `, bindings);
  return json({ items, total: items.length });
}

async function createTask(context) {
  const body = await readJson(context.request);
  if (!body.title?.trim()) return error('Task title is required', 422);
  if (inDemo(context)) return json({ id: makeId('tsk'), ...body, status: body.status || 'TODO' }, 201);
  const auth = context.data.auth;
  const tenantId = requireTenant(auth);
  const id = makeId('tsk');
  const createdAt = nowIso();
  await run(context.env.DB, `
    INSERT INTO tasks (id, tenant_id, title, description, owner_user_id, created_by, status, priority, due_at, project_id, contact_id, opportunity_id, campaign_id, activity_type, show_on_home, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, tenantId, body.title.trim(), body.description || null, body.ownerUserId || auth.userId, auth.userId, body.status || 'TODO', body.priority || 'MEDIUM', body.dueAt || null, body.projectId || null, body.contactId || null, body.opportunityId || null, body.campaignId || null, body.activityType || null, body.showOnHome === false ? 0 : 1, createdAt, createdAt]);
  return json({ id, createdAt }, 201);
}

async function updateTask(context, id) {
  const body = await readJson(context.request);
  if (inDemo(context)) return json({ id, ...body, updatedAt: nowIso() });
  const auth = context.data.auth;
  const tenantId = requireTenant(auth);
  const existing = await first(context.env.DB, 'SELECT id FROM tasks WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  if (!existing) return error('Task not found', 404);
  const status = body.status || null;
  const completedAt = status === 'DONE' ? nowIso() : body.completedAt || null;
  await run(context.env.DB, `
    UPDATE tasks SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      due_at = COALESCE(?, due_at),
      completed_at = CASE WHEN ? = 'DONE' THEN ? WHEN ? IS NOT NULL THEN NULL ELSE completed_at END,
      updated_at = ?
    WHERE tenant_id = ? AND id = ?
  `, [body.title || null, body.description || null, status, body.priority || null, body.dueAt || null, status, completedAt, status, nowIso(), tenantId, id]);
  return json({ id, updated: true });
}

async function getPayments(context) {
  const auth = context.data.auth;
  requireFinance(auth);
  if (inDemo(context)) return json({ items: [], total: 0, demo: true });
  const tenantId = requireTenant(auth);
  const items = await all(context.env.DB, `
    SELECT pay.*, p.name AS project_name, c.name AS campaign_name
    FROM payments pay
    JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
    LEFT JOIN campaigns c ON c.id = pay.campaign_id AND c.tenant_id = pay.tenant_id
    WHERE pay.tenant_id = ?
    ORDER BY COALESCE(pay.received_date, pay.due_date, '9999-12-31') DESC
    LIMIT 100
  `, [tenantId]);
  return json({ items, total: items.length });
}

async function getReports(context) {
  const auth = context.data.auth;
  const tenantId = requireTenant(auth);
  if (inDemo(context)) return json({ pipelineByStage: [], revenueByMonth: [], demo: true });
  const pipelineByStage = await all(context.env.DB, `
    SELECT stage, COUNT(*) AS opportunity_count,
           COALESCE(SUM(COALESCE(estimated_value_base_currency, estimated_value, 0)), 0) AS pipeline_value,
           COALESCE(SUM(weighted_value), 0) AS weighted_value
    FROM opportunities
    WHERE tenant_id = ?
    GROUP BY stage
    ORDER BY stage
  `, [tenantId]);
  const revenueByMonth = canViewFinance(auth) ? await all(context.env.DB, `
    SELECT substr(received_date, 1, 7) AS month, COALESCE(SUM(amount_base_currency), SUM(amount), 0) AS collected
    FROM payments
    WHERE tenant_id = ? AND status = 'PAID' AND received_date IS NOT NULL
    GROUP BY substr(received_date, 1, 7)
    ORDER BY month DESC
    LIMIT 24
  `, [tenantId]) : [];
  return json({ pipelineByStage, revenueByMonth });
}

async function simpleList(context, table, columns = '*') {
  if (inDemo(context)) return json({ items: [], total: 0, demo: true });
  const tenantId = requireTenant(context.data.auth);
  const items = await all(context.env.DB, `SELECT ${columns} FROM ${table} WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 100`, [tenantId]);
  return json({ items, total: items.length });
}

export async function onRequest(context) {
  try {
    const parts = pathParts(context);
    const [resource, id] = parts;
    const method = context.request.method.toUpperCase();

    if (!resource || resource === 'health') return json({ ok: true, service: 'akari-crm-api', time: nowIso() });
    if (resource === 'me' && method === 'GET') return json({ user: context.data.auth });
    if (resource === 'dashboard' && method === 'GET') return getDashboard(context);
    if (resource === 'projects' && method === 'GET' && id) return getProject(context, id);
    if (resource === 'projects' && method === 'GET') return getProjects(context);
    if (resource === 'contacts' && method === 'GET') return getContacts(context);
    if (resource === 'opportunities' && method === 'GET') return getOpportunities(context);
    if (resource === 'tasks' && method === 'GET') return getTasks(context);
    if (resource === 'tasks' && method === 'POST') return createTask(context);
    if (resource === 'tasks' && method === 'PATCH' && id) return updateTask(context, id);
    if (resource === 'campaigns' && method === 'GET') return simpleList(context, 'campaigns');
    if (resource === 'partners' && method === 'GET') return simpleList(context, 'partners');
    if (resource === 'payments' && method === 'GET') return getPayments(context);
    if (resource === 'reports' && method === 'GET') return getReports(context);

    return error('Route not found', 404, { method, path: parts.join('/') });
  } catch (cause) {
    const status = Number(cause?.status || 500);
    console.error('AKARI CRM API error', cause);
    return error(status >= 500 ? 'Internal server error' : cause.message, status);
  }
}
