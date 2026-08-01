(() => {
  const pulse = () => {
    if (!document.body) return;
    const marker = document.createElement('span');
    marker.hidden = true;
    marker.dataset.bdRenderSync = 'pulse';
    document.body.appendChild(marker);
    marker.remove();
  };

  const settle = () => {
    queueMicrotask(pulse);
    setTimeout(pulse, 80);
    setTimeout(pulse, 240);
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-route],[data-action="refresh"]')) settle();
  });
  window.addEventListener('popstate', settle);
  window.addEventListener('pageshow', settle);
  settle();
})();
