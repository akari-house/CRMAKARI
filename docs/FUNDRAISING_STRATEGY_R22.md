# Release 6.2F — Terms, Ownership and Strategic Funding

Release 6.2F completes the remaining manual fundraising work after investor research, outreach, diligence, commitments and closing.

## Manual-first operating mode

This release requires no OpenAI, Anthropic, Kimi or other model provider. It also requires no banking, payment, grant-discovery or cap-table API. All records are entered and reviewed by authorised AKARI workspace members.

AI may later propose summaries through the provider-neutral gateway, but it is not part of this release and cannot approve terms, ownership or funding decisions.

## Term-sheet comparison

Each term sheet is linked to a founder project and fundraising round, with an optional investor target. The workspace records:

- instrument and proposed investment;
- valuation or valuation cap;
- discount, interest and maturity;
- pro-rata and information rights;
- board seat and observer rights;
- liquidation preference and participation;
- anti-dilution provision;
- exclusivity period;
- legal-document URL, notes and decision reason.

AKARI calculates visible risk flags but does not give legal advice. A risk flag never approves or rejects a term sheet. Final approval, rejection or signing is Owner/Admin controlled and requires finance access.

## Lightweight ownership scenarios

Ownership scenarios are planning models, not the legal cap table of record. A scenario records pre-money valuation, new investment, existing and proposed option pools, and stakeholder ownership before the round.

The system calculates:

- post-money valuation;
- new-investor ownership;
- option-pool increase;
- estimated stakeholder ownership after financing;
- dilution for each stakeholder;
- unallocated ownership before and after financing.

Stakeholder ownership before financing cannot exceed 100%. Final scenario approval is Owner/Admin controlled and requires finance access.

## Grants and strategic funding

The strategic-funding pipeline supports:

- grants;
- public funding;
- accelerator programmes;
- ecosystem funding;
- strategic capital and non-dilutive programmes.

Each opportunity records provider, programme, amount, currency, deadline, stage, owner, eligibility or requirements, next action, application URL, document URL and notes.

The lifecycle is:

`RESEARCHING → ELIGIBLE → APPLYING → SUBMITTED → DILIGENCE → AWARDED`

Rejected, declined and closed outcomes are also supported. Final award recognition is Owner/Admin controlled and requires finance access. Follow-up actions create linked Work OS tasks with duplicate-open-work protection.

## Storage and tenancy

Release 6.2F uses the existing tenant-scoped activity ledger:

- `FUNDRAISING_TERM_SHEET`
- `FUNDRAISING_CAP_TABLE_SCENARIO`
- `FUNDRAISING_STRATEGIC_FUNDING`

No production schema migration is required. Every project, round, target, workspace member, activity and task lookup is restricted to the authenticated tenant and audited.

## Safety

- No AI provider or API key is required.
- No legal recommendation is generated.
- No legal cap table is replaced.
- No grant application is submitted automatically.
- No investor message is sent automatically.
- No payment or banking provider is called.
- No production migration runs during deployment.
