(() => {
  'use strict';

  const loginLinks = [...document.querySelectorAll('a[href="/enter-crm"]')];
  loginLinks.forEach((link) => {
    const replacement = document.createElement('span');
    const isButton = link.classList.contains('button');
    const isTextLink = link.classList.contains('text-link');

    replacement.className = [
      isButton ? 'button button-quiet' : '',
      isTextLink ? 'text-link' : '',
      'public-access-closed',
    ].filter(Boolean).join(' ');
    replacement.dataset.publicAccess = 'invite-only';
    replacement.textContent = 'Private CRM · Invite only';
    replacement.setAttribute('aria-label', 'Private CRM access is invite only');
    if (isButton) replacement.setAttribute('aria-disabled', 'true');
    link.replaceWith(replacement);
  });

  const core = document.createElement('script');
  core.src = '/assets/public-home-r6-core.js?v=9';
  core.defer = true;
  core.dataset.akariPublicCore = 'r6';
  document.head.appendChild(core);
})();
