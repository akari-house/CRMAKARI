# CRMAKARI Platform Completion Roadmap

## Delivery principle

The remaining platform is delivered as ten controlled production releases. Each release must preserve the canonical AKARI UI, Cloudflare Access, D1 tenant isolation, finance permissions, audit history and the separate `akarihouse.com` website.

A release is not merged until source validation, tenant-isolation tests, browser interaction tests, mobile checks and the protected production smoke check pass.

## Release 1 — BD Operations Completion

Purpose: make the existing lead and relationship database usable by the AKARI business-development team every day.

Scope:

- data-quality queues for unassigned leads, missing next actions, overdue follow-ups, missing project channels and missing POCs;
- selectable lead rows and manager-controlled bulk updates;
- bulk owner, priority, lifecycle and next-follow-up changes;
- personal saved lead views scoped to the authenticated browser/user/tenant identity;
- manager workload visibility;
- tenant-boundary and audit coverage.

## Release 2 — Team Rollout and Manager Controls

Purpose: let AKARI safely distribute and supervise work.

Scope:

- complete member directory and workload scorecards;
- role, membership-status and finance-access controls;
- last-active-owner protection;
- lead assignment and re-assignment;
- manager attention queues, targets and activity summaries;
- invitation workflow only after Cloudflare Access/application-membership requirements are agreed.

Release 1 and the safe subset of Release 2 are combined in the first implementation wave because they share the same owner/workload model.

## Release 3 — Proposal, Invoice and Payment Hardening

Purpose: make commercial documents and collections operationally reliable.

Scope:

- proposal templates, versions, approval, links/files and acceptance status;
- invoice numbering, PDFs, tax configuration, credit/cancellation controls and payment schedules;
- invoice delivery and reminders after Gmail integration is authorised;
- partial receipts, reconciliation, outstanding balances and accounting exports;
- referral statements and payout reconciliation.

## Release 4 — Campaign and Service Delivery

Purpose: carry won work through onboarding, execution, reporting and renewal.

Scope:

- engagement onboarding checklist and delivery owners;
- milestones, budgets, creator selection, deliverables, approvals and content links;
- client reporting, profitability, completion and renewal opportunity creation;
- campaign and service templates by engagement type.

## Release 5 — Google Calendar and Gmail

Purpose: connect meetings and approved email operations without weakening consent or audit controls.

Scope:

- per-user Google connection and tenant entitlement;
- calendar availability, event creation, reschedule/cancel and sync-failure handling;
- Gmail draft/send/log flows with explicit user action;
- timezone, suppression, consent, retry and audit controls;
- secure token storage outside the public repository and static assets.

## Release 6 — Fundraising Operating System

Purpose: manage founder fundraising mandates on the same project/contact foundation.

Scope:

- raise profile, target, valuation, round structure and remaining allocation;
- investor targets, fit scoring, introductions, outreach and meetings;
- data-room, NDA, due diligence, questions and investor updates;
- soft/confirmed commitments, allocation, closing and fundraising analytics;
- no duplicate project or investor-contact records.

## Release 7 — Public Homepage and Waitlist

Purpose: explain CRMAKARI publicly and capture qualified commercial demand without granting CRM access.

Scope:

- public product narrative, capabilities, packages and pricing presentation;
- waitlist form for email, organisation, package, preferred price and term;
- consent, rate limiting, abuse protection and acknowledgement;
- approved access architecture that does not remove protection from the secure CRM.

## Release 8 — Tenant Provisioning and Packages

Purpose: convert CRMAKARI from Customer 001 operations into a controlled multi-tenant SaaS.

Scope:

- organisation provisioning, owner assignment, workspace currency/timezone and user limits;
- invitations and application-level membership activation;
- plan/module entitlements and subscription states;
- platform-admin controls separated from tenant administration;
- no payment activation until entitlement and lifecycle rules are complete.

## Release 9 — Central Intelligence Database

Purpose: provide governed, paid, sector-wise intelligence without mixing it with private tenant CRM data.

Scope:

- separate central schema and permission domain;
- provenance, lawful-use basis, freshness, steward, suppression and audit metadata;
- search, sector filters, entitlements and usage limits;
- explicit audited save-to-CRM action with duplicate detection;
- no silent copying into AKARI House or another tenant.

## Release 10 — Final Security, Performance and Launch Audit

Purpose: establish launch readiness for external organisations.

Scope:

- full tenant-isolation and permission matrix;
- dependency/advisory review without unsafe forced upgrades;
- accessibility, keyboard, mobile, reduced-motion and visual regression audit;
- API validation, rate limiting, error handling, backup and rollback procedures;
- performance budgets, caching, D1 query review and operational monitoring;
- production-domain, Cloudflare Access, Pages hostname and `akarihouse.com` separation checks;
- final runbooks and release sign-off.

## Current delivery wave

`build/campaign-service-delivery-r4` implements Release 4:

1. campaign and service delivery command centre;
2. engagement onboarding and My Day task generation;
3. milestones, dependencies, evidence and client-visible notes;
4. deliverable approvals, publishing links and performance metrics;
5. creator selection, submissions, rewards and payment states;
6. finance-permission-aware budget and profitability controls;
7. authenticated client delivery reports;
8. completion gates and renewal opportunity creation;
9. tenant isolation, browser interaction and mobile regression coverage.
