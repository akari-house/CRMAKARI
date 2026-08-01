# Release 4 — Campaign and Service Delivery

## Product purpose

This release carries won commercial work through operational delivery:

```text
Won opportunity
→ Client onboarding
→ Planning
→ Creator selection
→ Live delivery
→ Reporting
→ Completion
→ Renewal / upsell opportunity
```

It extends the existing tenant-owned `campaigns`, `tasks`, `opportunities`, `tenant_settings` and `audit_logs` records. It does not create another CRM shell, another campaign database or a public client portal.

## Delivery workspace

Every campaign or service engagement has one operational workspace containing:

- delivery stage, owner, service type, start date, target completion date and next action;
- onboarding checklist with owners, deadlines, required/optional state and My Day tasks;
- milestones with dependencies, internal notes, client-visible notes and evidence;
- deliverables with drafts, approvals, published links and performance metrics;
- creator participation, required content, submitted links and payment status;
- client report, completion record and renewal opportunity reference;
- finance-controlled profitability values from the existing engagement record.

Delivery metadata is versioned inside the existing campaign `notes` JSON under `serviceDelivery`. Existing engagement metadata remains preserved.

## Service templates

The release includes built-in templates for:

- Creator campaign
- GTM strategy
- X Spaces campaign
- Advisory retainer
- Fundraising support
- Community growth
- Exchange / launch campaign

Owners, Admins and BD Managers may also create tenant-owned templates. Applying a template generates onboarding, milestone and deliverable records and creates the connected My Day tasks.

## Lifecycle controls

The canonical delivery stages remain:

- `CONFIRMED`
- `ONBOARDING`
- `PLANNING`
- `CREATOR_SELECTION`
- `LIVE`
- `REPORTING`
- `COMPLETED`
- `PAUSED`
- `CANCELLED`

Completion is blocked until all required onboarding items, milestones and deliverables are resolved and the final client report is complete and internally approved.

## Creator operations

Creator records support:

- shortlist, invitation, confirmation, active delivery, submission and approval states;
- platform and handle;
- required post quantity;
- submitted content links;
- reward amount, currency and payment state for finance-authorised users;
- internal campaign notes.

Creator records remain inside the client engagement. This release does not create a public creator portal or automatic creator payout system.

## Reporting and renewal

The authenticated client report includes work completed, milestones, deliverables, published links, creator participation, performance, recommendations and a finance summary when the viewer has finance access. It is private, not cached and can be printed or saved as PDF in the browser.

Completed engagements can create one renewal or upsell opportunity on the existing project relationship. No duplicate project is created.

## Permissions and isolation

- Owner, Admin, BD Manager and BD Member: operational delivery updates.
- Owner, Admin and BD Manager: template application, completion and renewal creation.
- Finance-authorised users: contract value, delivery costs, creator rewards and profitability.
- Every campaign, owner, task, opportunity, template and report lookup is tenant scoped.
- Every material delivery change produces an audit record.
- No production schema migration is introduced.
- No customer data, exports, tokens or secrets are committed to GitHub.

## Release validation

Before production deployment:

- source validation passes;
- all tenant-isolation tests pass;
- service owner and finance boundaries are tested;
- completion blockers are tested;
- Campaigns command centre and delivery workspace pass in Chromium;
- nested delivery forms preserve the workspace;
- mobile pages and the full-screen workspace have no page-level horizontal overflow;
- Cloudflare deployment targets only project `crmakari`;
- `crm.akarihouse.com` protected smoke checks pass;
- `akarihouse.com` remains unchanged.
