(() => {
  const root = document.documentElement;
  root.dataset.akariUi = 'v1';
  document.body.classList.add('ak-ui', 'ak-grid');

  const classMap = [
    ['.panel', 'ak-panel'],
    ['.table-wrap', 'ak-panel'],
    ['.campaign-card', 'ak-card'],
    ['.deal-card', 'ak-card'],
    ['.record-row', 'ak-card'],
    ['.kpi', 'ak-card'],
    ['.mini-kpi', 'ak-card'],
    ['.empty-state', 'ak-empty'],
    ['table', 'ak-table'],
    ['.modal', 'ak-panel'],
    ['.drawer', 'ak-panel'],
  ];

  const applyClasses = (scope = document) => {
    classMap.forEach(([selector, className]) => {
      scope.querySelectorAll?.(selector).forEach((node) => node.classList.add(className));
    });

    scope.querySelectorAll?.('.btn, .icon-btn, .mobile-menu').forEach((node) => {
      node.classList.add('ak-btn');
      if (node.classList.contains('primary')) node.classList.add('ak-btn--primary');
      if (node.classList.contains('danger') || node.classList.contains('destructive')) node.classList.add('ak-btn--danger');
      if (node.classList.contains('icon-btn') || node.classList.contains('mobile-menu')) node.classList.add('ak-btn--icon');
    });

    scope.querySelectorAll?.('input, textarea, select').forEach((node) => {
      if (node.tagName === 'SELECT') node.classList.add('ak-select');
      else if (node.tagName === 'TEXTAREA') node.classList.add('ak-textarea');
      else node.classList.add('ak-input');
    });

    scope.querySelectorAll?.('.pill').forEach((node) => {
      node.classList.add('ak-pill');
      if (node.classList.contains('pink')) node.classList.add('ak-pill--pink');
      if (node.classList.contains('green')) node.classList.add('ak-pill--success');
      if (node.classList.contains('yellow')) node.classList.add('ak-pill--warning');
      if (node.classList.contains('red')) node.classList.add('ak-pill--danger');
    });

    scope.querySelectorAll?.('.skeleton').forEach((node) => node.classList.add('ak-skeleton'));
  };

  applyClasses();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        applyClasses(node);
        if (node.matches?.('.panel,.table-wrap,.campaign-card,.deal-card,.record-row,.kpi,.mini-kpi,.empty-state,table,.modal,.drawer,.btn,.icon-btn,.mobile-menu,input,textarea,select,.pill,.skeleton')) {
          applyClasses(node.parentElement || document);
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('pageshow', () => applyClasses());
  document.addEventListener('akari:route-rendered', () => applyClasses());
})();
