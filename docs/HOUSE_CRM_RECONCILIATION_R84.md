# R84 — AKARI House / CRM reconciliation and NDA bridge

## Purpose

CRM by AKARI is the canonical owner of commercial agreement and relationship workflow. AKARI House remains the professional network and trusted diligence experience.

R84 creates the smallest interoperability layer required to remove the historical CRM-era tables from AKARI House later without breaking Investor diligence.

This release does **not** merge the two databases, copy CRM workflow back into House, or delete legacy House data.

## Ownership boundary

### AKARI House owns

- membership and role identity
- member profiles and connections
- Founder projects as network-facing profiles
- Investor opportunity access and diligence UI
- Creator campaigns and member participation
- events and House moderation

### CRM by AKARI owns

- commercial projects/accounts and contacts
- relationship intelligence
- agreements and compliance workflow
- follow-ups and operating rhythm
- finance/revenue operations
- CRM tenant/workspace administration

## Why an explicit bridge is required

The historical House NDA check identifies an Investor through the House user id/email and reads the legacy `agreement_records` table. The canonical CRM `agreements` table is tenant-scoped and previously stored a counterparty name but no stable House-member identity.

Matching projects or people by display name would be unsafe. R84 therefore introduces explicit cross-system identity links.

## New CRM bridge schema

### `external_entity_links`

Maps a stable AKARI House entity id to a canonical CRM entity id inside one CRM tenant.

Supported mappings are intentionally narrow:

- House `PROJECT` → CRM `PROJECT`
- House `MEMBER` → CRM `CONTACT`
- House `AGREEMENT` → CRM `AGREEMENT`

A House entity cannot be silently remapped to a different CRM record.

### `agreement_counterparty_identity`

Adds counterparty provenance to a canonical CRM agreement without duplicating the agreement itself.

It can link an agreement to:

- a CRM contact
- a stable House member id
- an email address

The NDA runtime bridge uses the stable House member id.

## Runtime NDA API

`GET /api/v1/house-nda-status`

Required query parameters:

- `houseProjectId`
- `houseMemberId`

Authentication uses the existing tenant-scoped CRM API key mechanism. GET requests require only the `read` scope.

The response is deliberately narrow:

- signed/not signed
- authoritative source marker
- reason
- checked timestamp
- agreement id/status and signed/active/expiry timestamps when a current NDA exists

The endpoint never exposes the signed document URL, signature evidence, notes, fees, commercial terms, or full agreement record.

## Reconciliation write API

`POST /api/v1/house-bridge`

This endpoint requires an API key with `write` scope and supports only:

1. `link-entity`
2. `bind-agreement-counterparty`

Each operation is tenant-scoped, validated and audited. Conflicting remaps fail closed with HTTP 409.

A dedicated reconciliation key should be short-lived and revoked after the migration work. The production House runtime should use a separate read-only key.

## Safe migration sequence

### Phase 1 — bridge deployment

1. Back up CRM D1.
2. Apply migration `0010_house_boundary_bridge.sql`.
3. Deploy the read-only NDA endpoint and controlled reconciliation endpoint.
4. Keep AKARI House authorization on its legacy NDA source.

No production records are moved in this phase.

### Phase 2 — inventory and explicit mapping

1. Export/read non-sensitive counts from both databases.
2. Identify House projects with legacy agreement records.
3. Explicitly map House projects to CRM projects.
4. Explicitly map relevant House members to CRM contacts where available.
5. Recreate or link canonical CRM agreements only after a human-reviewed mapping exists.
6. Bind NDA agreements to the stable House member id.
7. Reconcile counts and exceptions.

Do not fuzzy-match by project name or person name.

### Phase 3 — shadow comparison

Set House to `shadow` NDA bridge mode.

- House legacy NDA state remains authoritative.
- CRM is queried in parallel.
- mismatches are logged without changing user authorization.

Resolve all meaningful mismatches before cutover.

### Phase 4 — CRM authority

Set House to `crm` NDA bridge mode only after:

- all required project mappings exist
- all active NDA counterparties have stable House identity provenance
- shadow comparisons are clean
- the read-only runtime API key is configured
- rollback instructions are tested

CRM mode must fail closed if the CRM bridge cannot provide an authoritative response.

### Phase 5 — legacy House table removal

Only after code search and production evidence show zero active reads:

1. create a final House D1 backup
2. confirm reconciliation counts
3. archive the migration inventory/evidence
4. drop CRM-era House tables in a dedicated destructive migration
5. run full House role/security and diligence tests

R84 does **not** perform this destructive phase.

## Rollback

Before legacy tables are removed, House can immediately return to `legacy` mode without changing CRM data.

After legacy tables are removed, rollback requires the final pre-drop House D1 backup. Therefore destructive cleanup must be a separate release with explicit evidence and approval.

## Security rules

- Never commit CRM production data or exports to GitHub.
- Never expose signed agreement documents through the House bridge.
- Never use a write-scope API key as the normal House runtime credential.
- Never map entities by fuzzy/name-only matching.
- Every mapping is tenant-scoped and audited.
- House receives only the provenance necessary for its own access decision.
