# Production smoke boundary correction

The custom production domain `crm.akarihouse.com` is intentionally protected by Cloudflare Access, including the root route. An unauthenticated request therefore returns an Access redirect rather than the public Pages landing page.

The post-deploy smoke now validates:

- `crmakari.pages.dev/` as the public invite-only landing page;
- `crm.akarihouse.com/` as a valid Cloudflare Access redirect;
- both `/app/` routes as protected boundaries;
- both API routes as either application-level 401 or verified Cloudflare Access redirects.

This change removes a false-negative smoke failure without weakening authentication checks.
