# Deployment to `crm.akarihouse.com`

## 1. Create the GitHub repository

Create a new private repository under the existing AKARI GitHub account or organisation:

```text
akari-crm
```

Upload the contents of this folder to the repository root.

## 2. Create the Cloudflare Pages project

- Open Cloudflare Dashboard
- Workers & Pages â†’ Create â†’ Pages â†’ Connect to Git
- Select the new `akari-crm` repository
- Framework preset: None
- Build command: leave empty
- Build output directory: `public`

Pages Functions are automatically detected from the `functions` directory.

## 3. Create D1

```bash
npx wrangler d1 create akari-crm-production
```

Copy `wrangler.toml.example` to `wrangler.toml` and replace the D1 database ID.

Apply the migration:

```bash
npm run db:migrate:remote
```

Do not apply `db/seed.sql` to production unless you intentionally want the demonstration records.

## 4. Bind D1 to Pages

In the Pages project:

- Settings â†’ Bindings
- Add D1 database binding
- Variable name: `DB`
- Select `akari-crm-production`

## 5. Set environment variables

Production:

```text
AUTH_MODE=access
DEFAULT_TENANT_SLUG=akari-house
```

Preview can remain `AUTH_MODE=demo` until test memberships are configured.

## 6. Protect access

Create a Cloudflare Access self-hosted application for:

```text
crm.akarihouse.com
```

Allow only approved AKARI emails initially. Ensure those same emails exist in the D1 `users` and `tenant_memberships` tables.

## 7. Connect the domain

In the Pages project, add custom domain:

```text
crm.akarihouse.com
```

This does not require changing the public `akarihouse.com` application repository.

## 8. Validate

- Sign in as each of the three users
- Confirm the Access email header reaches the middleware
- Confirm unauthorised emails receive 403
- Confirm finance values disappear for a user without finance permission
- Confirm `/api/health` and `/api/me` work
- Confirm the public `akarihouse.com` site remains unchanged

