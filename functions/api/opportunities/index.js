import { json, error, readJson } from '../../lib/response.js';
import { all, first, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const STAGES = new Set(['NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION','WON','LOST','ON_HOLD']);
const text = (value, max = 5000) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
};

function persistenceError(message) {
  const cause = new Error(message);
  cause.status = 500;
  return cause;
}

async function executeWriteBatch(db, statements) {
  const prepared = statements.map(({ sql, bindings }) => db.prepare(sql).bind(...bindings));
  if (typeof db.batch === 'function') {
    await db.batch(prepared);
    return;
  }
  for (const statement of prepared) await statement.run();
}

async function savedOpportunity(db, tenantId, id) {
  return first(db, `
    SELECT o.*, p.name AS project_name, u.full_name AS owner_name
    FROM opportunities o
    JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
    LEFT JOIN users u ON u.id = o.owner_user_id
    WHERE o.tenant_id = ? AND o.id = ?
  `, [tenantId, id]);
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const items = await all(context.env.DB, `
      SELECT o.*, p.name AS project_name, u.full_name AS owner_name
      FROM opportunities o
      JOIN projects p ON p.id = o.project_id AND p.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.tenant_id = ?
      ORDER BY CASE o.stage WHEN 'NEGOTIATION' THEN 1 WHEN 'PROPOSAL' THEN 2 WHEN 'QUALIFIED' THEN 3 ELSE 4 END,
               COALESCE(o.expected_close_date, '9999-12-31') ASC, o.updated_at DESC
    `, [tenantId]);
    return json({ items, total: items.length });
  } catch (cause) {
    console.error('Opportunities GET error', cause);
    return error(cause.message || 'Opportunities could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Opportunity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const projectId = text(body.projectId, 120);
    const name = text(body.name, 500);
    if (!projectId || !name) return error('Project and opportunity name are required', 422);
    const stage = String(body.stage || 'NEW').toUpperCase();
    if (!STAGES.has(stage)) return error('Invalid opportunity stage', 422);
    const probability = Math.min(Math.max(Number(body.probabilityPercentage || 10), 0), 100);
    if (!context.env.DB) return json({ id: makeId('opp'), created: true, demo: true }, 201);

    const project = await first(context.env.DB, 'SELECT id FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, projectId]);
    if (!project) return error('Project not found in this workspace', 404);

    const id = makeId('opp');
    const historyId = makeId('osh');
    const auditId = makeId('aud');
    const now = nowIso();
    const estimatedValue = Number(body.estimatedValue || 0);
    const currency = text(body.currency, 10) || 'USD';
    const statements = [
      {
        sql: `
          INSERT INTO opportunities (
            id, tenant_id, project_id, name, service_type, description, owner_user_id,
            stage, estimated_value, currency, estimated_value_base_currency,
            probability_percentage, expected_close_date, next_action, next_follow_up_at,
            created_at, updated_at, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        bindings: [
          id, tenantId, projectId, name, text(body.serviceType, 300), text(body.description, 10000),
          auth.userId, stage, estimatedValue, currency, estimatedValue, probability,
          text(body.expectedCloseDate, 30), text(body.nextAction, 2000), text(body.nextFollowUpAt, 100),
          now, now, auth.userId, auth.userId,
        ],
      },
      {
        sql: `INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, previous_stage, new_stage, changed_by, changed_at, notes) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Opportunity created')`,
        bindings: [historyId, tenantId, id, stage, auth.userId, now],
      },
    ];

    if (!['WON','LOST','ON_HOLD'].includes(stage)) {
      statements.push({
        sql: `UPDATE projects SET lifecycle_status = CASE WHEN lifecycle_status = 'LEAD' THEN 'ACTIVE_OPPORTUNITY' ELSE lifecycle_status END, updated_at = ?, updated_by = ? WHERE tenant_id = ? AND id = ?`,
        bindings: [now, auth.userId, tenantId, projectId],
      });
    }

    statements.push({
      sql: `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at) VALUES (?, ?, ?, 'OPPORTUNITY_CREATED', 'OPPORTUNITY', ?, ?, ?)`,
      bindings: [auditId, tenantId, auth.userId, id, JSON.stringify({ projectId, name, stage }), now],
    });

    await executeWriteBatch(context.env.DB, statements);

    const item = await savedOpportunity(context.env.DB, tenantId, id);
    if (!item) {
      throw persistenceError('Opportunity was not confirmed in the CRM database. Nothing was reported as created; please retry once.');
    }

    return json({ id, created: true, item }, 201);
  } catch (cause) {
    console.error('Opportunities POST error', cause);
    return error(cause.message || 'Opportunity could not be created', Number(cause.status || 500));
  }
}
