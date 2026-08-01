import { json, error, readJson } from '../../lib/response.js';
import { first, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { buildBdProfile } from '../../lib/bd-profile.js';

const WRITE_ROLES = new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const text = (value, max = 10000) => value === null || value === undefined ? null : (String(value).trim().slice(0, max) || null);

async function validateReference(db, table, tenantId, id, projectId) {
  if (!id) return true;
  const row = await first(db, `SELECT id FROM ${table} WHERE tenant_id = ? AND id = ? AND project_id = ?`, [tenantId, id, projectId]);
  return Boolean(row);
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    if (!WRITE_ROLES.has(auth?.role)) return error('Activity write permission is required', 403);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const projectId = text(body.projectId, 120);
    const subject = text(body.subject, 1000);
    const activityType = String(text(body.activityType, 100) || 'INTERNAL_NOTE').toUpperCase();
    if (!projectId || !subject) return error('Project and subject are required', 422);
    if (!context.env.DB) return json({ id: makeId('act'), created: true, demo: true }, 201);

    const project = await first(context.env.DB, 'SELECT * FROM projects WHERE tenant_id = ? AND id = ?', [tenantId, projectId]);
    if (!project) return error('Project not found', 404);
    const contactId = text(body.contactId, 120);
    const opportunityId = text(body.opportunityId, 120);
    const campaignId = text(body.campaignId, 120);
    if (!await validateReference(context.env.DB, 'contacts', tenantId, contactId, projectId)) return error('Contact does not belong to this project and workspace', 422);
    if (!await validateReference(context.env.DB, 'opportunities', tenantId, opportunityId, projectId)) return error('Opportunity does not belong to this project and workspace', 422);
    if (!await validateReference(context.env.DB, 'campaigns', tenantId, campaignId, projectId)) return error('Campaign does not belong to this project and workspace', 422);

    const meetingScheduledAt = text(body.meetingScheduledAt, 100);
    const isBookedMeeting = activityType === 'MEETING' && String(body.outcome || '').toUpperCase() === 'BOOKED';
    if (isBookedMeeting && !meetingScheduledAt) return error('Meeting date and time are required', 422);

    const id = makeId('act');
    const now = nowIso();
    const nextFollowUpAt = meetingScheduledAt || text(body.followUpAt, 100);
    const statements = [];
    statements.push(context.env.DB.prepare(`
      INSERT INTO activities (
        id,tenant_id,project_id,contact_id,opportunity_id,campaign_id,user_id,activity_type,
        subject,description,outcome,occurred_at,next_action,follow_up_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,tenantId,projectId,contactId,opportunityId,campaignId,auth.userId,activityType,
      subject,text(body.description,10000),text(body.outcome,2000),now,text(body.nextAction,2000),nextFollowUpAt,now
    ));

    let meetingProfile = null;
    if (isBookedMeeting) {
      const bd = buildBdProfile(project.legacy_import_data, {
        bdStage: 'MEETING_BOOKED',
        nextAction: text(body.nextAction, 2000) || 'Attend discovery call',
        meetingStatus: 'BOOKED',
        meetingScheduledAt,
        meetingDurationMinutes: body.meetingDurationMinutes || 30,
        meetingTimezone: body.meetingTimezone || 'Europe/Berlin',
        meetingLocationUrl: body.meetingLocationUrl,
        calendarProvider: body.calendarProvider || 'GOOGLE',
        calendarSyncStatus: 'PENDING_INTEGRATION',
      }, project);
      meetingProfile = bd.profile.meeting;
      statements.push(context.env.DB.prepare(`
        UPDATE projects SET last_activity_at=?,next_follow_up_at=?,legacy_import_data=?,updated_at=?,updated_by=?
        WHERE tenant_id=? AND id=?
      `).bind(now,meetingScheduledAt,bd.serialized,now,auth.userId,tenantId,projectId));
      if (body.createPreparationTask !== false) {
        statements.push(context.env.DB.prepare(`
          INSERT INTO tasks (
            id,tenant_id,title,description,owner_user_id,created_by,status,priority,due_at,project_id,
            contact_id,opportunity_id,activity_type,show_on_home,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,'TODO','HIGH',?,?,?,?,'MEETING_PREPARATION',1,?,?)
        `).bind(
          makeId('tsk'),tenantId,`Prepare for ${project.name} discovery call`,
          text(body.preparationNotes,5000)||'Review the relationship profile, objectives, decision-makers and agreed agenda before the call.',
          auth.userId,auth.userId,meetingScheduledAt,projectId,contactId,opportunityId,now,now
        ));
      }
    } else {
      statements.push(context.env.DB.prepare(`
        UPDATE projects SET last_activity_at=?,next_follow_up_at=COALESCE(?,next_follow_up_at),updated_at=?,updated_by=?
        WHERE tenant_id=? AND id=?
      `).bind(now,nextFollowUpAt,now,auth.userId,tenantId,projectId));
    }

    statements.push(context.env.DB.prepare(`
      INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,after_data,created_at)
      VALUES (?,?,?,'ACTIVITY_RECORDED','ACTIVITY',?,?,?)
    `).bind(makeId('aud'),tenantId,auth.userId,id,JSON.stringify({ projectId, activityType, outcome: body.outcome || null, meetingScheduledAt }),now));
    await context.env.DB.batch(statements);
    return json({ id, created: true, meeting: meetingProfile, calendarSync: meetingProfile?.syncStatus || null }, 201);
  } catch (cause) {
    console.error('Activity create error', cause);
    return error(cause.message || 'Activity could not be recorded', Number(cause.status || 500));
  }
}
