(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    if (typeof raw === 'string' && raw.startsWith('/api/projects?')) {
      const url = new URL(raw, location.origin);
      const limit = url.searchParams.get('limit') || '50';
      const offset = url.searchParams.get('offset') || '0';
      const search = url.searchParams.get('search') || '';
      const query = new URLSearchParams({ limit, offset });
      if (search) query.set('search', search);
      return nativeFetch(`/api/akari-leads?${query}`, init);
    }
    return nativeFetch(input, init);
  };

  function firstName() {
    const profile = document.querySelector('.profile-meta strong')?.textContent?.trim();
    return (profile && profile !== 'AKARI User' ? profile : 'Muaz').split(/\s+/)[0];
  }

  function ensureCompatibility() {
    document.documentElement.dataset.akariInteractive = 'ready';
    const dashboardHeading = document.querySelector('#view-root .page-head h1');
    if (dashboardHeading && location.hash.replace(/^#\/?/, '').split('?')[0] === 'dashboard') {
      dashboardHeading.textContent = `Good evening, ${firstName()}.`;
    }
    document.querySelectorAll('[data-v8-task]').forEach((button) => {
      button.dataset.action = 'toggle-task';
    });
    const leadHeading = [...document.querySelectorAll('#modal-root h2')].find((node) => node.textContent.trim() === 'New AKARI Lead');
    if (leadHeading) leadHeading.textContent = 'New AKARI lead';
  }

  const observer = new MutationObserver(ensureCompatibility);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function openCommand() {
    const root = document.querySelector('#modal-root');
    if (!root) return;
    root.innerHTML = `<div class="modal-backdrop"><div class="command modal" role="dialog" aria-modal="true">
      <div class="command-input"><span>⌕</span><input id="command-input" placeholder="Search or run a command…" autofocus /><button class="icon-btn" data-v8-close>×</button></div>
      <div class="command-list">
        <button class="command-item" data-command="leads"><strong>AKARI Leads</strong><small>Open the AKARI House lead database</small></button>
        <button class="command-item" data-command="day"><strong>My Day</strong><small>Open tasks and follow-ups</small></button>
        <button class="command-item" data-command="opportunities"><strong>Opportunities</strong><small>Open the sales pipeline</small></button>
      </div>
    </div></div>`;
    setTimeout(() => document.querySelector('#command-input')?.focus(), 0);
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      openCommand();
    }
  }, true);

  document.addEventListener('click', (event) => {
    const command = event.target.closest('[data-command]');
    if (command) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelector('#modal-root').innerHTML = '';
      location.hash = `#/${command.dataset.command}`;
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const openSidebar = event.target.closest('[data-action="open-sidebar"]');
    if (openSidebar) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelector('#sidebar')?.classList.add('open');
      document.querySelector('.sidebar-backdrop')?.classList.add('open');
    }
  }, true);

  ensureCompatibility();
})();
