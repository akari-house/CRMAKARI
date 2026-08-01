# Revenue Lifecycle M2

## Product objective

AKARI CRM uses one continuous governed lifecycle:

```text
Qualified lead
→ Opportunity
→ Proposal
→ Negotiation
→ Won / Lost
→ Client conversion
→ Service engagement
→ Invoice
→ Payment
→ Referral reward
```

This milestone does not introduce a second CRM shell or a production database migration. It uses the existing tenant-owned `projects`, `opportunities`, `activities`, `campaigns`, `payments`, `referrals`, `partners` and `audit_logs` records.

## Team workstreams

- Lifecycle engineering: qualification, proposal versions, negotiation rounds, close controls and client conversion.
- Revenue engineering: engagement economics, invoice allocation, payment receipts and referral payout state.
- Product and UI design: a single opportunity lifecycle workspace, compact stage stepper, contextual actions and finance-safe visibility.
- QA and security: tenant scoping, role checks, audit history, mobile layout and end-to-end browser coverage.

## Lifecycle rules

### Qualified lead and opportunity

An opportunity can only be marked qualified after confirming:

- business need
- decision-maker or approval path
- buying or start timeline
- usable budget status

### Proposal

Proposals are recorded as versioned opportunity activities. Every version preserves scope, deliverables, value, commercial model, timeline, terms, validity and follow-up.

A sent proposal requires a complete qualification checklist.

### Negotiation

Each negotiation round records the current offer, requested changes, agreed terms, commercial risk, expected decision date and next action.

`AGREED_IN_PRINCIPLE` moves the opportunity to verbal confirmation. Other active rounds use negotiation.

### Won

A won opportunity:

- becomes 100% probability
- converts the project relationship to `CLIENT`
- records `customer_since`
- creates a service engagement in onboarding
- carries final contract value and delivery costs
- calculates margin, AKARI net revenue and referral reward
- creates a confirmed referral reward when a referral partner applies

### Lost

A lost opportunity requires a reason. Competitor or chosen alternative and additional learning are optional. When no other active opportunity remains, an active-opportunity relationship returns to prospect.

### Service engagement

The engagement is the operational and commercial bridge between a won opportunity and invoicing. It stores service type, commercial model, dates, deliverables, status, costs, referral terms and next action.

### Invoice and payment

Invoices can be issued contextually from an engagement. Payments are separate receipt records allocated against an invoice.

- no receipt: invoiced
- some receipt: partially paid
- full receipt: paid

Receipt totals synchronize the connected engagement's invoiced, received and payment status values.

### Referral reward

Referral reward basis is engagement revenue minus campaign, creator and other direct costs.

```text
Revenue basis = Gross revenue - Direct costs
Referral reward = Revenue basis × Referral percentage
AKARI net = Revenue basis - Referral reward
```

A confirmed reward becomes `DUE` when the connected invoice is fully paid. Recording a payout requires a transaction or bank reference and changes the reward to `PAID`.

## Permission model

- Owner, Admin, BD Manager and BD Member: qualification, proposal and negotiation.
- Owner, Admin and BD Manager: won/lost closure and engagement management.
- Finance-authorised users: invoices, client receipts, commercial engagement values and referral payouts.
- Every project, contact, partner, opportunity, engagement, invoice, receipt and referral lookup is scoped by the authenticated tenant.

## Google Calendar boundary

Meeting records remain prepared for future Google Calendar synchronization. This revenue milestone does not claim or simulate external calendar event creation.
