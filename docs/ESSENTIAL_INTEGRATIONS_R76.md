# R76 — Essential Integrations

## Purpose
R76 completes the frozen V1 integration scope only:
- Google Calendar activity capture
- Gmail activity capture
- Google Drive document links
- CSV import / export
- minimal external API foundation
- minimal outbound webhook foundation

No social APIs, Telegram automation, autonomous outreach, mobile integrations or predictive automation are included in R76.

## Google connection
Google OAuth is workspace-scoped and initiated by an authenticated internal CRM user. OAuth state is bound to both tenant and user, stored only as a SHA-256 hash, expires after 10 minutes and is single-use.

Production secrets belong in Cloudflare Pages secrets:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- optional `GOOGLE_REDIRECT_URI`
- `INTEGRATION_ENCRYPTION_KEY`

`INTEGRATION_ENCRYPTION_KEY` must be at least 32 random characters. Google access/refresh tokens and webhook signing secrets are AES-GCM encrypted before being written to D1.

## Gmail privacy boundary
Gmail integration uses read-only Google access and requests messages using `format=metadata`.

CRM stores only relationship activity metadata:
- From
- To
- Cc
- Subject
- Date
- message/thread identifiers for dedupe
- inbound/outbound direction

Message bodies, raw MIME content and snippets are not stored.

An email becomes a CRM Activity only when one of the other participants matches an existing tenant contact. Unmatched messages are remembered only as external dedupe references so they are not repeatedly processed.

## Calendar privacy boundary
Calendar event metadata becomes a CRM Meeting Activity only when an attendee matches an existing tenant contact. The event is linked to that contact/project and an active opportunity when available.

The current implementation does not create or modify Google Calendar events.

## Drive
R76 stores external Google Drive/Docs links and metadata rather than copying Drive file contents into CRM storage.

Supported links can be attached to CRM entities such as Projects, Opportunities, Campaigns, Fundraising Rounds and Agreements.

## CSV portability
Exports are tenant-scoped and available for:
- Projects
- Contacts
- Opportunities
- Campaigns
- Fundraising Rounds

V1 imports are intentionally limited to Projects and Contacts.

Imports require preview-before-commit and enforce:
- row / column / file-size limits
- canonical project lifecycle values
- required contact identity fields
- project ownership resolution for contacts
- duplicate detection
- tenant-scoped lookups

CSV exports neutralize cells beginning with spreadsheet formula prefixes before output.

## External API foundation
Workspace Owners/Admins can create API keys. The raw API key is displayed once and only its SHA-256 hash is persisted.

Machine authentication is limited to `/api/v1/*`. The tenant identity comes from the API key record; callers cannot select another tenant through a header or request parameter.

V1 scopes:
- `read`
- `write`
- `webhooks`

Initial V1 endpoints:
- `GET /api/v1/ping`
- `GET /api/v1/projects`
- `POST /api/v1/projects`

External API writes create audit evidence identifying the API key used, without treating the API key as a human user.

## Webhook foundation
Webhook endpoints must use HTTPS and a public DNS hostname. Localhost, `.local`, IP-literal and credential-bearing URLs are rejected.

Webhook signing secrets are displayed once and encrypted at rest. Deliveries are signed with HMAC-SHA256 using:

`x-akari-signature: t=<unix timestamp>,v1=<signature>`

The signature input is `<timestamp>.<raw-json-body>`.

Delivery attempts, response status and errors are retained in `webhook_deliveries` for audit and troubleshooting.

## Security / tenant isolation
- Google connections are tenant-scoped.
- Non-admin users can manage only Google accounts they connected.
- Gmail/Calendar matching queries include the authenticated tenant.
- Drive links are tenant-scoped.
- CSV reads/writes are tenant-scoped.
- API-key tenant identity is derived from the key hash.
- API write scope is enforced before the external handler executes.
- Webhooks are tenant-scoped and signed.
- Integration secrets are encrypted with a Cloudflare-managed application secret.

## Database migration
R76 uses `db/migrations/0009_essential_integrations.sql`.

The production workflow applies and verifies the full pending schema chain:

`0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009`

before deploying Cloudflare Pages.

## Production dependencies
R76 code can be merged independently, but Google OAuth will show as unconfigured until the Google credentials and encryption key are added to Cloudflare Pages secrets.

All schema-dependent releases remain blocked from production promotion while the GitHub deployment credential receives Cloudflare D1 HTTP 403 / error 7403. The Cloudflare token/account authorization must be corrected before migrations 0003–0009 can be declared live.

## V1 acceptance
R76 is complete when:
1. Google OAuth state is tenant/user-bound and single-use.
2. Google tokens are encrypted at rest.
3. Gmail metadata capture creates Activities only for matched CRM contacts and never stores bodies.
4. Calendar capture creates Activities only for matched CRM contacts.
5. Drive files can be linked without copying their contents into CRM.
6. CSV export works for the five frozen entity groups.
7. Projects/Contacts import uses preview-before-commit and canonical validation.
8. API keys are hashed at rest and tenant/scope constrained.
9. Signed HTTPS webhooks can be created and tested with delivery audit evidence.
10. R76 tenant/security tests and the full repository validation gate pass.
11. Migration 0009 is applied and verified before production Pages deployment.
