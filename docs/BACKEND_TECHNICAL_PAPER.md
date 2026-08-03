# AKARI CRM Backend Technical Paper

Status: active architecture record  
Last updated: 2026-08-03  
Production tenant: AKARI House (Customer 001)

## 1. Product boundary

AKARI CRM is a hosted, tenant-isolated operating system for business development, relationship management, fundraising, campaign delivery, revenue operations and governed collaboration.

The production runtime is:

- Cloudflare Pages for the public and protected application shell
- Cloudflare Pages Functions for API routes
- Cloudflare D1 for relational tenant data
- Cloudflare Access for authenticated entry
- application-level membership, role and finance permission checks
- a single canonical CRM renderer and one canonical business database

Every business table must carry `tenant_id`, every record lookup must include the authenticated tenant, and every mutation of material business state must create an audit record.

## 2. Fundraising OS 2.0 objective

Fundraising OS 2.0 turns the existing Founder Capital Room into an evidence-backed investor intelligence and fundraising execution system:

```text
Founder readiness
→ round definition
→ investor research
→ explainable matching
→ founder-approved target list
→ warm-introduction research
→ controlled outreach
→ meetings
→ diligence
→ soft circle
→ commitment
→ allocation
→ funds received
→ closing
→ investor relations
```

The design is informed by the public architecture and workflow patterns in Outreachr (`lalalune/outreachr`) without importing its application, bundled investor dataset or desktop-specific security model.

Outreachr is an Electron and local SQLite application. AKARI remains a hosted Cloudflare and D1 platform. We adopt useful domain concepts and safety principles, not its runtime architecture.

## 3. Core design principles

### 3.1 Canonical identities

Investor organisations, funds, people and contact methods are separate entities. A firm-level pipeline record must not replace the identity of the decision-maker or contact person.

A professional email or profile belongs to one canonical person inside one tenant unless an authorised merge resolves a duplicate.

### 3.2 Evidence before assertion

Material investor claims must retain:

- source URL
- publisher
- observation date
- confidence
- status: asserted, verified, stale or disputed
- redistribution rights
- public/private visibility
- reviewer and review date when applicable

Missing data remains unknown. Absence of evidence must not be represented as evidence of absence.

### 3.3 Explainable matching

Investor-fit scoring is a round-specific assessment, not a promise of response or investment probability.

The initial scoring model uses:

| Signal | Maximum |
|---|---:|
| Stage fit | 20 |
| Cheque-size fit | 20 |
| Sector fit | 15 |
| Geography fit | 10 |
| Portfolio relevance | 10 |
| Fund freshness | 10 |
| Lead-investor behaviour | 5 |
| Verified warm path | 5 |
| Evidence confidence | 5 |
| Portfolio conflict adjustment | -20 |

Every score returns component values, positive reasons and warnings. Manual overrides require an authorised user, a reason and an audit event.

### 3.4 Round economics

Published cheque evidence and the founder's private expected cheque are separate values.

The round dashboard calculates:

- target amount
- qualified pipeline
- weighted pipeline
- soft-circled capital
- confirmed commitments
- allocated capital
- funds received
- remaining capital
- coverage ratio

An expected cheque counts toward soft-circled capital only when the target reaches the soft-circle stage. Confirmed capital comes from commitment records, not from investor marketing claims.

### 3.5 Warm introductions are verified workflows

AKARI must never infer that a warm path exists merely because two people appear connected.

An introduction path records:

- target investor organisation and person
- proposed connector
- relationship owner inside AKARI
- relationship strength
- supporting evidence
- last verification date
- permission/consent to approach
- request, acceptance and completion state
- outcome

### 3.6 Human-controlled outreach

The initial hosted implementation is draft-first:

```text
DRAFT
→ FOUNDER_APPROVED
→ AKARI_APPROVED
→ EXPORTED
→ SENT
→ REPLIED / CLOSED
```

AI may propose research, summaries and message drafts. AI must not send a message, grant data-room access, confirm a commitment or close a round.

Provider-based Gmail or Outlook dispatch is a later release and must include exact-content approval, suppression, pacing, sender identity, ambiguity handling and audit controls.

### 3.7 Disclosure-aware knowledge

Fundraising knowledge and documents use one of four policies:

- `INTERNAL`
- `SAFE_FOR_OUTREACH`
- `MEETING_ONLY`
- `DILIGENCE_ONLY`

This policy controls what can appear in message drafts, meeting briefs, diligence responses, agent context and investor-access views.

### 3.8 Provider-neutral AI gateway

AKARI supports both OpenAI models, presented in the product as **OpenAI · ChatGPT models**, and Anthropic models, presented as **Anthropic · Claude models**.

The workspace chooses:

- primary provider
- optional fallback provider
- model identifier for each provider
- allowed proposal purposes
- output-token limit

Provider choice must not change the fundraising workflow, approval states, disclosure rules, audit model or stored business data. All providers operate through one governed proposal-only gateway.

Credentials are Cloudflare secrets only:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Default model identifiers may be supplied through `OPENAI_MODEL` and `ANTHROPIC_MODEL`. Provider credentials must never be stored in D1, returned by an API, entered in a CRM form or committed to the repository.

The AI gateway accepts only explicit governed context supplied by an authorised AKARI workflow. Disclosure policy is enforced before any provider call. Generated content remains a proposal requiring human review.

AI must never directly:

