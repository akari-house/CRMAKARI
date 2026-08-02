(() => {
  'use strict';

  const rootSelectors = ['#modal-root', '#commercial-modal-root', '#work-os-modal-root'];
  const dialogSelector = '.modal, .commercial-modal, .work-modal, .revenue-form-card';
  const workspaceSelector = '.revenue-workspace, .service-delivery-workspace, .fundraising-workspace, .drawer';
  let activeCombobox = null;

  function replaceExactText(root, from, to) {
    if (!(root instanceof Element)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const matches = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.trim() === from) matches.push(walker.currentNode);
    }
    matches.forEach((node) => { node.nodeValue = node.nodeValue.replace(from, to); });
  }

  function normalizeTaskNavigation() {
    document.querySelectorAll('[data-route="day"]').forEach((node) => {
      replaceExactText(node, 'My Day', 'Tasks');
      if (node.classList.contains('nav-item')) node.setAttribute('aria-label', 'Tasks');
    });
    document.querySelectorAll('[data-command="day"] strong').forEach((node) => {
      if (node.textContent.trim() === 'Open My Day') node.textContent = 'Open Tasks';
    });
    document.querySelectorAll('.breadcrumb').forEach((node) => {
      if (node.textContent.trim() === 'My Day') node.textContent = 'Tasks';
    });
  }

  function normalizeDialog(dialog) {
    if (!(dialog instanceof HTMLElement) || dialog.matches(workspaceSelector)) return;
    dialog.classList.add('ak-modal-standard');

    const controls = [...dialog.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter((control) => !control.disabled && control.getAttribute('aria-hidden') !== 'true');
    const explicitWide = dialog.classList.contains('wide') || dialog.classList.contains('work-modal--wide');
    dialog.classList.toggle('ak-modal--wide', explicitWide || controls.length >= 8);

    const heading = dialog.querySelector('h1, h2, h3');
    if (heading && !dialog.hasAttribute('aria-labelledby') && !dialog.hasAttribute('aria-label')) {
      if (!heading.id) heading.id = `ak-modal-title-${crypto.randomUUID().slice(0, 8)}`;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
  }

  function selectLabel(select) {
    return select.getAttribute('aria-label')
      || select.closest('label')?.querySelector(':scope > span, :scope > label')?.textContent?.trim()
      || select.name
      || 'Choose an option';
  }

  function selectedText(select) {
    return select.selectedOptions?.[0]?.textContent?.trim() || 'Select';
  }

  function closeCombobox({ restoreFocus = false } = {}) {
    if (!activeCombobox) return;
    const { trigger, panel } = activeCombobox;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.classList.remove('is-open');
    panel?.remove();
    activeCombobox = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  function positionCombobox() {
    if (!activeCombobox) return;
    const { trigger, panel } = activeCombobox;
    if (!trigger?.isConnected || !panel?.isConnected) {
      closeCombobox();
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const availableBelow = window.innerHeight - rect.bottom - viewportGap;
    const availableAbove = rect.top - viewportGap;
    const openAbove = availableBelow < 220 && availableAbove > availableBelow;
    const maxHeight = Math.max(160, Math.min(360, openAbove ? availableAbove : availableBelow));
    panel.style.left = `${Math.max(viewportGap, Math.min(rect.left, window.innerWidth - rect.width - viewportGap))}px`;
    panel.style.width = `${Math.max(220, rect.width)}px`;
    panel.style.maxHeight = `${maxHeight}px`;
    panel.style.top = openAbove ? 'auto' : `${rect.bottom + 6}px`;
    panel.style.bottom = openAbove ? `${window.innerHeight - rect.top + 6}px` : 'auto';
  }

  function visibleOptionButtons(panel) {
    return [...panel.querySelectorAll('[data-ak-option-index]:not([disabled])')];
  }

  function focusOption(panel, direction) {
    const options = visibleOptionButtons(panel);
    if (!options.length) return;
    const current = options.indexOf(document.activeElement);
    let next = direction === 'first' ? 0 : direction === 'last' ? options.length - 1 : current + direction;
    if (current < 0 && typeof direction === 'number') next = direction > 0 ? 0 : options.length - 1;
    next = Math.max(0, Math.min(options.length - 1, next));
    options[next]?.focus();
  }

  function chooseOption(select, index, trigger) {
    const option = select.options[index];
    if (!option || option.disabled) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    trigger.querySelector('.ak-combobox__value').textContent = selectedText(select);
    trigger.classList.remove('is-invalid');
    closeCombobox({ restoreFocus: true });
  }

  function renderComboboxOptions(select, trigger, panel, query = '') {
    const list = panel.querySelector('.ak-combobox__list');
    if (!list) return;
    const normalized = query.trim().toLowerCase();
    const rows = [...select.options]
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !normalized || option.textContent.toLowerCase().includes(normalized));

    if (!rows.length) {
      list.innerHTML = '<div class="ak-combobox__empty">No matching options</div>';
      return;
    }

    list.innerHTML = rows.map(({ option, index }) => `
      <button type="button" role="option" class="ak-combobox__option ${index === select.selectedIndex ? 'is-selected' : ''}"
        aria-selected="${index === select.selectedIndex ? 'true' : 'false'}" data-ak-option-index="${index}" ${option.disabled ? 'disabled' : ''}>
        <span>${String(option.textContent || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]))}</span>
        ${index === select.selectedIndex ? '<b aria-hidden="true">✓</b>' : ''}
      </button>
    `).join('');

    list.querySelectorAll('[data-ak-option-index]').forEach((button) => {
      button.addEventListener('click', () => chooseOption(select, Number(button.dataset.akOptionIndex), trigger));
    });
  }

  function openCombobox(select, trigger) {
    if (select.disabled) return;
    if (activeCombobox?.trigger === trigger) {
      closeCombobox({ restoreFocus: true });
      return;
    }
    closeCombobox();

    const panel = document.createElement('div');
    const panelId = `ak-combobox-panel-${crypto.randomUUID().slice(0, 8)}`;
    panel.id = panelId;
    panel.className = 'ak-combobox__panel';
    panel.setAttribute('role', 'presentation');
    panel.innerHTML = `${select.options.length > 8 ? '<div class="ak-combobox__search-wrap"><input class="ak-combobox__search" type="search" autocomplete="off" placeholder="Search options…" aria-label="Search options"></div>' : ''}<div class="ak-combobox__list" role="listbox" aria-label="${selectLabel(select).replace(/"/g, '&quot;')}"></div>`;
    document.body.appendChild(panel);

    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', panelId);
    trigger.classList.add('is-open');
    activeCombobox = { select, trigger, panel };
    renderComboboxOptions(select, trigger, panel);
    positionCombobox();

    const search = panel.querySelector('.ak-combobox__search');
    search?.addEventListener('input', () => renderComboboxOptions(select, trigger, panel, search.value));
    search?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(panel, 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeCombobox({ restoreFocus: true });
      }
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCombobox({ restoreFocus: true });
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(panel, 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(panel, -1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusOption(panel, 'first');
      } else if (event.key === 'End') {
        event.preventDefault();
        focusOption(panel, 'last');
      }
    });

    requestAnimationFrame(() => {
      if (search) search.focus();
      else panel.querySelector('.ak-combobox__option.is-selected, .ak-combobox__option:not([disabled])')?.focus();
    });
  }

  function enhanceSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.dataset.akCombobox === 'true' || select.multiple || Number(select.size || 0) > 1) return;
    const parent = select.parentNode;
    if (!parent) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'ak-combobox';
    parent.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ak-combobox__trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', selectLabel(select));
    trigger.innerHTML = `<span class="ak-combobox__value"></span><span class="ak-combobox__chevron" aria-hidden="true">⌄</span>`;
    wrapper.appendChild(trigger);

    select.dataset.akCombobox = 'true';
    select.classList.add('ak-combobox__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const sync = () => {
      trigger.querySelector('.ak-combobox__value').textContent = selectedText(select);
      trigger.disabled = select.disabled;
      trigger.classList.toggle('is-disabled', select.disabled);
    };
    sync();

    trigger.addEventListener('click', () => openCombobox(select, trigger));
    trigger.addEventListener('keydown', (event) => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openCombobox(select, trigger);
      }
    });
    select.addEventListener('change', sync);
    select.addEventListener('invalid', (event) => {
      event.preventDefault();
      trigger.classList.add('is-invalid');
      trigger.focus();
    });
    select.form?.addEventListener('reset', () => setTimeout(sync, 0));
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
  }

  function normalizeAll() {
    let active = false;
    for (const selector of rootSelectors) {
      const root = document.querySelector(selector);
      if (!root) continue;
      root.querySelectorAll(dialogSelector).forEach((dialog) => {
        normalizeDialog(dialog);
        if (dialog instanceof HTMLElement && dialog.offsetParent !== null) active = true;
      });
      root.querySelectorAll('select').forEach(enhanceSelect);
    }
    if (activeCombobox && !activeCombobox.trigger?.isConnected) closeCombobox();
    document.body.classList.toggle('ak-modal-open', active);
    normalizeTaskNavigation();
  }

  document.addEventListener('pointerdown', (event) => {
    if (!activeCombobox) return;
    if (activeCombobox.panel.contains(event.target) || activeCombobox.trigger.contains(event.target)) return;
    closeCombobox();
  }, true);
  document.addEventListener('scroll', (event) => {
    if (!activeCombobox) return;
    if (event.target instanceof Node && activeCombobox.panel.contains(event.target)) return;
    closeCombobox();
  }, true);
  window.addEventListener('resize', positionCombobox);

  const observer = new MutationObserver(() => queueMicrotask(normalizeAll));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', normalizeAll);
  document.addEventListener('akari:route-rendered', normalizeAll);
  window.addEventListener('pageshow', normalizeAll);
})();
