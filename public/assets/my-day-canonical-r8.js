(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let dragTaskId = '';
  let touchDrag = null;
  let scheduled = false;

  const isMyDay = () => $('#view-root .page-head h1')?.textContent?.trim() === 'My Day';
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');

  function toast(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3600);
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
      root.innerHTML = '<div class="work-os-loading-card"><span>TEAM WORK OS</span><strong>Loading tasks and calendar…</strong><p>Opening the canonical execution workspace.</p></div>';
      pageHead.insertAdjacentElement('afterend', root);
    }
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

  const observer = new MutationObserver(scheduleMaintain);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', maintain);
  maintain();
})();