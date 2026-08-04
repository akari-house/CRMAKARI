(() => {
  'use strict';

  function labelWorkspaceControls(root = document) {
    const close = root.querySelector?.('.revenue-workspace [data-revenue-action="close"]');
    if (!close) return;
    close.setAttribute('aria-label', 'Close revenue workspace');
    if (!close.getAttribute('title')) close.setAttribute('title', 'Close revenue workspace');
  }

  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('.revenue-workspace') || node.querySelector?.('.revenue-workspace')) {
          labelWorkspaceControls(node.matches?.('.revenue-workspace') ? node : node);
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => labelWorkspaceControls());
  document.addEventListener('akari:route-rendered', () => labelWorkspaceControls());
  labelWorkspaceControls();
})();
