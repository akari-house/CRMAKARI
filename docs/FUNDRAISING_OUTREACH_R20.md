# Release 6.2D — Controlled Fundraising Outreach and Meetings

Release 6.2D adds the tenant-scoped `/api/fundraising/outreach` execution layer to the AKARI Fundraising workspace.

## Dual AI providers

Outreach drafting can use either **OpenAI/ChatGPT** models or **Anthropic/Claude** through AKARI’s governed provider gateway. AI output is always a proposal. It does not approve, export, send, mutate investor records or bypass permissions.

Provider credentials remain server-side secrets. The activity record stores only safe provider metadata such as provider, model, request reference and fallback state.

## Exact-content approval

A draft records the exact recipient, channel, subject, body, purpose and disclosure policy. Any content change invalidates prior approval.

Both founder approval and AKARI approval must match the current content hash before export or a recorded **manual send**. AKARI does not dispatch outreach automatically.

Internal-only material cannot be used in outreach. Diligence-only material is restricted to diligence responses.

## Meetings and follow-up

An investor meeting records its owner, date, duration, timezone, secure meeting link, agenda and **meeting brief**. Completion requires notes, outcome and next steps.

Replies, meetings and follow-up actions are written to the tenant-scoped **activity ledger**. Follow-up work creates a linked Work OS task and blocks duplicate open tasks by default.

Every target, project, member, activity and task lookup is restricted to the authenticated tenant. Sensitive message bodies and meeting notes are redacted or hashed in general audit records.
