# Release 3 — Proposal, Invoice and Payment Hardening

## Product purpose

This release turns the existing qualified-opportunity revenue lifecycle into a reliable commercial operating workflow:

```text
Opportunity
→ Proposal draft
→ Internal review
→ Approval
→ Sent / accepted / rejected / expired
→ Service engagement
→ Draft or issued invoice
→ Partial / full collection
→ Credit or cancellation control
→ Referral settlement
```

It extends the canonical AKARI CRM renderer and the existing tenant-owned opportunity, activity, payment, campaign, task, referral and tenant-settings records. It does not create a second CRM shell or a parallel finance database.

## Proposal controls

Proposal versions remain immutable commercial history in tenant-scoped opportunity activities.

Supported states:

- `DRAFT`
- `INTERNAL_REVIEW`
- `APPROVED`
- `SENT`
- `ACCEPTED`
- `REJECTED`
- `EXPIRED`
- `SUPERSEDED`

Owner, Admin and BD Manager roles approve, send and record final client decisions. BD Members may prepare drafts and submit them for internal review but cannot self-approve.

Reusable proposal templates are stored inside tenant settings and contain scope, deliverables, timeline, payment terms, assumptions, service type and commercial model. Templates never cross tenant boundaries.

An accepted proposal moves the opportunity to verbal confirmation. It does not silently mark the deal won; the controlled won workflow remains responsible for client conversion and engagement creation.

## Proposal documents

Each proposal has an authenticated, print-ready document view. The user can print it or use the browser’s **Save as PDF** function.

This release does not introduce server-side binary PDF storage or automatic email delivery. Gmail delivery belongs to Release 5 after OAuth, consent, audit and secure-token storage are implemented.

## Invoice controls

Invoices support:

- sequential tenant invoice numbers;
- draft and issued states;
- multiple line items;
- tax rate and explanation;
- client and issuer billing identity;
- optional payment milestones whose amounts must reconcile exactly to the invoice total;
- print-ready invoice documents;
- issue, cancel, credit-note and reminder actions;
- partial and full receipt allocation;
- paid, overdue, partially credited and fully credited balances;
- connected engagement finance synchronisation.

Cancellation requires a reason and is blocked after a receipt or credit note exists. Credit notes are recorded separately and cannot exceed the remaining invoice value available for credit.

## Collections and reconciliation

Receipts are separate tenant-owned payment records allocated to one invoice reference. A receipt cannot exceed the invoice balance after previous receipts and credit notes.

The commercial command centre shows:

- total invoiced after credit notes;
- total collected;
- outstanding and overdue balances;
- proposal approval queue;
- invoice collection queue;
- referral amounts due;
- invoice-ledger and referral-statement CSV exports.

Finance users can create an audited payment-follow-up task in My Day instead of claiming that reminders were emailed automatically.

## Referral settlement

Referral rewards continue to derive from the connected engagement economics. When the client invoice is fully settled after receipts and credits, eligible referral records become due according to the configured due interval. Recording a payout still requires a transaction or bank reference.

## Permissions and security

- Proposal drafting: Owner, Admin, BD Manager and BD Member.
- Proposal approval, send and final decision: Owner, Admin and BD Manager.
- Invoice, receipt, credit-note, export and collection actions: finance-authorised users only.
- Every proposal, invoice, project, opportunity, engagement, receipt, credit note, task and referral lookup is tenant scoped.
- Commercial changes produce audit records.
- Print-ready document responses are authenticated, private and not cached.
- No production schema migration is introduced.
- No real CRM data, exports, tokens or secrets are committed to GitHub.

## User interface

Release 3 adds a compact AKARI commercial command centre to Finance and a commercial-control section to the existing revenue lifecycle workspace. It reuses current buttons, panels, tables, state pills, responsive behavior and the final AKARI brand layer.

Commercial sub-forms use a separate modal layer so opening a proposal, payment, credit or invoice form never destroys the underlying opportunity lifecycle workspace.

## Validation requirements

Before production deployment:

- source validation passes;
- all tenant-isolation tests pass;
- proposal approval boundaries are tested;
- invoice and credit-note tenant boundaries are tested;
- payment schedules and overpayment protection are tested;
- Finance command-centre interactions pass in Chromium;
- the lifecycle workspace remains open behind commercial sub-forms;
- mobile layout has no page-level horizontal overflow;
- deployment targets only Cloudflare Pages project `crmakari`;
- `crm.akarihouse.com` protected smoke checks pass;
- `akarihouse.com` remains unchanged.
