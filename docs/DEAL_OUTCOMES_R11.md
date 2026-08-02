# Release 11 — Partnership and Service Deal Outcomes

AKARI CRM no longer assumes that every won opportunity is a billable client engagement.

## Supported won relationship models

### Strategic partnership

A partnership can create direct non-cash value through distribution, credibility, ecosystem access, technology, introductions, data or community reach.

- Project lifecycle becomes `PARTNER`.
- Engagement is marked `PARTNERSHIP` and `NON_BILLABLE`.
- Contract revenue, delivery costs, referral reward and invoice controls are not used.
- Strategic value can be described qualitatively and optionally estimated internally.
- No invoice can be created against the non-billable partnership engagement.

### Paid service or campaign

A service relationship covers marketing, KOL campaigns, advisory, delivery or another paid mandate.

- Project lifecycle becomes `CLIENT`.
- Engagement is marked `SERVICE` and invoice eligible.
- Final contract value, payment terms, delivery costs and referral economics are tracked.
- Finance can create an invoice from the connected engagement.

### Hybrid partnership and service

A hybrid relationship combines strategic partnership value with a paid service mandate.

- Project lifecycle becomes `CLIENT`.
- Engagement is marked `HYBRID` and invoice eligible.
- Partnership value and billable service revenue remain connected but are not confused.

## Optional social announcement activation

A won partnership, service or hybrid relationship can optionally create a social announcement plan.

The generated tasks cover:

1. Partnership scope and announcement details.
2. Partner logos, brand assets and official links.
3. Announcement copy and approved quotes.
4. Announcement graphics.
5. Internal review.
6. Partner approval.
7. Channel and date confirmation.
8. Scheduling.
9. Publishing and recording links.
10. Community engagement and partner follow-up.
11. Review and next joint activation.

Tasks are related to the same project, opportunity and engagement and are separated into BD, Operations, Content, Design, Account, Marketing, Social and Community workstreams.

## Invoice safety

Invoice eligibility is enforced in two places:

- The lifecycle UI removes invoice and payment actions for non-billable partnerships.
- The invoice API middleware rejects any attempt to create an invoice against a non-billable partnership engagement.

This release uses existing production tables and engagement metadata. No production schema migration or seed data is required.
