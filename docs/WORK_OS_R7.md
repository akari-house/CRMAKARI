# AKARI Work OS — Tasks, Calendar and Workflow Starters

## Purpose

This release turns the existing My Day board into a connected team execution layer without introducing a second CRM renderer or a new database schema.

It uses the existing tenant-owned `tasks`, `projects`, `contacts`, `opportunities`, `campaigns`, `payments`, `tenant_memberships`, `tenant_settings` and `audit_logs` records.

## My Day

My Day gains:

- fast task creation;
- Board, List, Calendar and Agenda views;
- team or personal scope;
- project, owner and workstream filters;
- editable task owner, due date, priority, status, project, opportunity and campaign relations;
- recurrence-rule storage;
- drag-and-drop status changes;
- drag-to-reschedule in the calendar;
- clear overdue, due-today and waiting counts.

Task relations are validated server-side. A contact, opportunity or campaign cannot be attached to a task from another tenant or an unrelated project.

## Connected calendar

The calendar combines:

- task deadlines;
- project follow-ups;
- opportunity follow-ups and expected close dates;
- campaign start, target-completion and reporting dates;
- payment due dates for finance-authorised users;
- fundraising target closes, investor follow-ups and diligence deadlines.

This is the internal AKARI calendar. Google Calendar sync remains a later integration release requiring per-user authorisation, secure token storage and explicit audit controls.

## Partnership activation

A won opportunity without an existing activation plan appears as a workflow starter.

Starting the template creates linked tasks for:

1. partnership scope confirmation;
2. partner brand assets and links;
3. announcement copy and quotes;
4. announcement graphics;
5. internal review;
6. partner approval;
7. channel and launch-date confirmation;
8. scheduling;
9. publishing and link capture;
10. engagement follow-up;
11. the next joint activation.

The relationship owner, marketing/content owner and design owner are selected before creation. All generated tasks remain related to the existing project, won opportunity and delivery engagement.

## Fundraising work plan

An active Capital Room without a work plan can create linked tasks for:

- mandate and round brief;
- readiness gaps;
- secure data-room index;
- pitch narrative and outreach messages;
- pitch-design review;
- investor target list;
- founder approval for targets and introductions;
- approved outreach;
- investor follow-up and reporting cadence.

The current Capital Room storage remains in tenant feature flags. This release reads that source and creates tenant-owned tasks; it does not migrate fundraising records. The later relational fundraising migration remains required before broad external-customer scale.

## Permissions and security

- Owner, Admin, BD Manager, BD Member and Finance roles can create and update tasks.
- Viewer cannot mutate tasks.
- Owner, Admin and BD Manager can start workflow templates.
- Task owners must be active members of the same tenant.
- Every task relation is tenant validated.
- Finance calendar events are returned only to users with finance access.
- Every task mutation and workflow-template start creates an audit record.
- No production schema migration is required.

## Known controlled limitations

- Workstream is encoded through the existing task activity-type field until a dedicated task metadata migration is approved.
- Recurrence rules are stored but automatic future-task generation is not enabled yet.
- Same-column manual task ordering is not persisted yet.
- Google Calendar, Gmail, comments, attachments, mentions and notifications remain separate controlled releases.
