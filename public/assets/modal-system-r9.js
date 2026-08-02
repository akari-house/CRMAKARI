(() => {
  'use strict';

  const rootSelectors = ['#modal-root', '#commercial-modal-root', '#work-os-modal-root'];
  const dialogSelector = '.modal, .commercial-modal, .work-modal, .revenue-form-card';
  const workspaceSelector = '.revenue-workspace, .service-delivery-workspace, .fundraising-workspace, .drawer';

  function replaceExactText(root, from, to) {
    if (!(root instanceof Element)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const matches = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.trim() === from) matches.push(walker.currentNode);
    }
    matches.forEach((node) => { node.nodeValue = node.nodeValue.replace(from, to); });
  }

  function normalizeTaskNavigation() {
    document.querySelectorAll('[data-route="day"]').forEach((node) => {
      replaceExactText(node, 'My Day', 'Tasks');
      if (node.classList.contains('nav-item')) node.setAttribute('aria-label', 'Tasks');
    });
    document.querySelectorAll('[data-command="day"] strong').forEach((node) => {
      if (node.textContent.trim() === 'Open My Day') node.textContent = 'Open Tasks';
    });
    document.querySelectorAll('.breadcrumb').forEach((node) => {
      if (node.textContent.trim() === 'My Day') node.textContent = 'Tasks';
    });
  }

  function normalizeDialog(dialog) {
    if (!(dialog instanceof HTMLElement) || dialog.matches(workspaceSelector)) return;
    dialog.classList.add('ak-modal-standard');

    const controls = [...dialog.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter((control) => !control.disabled && control.getAttribute('aria-hidden') !== 'true');
    const explicitWide = dialog.classList.contains('wide') || dialog.classList.contains('work-modal--wide');
    dialog.classList.toggle('ak-modal--wide', explicitWide || controls.length >= 8);

    const heading = dialog.querySelector('h1, h2, h3');
    if (heading && !dialog.hasAttribute('aria-labelledby')) {
      if (!heading.id) heading.id = `ak-modal-title-${crypto.randomUUID().slice(0, 8)}`;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
  }

  function normalizeAll() {
    let active = false;
    for (const selector of rootSelectors) {
      const root = document.querySelector(selector);
      if (!root) continue;
      root.querySelectorAll(dialogSelector).forEach((dialog) => {
        normalizeDialog(dialog);
        if (dialog instanceof HTMLElement && dialog.offsetParent !== null) active = true;
      });
    }
    document.body.classList.toggle('ak-modal-open', active);
    normalizeTaskNavigation();
  }

  const observer = new MutationObserver(() => queueMicrotask(normalizeAll));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', normalizeAll);
  document.addEventListener('akari:route-rendered', normalizeAll);
  window.addEventListener('pageshow', normalizeAll);
})();
