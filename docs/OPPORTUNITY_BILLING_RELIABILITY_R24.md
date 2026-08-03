# AKARI CRM R24 — Opportunity persistence and billing modal polish

## Scope

This release corrects two production-facing reliability issues without changing the database schema.

## Opportunity persistence

A commercial opportunity is no longer reported as created merely because the insert path returned without a browser error.

The server now:

1. validates the authenticated tenant and project;
2. writes the opportunity, stage history, project lifecycle update and audit record as one D1 batch when batch support is available;
3. reads the new opportunity back using both tenant ID and opportunity ID;
4. returns the confirmed row to the browser;
5. returns an explicit error rather than a false success when the row cannot be read back.

The existing opportunity table and migration remain unchanged.

## Billing modal polish

The organisation billing modal keeps a fixed header and footer with only the body scrolling. The updated stylesheet:

- keeps every label above its input;
- supports both legacy `.field` and canonical `.form-group` wrappers;
- reduces modal width and height;
- tightens section and field spacing;
- lightens nested section chrome;
- improves input hover and focus states;
- keeps address and payment-instruction fields full width;
- preserves a single-column mobile layout.

## Verification

The release includes tenant-isolation tests for the opportunity write and read-back path, plus browser geometry assertions for billing labels, fixed header/footer behaviour and scrolling.
