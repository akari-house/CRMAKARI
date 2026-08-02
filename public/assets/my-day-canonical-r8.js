(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nativeFetch = window.fetch.bind(window);
  const workRequests = new Map();
  let dragTaskId = '';
  let touchDrag = null;
  let scheduled = false;
  let slowLoadingTimer = null;

  const isMyDay = () => $('#view-root .page-head h1')?.textContent?.trim() === 'My Day';
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');

  function workRequest(input, init = {}) {
    try {
      if (!isMyDay() && !/\/day\/?$/.test(window.location.pathname)) return null;
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.origin);
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET' || url.origin !== window.location.origin || url.pathname !== '/api/work-os' || url.searchParams.get('full') === '1') return null;
      return { url, scope: url.searchParams.get('scope') === 'team' ? 'team' : 'mine' };
    } catch {
      return null;
    }
  }

  function scheduleFullHydration(entry) {
    if (entry.refreshScheduled) return;
    entry.refreshScheduled = true;
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      const root = $('#work-os-root');
      const refresh = $('[data-work-action="refresh"]');
      if (root && refresh && root.querySelector('.work-command')) {
        refresh.click();
        return;
      }
      if (attempts < 40) setTimeout(attempt, 100);
    };
    setTimeout(attempt, 0);
  }

  window.fetch = async function progressiveWorkFetch(input, init = {}) {
    const request = workRequest(input, init);
    if (!request) return nativeFetch(input, init);

    let entry = workRequests.get(request.scope);
    if (!entry) {
      entry = { coreServed: false, fullPromise: null, fullDelivered: false, refreshScheduled: false };
      workRequests.set(request.scope, entry);

      const coreUrl = new URL('/api/work-os-core', window.location.origin);
      coreUrl.searchParams.set('scope', request.scope);
      const coreResponse = await nativeFetch(coreUrl.toString(), init);
      if (!coreResponse.ok) {
        workRequests.delete(request.scope);
        return nativeFetch(input, init);
      }

      let corePayload = null;
      try {
        corePayload = await coreResponse.clone().json();
      } catch {
        corePayload = null;
      }
      if (corePayload?.partial !== true || !Array.isArray(corePayload.tasks) || !Array.isArray(corePayload.members)) {
        workRequests.delete(request.scope);
        return nativeFetch(input, init);
      }

      entry.coreServed = true;
      const fullUrl = new URL('/api/work-os', window.location.origin);
      fullUrl.searchParams.set('scope', request.scope);
      fullUrl.searchParams.set('full', '1');
      entry.fullPromise = nativeFetch(fullUrl.toString(), init).catch(() => null);
      scheduleFullHydration(entry);
      return coreResponse;
    }

    if (entry.coreServed && !entry.fullDelivered && entry.fullPromise) {
      const fullResponse = await entry.fullPromise;
      entry.fullDelivered = true;
      workRequests.delete(request.scope);
      if (fullResponse?.ok) return fullResponse.clone();
    }

    return nativeFetch(input, init);
  };

  function toast(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function armSlowLoadingNotice(root) {
    clearTimeout(slowLoadingTimer);
    slowLoadingTimer = setTimeout(() => {
      if (!root?.isConnected || !root.classList.contains('work-os-loading') || root.querySelector('.work-command')) return;
      const card = root.querySelector('.work-os-loading-card');
      if (!card) return;
      card.classList.add('is-slow');
      card.innerHTML = '<span>TEAM WORK OS</span><strong>Tasks are taking longer than expected.</strong><p>Your workspace is secure, but the task data request has not completed. Reload this view to retry.</p><button type="button" class="btn small" data-canonical-retry>Reload Tasks</button>';
    }, 8000);
  }

  function settleLoadingState() {
    const root = $('#work-os-root');
    if (!root || !root.querySelector('.work-command')) return;
    root.classList.remove('work-os-loading');
    root.removeAttribute('aria-busy');
    clearTimeout(slowLoadingTimer);
  }

  function ensureCanonicalMyDay() {
    if (!isMyDay()) return;

    $$('#view-root .task-board-panel, #view-root .my-day-support').forEach((node) => node.remove());

    const roots = $$('#view-root #work-os-root');
    let root = roots.shift();
    roots.forEach((node) => node.remove());

    if (!root) {
      const pageHead = $('#view-root .page-head');
      if (!pageHead) return;
      root = document.createElement('section');
      root.id = 'work-os-root';
      root.className = 'work-os work-os-loading';
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-busy', 'true');
      root.innerHTML = '<div class="work-os-loading-card"><span>TEAM WORK OS</span><strong>Loading your tasks…</strong><p>Opening the task board first; calendar and workflow details will follow.</p></div>';
      pageHead.insertAdjacentElement('afterend', root);
      armSlowLoadingNotice(root);
    }

    settleLoadingState();
  }

  function decorateCards() {
    $$('.work-card[data-work-task]').forEach((card) => {
      card.setAttribute('aria-grabbed', card.classList.contains('is-dragging') ? 'true' : 'false');
      if (card.querySelector('[data-work-drag-handle]')) return;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'work-card__drag';
      handle.draggable = true;
      handle.dataset.workDragHandle = '';
      handle.dataset.id = card.dataset.workTask;
      const taskName = card.querySelector('.work-card__title')?.textContent?.trim() || 'task';
      handle.setAttribute('aria-label', `Move ${taskName}`);
      handle.setAttribute('title', 'Drag to another status');
      handle.textContent = '⋮⋮';
      card.prepend(handle);
    });
  }

  function maintain() {
    scheduled = false;
    ensureCanonicalMyDay();
    decorateCards();
    settleLoadingState();
  }

  function scheduleMaintain() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(maintain);
  }

  function clearDragUi() {
    dragTaskId = '';
    touchDrag = null;
    document.body.classList.remove('work-is-dragging');
    $$('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
    $$('.work-card.is-dragging, .work-event.is-dragging').forEach((node) => {
      node.classList.remove('is-dragging');
      node.setAttribute?.('aria-grabbed', 'false');
    });
  }

  function transferredTaskId(event) {
    return event.dataTransfer?.getData('text/work-task') || event.dataTransfer?.getData('text/plain') || dragTaskId || touchDrag?.taskId || '';
  }

  function statusColumn(status) {
    return $(`.work-column[data-work-drop-status="${CSS.escape(status)}"]`);
  }

  function updateColumnCounts() {
    $$('.work-column[data-work-drop-status]').forEach((column) => {
      const count = column.querySelectorAll('.work-card[data-work-task]').length;
      const badge = column.querySelector(':scope > header b');
      if (badge) badge.textContent = String(count);
      const body = column.querySelector('.work-column__body');
      body?.querySelector('.work-empty-drop')?.remove();
      if (body && count === 0) body.innerHTML = '<div class="work-empty-drop">Drop a task here</div>';
    });
  }

  function moveCardOptimistically(taskId, status) {
    const card = $(`.work-card[data-work-task="${CSS.escape(taskId)}"]`);
    const column = statusColumn(status);
    const body = column?.querySelector('.work-column__body');
    if (!card || !body) return;
    body.querySelector('.work-empty-drop')?.remove();
    card.dataset.status = status;
    body.appendChild(card);
    updateColumnCounts();
  }

  async function persistMove(taskId, patch, message) {
    if (!taskId) return;
    if (patch.status) moveCardOptimistically(taskId, patch.status);

    try {
      const response = await fetch('/api/work-os', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update-task', taskId, ...patch }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Task update failed (${response.status})`);
      toast(message);
      $('[data-work-action="refresh"]')?.click();
    } catch (error) {
      toast(error.message || 'Task move failed', 'error');
      $('[data-work-action="refresh"]')?.click();
    }
  }

  function markDropTarget(target) {
    $$('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
    target?.classList.add('is-drop-target');
  }

  document.addEventListener('dragstart', (event) => {
    const card = event.target.closest?.('.work-card[data-work-task]');
    const calendarTask = event.target.closest?.('.work-event[data-source-id][data-event-type="TASK"]');
    const taskId = card?.dataset.workTask || calendarTask?.dataset.sourceId || '';
    if (!taskId) return;

    event.stopImmediatePropagation();
    dragTaskId = taskId;
    event.dataTransfer?.setData('text/work-task', taskId);
    event.dataTransfer?.setData('text/plain', taskId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    card?.classList.add('is-dragging');
    card?.setAttribute('aria-grabbed', 'true');
    calendarTask?.classList.add('is-dragging');
    document.body.classList.add('work-is-dragging');
  }, true);

  document.addEventListener('dragover', (event) => {
    const target = event.target.closest?.('[data-work-drop-status],[data-work-drop-date]');
    if (!target || !transferredTaskId(event)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    markDropTarget(target);
  }, true);

  document.addEventListener('dragleave', (event) => {
    const target = event.target.closest?.('[data-work-drop-status],[data-work-drop-date]');
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
  }, true);

  document.addEventListener('drop', async (event) => {
    const target = event.target.closest?.('[data-work-drop-status],[data-work-drop-date]');
    const taskId = transferredTaskId(event);
    if (!target || !taskId) return;

    event.stopImmediatePropagation();
    event.preventDefault();
    const status = target.dataset.workDropStatus;
    const date = target.dataset.workDropDate;
    clearDragUi();

    if (status) {
      await persistMove(taskId, { status }, `Task moved to ${title(status)}`);
    } else if (date) {
      await persistMove(taskId, { dueAt: `${date}T16:00:00.000Z` }, `Task rescheduled to ${date}`);
    }
  }, true);

  document.addEventListener('dragend', (event) => {
    if (!event.target.closest?.('[data-work-task],.work-event[data-event-type="TASK"]')) return;
    event.stopImmediatePropagation();
    clearDragUi();
  }, true);

  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.('[data-work-drag-handle]');
    if (!handle || event.pointerType === 'mouse') return;
    const card = handle.closest('.work-card[data-work-task]');
    if (!card) return;
    event.preventDefault();
    touchDrag = { taskId: card.dataset.workTask, pointerId: event.pointerId };
    card.classList.add('is-dragging');
    card.setAttribute('aria-grabbed', 'true');
    document.body.classList.add('work-is-dragging');
    handle.setPointerCapture?.(event.pointerId);
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-work-drop-status]');
    markDropTarget(target);
  }, true);

  document.addEventListener('pointerup', async (event) => {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    const taskId = touchDrag.taskId;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-work-drop-status]');
    const status = target?.dataset.workDropStatus;
    clearDragUi();
    if (status) await persistMove(taskId, { status }, `Task moved to ${title(status)}`);
  }, true);

  document.addEventListener('pointercancel', clearDragUi, true);

  document.addEventListener('keydown', async (event) => {
    const handle = event.target.closest?.('[data-work-drag-handle]');
    if (!handle || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const card = handle.closest('.work-card[data-work-task]');
    if (!card) return;
    const statuses = ['TODO', 'IN_PROGRESS', 'WAITING', 'DONE'];
    const current = statuses.indexOf(card.dataset.status || 'TODO');
    const next = Math.max(0, Math.min(statuses.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
    if (next === current) return;
    event.preventDefault();
    await persistMove(card.dataset.workTask, { status: statuses[next] }, `Task moved to ${title(statuses[next])}`);
  }, true);

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-canonical-retry]')) return;
    window.location.reload();
  }, true);

  const observer = new MutationObserver(scheduleMaintain);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', maintain);
  maintain();
})();