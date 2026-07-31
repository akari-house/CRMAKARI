# Secure AKARI Data Import

The production CRM data should not be committed to GitHub.

## Source records available

- 542 deduplicated projects/leads
- 47 partners
- 86 source-intelligence records
- 60 team tasks
- 41 historical daily records
- 5 confirmed campaigns

## Import process

1. Export cleaned records to local CSV or JSON files.
2. Store them temporarily in `imports/private/`; Git ignores this directory.
3. Validate project names, websites, X profiles, emails and Telegram handles.
4. Import tenants, users and partners first.
5. Import projects and contacts.
6. Import opportunities and campaigns.
7. Import tasks, targets and historical records.
8. Produce an import report with inserted, merged, rejected and review-required records.
9. Delete local raw files after the migration is verified.

## Deduplication keys

- Normalised project name
- Website domain
- X profile
- Email
- Telegram handle

Uncertain matches should be flagged for manual review, not silently merged.

