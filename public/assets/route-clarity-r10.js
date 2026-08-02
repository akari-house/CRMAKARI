(() => {
  'use strict';

  function normalizeLabels(scope = document) {
    scope.querySelectorAll?.('.nav-item--public[data-public-home]').forEach((link) => {
      const text = link.querySelector('.nav-text');
      if (text) text.textContent = 'Public Website';
      link.setAttribute('aria-label', 'Open the public CRM by AKARI website');
      link.setAttribute('title', 'Open the public CRM website');
    });

    scope.querySelectorAll?.('.mobile-bottom [data-route="day"] span').forEach((node) => {
      node.textContent = 'Tasks';
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        normalizeLabels(node);
        if (node.matches?.('.nav-item--public[data-public-home], .mobile-bottom [data-route="day"]')) {
          normalizeLabels(node.parentElement || document);
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => normalizeLabels());
  document.addEventListener('akari:route-rendered', () => normalizeLabels());
  window.addEventListener('pageshow', () => normalizeLabels());
  normalizeLabels();
})();