# Campaign Operations & Intelligence — Architecture Audit

## Existing system findings

- `campaigns` is already the tenant-owned operational engagement entity.
- Won opportunities create campaign/service engagement records connected to projects and opportunities.
- Service delivery metadata is versioned in `campaigns.notes.serviceDelivery` and preserves the existing relational campaign row.
- Campaign owners, tasks, finance values, opportunity links and audit logs already use tenant-scoped records.
- The CRM is the tracking, governance, reporting and finance system; future campaign participation and creator submission may originate from `akarihouse.com`.

## Decision

Release 8 extends each existing campaign record with a sibling metadata root:

```text
campaigns.notes
├── serviceDelivery
└── campaignTracking
```

No duplicate campaign table, project, client, investor or creator source of truth is introduced.

## Release 8.1A data model

`campaignTracking` contains:

- `overview`: reporting currency, project links, token defaults, campaign notes, Sorsa and XScore baselines/targets;
- `targets`: one baseline/target record per owned-social platform;
- `socialUpdates`: one dated update per platform and reporting date;
- audit metadata: creator/updater and timestamps.

Current audience, growth, target progress, total reach, total engagements, engagement rate, current campaign week/month and latest Sorsa/XScore are always derived from source records.

## Integrity controls

- All reads and writes require the authenticated tenant.
- Campaign lookup is constrained by both `tenant_id` and campaign ID.
- Platform values use a controlled list.
- Duplicate platform/date social updates are rejected.
- Campaign week and campaign month derive from campaign start date.
- Total engagements and engagement rate derive from post metrics.
- Material writes create `CAMPAIGN_TRACKING` audit records.
- Existing `serviceDelivery` and other campaign metadata are preserved.

## Permissions

- Owner, Admin, BD Manager and BD Member may update operational tracking.
- Destructive social-update removal requires Owner, Admin or BD Manager.
- Future finance-only fields will use the existing finance permission helper.
- Future client and external-agency views will receive explicitly filtered payloads rather than the internal record.

## Next controlled slices

1. Global creator/KOL directory and campaign assignments.
2. Post log and agency rollups.
3. X Spaces, GTM activities, PR and partnerships.
4. Fundraising OS links for capital introductions.
5. Executive reporting, reporting-period filters, summaries and risk intelligence.
