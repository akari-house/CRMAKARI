(() => {
  function protectProjectModal() {
    const modal = document.querySelector('#modal-root .ak-project-modal');
    const backdrop = modal?.closest('.modal-backdrop');
    if (!modal || !backdrop) return;

    // The legacy runtime stops click propagation from every modal. The
    // stabilized relationship workspace owns its own tab and form events, so
    // remove that inherited blocker while retaining an explicit close button.
    modal.removeAttribute('onclick');

    if (backdrop.dataset.m1ProjectBackdrop !== 'protected') {
      backdrop.removeAttribute('data-v8-close');
      backdrop.dataset.m1ProjectBackdrop = 'protected';
    }
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
