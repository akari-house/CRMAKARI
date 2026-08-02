# Deployment to `crm.akarihouse.com`

## 1. Create the GitHub repository

The canonical public repository is:

```text
https://github.com/akari-house/CRMAKARI
```

Do not commit production credentials, Cloudflare tokens, D1 identifiers or tenant exports.

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

## 6. Protect CRM access while keeping Home public

The custom hostname is:

```text
crm.akarihouse.com
```

Keep `/` public for the compact product page. Replace any whole-host Access destination with path-scoped applications for `crm.akarihouse.com/app/*`, `crm.akarihouse.com/enter-crm` and `crm.akarihouse.com/api/*`, using the approved-AKARI-email Allow policy. Add a more-specific Bypass/Everyone application only for `crm.akarihouse.com/api/waitlist` so pre-registration works publicly. Legacy `/dashboard` and `/home` entries redirect to the protected resolver. Ensure approved emails also exist in D1 `users` and `tenant_memberships`.

Keep `akarihouse.com` outside this Access application.

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
- Confirm `/` loads publicly, `/api/waitlist` accepts validated public interest, and `/enter-crm` invokes CRM authentication
- Confirm an approved account lands at `/app/:tenantSlug/home` and sees Dashboard rather than public Home
- Confirm submitting the waitlist does not create a CRM user or tenant membership
- Confirm the public `akarihouse.com` site remains unchanged

