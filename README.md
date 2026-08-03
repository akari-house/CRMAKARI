# AKARI CRM

AKARI CRM is a tenant-isolated operating system for business development, CRM, marketing delivery, fundraising operations, governed relationship intelligence and revenue operations.

AKARI House is Customer 001 and the first active production tenant. Future customers must receive separate workspaces and must never see AKARI House or another customer's records.

Read the active [Backend Technical Paper](docs/BACKEND_TECHNICAL_PAPER.md) for the platform boundary, Fundraising OS 2.0 architecture, migration strategy and production controls.

## Repository safety

This repository is public. Never commit:

- lead exports or raw CRM imports
- personal contact data
- customer records
- financial records or payment references
- Cloudflare credentials, API tokens or secrets
- production database dumps

Private imports must be uploaded through the controlled import workflow and written directly to the correct tenant after preview and approval.

## Current production architecture

- Cloudflare Pages project: `crmakari`
- CRM domain: `crm.akarihouse.com`
- Temporary Pages domain: `crmakari.pages.dev`
- Cloudflare Pages Functions API
- Cloudflare D1 production database
- Cloudflare Access with approved-email OTP login
- tenant membership and role validation inside CRM middleware
- one canonical CRM renderer and one canonical business database

The public `akarihouse.com` product is separate and must not be modified by this repository.

## Current implementation

Production foundation:

- responsive protected AKARI CRM application shell and PWA
- tenant-aware protected routes and Cloudflare Access membership middleware
- 895 imported AKARI relationship records and controlled lead-import diagnostics
- dashboard, leads, contacts, opportunities, tasks, campaigns, partners, finance, reports, team and settings
- governed proposal, invoice, partial/full payment and referral lifecycle
- service engagement onboarding, milestones, deliverables, creator operations, reporting, completion and renewal
- Founder Capital Rooms, investor pipeline, data-room controls, diligence, commitments, closing and investor relations
- production-readiness checks, controlled sign-off and tenant backup export
- role, finance and tenant-isolation regression coverage

Fundraising OS 2.0 begins with a normalized investor-intelligence backend and a compatibility layer for existing Capital Rooms. Until migration `0002_fundraising_intelligence.sql` is applied, the new intelligence endpoint remains read-only and projects existing Capital Room data without changing it.

## Local development

Requirements:

- Node.js 20+
- Cloudflare Wrangler

```bash
npm install
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
npm run validate
npm run dev
```

`AUTH_MODE=demo` is for local development only. Production uses Cloudflare Access and the active tenant membership stored in D1.

## Database safety

Migration `0001_core.sql` is applied in production.

Migration `0002_fundraising_intelligence.sql` is non-destructive and creates normalized fundraising tables only. It must be applied through the controlled production migration procedure after a tenant backup and preview validation. Pages deployment does not automatically convert legacy Capital Room records.

Do not run `db/seed.sql` against production. It is local demonstration data only.

Before any new migration:

1. explain the schema change
2. review tenant isolation and rollback impact
3. download a current tenant backup
4. validate locally and on a sanitized preview database
5. confirm the Cloudflare token has the required D1 permission
6. obtain approval before production execution
7. verify record counts and audit the result

## Controlled lead import workflow

The required flow is:

```text
inspect → map → validate → deduplicate → dry-run preview → approve → import → audit → rollback if required
```

No uploaded lead file should be imported automatically.

## Fundraising intelligence compatibility

Protected endpoint:

```text
GET /api/fundraising/intelligence
POST /api/fundraising/intelligence
```

GET returns normalized D1 data after migration 0002. Before migration, it returns a read-only `LEGACY_COMPATIBILITY` projection from existing tenant-scoped Capital Rooms.

POST is restricted to Owner, Admin and BD Manager and fails closed with HTTP 503 until migration 0002 is available.

No investor dataset from third-party repositories is committed or redistributed through AKARI.

## Deployment

```bash
npm run validate
npm run deploy
```

The deploy command targets the existing Cloudflare Pages project `crmakari`.

DNS, Cloudflare Access policy and D1 migrations are separate production controls and must not be changed implicitly by an application release.

## Next build order

1. Apply and verify migration 0002 through the controlled D1 procedure
2. Build the Investor Universe and evidence-led investor profiles
3. Add source-review, duplicate and portfolio-conflict queues
4. Add explainable target matching and focused lists
5. Add warm-introduction path research and consent controls
6. Add disclosure-aware outreach drafts and meeting briefs
7. Migrate existing commitments and closing records after acceptance
8. Add Gmail, Outlook and calendar providers only after messaging governance is complete
