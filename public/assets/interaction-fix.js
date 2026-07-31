const ROUTE_COMMANDS = new Set([
  'dashboard',
  'day',
  'leads',
  'contacts',
  'opportunities',
  'fundraising',
  'campaigns',
  'partners',
  'finance',
  'reports',
  'team',
  'settings',
]);

/**
 * Command-palette clicks are captured before the palette container's legacy
 * stopPropagation handler. This preserves the approved UI while ensuring every
 * command is actionable on desktop, mobile and installed-PWA sessions.
 */
document.addEventListener('click', (event) => {
  const item = event.target.closest('[data-command]');
  if (!item) return;

  const command = item.dataset.command;
  if (!command) return;

  event.preventDefault();
  event.stopPropagation();

  const modalRoot = document.querySelector('#modal-root');
  if (modalRoot) modalRoot.innerHTML = '';

  if (ROUTE_COMMANDS.has(command)) {
    const destination = `#/${command}`;
    if (location.hash !== destination) history.pushState(null, '', destination);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }

  const proxy = document.createElement('button');
  proxy.type = 'button';
  proxy.hidden = true;
  proxy.dataset.action = command;
  document.body.appendChild(proxy);
  proxy.click();
  proxy.remove();
}, true);

window.addEventListener('load', () => {
  document.documentElement.dataset.akariInteractive = 'ready';
});
