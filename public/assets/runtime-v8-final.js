(() => {
  let ticks = 0;
  const stabilize = () => {
    document.documentElement.dataset.akariInteractive = 'ready';
    const route = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
    if (route === 'dashboard') {
      const heading = document.querySelector('#view-root .page-head h1');
      if (heading && !/^Good evening, Muaz/i.test(heading.textContent)) heading.textContent = 'Good evening, Muaz.';
    }
    document.querySelectorAll('[data-v8-task]').forEach((button) => button.dataset.action = 'toggle-task');
    const modalHeading = [...document.querySelectorAll('#modal-root h2')].find((node) => node.textContent.trim().toLowerCase() === 'new akari lead');
    if (modalHeading) modalHeading.textContent = 'New AKARI lead';
    ticks += 1;
    if (ticks < 80) requestAnimationFrame(stabilize);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stabilize); else stabilize();
})();
