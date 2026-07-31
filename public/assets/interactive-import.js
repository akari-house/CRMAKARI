const SHEETJS_MODULE = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const state = {
  me: null,
  page: 0,
  limit: 50,
  total: 0,
  search: '',
  category: '',
  priority: '',
  items: [],
  categories: [],
  canWrite: false,
  importData: null,
  importing: false,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').replace(/\s+/g, ' ');
}

function stablePart(value, fallback = 'record') {
  return text(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function initials(value) {
  return text(value || 'AK').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function titleCase(value) {
  return text(value).toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
}

async function api(path, options = {}) {
  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const cause = new Error(payload.error || `Request failed with status ${response.status}`);
    cause.status = response.status;
    cause.details = payload.details;
    throw cause;
  }
  return payload;
}

function injectStyles() {
  if (document.getElementById('akariLeadsStyles')) return;
  const style = document.createElement('style');
  style.id = 'akariLeadsStyles';
  style.textContent = `
    .akari-leads-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}
    .akari-leads-kpi{background:rgba(17,21,34,.84);border:1px solid var(--line);border-radius:14px;padding:15px}
    .akari-leads-kpi span{display:block;color:var(--muted-2);font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}
    .akari-leads-kpi strong{display:block;font-size:24px;margin-top:9px;letter-spacing:-.03em}
    .akari-leads-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
    .akari-leads-toolbar .table-search{flex:1;min-width:240px}
    .akari-select{height:35px;min-width:150px;padding:0 10px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--text);outline:none}
    .akari-pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 2px;color:var(--muted);font-size:11px}
    .akari-modal-overlay{position:fixed;inset:0;z-index:150;background:rgba(0,0,0,.68);display:none;place-items:center;padding:20px}
    .akari-modal-overlay.open{display:grid}
    .akari-modal{width:min(860px,96vw);max-height:92vh;overflow:auto;background:#0e121d;border:1px solid var(--line-strong);border-radius:16px;box-shadow:var(--shadow)}
    .akari-modal.small{width:min(590px,96vw)}
    .akari-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px;border-bottom:1px solid var(--line)}
    .akari-modal-head h2{margin:0;font-size:20px;letter-spacing:-.025em}
    .akari-modal-head p{margin:6px 0 0;color:var(--muted);font-size:11px;line-height:1.5}
    .akari-modal-body{padding:20px}
    .akari-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:15px 20px;border-top:1px solid var(--line);position:sticky;bottom:0;background:#0e121d}
    .akari-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
    .akari-field{display:grid;gap:6px}
    .akari-field.full{grid-column:1/-1}
    .akari-field label{font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.06em}
    .akari-field input,.akari-field textarea,.akari-field select{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;padding:10px;outline:none}
    .akari-field textarea{min-height:95px;resize:vertical}
    .akari-field input:focus,.akari-field textarea:focus,.akari-field select:focus{border-color:rgba(240,79,135,.48);box-shadow:0 0 0 4px rgba(240,79,135,.08)}
    .akari-dropzone{border:1px dashed rgba(240,79,135,.42);background:rgba(240,79,135,.055);border-radius:14px;padding:28px;text-align:center;cursor:pointer;transition:.16s ease}
    .akari-dropzone:hover,.akari-dropzone.drag{border-color:var(--pink);background:rgba(240,79,135,.09)}
    .akari-dropzone strong{display:block;font-size:13px}
    .akari-dropzone span{display:block;color:var(--muted);font-size:10px;margin-top:7px}
    .akari-import-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:15px 0}
    .akari-import-stat{border:1px solid var(--line);background:rgba(255,255,255,.025);border-radius:11px;padding:12px}
    .akari-import-stat span{display:block;color:var(--muted-2);font-size:9px;text-transform:uppercase;letter-spacing:.07em}
    .akari-import-stat strong{display:block;font-size:18px;margin-top:6px}
    .akari-import-alert{border:1px solid var(--line);border-radius:11px;padding:12px;margin-top:10px;font-size:11px;line-height:1.55;color:var(--muted)}
    .akari-import-alert.warning{background:var(--yellow-soft);border-color:rgba(255,211,61,.2);color:#ffe995}
    .akari-import-alert.error{background:var(--red-soft);border-color:rgba(255,111,124,.22);color:#ffb2b9}
    .akari-import-alert.success{background:var(--green-soft);border-color:rgba(80,216,144,.22);color:#a8f0ca}
    .akari-issue-table{width:100%;border-collapse:collapse;margin-top:12px;min-width:0}
    .akari-issue-table th,.akari-issue-table td{height:auto;padding:8px;border-bottom:1px solid var(--line);font-size:10px;white-space:normal;text-align:left}
    .akari-progress{height:9px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden;margin-top:12px}
    .akari-progress>div{height:100%;width:0;background:linear-gradient(90deg,var(--pink),var(--yellow));transition:width .18s ease}
    .akari-checkbox{display:flex;align-items:flex-start;gap:9px;margin-top:14px;color:var(--muted);font-size:10px;line-height:1.5}
    .akari-checkbox input{margin-top:2px}
    .akari-import-log{margin-top:12px;max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px;background:rgba(0,0,0,.18);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;color:var(--muted)}
    .akari-loading{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:white;border-radius:50%;animation:akari-spin .7s linear infinite}
    @keyframes akari-spin{to{transform:rotate(360deg)}}
    @media(max-width:900px){.akari-leads-kpis,.akari-import-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:640px){.akari-form-grid{grid-template-columns:1fr}.akari-field.full{grid-column:auto}.akari-leads-kpis,.akari-import-summary{grid-template-columns:1fr 1fr}.akari-modal-body{padding:15px}.akari-modal-head{padding:16px}}
  `;
  document.head.appendChild(style);
}

function injectNavigation() {
  if (document.querySelector('[data-view="akari-leads"]')) return;
  const projectsButton = document.querySelector('[data-view="projects"]');
  if (!projectsButton) return;
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.view = 'akari-leads';
  button.innerHTML = '<span class="nav-icon">✦</span><span>AKARI Leads</span><span class="nav-count" id="akariLeadNavCount">0</span>';
  button.addEventListener('click', () => {
    window.switchView?.('akari-leads', button);
    loadLeads();
  });
  projectsButton.insertAdjacentElement('afterend', button);
}

function injectView() {
  if (document.getElementById('view-akari-leads')) return;
  const content = document.querySelector('.content');
  if (!content) return;
  const section = document.createElement('section');
  section.className = 'view';
  section.id = 'view-akari-leads';
  section.innerHTML = `
    <div class="page-header">
      <div><div class="eyebrow">AKARI HOUSE · PRIVATE TENANT DATA</div><h1>AKARI Leads</h1><p>Imported and manually created leads belonging only to the AKARI House workspace.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="soft-btn" id="akariImportButton">⇧ Import workbook</button><button class="primary-btn" id="akariNewLeadButton">＋ New lead</button></div>
    </div>
    <div class="akari-leads-kpis">
      <div class="akari-leads-kpi"><span>Total AKARI leads</span><strong id="akariLeadTotal">—</strong></div>
      <div class="akari-leads-kpi"><span>High priority</span><strong id="akariLeadHigh">—</strong></div>
      <div class="akari-leads-kpi"><span>With contacts</span><strong id="akariLeadContacts">—</strong></div>
      <div class="akari-leads-kpi"><span>Pipeline value</span><strong id="akariLeadPipeline" class="finance-value">—</strong></div>
    </div>
    <div class="akari-leads-toolbar">
      <input class="table-search" id="akariLeadSearch" placeholder="Search AKARI leads, X, website, Telegram or source…" />
      <select class="akari-select" id="akariLeadCategory"><option value="">All categories</option></select>
      <select class="akari-select" id="akariLeadPriority"><option value="">All priorities</option><option>URGENT</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select>
      <button class="soft-btn" id="akariLeadRefresh">Refresh</button>
    </div>
    <div class="table-wrap">
      <table id="akariLeadsTable">
        <thead><tr><th>Project</th><th>Priority</th><th>Category</th><th>Primary contact</th><th>Channels</th><th>Source</th><th>Last activity</th><th>Next follow-up</th><th>Opportunities</th><th>Pipeline</th></tr></thead>
        <tbody><tr><td colspan="10" style="height:110px;text-align:center;color:var(--muted)">Loading AKARI Leads…</td></tr></tbody>
      </table>
    </div>
    <div class="akari-pagination"><span id="akariLeadPageInfo">Loading…</span><div style="display:flex;gap:8px"><button class="soft-btn" id="akariLeadPrev">Previous</button><button class="soft-btn" id="akariLeadNext">Next</button></div></div>
  `;
  content.appendChild(section);
}

function injectModals() {
  if (!document.getElementById('akariImportOverlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'akari-modal-overlay';
    overlay.id = 'akariImportOverlay';
    overlay.innerHTML = `
      <div class="akari-modal" role="dialog" aria-modal="true" aria-labelledby="akariImportTitle">
        <div class="akari-modal-head"><div><h2 id="akariImportTitle">Import into AKARI Leads</h2><p>The file is parsed in your browser, previewed, and then written only to the AKARI House tenant after confirmation.</p></div><button class="close-btn" data-close-import>×</button></div>
        <div class="akari-modal-body">
          <label class="akari-dropzone" id="akariDropzone">
            <input type="file" id="akariImportFile" accept=".xlsx,.xls,.csv" hidden />
            <strong>Select or drop the AKARI CRM workbook</strong>
            <span>Expected sheets: Leads, Contacts and Tasks. The raw file is not uploaded to GitHub.</span>
          </label>
          <div id="akariImportPreview"></div>
        </div>
        <div class="akari-modal-foot"><button class="soft-btn" data-close-import>Cancel</button><button class="primary-btn" id="akariCommitImport" disabled>Import to AKARI House</button></div>
      </div>`;
    document.body.appendChild(overlay);
  }

  if (!document.getElementById('akariNewLeadOverlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'akari-modal-overlay';
    overlay.id = 'akariNewLeadOverlay';
    overlay.innerHTML = `
      <div class="akari-modal small" role="dialog" aria-modal="true" aria-labelledby="akariNewLeadTitle">
        <div class="akari-modal-head"><div><h2 id="akariNewLeadTitle">Create AKARI Lead</h2><p>Add a lead directly to the private AKARI House workspace.</p></div><button class="close-btn" data-close-new-lead>×</button></div>
        <form id="akariNewLeadForm">
          <div class="akari-modal-body"><div class="akari-form-grid">
            <div class="akari-field full"><label>Project / organization *</label><input name="name" required maxlength="300" /></div>
            <div class="akari-field"><label>Category</label><input name="category" maxlength="300" /></div>
            <div class="akari-field"><label>Priority</label><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></div>
            <div class="akari-field"><label>Website</label><input name="website" type="url" /></div>
            <div class="akari-field"><label>X profile</label><input name="xUrl" type="url" /></div>
            <div class="akari-field"><label>Telegram</label><input name="telegram" /></div>
            <div class="akari-field"><label>Region</label><input name="region" /></div>
            <div class="akari-field full"><label>Lead source</label><input name="sourceName" value="Manual AKARI Lead" /></div>
            <div class="akari-field full"><label>Notes</label><textarea name="notes"></textarea></div>
            <label class="akari-checkbox full"><input type="checkbox" name="assignToMe" checked /> Assign this lead to me</label>
          </div><div id="akariNewLeadError"></div></div>
          <div class="akari-modal-foot"><button type="button" class="soft-btn" data-close-new-lead>Cancel</button><button type="submit" class="primary-btn" id="akariCreateLeadSubmit">Create lead</button></div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
  }
}

function openImportModal() {
  const overlay = document.getElementById('akariImportOverlay');
  if (!state.canWrite) return window.showToast?.('Owner or Admin permission is required to import leads');
  state.importData = null;
  document.getElementById('akariImportFile').value = '';
  document.getElementById('akariImportPreview').innerHTML = '';
  document.getElementById('akariCommitImport').disabled = true;
  overlay.classList.add('open');
}

function closeImportModal() {
  if (state.importing) return;
  document.getElementById('akariImportOverlay')?.classList.remove('open');
}

function openNewLeadModal() {
  if (!state.canWrite) return window.showToast?.('You do not have permission to create AKARI leads');
  document.getElementById('akariNewLeadForm')?.reset();
  const assign = document.querySelector('#akariNewLeadForm [name="assignToMe"]');
  if (assign) assign.checked = true;
  document.getElementById('akariNewLeadError').innerHTML = '';
  document.getElementById('akariNewLeadOverlay')?.classList.add('open');
}

function closeNewLeadModal() {
  document.getElementById('akariNewLeadOverlay')?.classList.remove('open');
}

function queryString(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) query.set(key, String(value));
  });
  return query.toString();
}

async function loadLeads() {
  const tbody = document.querySelector('#akariLeadsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="height:110px;text-align:center;color:var(--muted)"><span class="akari-loading"></span> Loading AKARI Leads…</td></tr>';
  try {
    const payload = await api(`akari-leads?${queryString({ search: state.search, category: state.category, priority: state.priority, limit: state.limit, offset: state.page * state.limit })}`);
    state.items = payload.items || [];
    state.total = Number(payload.total || 0);
    state.categories = payload.categories || [];
    state.canWrite = Boolean(payload.canWrite);
    renderLeadStats();
    renderLeadCategories();
    renderLeadTable();
    const navCount = document.getElementById('akariLeadNavCount');
    if (navCount) navCount.textContent = state.total > 999 ? '999+' : String(state.total);
    document.getElementById('akariImportButton').hidden = !state.canWrite;
    document.getElementById('akariNewLeadButton').hidden = !state.canWrite;
  } catch (cause) {
    tbody.innerHTML = `<tr><td colspan="10" style="height:110px;text-align:center;color:var(--red)">${escapeHtml(cause.message)}</td></tr>`;
  }
}

function renderLeadStats() {
  const high = state.items.filter((item) => ['URGENT', 'HIGH'].includes(item.priority)).length;
  const withContacts = state.items.filter((item) => Number(item.contact_count || 0) > 0).length;
  const pipeline = state.items.reduce((sum, item) => sum + Number(item.pipeline_value || 0), 0);
  document.getElementById('akariLeadTotal').textContent = state.total.toLocaleString();
  document.getElementById('akariLeadHigh').textContent = high.toLocaleString();
  document.getElementById('akariLeadContacts').textContent = withContacts.toLocaleString();
  document.getElementById('akariLeadPipeline').textContent = formatMoney(pipeline);
}

function renderLeadCategories() {
  const select = document.getElementById('akariLeadCategory');
  if (!select) return;
  const current = state.category;
  select.innerHTML = '<option value="">All categories</option>' + state.categories.map((item) => `<option value="${escapeHtml(item.category === 'Uncategorized' ? '' : item.category)}">${escapeHtml(item.category)} (${Number(item.count || 0)})</option>`).join('');
  select.value = current;
}

function renderLeadTable() {
  const tbody = document.querySelector('#akariLeadsTable tbody');
  if (!state.items.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="height:120px;text-align:center;color:var(--muted)">No AKARI Leads match this view. Import the workbook or create the first lead.</td></tr>';
  } else {
    tbody.innerHTML = state.items.map((lead) => {
      const channels = [lead.website ? 'Web' : '', lead.x_url ? 'X' : '', lead.telegram ? 'TG' : ''].filter(Boolean).join(' · ') || '—';
      const contact = lead.primary_contact || lead.primary_contact_email || lead.primary_contact_telegram || '—';
      return `<tr data-akari-lead-id="${escapeHtml(lead.id)}">
        <td><div class="project-cell"><div class="project-logo">${initials(lead.name)}</div><div class="project-name"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.region || lead.original_status || 'AKARI Lead')}</span></div></div></td>
        <td><span class="pill ${lead.priority === 'HIGH' || lead.priority === 'URGENT' ? 'yellow' : ''}">${escapeHtml(titleCase(lead.priority))}</span></td>
        <td>${escapeHtml(lead.category || 'Uncategorized')}</td>
        <td>${escapeHtml(contact)}${Number(lead.contact_count || 0) > 1 ? ` <span class="pill">+${Number(lead.contact_count) - 1}</span>` : ''}</td>
        <td>${escapeHtml(channels)}</td>
        <td>${escapeHtml(lead.source_name || '—')}</td>
        <td>${formatDate(lead.last_activity_at)}</td>
        <td>${formatDate(lead.next_follow_up_at)}</td>
        <td>${Number(lead.open_opportunities || 0)}</td>
        <td class="finance-value">${formatMoney(lead.pipeline_value)}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('tr[data-akari-lead-id]').forEach((row) => row.addEventListener('click', () => window.openProjectById?.(row.dataset.akariLeadId)));
  }
  const start = state.total ? state.page * state.limit + 1 : 0;
  const end = Math.min((state.page + 1) * state.limit, state.total);
  document.getElementById('akariLeadPageInfo').textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()} AKARI leads`;
  document.getElementById('akariLeadPrev').disabled = state.page === 0;
  document.getElementById('akariLeadNext').disabled = end >= state.total;
}

function rowsFromSheet(XLSX, workbook, name) {
  const worksheet = workbook.Sheets[name];
  if (!worksheet) return null;
  return XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: true, blankrows: false });
}

function removeEmptyRows(rows) {
  return (rows || []).filter((row) => Object.values(row).some((entry) => entry !== null && entry !== undefined && text(entry) !== ''));
}

function duplicateGroups(rows, keyFn) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = keyFn(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index + 2);
  });
  return [...groups.entries()].filter(([, indexes]) => indexes.length > 1).map(([key, indexes]) => ({ key, indexes }));
}

async function parseImportFile(file) {
  const preview = document.getElementById('akariImportPreview');
  preview.innerHTML = '<div class="akari-import-alert"><span class="akari-loading"></span> Reading workbook and checking the AKARI House tenant…</div>';
  const XLSX = await import(SHEETJS_MODULE);
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const missingSheets = ['Leads', 'Contacts', 'Tasks'].filter((name) => !workbook.Sheets[name]);
  if (missingSheets.length) throw new Error(`Missing required sheet${missingSheets.length > 1 ? 's' : ''}: ${missingSheets.join(', ')}`);

  const leads = removeEmptyRows(rowsFromSheet(XLSX, workbook, 'Leads'));
  const contacts = removeEmptyRows(rowsFromSheet(XLSX, workbook, 'Contacts'));
  const tasks = removeEmptyRows(rowsFromSheet(XLSX, workbook, 'Tasks'));
  const requiredLeadHeaders = ['Lead ID', 'Project / Organization', 'Priority', 'Lead Source'];
  const firstLead = leads[0] || {};
  const missingHeaders = requiredLeadHeaders.filter((header) => !Object.prototype.hasOwnProperty.call(firstLead, header));
  if (missingHeaders.length) throw new Error(`Leads sheet is missing required column${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}`);

  const fatalRows = leads.map((row, index) => ({ row, rowNumber: index + 2 })).filter(({ row }) => !text(row['Lead ID']) || !text(row['Project / Organization']));
  const internalIdDuplicates = duplicateGroups(leads, (row) => normalized(row['Lead ID']));
  const internalNameDuplicates = duplicateGroups(leads, (row) => normalized(row['Project / Organization']));
  const internalTelegramDuplicates = duplicateGroups(leads, (row) => normalized(row.Telegram));
  const contactTelegramDuplicates = duplicateGroups(contacts, (row) => normalized(row.Telegram));
  const missingContactNames = contacts.filter((row) => !text(row['Contact Name'])).length;
  const missingCategories = leads.filter((row) => !text(row['Primary Category'])).length;
  const noChannels = leads.filter((row) => !['Website', 'X Profile', 'Email', 'Telegram', 'Other Contact'].some((field) => text(row[field]))).length;
  const sensitive = {
    leadEmails: leads.filter((row) => text(row.Email)).length,
    leadTelegrams: leads.filter((row) => text(row.Telegram)).length,
    contactEmails: contacts.filter((row) => text(row.Email)).length,
    contactTelegrams: contacts.filter((row) => text(row.Telegram)).length,
  };

  const existing = await api('imports/akari-leads/existing');
  const existingIds = new Set((existing.items || []).map((item) => item.id));
  const existingNames = new Set((existing.items || []).map((item) => normalized(item.name)).filter(Boolean));
  const existingX = new Set((existing.items || []).map((item) => normalized(item.x_url)).filter(Boolean));
  const existingWeb = new Set((existing.items || []).map((item) => normalized(item.website)).filter(Boolean));
  const potentialExisting = leads.filter((row) => {
    const id = `prj_akari_${stablePart(row['Lead ID'])}`;
    return existingIds.has(id)
      || existingNames.has(normalized(row['Project / Organization']))
      || (normalized(row['X Profile']) && existingX.has(normalized(row['X Profile'])))
      || (normalized(row.Website) && existingWeb.has(normalized(row.Website)));
  }).length;

  state.importData = {
    fileName: file.name,
    batchId: `imp_akari_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    leads,
    contacts,
    tasks,
    issues: { fatalRows, internalIdDuplicates, internalNameDuplicates, internalTelegramDuplicates, contactTelegramDuplicates, missingContactNames, missingCategories, noChannels, potentialExisting },
    sensitive,
  };
  renderImportPreview();
}

