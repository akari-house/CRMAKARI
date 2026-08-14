# R74 — Reporting + Attention Engine

## Purpose
R74 consolidates operational reporting and attention without creating a second task system or duplicating canonical CRM data.

## Operating model
Canonical records remain in Projects, Opportunities, Campaigns, Payments, Agreements, Fundraising, Data Room and Relationship Intelligence. R74 derives attention from those sources, persists only the attention workflow state, and writes immutable report snapshots when a user explicitly saves a report.

## Attention sources
- Project follow-up overdue
- Opportunity follow-up overdue
- Opportunity close approaching
- Payment overdue
- Referral settlement due
- Campaign report overdue
- Campaign settlement pending
- Campaign deliverable overdue
- Agreement renewal / expiry approaching
- Investor follow-up due
- Diligence due
- Required Data Room evidence missing

## Attention lifecycle
`OPEN → ACKNOWLEDGED → SNOOZED / RESOLVED / DISMISSED`

Resolved source conditions are automatically closed on refresh. If the source becomes actionable again, the attention item is reopened rather than duplicated.

## Reports
- Founder Weekly
- Client
- Campaign
- Fundraising
- Investor Update
- Revenue
- Management

Reports are generated from canonical records. A saved snapshot is audit evidence, not a new source of truth.

## Permissions
- Founder/Client portal collaborators cannot access R74.
- Viewer cannot mutate attention or save report snapshots.
- Personal attention is scoped to the authenticated tenant and owner.
- Team attention requires Owner, Admin or BD Manager.
- Non-managers cannot change another member's assigned attention item.
- Revenue and Management reports require finance access.
- Payment/referral financial attention is hidden from non-finance users.

## UI
R74 extends the canonical My Day screen above Work OS. It does not create another dashboard or task board.

## Deployment
Migration `0007_reporting_attention.sql` must be applied after R73 migration `0006_relationship_intelligence.sql`.

The production Cloudflare workflow applies and verifies migrations 0003 through 0007 sequentially before Pages deployment. Deployment remains blocked until the configured Cloudflare credential/account can query production D1 without error 7403.

## Acceptance
R74 is complete when:
1. Tenant/security tests pass.
2. `npm run validate` includes and passes the R74 validator.
3. My Day loads personal attention and manager team scope correctly.
4. All seven reports generate from canonical data.
5. Report snapshots are auditable.
6. Production D1 migration 0007 is applied and verified before Pages deployment.
