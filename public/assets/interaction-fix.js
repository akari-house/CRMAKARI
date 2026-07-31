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

function closeOverlay() {
  const modalRoot = document.querySelector('#modal-root');
  if (modalRoot) modalRoot.innerHTML = '';
}

function dispatchAction(source, action) {
  const proxy = document.createElement('button');
  proxy.type = 'button';
  proxy.hidden = true;
  proxy.dataset.action = action;
  for (const [key, value] of Object.entries(source.dataset)) {
    if (key !== 'action') proxy.dataset[key] = value;
  }
  document.body.appendChild(proxy);
  proxy.click();
  proxy.remove();
}

/**
 * The approved CRM UI used delegated document clicks while modal and command
 * containers stopped bubbling. Capture-phase routing makes every nested action
 * functional without changing the visual design or the underlying API rules.
 */
document.addEventListener('click', (event) => {
  const commandItem = event.target.closest('[data-command]');
  if (commandItem) {
    const command = commandItem.dataset.command;
    if (!command) return;

    event.preventDefault();
    event.stopPropagation();
    closeOverlay();

    if (ROUTE_COMMANDS.has(command)) {
      const destination = `#/${command}`;
      if (location.hash !== destination) history.pushState(null, '', destination);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }

    dispatchAction(commandItem, command);
    return;
  }

  const actionItem = event.target.closest('[data-action]');
  if (!actionItem || !actionItem.closest('.modal, .command')) return;

  const action = actionItem.dataset.action;
  if (!action) return;

  event.preventDefault();
  event.stopPropagation();

  if (action === 'close-modal') {
    closeOverlay();
    return;
  }

  closeOverlay();
  dispatchAction(actionItem, action);
}, true);

window.addEventListener('load', () => {
  document.documentElement.dataset.akariInteractive = 'ready';
});