function renderImportPreview() {
  const data = state.importData;
  const preview = document.getElementById('akariImportPreview');
  if (!data) return;
  const fatal = data.issues.fatalRows.length + data.issues.internalIdDuplicates.length;
  const warningRows = [
    ['Missing categories', data.issues.missingCategories, 'Imported as uncategorized'],
    ['Leads without direct contact channels', data.issues.noChannels, 'Added to the data-enrichment queue'],
    ['Contacts missing names', data.issues.missingContactNames, 'Fallback name generated from email, Telegram or X'],
    ['Duplicate lead Telegram groups', data.issues.internalTelegramDuplicates.length, 'Flagged; no automatic merge'],
    ['Duplicate contact Telegram groups', data.issues.contactTelegramDuplicates.length, 'Flagged; no automatic merge'],
    ['Potential matches already in AKARI Leads', data.issues.potentialExisting, 'Stable IDs are skipped; possible name/channel matches require review'],
  ];
  preview.innerHTML = `
    <div class="akari-import-summary">
      <div class="akari-import-stat"><span>Lead projects</span><strong>${data.leads.length.toLocaleString()}</strong></div>
      <div class="akari-import-stat"><span>Contacts</span><strong>${data.contacts.length.toLocaleString()}</strong></div>
      <div class="akari-import-stat"><span>Tasks</span><strong>${data.tasks.length.toLocaleString()}</strong></div>
      <div class="akari-import-stat"><span>Fatal issues</span><strong style="color:${fatal ? 'var(--red)' : 'var(--green)'}">${fatal}</strong></div>
    </div>
    <div class="akari-import-alert ${fatal ? 'error' : 'success'}"><strong>${fatal ? 'Import is blocked until fatal issues are fixed.' : 'Dry run passed.'}</strong><br>${escapeHtml(data.fileName)} will target only AKARI House → AKARI Leads. Legacy client and partner labels are preserved as source metadata and do not create financial records.</div>
    <table class="akari-issue-table"><thead><tr><th>Review item</th><th>Count</th><th>Treatment</th></tr></thead><tbody>${warningRows.map(([label, count, action]) => `<tr><td>${escapeHtml(label)}</td><td>${Number(count).toLocaleString()}</td><td>${escapeHtml(action)}</td></tr>`).join('')}</tbody></table>
    <div class="akari-import-alert warning"><strong>Private fields detected:</strong> ${data.sensitive.leadEmails} lead emails, ${data.sensitive.leadTelegrams} lead Telegram handles, ${data.sensitive.contactEmails} contact emails and ${data.sensitive.contactTelegrams} contact Telegram handles. These records will be sent only to the protected AKARI House API and will not be committed to GitHub.</div>
    <label class="akari-checkbox"><input type="checkbox" id="akariImportConfirm" ${fatal ? 'disabled' : ''} /> I confirm this workbook belongs to AKARI House and approve importing the previewed rows into the private AKARI Leads collection.</label>
    <div class="akari-progress" id="akariImportProgress" hidden><div></div></div>
    <div class="akari-import-log" id="akariImportLog" hidden></div>
  `;
  const confirm = document.getElementById('akariImportConfirm');
  confirm?.addEventListener('change', () => { document.getElementById('akariCommitImport').disabled = !confirm.checked || Boolean(fatal); });
  document.getElementById('akariCommitImport').disabled = true;
}

