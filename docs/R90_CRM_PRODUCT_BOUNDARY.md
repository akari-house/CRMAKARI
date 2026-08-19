# R90 — CRM product boundary clarity

CRM by AKARI is a separate product from AKARI House.

## Canonical naming

- **AKARI House** — professional network and collaboration product at `akarihouse.com`.
- **CRM by AKARI** — commercial relationship and revenue operating system at `crm.akarihouse.com`.

## Public presentation rules

- CRM surfaces identify themselves as `CRM by AKARI` or `AKARI CRM`.
- Do not use generic `AKARI login` wording when the destination is specifically the CRM.
- Illustrative CRM workspace UI must not present itself as the AKARI House member application.
- Do not expose internal tenant/customer numbering such as `AKARI House is Customer 001` in user-facing copy.
- Shared AKARI branding is allowed; product purpose and interface identity remain distinct.

## Integration boundary

The House may call reviewed CRM API contracts server-to-server. CRM API access remains authenticated, tenant-scoped and scope-limited. This integration does not share browser sessions or merge the two product interfaces.
