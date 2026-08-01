(() => {
  function protectProjectModal() {
    const modal = document.querySelector('#modal-root .ak-project-modal');
    const backdrop = modal?.closest('.modal-backdrop');
    if (!backdrop || backdrop.dataset.m1ProjectBackdrop === 'protected') return;
    backdrop.removeAttribute('data-v8-close');
    backdrop.dataset.m1ProjectBackdrop = 'protected';
  }

  document.addEventListener('click', (event) => {
    const backdrop = event.target.closest('[data-m1-project-backdrop="protected"]');
    if (!backdrop || event.target !== backdrop) return;
    event.preventDefault();
    const root = document.querySelector('#modal-root');
    if (root) root.innerHTML = '';
  });

  new MutationObserver(protectProjectModal).observe(document.documentElement, { childList:true, subtree:true });
  protectProjectModal();
})();
