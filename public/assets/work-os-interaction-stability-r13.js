(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const quietWindowMs = 650;
  const maxWaitMs = 15000;
  let lastInteractionAt = 0;

  function isWorkTarget(target) {
    return target instanceof Element && Boolean(target.closest('#work-os-root, #work-os-modal-root'));
  }

  function noteInteraction(event) {
    if (isWorkTarget(event.target)) lastInteractionAt = Date.now();
  }

  function workIsBusy() {
    return document.body.classList.contains('work-is-dragging')
      || Boolean(document.querySelector('#work-os-root .is-dragging'))
      || Date.now() - lastInteractionAt < quietWindowMs;
  }

  async function waitForWorkIdle() {
    const startedAt = Date.now();
    // Always yield once after the full payload arrives. This prevents a response
    // from replacing a card between pointer-down and the native dragstart event.
    await new Promise((resolve) => setTimeout(resolve, 120));
    while (workIsBusy() && Date.now() - startedAt < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  function isFullWorkRequest(input, init = {}) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.origin);
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      return method === 'GET'
        && url.origin === window.location.origin
        && url.pathname === '/api/work-os'
        && url.searchParams.get('full') === '1';
    } catch {
      return false;
    }
  }

  window.fetch = async function stableWorkFetch(input, init = {}) {
    const response = await nativeFetch(input, init);
    if (isFullWorkRequest(input, init)) await waitForWorkIdle();
    return response;
  };

  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'dragstart', 'dragover', 'drop', 'keydown', 'focusin']) {
    document.addEventListener(type, noteInteraction, true);
  }
})();
