# AKARI CRM interactivity release gate

This release keeps the approved AKARI CRM visual design and fixes delivery confidence.

Required gates:

1. Static validation must confirm the production entry loads only `crm.css` and `crm.js`.
2. Browser acceptance tests must click sidebar navigation, open and close a form modal, complete command-palette navigation and verify mobile navigation.
3. Cloudflare Pages must be deployed by an explicit GitHub Actions workflow, not inferred from an Access redirect.
4. The service-worker cache must be versioned so existing users receive the new interactive application.
5. No private CRM data, workbook contents or production credentials may enter the public repository.
