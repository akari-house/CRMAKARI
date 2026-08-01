(() => {
  'use strict';

  const ROUTE_PATHS = Object.freeze({
    dashboard: '/',
    day: '/day',
    flows: '/flows',
    leads: '/leads',
    contacts: '/contacts',
    opportunities: '/opportunities',
    fundraising: '/fundraising',
    campaigns: '/campaigns',
    partners: '/partners',
    finance: '/finance',
    reports: '/reports',
    team: '/team',
    settings: '/settings',
  });

  const PATH_ROUTES = new Map(Object.entries(ROUTE_PATHS).map(([route, path]) => [path, route]));
  PATH_ROUTES.set('/home', 'dashboard');
  PATH_ROUTES.set('/dashboard', 'dashboard');

  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);

  const normalPath = (value = location.pathname) => {
    const clean = String(value || '/').replace(/\/+$/, '') || '/';
    return clean.startsWith('/') ? clean : `/${clean}`;
  };

  const routeFromPath = () => PATH_ROUTES.get(normalPath()) || null;
  const routeFromHash = (hash = location.hash) => {
    const route = String(hash || '').replace(/^#\/?/, '').split('?')[0];
    return Object.hasOwn(ROUTE_PATHS, route) ? route : null;
  };

  const cleanUrl = (route) => `${ROUTE_PATHS[route] || '/'}${location.search}`;
  const temporaryLegacyUrl = (route) => `/${location.search}#/${route}`;

  // crm.js remains the only renderer. It still calls pushState with legacy hash
  // routes, so translate those calls into clean paths before the browser writes
  // the URL. No duplicate router or application shell is introduced here.
  history.pushState = (state, title, url) => {
    if (typeof url === 'string') {
      const parsed = new URL(url, location.href);
      const route = routeFromHash(parsed.hash);
      if (route) return nativePushState({ ...(state || {}), akariRoute: route }, title, cleanUrl(route));
    }
    return nativePushState(state, title, url);
  };

  function preparePathForCanonicalRenderer() {
    if (routeFromHash()) return;
    const route = routeFromPath();
    if (!route || route === 'dashboard') {
      if (normalPath() !== '/' && route === 'dashboard') {
        nativeReplaceState({ ...(history.state || {}), akariRoute: 'dashboard' }, '', cleanUrl('dashboard'));
      }
      return;
    }
    // crm.js reads the route once from location.hash during bootstrap. Keep the
    // compatibility hash only until that renderer has consumed it.
    nativeReplaceState({ ...(history.state || {}), akariRoute: route }, '', temporaryLegacyUrl(route));
  }

  function exposeCleanUrlWhenReady() {
    const route = routeFromHash();
    if (!route) return;
    if (document.documentElement.dataset.akariInteractive !== 'ready') return;
    nativeReplaceState({ ...(history.state || {}), akariRoute: route }, '', cleanUrl(route));
  }

  function prepareHistoryNavigation() {
    const route = routeFromPath();
    if (!route || route === 'dashboard' || routeFromHash()) return;
    // This listener is registered before crm.js. On back/forward, temporarily
    // expose the compatibility hash so crm.js restores the intended screen.
    nativeReplaceState({ ...(history.state || {}), akariRoute: route }, '', temporaryLegacyUrl(route));
    setTimeout(exposeCleanUrlWhenReady, 0);
  }

  function closeModalRoot() {
    const root = document.querySelector('#modal-root');
    if (root) root.innerHTML = '';
  }

  function stabilizeDismissLayer(layer) {
    if (!(layer instanceof HTMLElement) || layer.dataset.akariDismissGuard === 'ready') return;
    layer.dataset.akariDismissGuard = 'ready';
    if (layer.dataset.action === 'close-modal') layer.removeAttribute('data-action');
    layer.addEventListener('click', (event) => {
      if (event.target !== layer) return;
      event.preventDefault();
      closeModalRoot();
    });
  }

  function stabilizeModals(scope = document) {
    scope.querySelectorAll?.('#modal-root .modal-backdrop, #modal-root .command-backdrop')
      .forEach(stabilizeDismissLayer);
  }

  preparePathForCanonicalRenderer();
  window.addEventListener('popstate', prepareHistoryNavigation);
  document.addEventListener('click', () => queueMicrotask(exposeCleanUrlWhenReady));

  const observer = new MutationObserver((mutations) => {
    stabilizeModals();
    if (mutations.some((mutation) => mutation.type === 'attributes' || mutation.addedNodes.length)) {
      exposeCleanUrlWhenReady();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-akari-interactive'],
  });

  document.addEventListener('DOMContentLoaded', () => {
    stabilizeModals();
    exposeCleanUrlWhenReady();
  });
})();
