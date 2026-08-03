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

  function providerStatus(provider) {
    if (provider.configured) return { tone: 'ready', label: 'Ready' };
    if (!provider.secretConfigured) return { tone: 'blocked', label: 'Cloudflare secret required' };
    return { tone: 'warning', label: 'Model required' };
  }

  function providerCard(provider, data) {
    const status = providerStatus(provider);
    const isPrimary = data.primaryProvider === provider.provider;
    const disabled = data.canManage ? '' : 'disabled';
    return `<article class="ai17-provider ${isPrimary ? 'is-primary' : ''}" data-ai17-provider="${provider.provider}">
      <header>
        <label class="ai17-primary-choice">
          <input type="radio" name="ai17-primary" value="${provider.provider}" ${isPrimary ? 'checked' : ''} ${disabled}>
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(provider.label)}</strong>
        </label>
        <em class="ai17-status ai17-status--${status.tone}">${escapeHtml(status.label)}</em>
      </header>
      <p>${provider.provider === 'OPENAI' ? 'Use OpenAI API models, including ChatGPT-family models, through the Responses API.' : 'Use Claude models through the Anthropic Messages API.'}</p>
      <label class="ai17-field">
        <span>Model ID</span>
        <input type="text" data-ai17-model="${provider.provider}" maxlength="160" value="${escapeHtml(provider.model || data.models?.[provider.provider] || '')}" placeholder="Configured model ID" ${disabled}>
      </label>
      <div class="ai17-provider-meta">
        <span>Secret: <b>${provider.secretConfigured ? 'Configured' : 'Missing'}</b></span>
        <span>Credentials: <b>Cloudflare only</b></span>
      </div>
    </article>`;
  }

  function purposeLabel(purpose) {
    return purpose.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function render(root, data) {
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const enabledPurposes = new Set(data.enabledPurposes || []);
    root.innerHTML = `<section class="ai17-shell" aria-labelledby="ai17-title">
      <header class="ai17-hero">
        <div>
          <span class="ai17-eyebrow">CONTROLLED AI GATEWAY</span>
          <h2 id="ai17-title">AI model providers</h2>
          <p>Choose OpenAI (ChatGPT models) or Anthropic (Claude models) per workspace. AKARI keeps one governed proposal layer so the provider can change without changing the fundraising workflow.</p>
        </div>
        <label class="ai17-enable">
          <input type="checkbox" data-ai17-enabled ${data.enabled ? 'checked' : ''} ${data.canManage ? '' : 'disabled'}>
          <span aria-hidden="true"></span>
          <b>${data.enabled ? 'Enabled' : 'Disabled'}</b>
        </label>
      </header>

      <div class="ai17-providers">${providers.map((provider) => providerCard(provider, data)).join('')}</div>

      <div class="ai17-controls">
        <section>
          <span class="ai17-section-label">FAILOVER</span>
          <label class="ai17-toggle-row">
            <input type="checkbox" data-ai17-fallback ${data.allowFallback ? 'checked' : ''} ${data.canManage ? '' : 'disabled'}>
            <span aria-hidden="true"></span>
            <div><strong>Use the other provider as fallback</strong><small>Fallback runs only for provider outages, rate limits or missing primary availability—not for invalid or disallowed requests.</small></div>
          </label>
        </section>
        <section>
          <span class="ai17-section-label">OUTPUT LIMIT</span>
          <label class="ai17-field ai17-field--compact"><span>Maximum output tokens</span><input type="number" data-ai17-tokens min="256" max="4000" step="128" value="${escapeHtml(data.maxOutputTokens || 1200)}" ${data.canManage ? '' : 'disabled'}></label>
        </section>
      </div>

      <section class="ai17-purposes">
        <header><div><span class="ai17-section-label">ALLOWED PROPOSALS</span><strong>Human-reviewed AI tasks</strong></div><small>No direct sending or CRM mutation</small></header>
        <div>${(data.purposes || []).map((purpose) => `<label class="ai17-purpose"><input type="checkbox" value="${purpose}" data-ai17-purpose ${enabledPurposes.has(purpose) ? 'checked' : ''} ${data.canManage ? '' : 'disabled'}><span aria-hidden="true"></span><b>${escapeHtml(purposeLabel(purpose))}</b></label>`).join('')}</div>
      </section>

      <footer class="ai17-footer">
        <div><strong>Secret rule</strong><p>${escapeHtml(data.secretRule || 'API keys are configured as Cloudflare secrets and never stored in the CRM.')}</p></div>
        ${data.canManage ? '<button type="button" data-ai17-save>Save AI configuration</button>' : '<span class="ai17-readonly">Owner/Admin controlled</span>'}
      </footer>
    </section>`;
    bind(root);
  }

  function loadingView(root) {
    root.innerHTML = '<section class="ai17-shell ai17-loading"><i></i><strong>Loading AI provider controls…</strong></section>';
  }

  function errorView(root, message) {
    root.innerHTML = `<section class="ai17-shell ai17-error"><strong>AI provider controls could not be loaded</strong><p>${escapeHtml(message)}</p><button type="button" data-ai17-refresh>Try again</button></section>`;
    root.querySelector('[data-ai17-refresh]')?.addEventListener('click', () => load(root, true));
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
      payload = await request('/api/ai/providers');
      render(root, payload);
    } catch (cause) {
      errorView(root, cause.message || 'Unknown error');
    } finally {
      loading = false;
    }
  }

  async function save(root, button) {
    const primaryProvider = root.querySelector('input[name="ai17-primary"]:checked')?.value || 'OPENAI';
    const fallbackProvider = primaryProvider === 'OPENAI' ? 'ANTHROPIC' : 'OPENAI';
    const body = {
      enabled: Boolean(root.querySelector('[data-ai17-enabled]')?.checked),
      primaryProvider,
      fallbackProvider,
      allowFallback: Boolean(root.querySelector('[data-ai17-fallback]')?.checked),
      models: {
        OPENAI: root.querySelector('[data-ai17-model="OPENAI"]')?.value || '',
        ANTHROPIC: root.querySelector('[data-ai17-model="ANTHROPIC"]')?.value || '',
      },
      enabledPurposes: [...root.querySelectorAll('[data-ai17-purpose]:checked')].map((input) => input.value),
      maxOutputTokens: Number(root.querySelector('[data-ai17-tokens]')?.value || 1200),
    };
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      payload = await request('/api/ai/providers', { method: 'POST', body: JSON.stringify(body) });
      notify('AI provider configuration updated');
      render(root, payload);
    } catch (cause) {
      notify(cause.message || 'AI provider configuration could not be saved', 'error');
      button.disabled = false;
      button.textContent = 'Save AI configuration';
    }
  }

  function bind(root) {
    root.querySelectorAll('input[name="ai17-primary"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        root.querySelectorAll('[data-ai17-provider]').forEach((card) => card.classList.toggle('is-primary', card.dataset.ai17Provider === radio.value));
      });
    });
    root.querySelector('[data-ai17-enabled]')?.addEventListener('change', (event) => {
      const label = event.currentTarget.closest('.ai17-enable')?.querySelector('b');
      if (label) label.textContent = event.currentTarget.checked ? 'Enabled' : 'Disabled';
    });
    const saveButton = root.querySelector('[data-ai17-save]');
    saveButton?.addEventListener('click', () => save(root, saveButton));
  }

  function mount() {
    scheduled = false;
    if (!isSettingsRoute()) return;
    const view = document.querySelector('#view-root');
    if (!view || !view.querySelector('h1, h2')) return;
    let root = view.querySelector('#ai-providers-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'ai-providers-root';
      root.dataset.akariAiProviders = 'r17';
      const readiness = view.querySelector('#production-readiness-root');
      if (readiness) readiness.insertAdjacentElement('beforebegin', root);
      else view.appendChild(root);
    }
    if (root.dataset.ai17Mounted === 'true') return;
    root.dataset.ai17Mounted = 'true';
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
