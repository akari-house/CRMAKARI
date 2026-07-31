# AKARI CRM

AKARI CRM is a tenant-isolated operating system for business development, CRM, marketing delivery, fundraising operations, governed relationship intelligence and revenue operations.

AKARI House is Customer 001 and the first active production tenant. Future customers must receive separate workspaces and must never see AKARI House or another customer's records.

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
- Private CRM domain: `crm.akarihouse.com`
- Temporary Pages domain: `crmakari.pages.dev`
- Cloudflare Pages Functions API
- Cloudflare D1 production database
- Cloudflare Access with approved-email OTP login
- Tenant membership validation inside the CRM middleware

The public `akarihouse.com` product is separate and must not be modified by this repository.

## Current implementation

Working foundation:

- responsive AKARI CRM application shell and PWA
- Cloudflare Access-aware tenant membership middleware
- tenant-scoped D1 schema
- dashboard, projects, contacts, opportunities, tasks, campaigns, partners, payments and reports API routes
- live frontend hydration for dashboard, projects, tasks and opportunity pipeline
- finance-field filtering by permission
- local standalone preview mode

The production database is intentionally mostly empty. The live UI must show accurate zero/empty states rather than sample commercial results.

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

Migration `0001_core.sql` is already applied in production.

Do not run `db/seed.sql` against production. It is local demonstration data only.

Before any new migration:

1. explain the schema change
2. review tenant isolation and rollback impact
3. validate locally
4. apply to a sanitized preview environment
5. obtain approval before production execution

## Controlled lead import workflow

The required flow is:

```text
inspect → map → validate → deduplicate → dry-run preview → approve → import → audit → rollback if required
```

The import system must include:

- column inspection and sensitive-field review
- explicit field mapping
- required-field validation
- duplicate detection using project name, domain, X profile, email and Telegram
- transaction-based writes
- import batch records and row-level results
- audit logging
- rollback for the imported batch

No uploaded lead file should be imported automatically.

## Deployment

```bash
npm run validate
npm run deploy
```

The deploy command targets the existing Cloudflare Pages project `crmakari`.

DNS, Access policy and the public AKARI House deployment must not be changed without explicit approval.

## Next build order

1. Complete live D1 read/write forms for the current CRM modules
2. Build the controlled CSV/XLSX import workflow
3. Add tenant, user, role and invitation administration
4. Add plans and feature entitlements
5. Build the public waitlist separately from the protected CRM
6. Add fundraising mandates, investors, diligence and founder workspace
7. Add governed central intelligence access
8. Add payment integration only after the approval and entitlement model is stable
