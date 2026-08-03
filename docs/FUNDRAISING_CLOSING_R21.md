# Release 6.2E — Commitments, Closing and Investor Relations

Release 6.2E completes the non-AI fundraising execution path after investor meetings and diligence.

## Manual-first operating mode

The entire release works without OpenAI, Anthropic, Kimi or any other external model provider. AI remains an optional proposal layer only. Users can manually create commitments, record allocations and receipts, close a round, publish investor updates and create follow-up work.

A future provider such as Kimi K2.5 may be added through the provider-neutral gateway, but no provider credential or external API is required for this release.

## Commitment lifecycle

The governed commitment lifecycle is:

`SOFT → CONFIRMED → SIGNED → FUNDED`

A commitment may also be `CANCELLED` before funds are received. The system keeps the committed amount, final allocation, funds received, instrument, signed-document reference, dates and notes separate.

Financial invariants:

- allocation cannot exceed commitment;
- funds received cannot exceed allocation;
- received funds are cumulative and require a transaction or bank reference;
- a commitment with received funds cannot be cancelled;
- a funded commitment must be fully reconciled.

## Closing controls

A round cannot close until:

- at least one final commitment exists;
- every active commitment is funded or cancelled;
- all allocated capital is reconciled as received;
- at least one receipt is recorded;
- closing notes are supplied;
- a shortfall reason is supplied when the final raise is below target.

Closing is Owner/Admin controlled and requires finance access. The closing record captures final funds received, target amount, date, notes and any shortfall explanation.

## Funds ledger

Every normalized receipt is written to the tenant-scoped activity ledger with commitment, round, investor, amount, currency, payment rail, reference, timestamp and cumulative received amount. General audit records retain the governed financial change without introducing an external payment provider.

## Investor relations

Investor updates are manual, period-based records with title, summary, KPIs, asks and an optional HTTPS document link. Drafting is available to fundraising managers. Publishing is Owner/Admin controlled. Post-raise follow-up work creates linked Work OS tasks with duplicate-open-work protection.

## Compatibility and migration

Before migration `0002_fundraising_intelligence.sql`, the existing Capital Room commitment and investor-update records remain operational in legacy compatibility mode.

After migration 0002 is applied, the same API reads and writes normalized fundraising rounds and commitments. An Owner/Admin migration preview compares legacy Capital Rooms with normalized rounds before any conversion. Deployment never performs an automatic production conversion.

## Safety

- No AI provider is required.
- No automatic email or investor message is sent.
- No payment or banking API is called.
- No production migration runs during Pages deployment.
- Every round, target, commitment, activity, member and task lookup is tenant scoped.
- Financial actions require finance permission.
