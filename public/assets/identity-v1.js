(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[char]));
  const api = async (path) => {
    const response = await fetch(path, { credentials:'same-origin', headers:{'content-type':'application/json'} });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };
  const xUrl = (value) => {
    if (!value) return null;
    const handle = String(value).replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i,'').replace(/^@/,'').split(/[/?#]/)[0];
    return handle ? `https://x.com/${handle}` : null;
  };
  const telegramUrl = (value) => {
    if (!value) return null;
    const handle = String(value).replace(/^https?:\/\/t\.me\//i,'').replace(/^@/,'').split(/[/?#]/)[0];
    return handle ? `https://t.me/${handle}` : null;
  };

  function enhanceIdentityFields(root = document) {
    const forms = root.querySelectorAll?.('form') || [];
    for (const form of forms) {
      const x = form.querySelector('[name="xUrl"], [name="xHandle"]');
      const telegram = form.querySelector('[name="telegram"]');
      if (!x || !telegram || form.dataset.identityEnhanced === '1') continue;
      form.dataset.identityEnhanced = '1';
      x.required = true;
      telegram.required = true;
      x.placeholder = '@handle or https://x.com/handle';
      telegram.placeholder = '@handle or https://t.me/handle';
      const container = x.closest('.form-grid') || form;
      const note = document.createElement('div');
      note.className = 'live-banner identity-required';
      note.innerHTML = '<strong>Required identity:</strong> every lead and contact must include both an X account and Telegram handle so the team can find and contact them quickly.';
      container.prepend(note);
    }
  }

  async function enhanceContactsPage() {
    const root = $('#view-root');
    const heading = root?.querySelector('.page-head h1');
    if (!root || !heading || heading.textContent.trim() !== 'Contacts' || root.dataset.identityContacts === '1') return;
    root.dataset.identityContacts = '1';
    try {
      const payload = await api('/api/contacts');
      const items = payload.items || [];
      const body = root.querySelector('.panel-body');
      if (!body || !items.length) return;
      body.innerHTML = items.map((contact) => {
        const x = xUrl(contact.x_handle);
        const tg = telegramUrl(contact.telegram);
        const complete = Boolean(x && tg);
        return `<div class="record-row identity-row">
          <span class="record-avatar">${esc(String(contact.full_name || 'AK').split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase())}</span>
          <span class="record-main"><strong>${esc(contact.full_name)}</strong><small>${esc(contact.project_name || contact.job_title || 'Contact')}</small></span>
          <span class="identity-actions">
            ${x ? `<a class="btn small" href="${esc(x)}" target="_blank" rel="noopener">X ↗</a>` : '<span class="pill red">X missing</span>'}
            ${tg ? `<a class="btn small" href="${esc(tg)}" target="_blank" rel="noopener">Telegram ↗</a>` : '<span class="pill red">Telegram missing</span>'}
            <span class="pill ${complete ? 'green' : 'yellow'}">${complete ? 'Complete' : 'Update needed'}</span>
          </span>
        </div>`;
      }).join('');
    } catch { /* legacy view remains available */ }
  }

  async function enhanceLeadsPage() {
    const root = $('#view-root');
    const heading = root?.querySelector('.page-head h1');
    if (!root || !heading || !/AKARI Leads/i.test(heading.textContent) || root.dataset.identityLeads === '1') return;
    root.dataset.identityLeads = '1';
    try {
      const payload = await api('/api/akari-leads?limit=100&offset=0');
      const items = payload.items || [];
      const incomplete = items.filter((item) => !item.identity_complete || (Number(item.contact_count || 0) > 0 && !item.contact_identity_complete));
      const target = root.querySelector('.lifecycle-help, .table-tools');
      if (!target) return;
      const banner = document.createElement('div');
      banner.className = `live-banner ${incomplete.length ? 'warning' : ''}`;
      banner.innerHTML = incomplete.length
        ? `<strong>${incomplete.length} lead${incomplete.length === 1 ? '' : 's'} need identity updates.</strong> Add X and Telegram details before converting them into a Partner or Client.`
        : '<strong>Contact identity complete.</strong> All visible leads have X and Telegram details.';
      target.after(banner);
    } catch { /* no-op */ }
  }

  const observer = new MutationObserver(() => {
    enhanceIdentityFields();
    enhanceContactsPage();
    enhanceLeadsPage();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  enhanceIdentityFields();
})();
