# R75 — SaaS Workspace Administration

## Purpose
R75 turns the existing multi-tenant CRM architecture into an operator-manageable SaaS control plane so CRM by AKARI can onboard a second workspace without engineering or direct D1 edits.

## Canonical flow
`Create Workspace → Invite Team → Roles → Modules → Plan → Usage`

## Existing foundations reused
R75 does not create a second tenant, membership or billing model. It continues to use:
- `tenants`
- `tenant_settings`
- `tenant_memberships`
- `invitations`
- existing Team role / finance-permission endpoints

R75 adds only platform administration and usage-history records that were missing from the core schema.

## Platform administration
Platform administrators can:
- provision a workspace
- define workspace slug, plan, seat limit and storage limit
- enable / disable V1 modules
- create the first Owner invitation
- review workspace usage
- suspend or reactivate a workspace
- add or revoke platform administrators

The first platform administrator can bootstrap only when there are no active platform administrators and the authenticated user is an Owner of the `akari-house` workspace. This avoids a hardcoded personal identity or a manual production database edit.

## Workspace administration
Workspace Owners and Admins can:
- update workspace name, timezone, base currency and logo
- configure enabled modules
- invite team members
- assign role and finance permission
- revoke pending invitations
- use the existing Team controls to suspend / reactivate / revoke memberships
- review seat and storage consumption

## Invitation security
Invitation links contain a one-time high-entropy token. Only its SHA-256 hash is stored in D1.

Invitation acceptance still requires Cloudflare Access authentication. The authenticated Cloudflare email must exactly match the invitation email before a membership is activated.

Expired, revoked and already-accepted invitations fail closed.

## Trial workspaces
`TRIAL` workspaces are valid authenticated workspaces. `SUSPENDED` and `CANCELLED` workspaces are not.

## Module entitlements
Enabled modules are enforced at the global middleware layer, not only in the UI. Requests for a disabled module return 403 before reaching the module handler.

The CRM navigation also removes disabled top-level modules so the UI matches the server-side contract.

V1 modules:
- BD
- Revenue
- Delivery
- Campaigns
- Fundraising
- Relationships
- Portal
- Reporting

## Usage
Current usage includes:
- active internal seats
- pending / invited seats
- storage used by active Data Room document versions
- projects
- campaigns
- fundraising rounds

Point-in-time usage can be captured to `workspace_usage_snapshots` for plan and operating review.

## Production deployment
Migration `0008_saas_workspace_admin.sql` must run after R74 migration `0007_reporting_attention.sql`.

The Cloudflare production workflow applies and verifies the R70–R75 migration chain before Pages deployment.

Production deployment remains externally blocked until the configured Cloudflare API credential/account has production D1 permission; the current known Cloudflare failure is HTTP 403 / error 7403.

## V1 acceptance
R75 is complete when:
1. Tenant #2 can be created from Platform Control without direct database edits.
2. Its Owner receives an invitation link.
3. The Owner can authenticate through Cloudflare Access and accept the matching invitation.
4. The Owner can invite the team and configure roles / finance permissions.
5. Module entitlements are enforced on both API and UI boundaries.
6. Plan, seat and storage limits are visible and enforceable.
7. Platform administration can suspend / reactivate the workspace.
8. Tenant isolation and invitation-security tests pass.
9. Migration 0008 is applied and verified before the production Pages release.

## Cloudflare Access dependency
Application-level onboarding is automated by R75. Cloudflare Access itself must still be configured to allow the intended invited identities to reach the Access login boundary. If Access is configured as a narrow manual email allowlist, that Cloudflare policy must be broadened before Tenant #2 can self-onboard end-to-end.
