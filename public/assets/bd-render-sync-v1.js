(() => {
  let settleRun = 0;

  const pulse = () => {
    if (!document.body) return;
    const marker = document.createElement('span');
    marker.hidden = true;
    marker.dataset.bdRenderSync = 'pulse';
    document.body.appendChild(marker);
    marker.remove();
  };

  const settle = () => {
    const run = ++settleRun;
    let attempt = 0;
    const tick = () => {
      if (run !== settleRun) return;
      pulse();
      attempt += 1;
      const heading = document.querySelector('#view-root .page-head h1')?.textContent?.trim();
      const billingReady = Boolean(document.querySelector('#view-root [data-bd-billing-profile]'));
      if (billingReady || attempt >= 30) return;
      const delay = heading === 'Settings' ? 180 : 260;
      setTimeout(tick, delay);
    };
    queueMicrotask(tick);
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-route],[data-action="refresh"]')) settle();
  });
  window.addEventListener('popstate', settle);
  window.addEventListener('pageshow', settle);
  settle();
})();
