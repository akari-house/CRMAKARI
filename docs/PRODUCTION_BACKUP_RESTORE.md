# AKARI CRM Production D1 Backup and Restore

## Recovery model

AKARI CRM uses Cloudflare D1. Production recovery uses two complementary layers:

1. **Tenant backup** for workspace-level portability and evidence, generated from the protected CRM tenant export.
2. **Full D1 backup** for production recovery, using Cloudflare D1 Time Travel plus an explicit SQL export before schema promotions.

These serve different purposes. A tenant backup is not a substitute for full database recovery, and a full D1 export does not replace the tenant-scoped export used for customer/workspace portability.

## Tenant backup

Before V1 production sign-off, an OWNER or ADMIN must download the protected tenant backup from CRM by AKARI and store it in an approved private location. The export is tenant-scoped and records `TENANT_BACKUP_EXPORTED` in the audit log.

Verify that the tenant backup contains the expected workspace identity and canonical tenant-scoped CRM records before marking the V1 `backupRestore` sign-off complete.

## Pre-migration full D1 export

Before applying production migrations, export the remote database:

```bash
npx wrangler d1 export akari-crm-production --remote --output=./akari-crm-production.sql --skip-confirmation
```

The production deployment workflow stores this SQL export as a protected GitHub Actions artifact with a SHA-256 checksum. Do not commit database exports to Git.

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
9. Compare the recovered workspace with the most recent tenant backup where appropriate.
10. Record the incident and restore point in the operational log.

## V1 recovery drill

Before V1.0 sign-off, record evidence that:

- a tenant backup can be produced and opened,
- the pre-migration D1 export is non-empty and checksummed,
- the Time Travel restore procedure and target-selection process are understood,
- post-restore tenant isolation, portal privacy and finance boundaries are part of the verification sequence.

## Release rule

No destructive production migration should run unless a recoverable point-in-time state is available and the deployment workflow can verify the expected post-migration schema.
