# AKARI CRM Launch Hardening R13

This release removes launch-blocking UI and runtime defects without changing tenant data or the production schema.

## Billing profile

- Keeps the modal header and footer fixed.
- Makes only the form body scroll.
- Normalises legacy `.field` controls to the shared modal design system.
- Groups organisation, address, tax/payment and invoice-default fields into clear sections.
- Restores comfortable spacing and mobile single-column behaviour.

## Fundraising

- Removes direct dependency on optional `projects.funding_stage`, `total_funds_raised`, `currency` and `valuation` columns when they are absent in an older production D1 schema.
- Reads equivalent structured BD profile metadata when available and otherwise returns safe empty values.
- Prevents observer-driven retry storms and repeated technical error notifications.
- Shows one stable, actionable error state when the workspace cannot load.

## Shared launch protection

- Deduplicates identical error toasts and caps the visible toast stack.
- Hides raw D1/SQLite implementation details from end users while preserving console diagnostics.
- Adds browser and tenant regression coverage for the reported billing and fundraising defects.

No seed data, customer data or destructive migration is included.
