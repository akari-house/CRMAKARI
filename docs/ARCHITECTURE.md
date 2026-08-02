# Architecture

## Current starter

```text
Browser
  â†“
Cloudflare Pages static frontend
  â†“ same origin
Cloudflare Pages Functions `/api/*`
  â†“
Cloudflare D1
```

The production hostname intentionally has two surfaces: public GET `/` and static assets, plus the exact public waitlist submission endpoint. Cloudflare Access protects `/app/*`, `/enter-crm`, tenant APIs and membership-resolving legacy entries for the first AKARI users. The canonical Dashboard URL is `/app/:tenantSlug/home`. Never apply the CRM Access policy to `akarihouse.com`.

## Multi-tenancy

- AKARI House is stored as a normal tenant.
- All operational records carry `tenant_id`.
- Authentication resolves a tenant membership.
- Every API query scopes by that membership's `tenant_id`.
- Platform administration must be a separate permission domain.

## File storage

Add Cloudflare R2 when file upload development begins. Store metadata in D1 and object bytes in R2. Downloads must be permission-checked before access.

## Future authentication

Cloudflare Access is efficient for the controlled first release. When onboarding external customers at scale, introduce app-level authentication and invitation acceptance. Keep the current tenant membership and permission model.

## API principles

- Validate every write
- Scope every query by tenant
- Log sensitive changes
- Never send finance values without permission
- Use service functions when the API grows beyond this starter

