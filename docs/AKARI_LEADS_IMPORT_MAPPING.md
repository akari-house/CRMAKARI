# AKARI Leads import mapping

Target workspace: `AKARI House` (`tenant_akari_house`)

Target collection: `AKARI Leads`

The upload is private tenant data. The workbook, parsed records, contact details and import payloads must never be committed to this public repository.

## Current source workbook dry run

- 895 lead/project rows
- 217 contact rows
- 3 task rows
- 1,693 raw-lineage rows retained only in the source workbook
- 0 missing project names
- 508 missing primary categories
- 182 leads with no direct website, X, email, Telegram or other contact field
- 28 contacts with missing names; the importer derives a fallback label from email, Telegram or X
- one duplicated lead Telegram handle and five duplicated contact Telegram groups are flagged rather than auto-merged

## Import policy

- All uploaded project rows enter the tenant-scoped `AKARI Leads` collection.
- Legacy client, campaign and partner classifications are preserved as source metadata. They do not create financial records or automatically mark a project as an active client.
- The importer performs an explicit preview before the commit button is enabled.
- Re-importing the same stable source IDs is idempotent and will skip existing records.
- A rollback is permitted only while the imported projects have no downstream opportunities or campaigns.

## Field mapping

| Workbook | CRM |
|---|---|
| Lead ID | stable project ID and import metadata |
| Project / Organization | project name |
| Primary Category | project category |
| Priority | HIGH or MEDIUM |
| Lead Source | source name |
| Website | website |
| X Profile | X URL |
| Telegram | project Telegram |
| Country / Region | region |
| Date Added | created date |
| Last Contacted | last activity date |
| Next Follow-Up | next follow-up date |
| TGE Status | TGE status |
| Funding | funding status |
| Legacy Classification / Status / Notes | original status and notes |
| Source References | source-lineage metadata |
| Contact rows | tenant-scoped contacts linked by Lead ID |
| Task rows | tenant-scoped tasks assigned to the current owner when Assigned To is Muaz |
