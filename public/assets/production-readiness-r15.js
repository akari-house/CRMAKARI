(() => {
  'use strict';

  let scheduled = false;
  let loading = false;
  let payload = null;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function isSettingsRoute() {
    const path = String(location.pathname || '').replace(/\/+$/, '');
    return path.endsWith('/settings') || path === '/settings';
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function notify(message, type = 'success') {
    const root = document.querySelector('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function tone(status) {
    return status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'warning';
  }

  function scoreTone(score) {
    if (score >= 85) return 'pass';
    if (score >= 60) return 'warning';
    return 'fail';
  }

  function metric(label, value, detail) {
    return `<article class="pr15-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
  }

  function automaticCard(item) {
    return `<article class="pr15-check pr15-check--${tone(item.status)}">
      <div class="pr15-check__status"><i aria-hidden="true"></i><span>${escapeHtml(item.status)}</span></div>
      <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
    </article>`;
  }

  function manualCard(item, canManage) {
    return `<article class="pr15-signoff ${item.completed ? 'is-complete' : ''}" data-pr15-signoff="${escapeHtml(item.key)}">
      <label class="pr15-signoff__check">
        <input type="checkbox" data-pr15-completed ${item.completed ? 'checked' : ''} ${canManage ? '' : 'disabled'}>
        <span aria-hidden="true"></span>
      </label>
      <div class="pr15-signoff__copy">
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.description)}</p>
        <input type="text" data-pr15-note maxlength="1000" value="${escapeHtml(item.note)}" placeholder="Optional evidence or note" ${canManage ? '' : 'disabled'}>
        <small>${item.checkedAt ? `Last updated ${escapeHtml(new Date(item.checkedAt).toLocaleString())}${item.checkedBy ? ` by ${escapeHtml(item.checkedBy)}` : ''}` : 'Not signed off yet'}</small>
      </div>
      <button type="button" class="pr15-save" data-pr15-save ${canManage ? '' : 'disabled'}>Save</button>
    </article>`;
  }

  function rolePills(roles) {
    if (!roles?.length) return '<span class="pr15-empty">No active memberships detected.</span>';
    return roles.map((item) => `<span class="pr15-role"><b>${escapeHtml(item.role.replaceAll('_', ' '))}</b><em>${escapeHtml(item.count)}</em></span>`).join('');
  }

  function render(root, data) {
    const counts = data.counts || {};
    const score = Number(data.readinessScore || 0);
    root.innerHTML = `<section class="pr15-shell" aria-labelledby="pr15-title">
      <header class="pr15-hero">
        <div>
          <span class="pr15-eyebrow">RELEASE 6.1 · PRODUCTION COMPLETION</span>
          <h2 id="pr15-title">Production readiness</h2>
          <p>Verify the live workspace, complete the launch sign-off and keep a recoverable tenant snapshot before wider team use.</p>
        </div>
        <div class="pr15-score pr15-score--${scoreTone(score)}" aria-label="Readiness score ${score} percent">
          <strong>${score}%</strong><span>READY</span>
        </div>
      </header>

      <div class="pr15-actions">
        <button type="button" data-pr15-refresh><span aria-hidden="true">↻</span> Run checks</button>
        ${data.canExport ? '<a href="/api/tenant-export" data-pr15-export><span aria-hidden="true">⇩</span> Download tenant backup</a>' : ''}
        <a href="./leads" data-pr15-link="leads">Open lead cleanup</a>
        <a href="./opportunities" data-pr15-link="opportunities">Open commercial flow</a>
      </div>

      <div class="pr15-metrics">
        ${metric('Relationships', counts.projects || 0, `${counts.contacts || 0} contacts`)}
        ${metric('AKARI leads', counts.leads || 0, `${counts.leadsWithOwner || 0} assigned`)}
        ${metric('Open work', counts.openTasks || 0, `${counts.overdueTasks || 0} overdue`)}
        ${metric('Commercial', counts.openOpportunities || 0, `${counts.wonOpportunities || 0} won`)}
        ${metric('Delivery', counts.activeCampaigns || 0, `${counts.paymentRecords || 0} payment records`)}
        ${metric('Team', counts.activeMembers || 0, `${counts.activeOwners || 0} owner`)}
      </div>

      <div class="pr15-grid">
        <section class="pr15-panel">
          <header><div><span>AUTOMATIC CHECKS</span><strong>Live workspace health</strong></div><small>Generated ${escapeHtml(new Date(data.generatedAt).toLocaleString())}</small></header>
          <div class="pr15-checks">${(data.automaticChecks || []).map(automaticCard).join('')}</div>
        </section>

        <section class="pr15-panel">
          <header><div><span>TEAM ACCESS</span><strong>Active role coverage</strong></div><small>Tenant-scoped memberships</small></header>
          <div class="pr15-roles">${rolePills(data.roles)}</div>
          <div class="pr15-backup">
            <span>RECOVERY STATUS</span>
            <strong>${data.lastBackup?.created_at ? 'Backup recorded' : 'Backup required'}</strong>
            <p>${data.lastBackup?.created_at ? `Last exported ${escapeHtml(new Date(data.lastBackup.created_at).toLocaleString())}` : 'Download the first tenant backup and store it in an approved private location.'}</p>
          </div>
        </section>
      </div>

      <section class="pr15-panel pr15-panel--signoff">
        <header><div><span>MANUAL SIGN-OFF</span><strong>Controlled production acceptance</strong></div><small>${data.canManage ? 'Owner/Admin controlled' : 'Read only'}</small></header>
        <div class="pr15-signoffs">${(data.manualChecks || []).map((item) => manualCard(item, data.canManage)).join('')}</div>
      </section>

      <footer class="pr15-footer">
        <p><strong>Restore rule:</strong> tenant backup files are recovery snapshots. Never upload them through the AKARI Leads workbook importer.</p>
        <span>${escapeHtml(data.tenant?.name || 'Workspace')} · ${escapeHtml(data.tenant?.plan_code || 'FOUNDING')} · ${escapeHtml(data.tenant?.timezone || '')}</span>
      </footer>
    </section>`;

    bind(root);
  }

  function loadingView(root) {
    root.innerHTML = `<section class="pr15-shell pr15-loading" aria-live="polite"><div><i></i><strong>Checking production readiness…</strong><span>Reading tenant-scoped operational signals.</span></div></section>`;
  }

  function errorView(root, message) {
    root.innerHTML = `<section class="pr15-shell pr15-error"><strong>Production readiness could not be loaded</strong><p>${escapeHtml(message)}</p><button type="button" data-pr15-refresh>Try again</button></section>`;
    bind(root);
  }

  async function load(root, force = false) {
    if (loading) return;
    if (payload && !force) {
      render(root, payload);
      return;
    }
    loading = true;
    loadingView(root);
    try {
      payload = await request('/api/production-readiness');
      render(root, payload);
    } catch (cause) {
      errorView(root, cause.message || 'Unknown error');
    } finally {
      loading = false;
    }
  }

  async function saveSignoff(card, button) {
    if (!card || !button) return;
    const key = card.dataset.pr15Signoff;
    const completed = Boolean(card.querySelector('[data-pr15-completed]')?.checked);
    const note = card.querySelector('[data-pr15-note]')?.value || '';
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await request('/api/production-readiness', {
        method: 'POST',
        body: JSON.stringify({ key, completed, note }),
      });
      payload = null;
      notify('Production sign-off updated');
      const root = document.querySelector('#production-readiness-root');
      if (root) await load(root, true);
    } catch (cause) {
      notify(cause.message || 'Sign-off could not be saved', 'error');
      button.disabled = false;
      button.textContent = 'Save';
    }
  }

  function bind(root) {
    root.querySelector('[data-pr15-refresh]')?.addEventListener('click', () => {
      payload = null;
      load(root, true);
    });
    root.querySelector('[data-pr15-export]')?.addEventListener('click', () => {
      setTimeout(() => {
        payload = null;
        load(root, true);
      }, 1800);
    });
    root.querySelectorAll('[data-pr15-save]').forEach((button) => {
      button.addEventListener('click', () => saveSignoff(button.closest('[data-pr15-signoff]'), button));
    });
    root.querySelectorAll('[data-pr15-completed]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => checkbox.closest('[data-pr15-signoff]')?.classList.toggle('is-complete', checkbox.checked));
    });
  }

  function mount() {
    scheduled = false;
    if (!isSettingsRoute()) return;
    const view = document.querySelector('#view-root');
    if (!view || !view.querySelector('h1, h2')) return;
    let root = view.querySelector('#production-readiness-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'production-readiness-root';
      root.dataset.akariProductionReadiness = 'r15';
      view.appendChild(root);
    }
    if (root.dataset.pr15Mounted === 'true') return;
    root.dataset.pr15Mounted = 'true';
    load(root);
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(mount);
  }

  new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scheduleMount);
  document.addEventListener('akari:route-rendered', scheduleMount);
  window.addEventListener('popstate', scheduleMount);
  scheduleMount();
})();
