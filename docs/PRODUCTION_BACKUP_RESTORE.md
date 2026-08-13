# AKARI CRM Production D1 Backup and Restore

## Recovery model

AKARI CRM uses Cloudflare D1. Production recovery should use both Cloudflare D1 Time Travel and an explicit SQL export before schema promotions.

## Pre-migration export

Before applying production migrations, export the remote database:

```bash
npx wrangler d1 export akari-crm-production --remote --output=./akari-crm-production.sql --skip-confirmation
```

Store the export as a protected deployment artifact. Do not commit database exports to Git.

## Restore options

### Preferred: D1 Time Travel

Use Cloudflare D1 Time Travel to restore the database to a point immediately before the failed migration or destructive operation.

### Portable SQL restore

For a new/empty recovery database, import the verified SQL export with Wrangler after confirming the target database and environment. Do not overwrite production without an incident decision and a verified recovery target.

## Required verification after restore

1. Confirm tenant count and AKARI House tenant.
2. Confirm active users and memberships.
3. Confirm opportunity, campaign, agreement, payment and fundraising counts.
4. Confirm migrations/tables expected by the current release exist.
5. Authenticate through Cloudflare Access.
6. Run a tenant-isolation smoke test.
7. Verify Founder/Client portal access remains restricted.
8. Verify finance permission boundaries.
9. Record the incident and restore point in the operational log.

## Release rule

No destructive production migration should run unless a recoverable point-in-time state is available and the deployment workflow can verify the expected post-migration schema.
