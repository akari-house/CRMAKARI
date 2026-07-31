# AKARI CRM

AKARI CRM is a Business Development, Campaign Management and Revenue Operations platform. **AKARI House is Customer 001**, using the same tenant architecture that future customer organisations will use.

This repository contains a working UI/UX starter, Cloudflare Pages Functions API, multi-tenant D1 schema, demo seed data, validation scripts and deployment documentation.

## What is working now

- Interactive dark AKARI CRM UI matching the approved prototype
- Home dashboard, targets, charts, daily tasks, project table and opportunity pipeline
- Project detail drawer, command palette, quick-create and screen-share privacy mode
- Responsive desktop and mobile layouts
- Installable PWA shell
- Cloudflare Pages Functions API routes
- Demo mode that runs without a database
- Cloudflare Access mode for the first internal users
- Multi-tenant D1 schema prepared for future customer organisations
- Project, contact, opportunity, campaign, task, partner, referral, payment and target tables
- Sample seed records for local development

## What is intentionally not complete yet

This is a production-oriented **starter repository**, not a completed CRM product. The UI currently renders sample values. The next development phase should connect every screen to the included API and D1 database, then add forms, role management, invitations, file uploads, full audit logging and automated tests.

No OAuth customer onboarding, subscription billing, public registration or full platform-admin console is included yet.

## Repository structure

```text
public/                 Static CRM frontend and PWA
functions/              Cloudflare Pages Functions API and auth middleware
db/migrations/          D1 database migrations
db/seed.sql             Local demo data
docs/                   Product, architecture, security and deployment guides
scripts/validate.mjs     Repository validation
.github/workflows/       CI and optional Cloudflare deployment
imports/private/         Local import holding area; ignored by Git
```

## Local preview without installing anything

Open `public/index.html` directly in a browser. Its CSS, JavaScript, icons and manifest use relative paths, so the UI works from a local folder as well as after deployment.

The API is not available when opening the file directly. Use Wrangler for full local development. A self-contained fallback preview is also included at `AKARI_CRM_STANDALONE_PREVIEW.html`.

## Full local development

Requirements:

- Node.js 20 or later
- A Cloudflare account

```bash
npm install
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
npm run validate
npm run dev
```

Wrangler will serve the static UI and Pages Functions together.

## Create D1

```bash
npx wrangler d1 create akari-crm-production
```

Copy the returned database ID into `wrangler.toml`.

Apply migrations:

```bash
npm run db:migrate:remote
```

For local development:

```bash
npm run db:migrate:local
npm run db:seed:local
```

## Authentication for the first AKARI users

The starter supports two modes:

- `AUTH_MODE=demo` for local UI and API testing
- `AUTH_MODE=access` for Cloudflare Access-protected production use

In production, protect `crm.akarihouse.com` with Cloudflare Access and allow the approved emails. The middleware reads the authenticated email header and checks that the user has an active tenant membership in D1.

Cloudflare Access is suitable for the controlled first AKARI release. Future customer SaaS authentication can replace this middleware while preserving the tenant-scoped API and database.

## Deploy through Cloudflare Pages

1. Push this repository to a new private GitHub repository such as `akari-house/akari-crm`.
2. In Cloudflare, create a Pages project from that repository.
3. Use no build command.
4. Set the output directory to `public`.
5. Add the D1 binding named `DB`.
6. Set `AUTH_MODE=access` in production.
7. Connect `crm.akarihouse.com` as the custom domain.
8. Protect the domain with Cloudflare Access.

See `docs/DEPLOYMENT.md` for detailed steps.

## Security rule

Never commit the 542 lead records, private contacts, payment references, wallet details or raw Notion exports to GitHub. Import them directly into D1 through a controlled migration process. The `imports/private` directory is intentionally ignored.

## Product model

```text
AKARI CRM platform
â”œâ”€â”€ AKARI House â€” Customer 001
â”œâ”€â”€ Future Project â€” Customer 002
â””â”€â”€ Future Company â€” Customer 003
```

Every operational table includes `tenant_id`. Customer data must remain isolated in the API, reports, files, search and exports.

## Recommended next build order

1. Connect dashboard values to `/api/dashboard`
2. Connect project table and drawer to `/api/projects`
3. Connect tasks and completion actions to `/api/tasks`
4. Add opportunity stage updates and validation
5. Add campaign financial forms and payment records
6. Add tenant invitations and user role management
7. Add R2 file uploads
8. Import the cleaned AKARI data securely
9. Add platform-admin organisation creation
10. Add automated tenant-isolation and financial-calculation tests

## Ownership

Private AKARI CRM source code. All rights reserved.

