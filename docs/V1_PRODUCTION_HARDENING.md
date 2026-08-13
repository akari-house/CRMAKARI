# CRM by AKARI V1 Production Hardening

This release freezes feature development and turns the R68-R76 stack into the V1.0 production product.

## Release blockers

- All repository validators pass.
- All tenant-isolation tests pass.
- All Playwright tests pass.
- No cross-tenant read or write path is possible.
- Founder/Client portal cannot expose internal relationship intelligence, internal notes, finance internals, or private investor intelligence.
- Finance permissions are enforced server-side.
- Cloudflare Access authentication and tenant routing work for AKARI House and a second workspace.
- Production D1 migrations apply in order and are verified before Pages deployment.
- Backup/restore procedure is documented and tested.
- Production smoke tests pass after deployment.

## V1 acceptance journeys

### Commercial
Lead -> Opportunity -> Proposal -> Agreement -> Won -> Invoice -> Payment -> Delivery -> Renewal.

### Campaign
Campaign -> Creator Selection -> Compensation -> Acceptance -> Activation -> Work OS -> Approved Delivery -> Settlement -> Client Report -> Closeout -> Renewal.

### Fundraising
Founder -> Onboarding -> Readiness -> Round -> Data Room -> Investor Target -> Intro -> Outreach -> Meeting -> Diligence -> Terms -> Commitment -> Funds -> Close -> Investor Relations.

### Platform
Create Tenant -> Invite Users -> Configure Roles -> Configure Modules -> Operate -> Audit -> Plan/Usage -> Export/Backup -> Suspend/Reactivate.

## Role acceptance matrix

Every major module must be checked for View, Create, Edit, Delete, Export and Finance access for OWNER, ADMIN, BD_MANAGER, BD_MEMBER, FINANCE, VIEWER and EXTERNAL_COLLABORATOR.

EXTERNAL_COLLABORATOR is portal-only and must fail closed for internal CRM APIs and internal relationship intelligence.

## Tenant #2 acceptance

A second tenant must be provisioned without direct D1 edits or code changes. The owner invitation must be accepted using the Cloudflare-authenticated email. The tenant must be able to configure modules, invite team members, create records, export data and be suspended/reactivated from Workspace Administration.

## UX polish gate

Before V1.0, audit all primary screens for responsive layout, consistent navigation, page titles, action hierarchy, loading states, empty states, validation messages, error states, destructive confirmations, date/currency formatting and mobile navigation collisions.

## Production sign-off

Tag CRM by AKARI V1.0 only after all four acceptance journeys have been completed against production, Tenant #2 has been onboarded without engineering intervention, backup/restore has been tested, portal privacy has been re-verified and no P0/P1 security issue remains.
