# Security Baseline

1. Keep the repository private.
2. Never commit raw CRM exports or production secrets.
3. Use Cloudflare Access for the first internal launch.
4. Set `AUTH_MODE=access` in production.
5. Every API query must include the authenticated `tenant_id`.
6. Finance permissions must be checked on the backend.
7. Add audit logs to every create, update, delete, stage, payment and permission change.
8. Add rate limits to authentication and write routes before external customer onboarding.
9. Use R2 objects behind permission-checked endpoints; do not expose private public URLs.
10. Test tenant isolation before onboarding Customer 002.

## Before external customers

- Add application-level invitations and sessions
- Add CSRF protection where cookie sessions are used
- Add support-access sessions with reason, expiry and audit history
- Add backup and tenant export procedures
- Add data-retention and deletion controls
- Complete a formal security review

