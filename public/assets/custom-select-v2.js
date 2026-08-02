(() => {
  const ROOT_SELECTOR = '#modal-root,#commercial-modal-root,#work-os-modal-root';
  const ENHANCED = 'akSelectEnhanced';
  const controls = new Set();
  let openControl = null;
  let serial = 0;

  function selectableOptions(select) {
    return [...select.options].filter((option) => !option.hidden);
  }

  function selectedOption(select) {
    return select.options[select.selectedIndex] || selectableOptions(select)[0] || null;
  }

  function close(control, restoreFocus = false) {
    if (!control || !control.open) return;
    control.open = false;
    control.button.setAttribute('aria-expanded', 'false');
    control.menu.hidden = true;
    control.wrapper.classList.remove('is-open');
    if (openControl === control) openControl = null;
    if (restoreFocus && control.button.isConnected) control.button.focus({ preventScroll: true });
  }

  function closeAll(except = null) {
    if (openControl && openControl !== except) close(openControl);
  }

  function cleanupDisconnected() {
    controls.forEach((control) => {
      if (control.select.isConnected) return;
      close(control);
      control.menu.remove();
      controls.delete(control);
    });
  }

  function positionMenu(control) {
    if (!control.open || !control.button.isConnected) return;
    const rect = control.button.getBoundingClientRect();
    const gap = 7;
    const edge = 12;
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const desired = Math.min(300, Math.max(150, Math.max(below, above)));
    const openUp = below < 180 && above > below;
    const maxHeight = Math.max(120, openUp ? above : below);
    control.menu.style.left = `${Math.max(edge, rect.left)}px`;
    control.menu.style.width = `${Math.max(180, Math.min(rect.width, window.innerWidth - edge * 2))}px`;
    control.menu.style.maxHeight = `${Math.min(desired, maxHeight)}px`;
    control.menu.style.top = openUp ? 'auto' : `${rect.bottom + gap}px`;
    control.menu.style.bottom = openUp ? `${window.innerHeight - rect.top + gap}px` : 'auto';
    control.menu.classList.toggle('is-up', openUp);
  }

  function focusOption(control, index) {
    const items = [...control.menu.querySelectorAll('[role="option"]:not([aria-disabled="true"])')];
    if (!items.length) return;
    const bounded = Math.max(0, Math.min(index, items.length - 1));
    items[bounded].focus({ preventScroll: true });
    items[bounded].scrollIntoView({ block: 'nearest' });
  }

  function sync(control) {
    const option = selectedOption(control.select);
    control.label.textContent = option?.textContent?.trim() || 'Select…';
    control.button.disabled = control.select.disabled;
    control.button.setAttribute('aria-disabled', String(control.select.disabled));
    control.wrapper.classList.toggle('is-disabled', control.select.disabled);
    [...control.menu.querySelectorAll('[role="option"]')].forEach((item) => {
      const selected = item.dataset.value === String(control.select.value);
      item.setAttribute('aria-selected', String(selected));
      item.classList.toggle('is-selected', selected);
    });
  }

  function choose(control, value, notify = true) {
    if (control.select.disabled) return;
    const option = selectableOptions(control.select).find((item) => String(item.value) === String(value));
    if (!option || option.disabled) return;
    control.select.value = option.value;
    sync(control);
    close(control, true);
    if (notify) {
      control.select.dispatchEvent(new Event('input', { bubbles: true }));
      control.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function buildMenu(control) {
    const currentValue = String(control.select.value);
    control.menu.replaceChildren();
    [...control.select.children].forEach((child) => {
      if (child.tagName === 'OPTGROUP') {
        const group = document.createElement('div');
        group.className = 'ak-select__group';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', child.label || 'Options');
        const heading = document.createElement('div');
        heading.className = 'ak-select__group-label';
        heading.textContent = child.label || 'Options';
        group.appendChild(heading);
        [...child.children].forEach((option) => group.appendChild(optionNode(control, option, currentValue)));
        control.menu.appendChild(group);
        return;
      }
      if (child.tagName === 'OPTION' && !child.hidden) control.menu.appendChild(optionNode(control, child, currentValue));
    });
  }

  function optionNode(control, option, currentValue) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ak-select__option';
    item.dataset.value = String(option.value);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(String(option.value) === currentValue));
    item.setAttribute('aria-disabled', String(option.disabled));
    item.disabled = option.disabled;
    item.innerHTML = `<span>${escapeText(option.textContent || '')}</span><i aria-hidden="true">✓</i>`;
    if (String(option.value) === currentValue) item.classList.add('is-selected');
    item.addEventListener('click', () => choose(control, option.value));
    return item;
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  }

  function open(control, focus = 'selected') {
    if (control.select.disabled) return;
    closeAll(control);
    buildMenu(control);
    control.open = true;
    openControl = control;
    control.wrapper.classList.add('is-open');
    control.button.setAttribute('aria-expanded', 'true');
    control.menu.hidden = false;
    positionMenu(control);
    requestAnimationFrame(() => {
      positionMenu(control);
      const items = [...control.menu.querySelectorAll('[role="option"]:not([aria-disabled="true"])')];
      if (!items.length) return;
      if (focus === 'first') return focusOption(control, 0);
      if (focus === 'last') return focusOption(control, items.length - 1);
      const selectedIndex = Math.max(0, items.findIndex((item) => item.getAttribute('aria-selected') === 'true'));
      focusOption(control, selectedIndex);
    });
  }

  function onButtonKeydown(event, control) {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open(control, event.key === 'ArrowUp' ? 'last' : 'selected');
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      open(control, 'first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      open(control, 'last');
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const options = selectableOptions(control.select).filter((option) => !option.disabled);
      const start = Math.max(0, options.findIndex((option) => option.selected));
      const query = event.key.toLocaleLowerCase();
      const ordered = [...options.slice(start + 1), ...options.slice(0, start + 1)];
      const match = ordered.find((option) => option.textContent.trim().toLocaleLowerCase().startsWith(query));
      if (match) choose(control, match.value);
    }
  }

  function onMenuKeydown(event, control) {
    const items = [...control.menu.querySelectorAll('[role="option"]:not([aria-disabled="true"])')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(control, index < 0 ? 0 : Math.min(items.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(control, index < 0 ? items.length - 1 : Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(control, 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(control, items.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[index];
      if (item) choose(control, item.dataset.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(control, true);
    } else if (event.key === 'Tab') {
      close(control);
    }
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || !select.closest(ROOT_SELECTOR) || select.dataset[ENHANCED] || select.multiple || Number(select.size) > 1 || select.dataset.nativeSelect === 'true') return;
    select.dataset[ENHANCED] = 'true';
    const id = `ak-select-${++serial}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'ak-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ak-select__trigger';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `${id}-menu`);
    const accessibleLabel = select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim() || select.name || 'Select option';
    button.setAttribute('aria-label', accessibleLabel);
    const label = document.createElement('span');
    label.className = 'ak-select__value';
    const chevron = document.createElement('i');
    chevron.className = 'ak-select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(label, chevron);
    const menu = document.createElement('div');
    menu.id = `${id}-menu`;
    menu.className = 'ak-select__menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', accessibleLabel);
    menu.hidden = true;
    document.body.appendChild(menu);

    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, button);
    select.classList.add('ak-select__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const control = { select, wrapper, button, label, menu, open: false };
    controls.add(control);
    wrapper._akSelectControl = control;
    button.addEventListener('click', () => control.open ? close(control) : open(control));
    button.addEventListener('keydown', (event) => onButtonKeydown(event, control));
    menu.addEventListener('keydown', (event) => onMenuKeydown(event, control));
    select.addEventListener('change', () => sync(control));
    select.form?.addEventListener('reset', () => setTimeout(() => sync(control)));
    new MutationObserver(() => {
      buildMenu(control);
      sync(control);
    }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'hidden'] });
    buildMenu(control);
    sync(control);
  }

  function scan(root = document) {
    if (root instanceof HTMLSelectElement) enhance(root);
    root.querySelectorAll?.('select').forEach(enhance);
  }

  document.addEventListener('pointerdown', (event) => {
    if (!openControl) return;
    if (openControl.wrapper.contains(event.target) || openControl.menu.contains(event.target)) return;
    close(openControl);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openControl) close(openControl, true);
  }, true);
  window.addEventListener('resize', () => openControl && positionMenu(openControl), { passive: true });
  window.addEventListener('scroll', () => openControl && positionMenu(openControl), { passive: true, capture: true });

  const observer = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }));
    cleanupDisconnected();
  });

  function start() {
    scan(document);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();