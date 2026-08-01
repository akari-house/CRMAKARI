# AKARI CRM — Business Development workflow

## Purpose

The first Business Development workflow turns a tenant-owned relationship record into an actionable operating profile without duplicating the project. It connects qualification, contacts, outreach, meetings, opportunities and invoicing while preserving tenant isolation and referral attribution.

The canonical relationship remains:

`Project → Primary contact → Activity / task → Opportunity → Client lifecycle → Invoice / payment → Referral reward`

A project is updated through its lifecycle. Converting it to a client or partner never creates a duplicate project.

## Organisation qualification

Every relationship may be classified as a project/startup, venture-capital firm, investment fund, exchange, launchpad, protocol, agency, creator network, service provider or other organisation.

Common qualification fields include:

- project/organisation name, category, website, X and Telegram;
- region, source, owner, priority and referral partner;
- primary point of contact, role, email, X, Telegram and preferred channel;
- BD stage, potential AKARI service, next action and follow-up date.

Projects and operating companies can record funding stage, total funding raised, funding currency and latest valuation.

Venture-capital firms and funds can record assets under management, AUM currency, minimum and maximum cheque size and investment thesis/focus.

## Storage model

Version-one structured qualification is stored under `bdProfile` inside the existing tenant-owned project metadata (`projects.legacy_import_data`). Existing imported metadata is preserved. Existing relational fields `funding_status`, `funding_amount` and `valuation` are also kept in sync for source-backed reporting.

This avoids an unvalidated production schema migration during the first operational rollout. A later migration may promote stable fields into dedicated relational columns after the workflow has been used and reviewed.

## Lead creation and editing

The lead form creates or updates:

- the tenant-scoped project;
- an optional tenant-scoped primary contact;
- owner assignment;
- referral/introducer attribution;
- project or investor qualification fields;
- BD stage, next action and next follow-up;
- an audit record.

A saved lead requires X and Telegram. When a primary contact is supplied, the contact requires full name, X and Telegram.

## Outreach and meeting booking

A booked discovery call is recorded as a tenant-scoped `MEETING` activity with outcome `BOOKED`. The booking stores:

- scheduled date and time;
- duration and timezone;
- contact;
- joining link/location;
- agenda and next action;
- optional preparation task.

The project BD stage becomes `MEETING_BOOKED`. The event is marked `PENDING_INTEGRATION` for Google Calendar.

**Current limitation:** this release does not create or update an external Google Calendar event. Google Calendar will be integrated later behind tenant credentials, explicit consent, event ownership, retry/idempotency and audit controls.

## Invoicing bridge

Finance-authorised users can create an invoice from a relationship drawer. Invoice creation uses the existing tenant-scoped invoice API and requires a completed organisation billing profile.

The invoice stores:

- project/client reference;
- recipient billing identity;
- invoice and due dates;
- currency, line item, quantity and unit price;
- tax rate and tax explanation;
- payment instructions and notes;
- audit history.

Invoices remain finance-permission-aware. Creating an invoice does not automatically mark an opportunity won or a project as a client; controlled lifecycle conversion remains a separate business action.

## Security invariants

- Every project, contact, partner, activity, task and invoice is tenant-scoped.
- Owner assignment is limited to active members of the authenticated tenant.
- Referral partners must belong to the authenticated tenant.
- Meeting contact/opportunity/campaign references must belong to the same project and tenant.
- Financial summaries are returned only to finance-authorised users.
- No production relationship data is stored in static assets or repository documentation.

## Next BD milestones

1. Controlled qualification-to-opportunity action with required next step and estimated value.
2. Complete activity outcomes for calls, Telegram, X, email and meetings.
3. Persisted outreach playbooks and enrolment history.
4. Google Calendar connection and audited event sync.
5. Proposal, service engagement and controlled Client/Partner conversion.
6. Full invoice document preview/export and payment collection follow-up.
