(() => {
  'use strict';

  let requestSequence = 0;

  async function loadEngagement(id, sequence) {
    try {
      const response = await fetch(`/api/engagements/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) return;
      const engagement = await response.json();
      if (sequence !== requestSequence) return;

      let attempts = 0;
      const apply = () => {
        if (sequence !== requestSequence) return;
        const form = document.querySelector('#revenue-active-form');
        if (!form) {
          attempts += 1;
          if (attempts < 40) setTimeout(apply, 50);
          return;
        }
        const fields = {
          campaignCost: engagement.campaignCost,
          creatorCost: engagement.creatorCost,
          otherCost: engagement.otherCost,
        };
        Object.entries(fields).forEach(([name, value]) => {
          const input = form.elements.namedItem(name);
          if (input && value !== null && value !== undefined) input.value = String(value);
        });
      };
      apply();
    } catch {
      // The canonical form remains available if the optional prefill request fails.
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-revenue-action="edit-engagement"][data-id]');
    if (!trigger) return;
    const sequence = ++requestSequence;
    loadEngagement(trigger.dataset.id, sequence);
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-revenue-action="cancel-form"],[data-revenue-action="close"]')) requestSequence += 1;
  }, true);
})();