function appendImportLog(message) {
  const log = document.getElementById('akariImportLog');
  if (!log) return;
  log.hidden = false;
  log.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
  log.scrollTop = log.scrollHeight;
}

function updateProgress(current, total) {
  const progress = document.getElementById('akariImportProgress');
  if (!progress) return;
  progress.hidden = false;
  progress.firstElementChild.style.width = `${Math.min(Math.round((current / Math.max(total, 1)) * 100), 100)}%`;
}

async function sendChunks(entityType, records, data, aggregate, progressState) {
  const chunkSize = 80;
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const result = await api('imports/akari-leads/commit', {
      method: 'POST',
      body: JSON.stringify({ batchId: data.batchId, fileName: data.fileName, entityType, records: chunk }),
    });
    aggregate[entityType].inserted += Number(result.inserted || 0);
    aggregate[entityType].skipped += Number(result.skipped || 0);
    progressState.done += chunk.length;
    updateProgress(progressState.done, progressState.total);
    appendImportLog(`${titleCase(entityType)}: processed ${progressState.done.toLocaleString()} of ${progressState.total.toLocaleString()} total rows`);
  }
}

async function commitImport() {
  const data = state.importData;
  if (!data || state.importing) return;
  const confirm = document.getElementById('akariImportConfirm');
  if (!confirm?.checked) return;
  state.importing = true;
  const button = document.getElementById('akariCommitImport');
  button.disabled = true;
  button.innerHTML = '<span class="akari-loading"></span> Importing…';
  const total = data.leads.length + data.contacts.length + data.tasks.length;
  const progressState = { done: 0, total };
  const aggregate = {
    projects: { inserted: 0, skipped: 0 },
    contacts: { inserted: 0, skipped: 0 },
    tasks: { inserted: 0, skipped: 0 },
  };
  try {
    appendImportLog(`Starting protected import batch ${data.batchId}`);
    await sendChunks('projects', data.leads, data, aggregate, progressState);
    await sendChunks('contacts', data.contacts, data, aggregate, progressState);
    await sendChunks('tasks', data.tasks, data, aggregate, progressState);
    await api('imports/akari-leads/commit', {
      method: 'POST',
      body: JSON.stringify({ batchId: data.batchId, fileName: data.fileName, entityType: 'complete', records: [], summary: aggregate }),
    });
    updateProgress(total, total);
    localStorage.setItem('akariLastLeadImport', JSON.stringify({ batchId: data.batchId, fileName: data.fileName, at: new Date().toISOString() }));
    document.getElementById('akariImportPreview').insertAdjacentHTML('beforeend', `<div class="akari-import-alert success"><strong>Import completed.</strong><br>Projects inserted: ${aggregate.projects.inserted}; contacts inserted: ${aggregate.contacts.inserted}; tasks inserted: ${aggregate.tasks.inserted}. Existing stable IDs skipped: ${aggregate.projects.skipped + aggregate.contacts.skipped + aggregate.tasks.skipped}.</div>`);
    appendImportLog('Import complete. Reloading AKARI Leads.');
    button.textContent = 'Imported';
    await loadLeads();
    window.showToast?.('AKARI Leads import completed');
  } catch (cause) {
    document.getElementById('akariImportPreview').insertAdjacentHTML('beforeend', `<div class="akari-import-alert error"><strong>Import stopped.</strong><br>${escapeHtml(cause.message)}. Successfully committed chunks remain auditable and can be resumed with the same file because stable IDs are idempotent.</div>`);
    appendImportLog(`ERROR: ${cause.message}`);
    button.textContent = 'Retry import';
    button.disabled = false;
  } finally {
    state.importing = false;
  }
}

