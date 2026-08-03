# Release 6.2C — Investor Targeting and Warm Introductions

Release 6.2C adds the tenant-scoped `/api/fundraising/targeting` execution layer to the AKARI Fundraising workspace.

## Targeting model

AKARI keeps its private **expected cheque** separate from **published cheque evidence**. Published cheque ranges remain evidence-backed investor claims. Expected cheque, probability and priority remain private round-planning values.

The governed target lifecycle is:

`RESEARCHING → READY → INTRO_REQUESTED / CONTACTED → MEETING → DILIGENCE / PARTNER_MEETING → SOFT_CIRCLE → COMMITTED`

Passed and not-now outcomes require reasons. A target cannot move into introduction-requested status without a **verified introduction path** and granted **consent**.

## Warm-path governance

Every introduction path records the target person, proposed connector, relationship owner, relationship strength, supporting evidence or written verification note, consent state, request state and completion outcome.

Verification, consent and request status remain separate controls. AKARI does not infer a warm relationship from social proximity. Final consent decisions require Owner/Admin authority and a written note.

## Execution and follow-up

Focused queues surface overdue work, work due this week, research gaps, consent requirements, introduction-ready investors, high-fit targets without an action, soft circles and commitments.

A governed **follow-up task** is created in Work OS, linked to the founder project and fundraising target. Duplicate open follow-up work is blocked by default.

Before migration 0002, legacy Capital Room targets remain visible in read-only compatibility mode. No migration, automatic outreach, consent mutation or Capital Room conversion runs during deployment.