- send a message
- grant data-room access
- change CRM records
- confirm a commitment
- allocate or reconcile funds
- close a fundraising round

Audit records retain provider, model, purpose, disclosure policy, fallback usage, provider request reference and hashes of the input/output. Raw prompts and generated text are not copied into the general audit log.

## 4. Normalized D1 model

Migration `0002_fundraising_intelligence.sql` introduces tenant-scoped tables:

- `fundraising_rounds`
- `investor_organisations`
- `investor_people`
- `investor_contact_methods`
- `investor_sources`
- `investor_claims`
- `investor_portfolio_evidence`
- `fundraising_targets`
- `fundraising_pipeline_events`
- `fundraising_commitments`
- `fundraising_introduction_paths`
- `fundraising_knowledge_items`
- `fundraising_outreach_drafts`

Existing `projects` remain canonical founder/client/company records. An investor organisation may optionally link to a canonical CRM project, but the normalized investor entity stores investor-specific research and identity state.

## 5. Compatibility and migration strategy

Existing Capital Rooms are currently stored in `tenant_settings.feature_flags_json`.

The migration is non-destructive:

1. deploy a compatibility API that can read the legacy Capital Room format;
2. apply normalized tables with no changes to existing records;
3. run an Owner/Admin preview that maps legacy rooms and investor pipeline items;
4. review duplicates and project links;
5. execute an idempotent tenant-scoped conversion;
6. compare round totals and investor counts;
7. switch writes to normalized storage;
8. retain legacy data read-only during an acceptance window;
9. archive the legacy payload only after signed production acceptance.

No automatic conversion may run during a Pages deployment.

## 6. API boundary

### 6.1 Fundraising intelligence

The first normalized API is `/api/fundraising/intelligence`.

GET:

- reads only the authenticated tenant;
- returns normalized rounds, targets, investor organisations, evidence counts and round economics when migration 0002 is available;
- otherwise returns a read-only compatibility projection from existing Capital Rooms;
- never exposes raw D1 errors.

POST is restricted to Owner, Admin and BD Manager and initially supports:

- round creation/update
- investor organisation creation/update
- investor person creation/update
- source and claim creation/update
- round target creation/update
- governed target stage movement

Finance-sensitive commitments, allocation, funds received and closing continue to require finance access.

### 6.2 AI provider controls

`GET /api/ai/providers` returns the tenant's public provider configuration, model identifiers and provider readiness without exposing secrets.

`POST /api/ai/providers` is restricted to Owner and Admin. It updates the tenant's provider choice, fallback policy, model identifiers, enabled purposes and output limit. The endpoint rejects any submitted API-key field.

`POST /api/ai/propose` is restricted to Owner, Admin and BD Manager. It:

- validates purpose and disclosure policy
- calls the configured primary provider
- uses the configured fallback only for provider availability, rate-limit or server failures
- returns proposal text with `approvalRequired: true`
- records metadata and content hashes in the audit log
- does not mutate fundraising or CRM records

## 7. Audit and security

Every mutation must record:

- tenant
- actor
- action
- entity type and ID
- before and after state
- timestamp

Required security invariants:

- tenant scope in every read and write
- active membership validation for assigned owners
- project/contact/entity references validated inside the same tenant
- no cross-tenant canonical-person or investor merges
- no raw provider credentials in D1
- no investor research dataset committed to this public repository
- no automatic redistribution of third-party investor facts
- no AI direct-send or direct-closing capability

## 8. Data rights

Outreachr's first-party code is Apache-2.0, but its investor research data retains source-specific rights. AKARI does not import or redistribute that bundled dataset.

AKARI stores source-specific rights and redistribution status for each investor source and claim. Public-data export must use an explicit allowlist and exclude private contacts, pipeline state, messages, notes, meetings, diligence, commitments and audit history.

## 9. Delivery sequence

### Release 6.2A — normalized backend foundation

- migration 0002
- compatibility read layer
- explainable fit assessment
- round economics
- tenant and permission tests
- backend technical paper

### Release 6.2A.1 — dual AI provider gateway

- OpenAI and Anthropic provider choices
- optional provider fallback
- Cloudflare-secret credential boundary
- tenant-scoped provider settings
- disclosure-aware proposal endpoint
- metadata-only AI audit records
- Settings interface and mobile acceptance

### Release 6.2B — Investor Universe

- investor organisation and person interface
- evidence ledger
- source-review queue
- portfolio evidence and conflict review
- duplicate detection and merge review

### Release 6.2C — Targeting and introductions

- visual pipeline
- focused lists
- expected cheque handling
- introduction-path research and consent
- task generation and reminders

### Release 6.2D — controlled outreach and meetings

- disclosure-aware draft generation
- founder and AKARI approval
- manual-send record
- meeting briefs, notes and outcomes
- follow-up work

### Release 6.2E — commitments and closing migration

- migrate existing commitments and investor-relations records
- allocation and funds reconciliation
- closing controls
- post-raise updates

## 10. Production migration rule

Code deployment and D1 migration are separate controls.

Before applying migration 0002 remotely:

1. download and store a current tenant backup;
2. validate migration on a sanitized D1 copy;
3. confirm the Cloudflare token has D1 edit permission;
4. run `npm run db:migrate:remote`;
5. verify the migration table and new schema;
6. run the compatibility and tenant-isolation checks;
7. record the migration in the release log.

The application must continue operating in legacy compatibility mode until these checks pass.