async function createLead(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = document.getElementById('akariCreateLeadSubmit');
  const errorBox = document.getElementById('akariNewLeadError');
  const data = Object.fromEntries(new FormData(form).entries());
  data.assignToMe = form.elements.assignToMe.checked;
  submit.disabled = true;
  submit.innerHTML = '<span class="akari-loading"></span> Creating…';
  errorBox.innerHTML = '';
  try {
    const result = await api('akari-leads', { method: 'POST', body: JSON.stringify(data) });
    closeNewLeadModal();
    await loadLeads();
    window.openProjectById?.(result.id);
    window.showToast?.('AKARI Lead created');
  } catch (cause) {
    errorBox.innerHTML = `<div class="akari-import-alert error">${escapeHtml(cause.message)}</div>`;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Create lead';
  }
}

function bindEvents() {
  document.getElementById('akariImportButton')?.addEventListener('click', openImportModal);
  document.getElementById('akariNewLeadButton')?.addEventListener('click', openNewLeadModal);
  document.querySelectorAll('[data-close-import]').forEach((button) => button.addEventListener('click', closeImportModal));
  document.querySelectorAll('[data-close-new-lead]').forEach((button) => button.addEventListener('click', closeNewLeadModal));
  document.getElementById('akariCommitImport')?.addEventListener('click', commitImport);
  document.getElementById('akariNewLeadForm')?.addEventListener('submit', createLead);
  const fileInput = document.getElementById('akariImportFile');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try { await parseImportFile(file); } catch (cause) {
      state.importData = null;
      document.getElementById('akariImportPreview').innerHTML = `<div class="akari-import-alert error"><strong>Workbook could not be previewed.</strong><br>${escapeHtml(cause.message)}</div>`;
      document.getElementById('akariCommitImport').disabled = true;
    }
  });
  const dropzone = document.getElementById('akariDropzone');
  ['dragenter', 'dragover'].forEach((name) => dropzone?.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((name) => dropzone?.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone?.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try { await parseImportFile(file); } catch (cause) {
      document.getElementById('akariImportPreview').innerHTML = `<div class="akari-import-alert error">${escapeHtml(cause.message)}</div>`;
    }
  });
  let searchTimer;
  document.getElementById('akariLeadSearch')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = event.target.value.trim(); state.page = 0; loadLeads(); }, 260);
  });
  document.getElementById('akariLeadCategory')?.addEventListener('change', (event) => { state.category = event.target.value; state.page = 0; loadLeads(); });
  document.getElementById('akariLeadPriority')?.addEventListener('change', (event) => { state.priority = event.target.value; state.page = 0; loadLeads(); });
  document.getElementById('akariLeadRefresh')?.addEventListener('click', loadLeads);
  document.getElementById('akariLeadPrev')?.addEventListener('click', () => { if (state.page > 0) { state.page -= 1; loadLeads(); } });
  document.getElementById('akariLeadNext')?.addEventListener('click', () => { if ((state.page + 1) * state.limit < state.total) { state.page += 1; loadLeads(); } });
  document.getElementById('akariImportOverlay')?.addEventListener('click', (event) => { if (event.target.id === 'akariImportOverlay') closeImportModal(); });
  document.getElementById('akariNewLeadOverlay')?.addEventListener('click', (event) => { if (event.target.id === 'akariNewLeadOverlay') closeNewLeadModal(); });
}

async function loadIdentity() {
  try {
    const payload = await api('me');
    state.me = payload.user;
    state.canWrite = ['OWNER', 'ADMIN', 'BD_MANAGER'].includes(state.me?.role);
  } catch (_) {
    state.canWrite = false;
  }
}

function overrideQuickCreate() {
  const original = window.createAction;
  window.createAction = function createActionWithRealForms(type) {
    document.getElementById('quickCreate')?.classList.remove('open');
    if (type === 'Project') return openNewLeadModal();
    return original ? original(type) : window.showToast?.(`${type} form is under development`);
  };
}

async function init() {
  if (!document.getElementById('app')) return;
  injectStyles();
  injectNavigation();
  injectView();
  injectModals();
  bindEvents();
  overrideQuickCreate();
  await loadIdentity();
  await loadLeads();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
