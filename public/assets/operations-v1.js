(() => {
  const SPECIAL_ROUTES = new Set(['finance', 'team', 'settings']);
  const ROLES = ['OWNER', 'ADMIN', 'BD_MANAGER', 'BD_MEMBER', 'FINANCE', 'VIEWER', 'EXTERNAL_COLLABORATOR'];
  const state = { me: null, team: null, billing: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
  const initials = (value) => String(value || 'AK').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value || 0));
  const date = (value) => {
    if (!value) return '—';
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
  };
  const valueAttr = (value) => esc(value || '');
  const checked = (value) => value ? 'checked' : '';

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(payload.error || `Request failed (${response.status})`);
      requestError.status = response.status;
      throw requestError;
    }
    return payload;
  }

  function toast(message, type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function currentRoute() {
    return location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  }

  function activate(route) {
    $$('[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route));
    const breadcrumb = $('.breadcrumb strong');
    if (breadcrumb) breadcrumb.textContent = route === 'finance' ? 'Invoices & Finance' : route === 'team' ? 'Team' : 'Settings';
  }

  function pageHead(eyebrow, heading, copy, actions = '') {
    return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(heading)}</h1><p>${esc(copy)}</p></div><div class="head-actions">${actions}</div></div>`;
  }

  function empty(titleText, copy, action = '') {
    return `<div class="empty-state"><div><strong>${esc(titleText)}</strong><span>${esc(copy)}</span>${action}</div></div>`;
  }

  function pill(value, tone = '') {
    return `<span class="pill ${tone}">${esc(title(value || '—'))}</span>`;
  }

  function statusTone(status) {
    if (status === 'PAID' || status === 'ACTIVE') return 'green';
    if (status === 'OVERDUE' || status === 'REVOKED' || status === 'CANCELLED') return 'red';
    if (status === 'INVOICED' || status === 'PARTIALLY_PAID' || status === 'SUSPENDED') return 'yellow';
    return 'pink';
  }

  function closeModal() {
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
  }

  function modal({ titleText, subtitle = '', body, submitText = 'Save', onSubmit, wide = false }) {
    const root = $('#modal-root');
    if (!root) return;
    root.innerHTML = `<div class="modal-backdrop" data-ops-close><div class="modal ${wide ? 'wide ops-modal-wide' : ''}" role="dialog" aria-modal="true" onclick="event.stopPropagation()"><form id="ops-form"><div class="modal-head"><div><div class="eyebrow">AKARI CRM</div><h2>${esc(titleText)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button type="button" class="close" data-ops-close>×</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button type="button" class="btn" data-ops-close>Cancel</button><button type="submit" class="btn primary">${esc(submitText)}</button></div></form></div></div>`;
    const form = $('#ops-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = 'Saving…';
      try {
        await onSubmit(form);
      } catch (cause) {
        toast(cause.message || 'Unable to save', 'error');
        submit.disabled = false;
        submit.textContent = original;
      }
    });
  }

  async function go(route) {
    if (!SPECIAL_ROUTES.has(route)) return;
    history.pushState(null, '', `#/${route}`);
    activate(route);
    await renderSpecial(route);
  }

  async function renderSpecial(route = currentRoute()) {
    if (!SPECIAL_ROUTES.has(route)) return;
    const root = $('#view-root');
    if (!root) return;
    activate(route);
    root.innerHTML = empty('Loading workspace…', 'Fetching secure tenant data.');
    try {
      if (!state.me) state.me = await api('/api/me');
      if (route === 'finance') await renderFinance();
      if (route === 'team') await renderTeam();
      if (route === 'settings') await renderSettings();
    } catch (cause) {
      root.innerHTML = pageHead('WORKSPACE ERROR', route === 'finance' ? 'Invoices & Finance' : title(route), 'The requested view could not be loaded.') + `<section class="panel"><div class="panel-body">${empty('Unable to load this view', cause.message || 'Unknown error')}</div></section>`;
      toast(cause.message || 'View failed', 'error');
    }
  }

  function billingIsComplete(profile) {
    return Boolean(profile?.legalName && profile?.addressLine1 && profile?.country);
  }

  async function renderFinance() {
    const [invoiceData, paymentData, billingData] = await Promise.all([
      api('/api/invoices'),
      api('/api/payments'),
      api('/api/billing-profile'),
    ]);
    state.billing = billingData;
    const invoices = invoiceData.items || [];
    const payments = (paymentData.items || []).filter((item) => item.payment_type !== 'INVOICE');
    const total = invoices.filter((item) => item.status !== 'CANCELLED').reduce((sum, item) => sum + Number(item.total || 0), 0);
    const paid = invoices.filter((item) => item.status === 'PAID').reduce((sum, item) => sum + Number(item.total || 0), 0);
    const outstanding = invoices.filter((item) => !['PAID', 'CANCELLED'].includes(item.status)).reduce((sum, item) => sum + Number(item.total || 0), 0);
    const overdue = invoices.filter((item) => item.status === 'OVERDUE' || (!['PAID', 'CANCELLED'].includes(item.status) && item.dueDate && new Date(item.dueDate) < new Date())).length;
    const billingProfile = billingData.billingProfile || {};
    const root = $('#view-root');
    root.innerHTML = `
      ${pageHead('REVENUE OPERATIONS', 'Invoices & Finance', 'Create professional invoices, print or save them as PDF, and track collection status.', `<button class="btn" data-ops-action="billing-profile">Billing details</button><button class="btn primary" data-ops-action="new-invoice">＋ New invoice</button>`)}
      ${billingIsComplete(billingProfile) ? '' : `<div class="ops-banner warning"><strong>Complete billing details first.</strong><span>Add AKARI’s legal name, address and country before creating an invoice.</span><button class="btn small" data-ops-action="billing-profile">Complete details</button></div>`}
      <div class="mini-grid">
        <button class="mini-kpi"><span>Total invoiced</span><strong class="finance-value">${money(total)}</strong></button>
        <button class="mini-kpi"><span>Paid</span><strong class="finance-value">${money(paid)}</strong></button>
        <button class="mini-kpi"><span>Outstanding</span><strong class="finance-value">${money(outstanding)}</strong></button>
        <button class="mini-kpi"><span>Overdue</span><strong>${overdue}</strong></button>
        <button class="mini-kpi"><span>Invoices</span><strong>${invoices.length}</strong></button>
        <button class="mini-kpi"><span>Billing profile</span><strong>${billingIsComplete(billingProfile) ? 'Ready' : 'Incomplete'}</strong></button>
      </div>
      <section class="panel"><div class="panel-head"><div class="panel-title"><strong>Invoices</strong><span>Tenant-scoped invoice records and payment status</span></div><button class="btn small primary" data-ops-action="new-invoice">Create invoice</button></div><div class="panel-body ops-table-body">
        ${invoices.length ? `<div class="table-shell"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>${invoices.map((invoice) => `<tr><td><strong>${esc(invoice.invoiceNumber || 'Draft')}</strong></td><td>${esc(invoice.recipient?.name || invoice.projectName || '—')}</td><td>${esc(date(invoice.invoiceDate))}</td><td>${esc(date(invoice.dueDate))}</td><td class="finance-value"><strong>${money(invoice.total, invoice.currency)}</strong></td><td>${pill(invoice.status, statusTone(invoice.status))}</td><td><div class="ops-row-actions"><button class="btn small" data-ops-action="view-invoice" data-id="${esc(invoice.id)}">View / Print</button>${!['PAID', 'CANCELLED'].includes(invoice.status) ? `<button class="btn small" data-ops-action="mark-invoice-paid" data-id="${esc(invoice.id)}">Mark paid</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : empty('No invoices yet', 'Create your first invoice after completing the billing profile.', `<button class="btn primary" data-ops-action="new-invoice">Create invoice</button>`)}
      </div></section>
      <section class="panel"><div class="panel-head"><div class="panel-title"><strong>Other payment records</strong><span>Retainers, fees and payments not created through the invoice builder</span></div></div><div class="panel-body ops-table-body">
        ${payments.length ? `<div class="table-shell"><table><thead><tr><th>Client</th><th>Reference</th><th>Type</th><th>Amount</th><th>Status</th><th>Due</th></tr></thead><tbody>${payments.map((payment) => `<tr><td>${esc(payment.project_name || '—')}</td><td>${esc(payment.invoice_reference || '—')}</td><td>${esc(title(payment.payment_type || 'Payment'))}</td><td class="finance-value">${money(payment.amount, payment.currency || 'USD')}</td><td>${pill(payment.status, statusTone(payment.status))}</td><td>${esc(date(payment.due_date))}</td></tr>`).join('')}</tbody></table></div>` : empty('No additional payment records', 'Invoices created above are tracked separately in this view.')}
      </div></section>`;
  }

  async function loadAllProjects() {
    const items = [];
    let offset = 0;
    let total = 1;
    while (offset < total && offset < 2000) {
      const page = await api(`/api/projects?limit=100&offset=${offset}`);
      items.push(...(page.items || []));
      total = Number(page.total || items.length);
      offset += Number(page.limit || 100);
      if (!(page.items || []).length) break;
    }
    return items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function invoiceLineRow(index, description = '', quantity = 1, unitPrice = '') {
    return `<tr class="ops-line-row"><td><input aria-label="Description" data-line="description" value="${valueAttr(description)}" placeholder="Campaign, advisory or service" required /></td><td><input aria-label="Quantity" data-line="quantity" type="number" min="0.01" step="0.01" value="${valueAttr(quantity)}" required /></td><td><input aria-label="Unit price" data-line="unitPrice" type="number" min="0" step="0.01" value="${valueAttr(unitPrice)}" required /></td><td class="finance-value" data-line-total>${money(0)}</td><td><button type="button" class="icon-btn" data-ops-action="remove-line" aria-label="Remove line">×</button></td><input type="hidden" value="${index}" /></tr>`;
  }

  function recalculateInvoice() {
    const rows = $$('.ops-line-row');
    let subtotal = 0;
    rows.forEach((row) => {
      const quantity = Number(row.querySelector('[data-line="quantity"]')?.value || 0);
      const unitPrice = Number(row.querySelector('[data-line="unitPrice"]')?.value || 0);
      const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
      subtotal += lineTotal;
      const cell = row.querySelector('[data-line-total]');
      if (cell) cell.textContent = money(lineTotal, $('#ops-currency')?.value || 'USD');
    });
    const taxRate = Number($('#ops-tax-rate')?.value || 0);
    const tax = Math.round((subtotal * taxRate / 100 + Number.EPSILON) * 100) / 100;
    const total = subtotal + tax;
    if ($('#ops-subtotal')) $('#ops-subtotal').textContent = money(subtotal, $('#ops-currency')?.value || 'USD');
    if ($('#ops-tax-total')) $('#ops-tax-total').textContent = money(tax, $('#ops-currency')?.value || 'USD');
    if ($('#ops-grand-total')) $('#ops-grand-total').textContent = money(total, $('#ops-currency')?.value || 'USD');
  }

  async function openNewInvoice() {
    const billingData = await api('/api/billing-profile');
    const profile = billingData.billingProfile || {};
    if (!billingIsComplete(profile)) {
      toast('Complete billing details before creating an invoice.', 'error');
      await openBillingProfile();
      return;
    }
    const projects = await loadAllProjects();
    if (!projects.length) {
      toast('Create a client or project before creating an invoice.', 'error');
      return;
    }
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + Number(profile.defaultPaymentTermsDays || 14));
    modal({
      titleText: 'Create invoice',
      subtitle: 'Create a professional invoice connected to an AKARI client record.',
      submitText: 'Create invoice',
      wide: true,
      body: `<div class="form-grid">
        <label class="field"><span>Client / project *</span><select id="ops-project" name="projectId" required><option value="">Select client</option>${projects.map((project) => `<option value="${esc(project.id)}">${esc(project.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Invoice number</span><input name="invoiceNumber" placeholder="Auto-generated when empty" /></label>
        <label class="field"><span>Invoice date *</span><input name="invoiceDate" type="date" value="${today.toISOString().slice(0, 10)}" required /></label>
        <label class="field"><span>Due date</span><input name="dueDate" type="date" value="${due.toISOString().slice(0, 10)}" /></label>
        <label class="field"><span>Currency</span><select id="ops-currency" name="currency"><option>USD</option><option>EUR</option><option>USDT</option><option>GBP</option></select></label>
        <label class="field"><span>Status</span><select name="status"><option value="INVOICED">Issued / Invoiced</option><option value="DRAFT">Draft</option><option value="PAID">Already paid</option></select></label>
      </div>
      <div class="ops-section-title"><strong>Bill to</strong><span>These details are saved as an invoice snapshot.</span></div>
      <div class="form-grid">
        <label class="field"><span>Client legal / billing name *</span><input id="ops-recipient-name" name="recipientName" required /></label>
        <label class="field"><span>Billing email</span><input name="recipientEmail" type="email" /></label>
        <label class="field"><span>Contact person</span><input name="recipientContactName" /></label>
        <label class="field"><span>VAT / tax ID</span><input name="recipientVatId" /></label>
        <label class="field full"><span>Address</span><input name="recipientAddressLine1" /></label>
        <label class="field"><span>City</span><input name="recipientCity" /></label>
        <label class="field"><span>Postal code</span><input name="recipientPostalCode" /></label>
        <label class="field"><span>Country</span><input name="recipientCountry" /></label>
      </div>
      <div class="ops-section-title"><strong>Line items</strong><button type="button" class="btn small" data-ops-action="add-line">＋ Add line</button></div>
      <div class="table-shell"><table class="ops-lines"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th><th></th></tr></thead><tbody id="ops-line-items">${invoiceLineRow(0)}</tbody></table></div>
      <div class="ops-invoice-options">
        <div class="form-grid">
          <label class="field"><span>Tax rate %</span><input id="ops-tax-rate" name="taxRate" type="number" min="0" max="100" step="0.01" value="${valueAttr(profile.defaultTaxRate || 0)}" /></label>
          <label class="field"><span>Tax note</span><input name="taxLabel" placeholder="VAT, reverse charge, outside EU…" /></label>
          <label class="field full"><span>Invoice notes</span><textarea name="notes" placeholder="Scope, period or additional terms"></textarea></label>
        </div>
        <div class="ops-totals"><div><span>Subtotal</span><strong id="ops-subtotal">${money(0)}</strong></div><div><span>Tax</span><strong id="ops-tax-total">${money(0)}</strong></div><div class="grand"><span>Total</span><strong id="ops-grand-total">${money(0)}</strong></div></div>
      </div>`,
      onSubmit: async (form) => {
        const data = Object.fromEntries(new FormData(form));
        const lineItems = $$('.ops-line-row', form).map((row) => ({
          description: row.querySelector('[data-line="description"]').value,
          quantity: Number(row.querySelector('[data-line="quantity"]').value),
          unitPrice: Number(row.querySelector('[data-line="unitPrice"]').value),
        }));
        await api('/api/invoices', {
          method: 'POST',
          body: JSON.stringify({
            projectId: data.projectId,
            invoiceNumber: data.invoiceNumber,
            invoiceDate: data.invoiceDate,
            dueDate: data.dueDate,
            currency: data.currency,
            status: data.status,
            taxRate: Number(data.taxRate || 0),
            taxLabel: data.taxLabel,
            notes: data.notes,
            recipient: {
              name: data.recipientName,
              email: data.recipientEmail,
              contactName: data.recipientContactName,
              vatId: data.recipientVatId,
              addressLine1: data.recipientAddressLine1,
              city: data.recipientCity,
              postalCode: data.recipientPostalCode,
              country: data.recipientCountry,
            },
            lineItems,
          }),
        });
        closeModal();
        toast('Invoice created. Open it to print or save as PDF.');
        await renderFinance();
      },
    });
    let lineIndex = 1;
    $('#ops-project').addEventListener('change', (event) => {
      const option = event.target.selectedOptions[0];
      const nameInput = $('#ops-recipient-name');
      if (nameInput && !nameInput.value) nameInput.value = option?.textContent || '';
    });
    $('#ops-line-items').addEventListener('input', recalculateInvoice);
    $('#ops-tax-rate').addEventListener('input', recalculateInvoice);
    $('#ops-currency').addEventListener('change', recalculateInvoice);
    $('#ops-line-items').dataset.nextIndex = String(lineIndex);
    recalculateInvoice();
  }

  async function openBillingProfile() {
    const payload = await api('/api/billing-profile');
    const profile = payload.billingProfile || {};
    modal({
      titleText: 'Organisation billing details',
      subtitle: 'These details appear on every new invoice. Confirm them before issuing invoices.',
      submitText: 'Save billing details',
      wide: true,
      body: `<div class="form-grid">
        <label class="field"><span>Legal / trading name *</span><input name="legalName" value="${valueAttr(profile.legalName || payload.tenant?.name)}" required /></label>
        <label class="field"><span>Invoice prefix</span><input name="invoicePrefix" value="${valueAttr(profile.invoicePrefix || 'AKARI')}" /></label>
        <label class="field full"><span>Address line 1 *</span><input name="addressLine1" value="${valueAttr(profile.addressLine1)}" required /></label>
        <label class="field full"><span>Address line 2</span><input name="addressLine2" value="${valueAttr(profile.addressLine2)}" /></label>
        <label class="field"><span>City</span><input name="city" value="${valueAttr(profile.city)}" /></label>
        <label class="field"><span>Postal code</span><input name="postalCode" value="${valueAttr(profile.postalCode)}" /></label>
        <label class="field"><span>Country *</span><input name="country" value="${valueAttr(profile.country || 'Germany')}" required /></label>
        <label class="field"><span>Billing email</span><input name="email" type="email" value="${valueAttr(profile.email)}" /></label>
        <label class="field"><span>Phone</span><input name="phone" value="${valueAttr(profile.phone)}" /></label>
        <label class="field"><span>VAT ID</span><input name="vatId" value="${valueAttr(profile.vatId)}" /></label>
        <label class="field"><span>Registration / tax number</span><input name="registrationNumber" value="${valueAttr(profile.registrationNumber)}" /></label>
        <label class="field"><span>Bank name</span><input name="bankName" value="${valueAttr(profile.bankName)}" /></label>
        <label class="field"><span>IBAN</span><input name="iban" value="${valueAttr(profile.iban)}" /></label>
        <label class="field"><span>BIC / SWIFT</span><input name="bic" value="${valueAttr(profile.bic)}" /></label>
        <label class="field"><span>Crypto wallet</span><input name="walletAddress" value="${valueAttr(profile.walletAddress)}" /></label>
        <label class="field"><span>Logo URL</span><input name="logoUrl" type="url" value="${valueAttr(profile.logoUrl)}" /></label>
        <label class="field"><span>Default tax rate %</span><input name="defaultTaxRate" type="number" min="0" max="100" step="0.01" value="${valueAttr(profile.defaultTaxRate || 0)}" /></label>
        <label class="field"><span>Default payment terms (days)</span><input name="defaultPaymentTermsDays" type="number" min="0" max="365" value="${valueAttr(profile.defaultPaymentTermsDays || 14)}" /></label>
        <label class="field full"><span>Payment instructions</span><textarea name="paymentInstructions" placeholder="Bank transfer reference, wallet network, payment deadline…">${esc(profile.paymentInstructions || '')}</textarea></label>
      </div>`,
      onSubmit: async (form) => {
        const data = Object.fromEntries(new FormData(form));
        await api('/api/billing-profile', {
          method: 'PATCH',
          body: JSON.stringify({ ...data, defaultTaxRate: Number(data.defaultTaxRate || 0), defaultPaymentTermsDays: Number(data.defaultPaymentTermsDays || 14) }),
        });
        closeModal();
        state.billing = null;
        toast('Billing details saved');
        await renderSpecial(currentRoute());
      },
    });
  }

  async function markInvoicePaid(id) {
    await api(`/api/invoices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'PAID', receivedDate: new Date().toISOString().slice(0, 10) }),
    });
    toast('Invoice marked as paid');
    await renderFinance();
  }

  function addressHtml(person = {}) {
    return [person.name || person.legalName, person.contactName, person.addressLine1, person.addressLine2, [person.postalCode, person.city].filter(Boolean).join(' '), person.country, person.email, person.vatId ? `VAT / Tax ID: ${person.vatId}` : null].filter(Boolean).map((line) => `<div>${esc(line)}</div>`).join('');
  }

  async function viewInvoice(id) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast('Allow pop-ups to open the printable invoice.', 'error');
      return;
    }
    printWindow.opener = null;
    printWindow.document.write('<p style="font-family:Arial;padding:24px">Loading invoice…</p>');
    try {
      const invoice = await api(`/api/invoices/${encodeURIComponent(id)}`);
      const issuer = invoice.issuer || {};
      const recipient = invoice.recipient || {};
      const items = invoice.lineItems || [];
      const logo = issuer.logoUrl ? `<img src="${esc(issuer.logoUrl)}" alt="" />` : `<div class="mark">AKARI</div>`;
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoice.invoiceNumber || 'Invoice')}</title><style>
        :root{font-family:Arial,Helvetica,sans-serif;color:#111827}*{box-sizing:border-box}body{margin:0;background:#eef1f5}.toolbar{position:sticky;top:0;padding:12px 24px;background:#111827;color:#fff;display:flex;justify-content:space-between;align-items:center}.toolbar button{background:#ff9a3c;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer}.sheet{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:18mm;box-shadow:0 8px 30px rgba(0,0,0,.16)}.top{display:flex;justify-content:space-between;gap:30px}.brand img{max-width:150px;max-height:70px}.mark{font-size:28px;font-weight:900;letter-spacing:.12em}.invoice-title{text-align:right}.invoice-title h1{font-size:34px;margin:0}.muted{color:#6b7280}.status{display:inline-block;margin-top:8px;padding:5px 10px;border-radius:999px;background:#fff3e7;color:#9a4f09;font-size:12px;font-weight:700}.parties{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:46px 0 30px}.party h3{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#6b7280;margin:0 0 12px}.party div{line-height:1.55}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:20px 0}.meta div{border-top:1px solid #e5e7eb;padding-top:9px}.meta span{display:block;color:#6b7280;font-size:11px;text-transform:uppercase}.meta strong{display:block;margin-top:5px}table{width:100%;border-collapse:collapse;margin-top:30px}th{background:#111827;color:#fff;text-align:left;padding:11px;font-size:12px}td{padding:12px 11px;border-bottom:1px solid #e5e7eb}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.totals{margin-left:auto;width:320px;margin-top:24px}.totals div{display:flex;justify-content:space-between;padding:8px 0}.totals .grand{font-size:20px;font-weight:800;border-top:2px solid #111827;margin-top:8px;padding-top:14px}.notes{margin-top:42px;border-top:1px solid #e5e7eb;padding-top:20px}.notes h3{font-size:12px;text-transform:uppercase;letter-spacing:.12em}.pre{white-space:pre-wrap;line-height:1.55}.footer{margin-top:48px;font-size:11px;color:#6b7280}@page{size:A4;margin:0}@media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0;box-shadow:none;width:auto;min-height:auto}}
      </style></head><body><div class="toolbar"><strong>${esc(invoice.invoiceNumber || 'Invoice')}</strong><button onclick="window.print()">Print / Save PDF</button></div><main class="sheet"><div class="top"><div class="brand">${logo}</div><div class="invoice-title"><h1>INVOICE</h1><div class="muted">${esc(invoice.invoiceNumber || 'Draft')}</div><span class="status">${esc(title(invoice.status))}</span></div></div><div class="parties"><section class="party"><h3>From</h3>${addressHtml({ ...issuer, name: issuer.legalName })}${issuer.registrationNumber ? `<div>Registration / Tax No: ${esc(issuer.registrationNumber)}</div>` : ''}</section><section class="party"><h3>Bill to</h3>${addressHtml(recipient)}</section></div><div class="meta"><div><span>Invoice date</span><strong>${esc(date(invoice.invoiceDate))}</strong></div><div><span>Due date</span><strong>${esc(date(invoice.dueDate))}</strong></div><div><span>Currency</span><strong>${esc(invoice.currency)}</strong></div></div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${items.map((item) => `<tr><td>${esc(item.description)}</td><td>${esc(item.quantity)}</td><td>${money(item.unitPrice, invoice.currency)}</td><td>${money(item.amount, invoice.currency)}</td></tr>`).join('')}</tbody></table><div class="totals"><div><span>Subtotal</span><strong>${money(invoice.subtotal, invoice.currency)}</strong></div><div><span>Tax (${esc(invoice.taxRate)}%)</span><strong>${money(invoice.taxAmount, invoice.currency)}</strong></div><div class="grand"><span>Total</span><strong>${money(invoice.total, invoice.currency)}</strong></div></div>${invoice.taxLabel ? `<div class="notes"><h3>Tax note</h3><div class="pre">${esc(invoice.taxLabel)}</div></div>` : ''}${invoice.notes ? `<div class="notes"><h3>Notes</h3><div class="pre">${esc(invoice.notes)}</div></div>` : ''}${invoice.paymentInstructions ? `<div class="notes"><h3>Payment instructions</h3><div class="pre">${esc(invoice.paymentInstructions)}</div></div>` : ''}<div class="footer">Generated from AKARI CRM · ${esc(invoice.invoiceNumber || '')}</div></main></body></html>`);
      printWindow.document.close();
    } catch (cause) {
      printWindow.close();
      toast(cause.message || 'Invoice could not be opened', 'error');
    }
  }

  async function renderTeam() {
    const data = await api('/api/team');
    state.team = data;
    const members = data.items || [];
    const me = state.me?.user || {};
    const canManage = ['OWNER', 'ADMIN'].includes(me.role);
    const root = $('#view-root');
    root.innerHTML = `
      ${pageHead('ORGANISATION ADMINISTRATION', 'Team', 'Add team members, assign roles and control finance access.', canManage ? `<button class="btn primary" data-ops-action="add-member">＋ Add team member</button>` : '')}
      <div class="ops-banner"><strong>Workspace access has two layers.</strong><span>This page creates the CRM membership. The email must also be permitted by Cloudflare Access before the member can sign in.</span></div>
      <div class="mini-grid"><button class="mini-kpi"><span>Members</span><strong>${members.length}</strong></button><button class="mini-kpi"><span>User limit</span><strong>${data.userLimit || 3}</strong></button><button class="mini-kpi"><span>Remaining seats</span><strong>${Math.max(0, Number(data.userLimit || 3) - members.length)}</strong></button><button class="mini-kpi"><span>Admins</span><strong>${members.filter((member) => ['OWNER', 'ADMIN'].includes(member.role)).length}</strong></button><button class="mini-kpi"><span>Finance access</span><strong>${members.filter((member) => member.financeAccess).length}</strong></button><button class="mini-kpi"><span>Authentication</span><strong>Access OTP</strong></button></div>
      <section class="panel"><div class="panel-head"><div class="panel-title"><strong>Workspace members</strong><span>Roles are enforced server-side for the AKARI House tenant</span></div>${canManage ? `<button class="btn small primary" data-ops-action="add-member">Add member</button>` : ''}</div><div class="panel-body ops-table-body"><div class="table-shell"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Finance</th><th>Status</th><th>Last login</th><th>Action</th></tr></thead><tbody>${members.map((member) => `<tr><td><div class="record-cell"><div class="record-logo">${initials(member.fullName || member.email)}</div><div class="record-name"><strong>${esc(member.fullName || 'AKARI User')}</strong><span>${member.userId === me.userId ? 'You' : 'Team member'}</span></div></div></td><td>${esc(member.email)}</td><td>${pill(member.role, ['OWNER', 'ADMIN'].includes(member.role) ? 'pink' : '')}</td><td>${member.financeAccess ? pill('Enabled', 'green') : pill('Disabled')}</td><td>${pill(member.status, statusTone(member.status))}</td><td>${esc(member.lastLoginAt ? date(member.lastLoginAt) : 'Not recorded')}</td><td>${canManage ? `<button class="btn small" data-ops-action="edit-member" data-id="${esc(member.membershipId)}">Edit</button>` : '—'}</td></tr>`).join('')}</tbody></table></div></div></section>`;
  }

  async function openAddMember() {
    modal({
      titleText: 'Add team member',
      subtitle: 'Create an active tenant membership for an approved email.',
      submitText: 'Add member',
      body: `<div class="ops-banner warning"><strong>Cloudflare Access still applies.</strong><span>If the email is not already allowed by your Access policy, add it there after creating the membership.</span></div><div class="form-grid"><label class="field"><span>Full name *</span><input name="fullName" required /></label><label class="field"><span>Email *</span><input name="email" type="email" required /></label><label class="field"><span>Role</span><select name="role">${ROLES.filter((role) => role !== 'OWNER' || state.me?.user?.role === 'OWNER').map((role) => `<option value="${role}" ${role === 'BD_MEMBER' ? 'selected' : ''}>${esc(title(role))}</option>`).join('')}</select></label><label class="field checkbox-field"><span>Finance access</span><input name="financeAccess" type="checkbox" /></label></div>`,
      onSubmit: async (form) => {
        const data = Object.fromEntries(new FormData(form));
        const result = await api('/api/team', { method: 'POST', body: JSON.stringify({ ...data, financeAccess: Boolean(data.financeAccess) }) });
        closeModal();
        toast(result.accessNote || 'Team member added');
        await renderTeam();
      },
    });
  }

  async function openEditMember(id) {
    const member = state.team?.items?.find((item) => item.membershipId === id);
    if (!member) return;
    modal({
      titleText: 'Edit team member',
      subtitle: `${member.fullName} · ${member.email}`,
      submitText: 'Save access',
      body: `<div class="form-grid"><label class="field"><span>Role</span><select name="role">${ROLES.filter((role) => role !== 'OWNER' || state.me?.user?.role === 'OWNER').map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${esc(title(role))}</option>`).join('')}</select></label><label class="field"><span>Status</span><select name="status">${['ACTIVE', 'SUSPENDED', 'REVOKED'].map((status) => `<option value="${status}" ${member.status === status ? 'selected' : ''}>${esc(title(status))}</option>`).join('')}</select></label><label class="field checkbox-field full"><span>Finance access</span><input name="financeAccess" type="checkbox" ${checked(member.financeAccess)} /></label></div>`,
      onSubmit: async (form) => {
        const data = Object.fromEntries(new FormData(form));
        await api(`/api/team/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...data, financeAccess: Boolean(data.financeAccess) }) });
        closeModal();
        toast('Team member access updated');
        await renderTeam();
      },
    });
  }

  async function renderSettings() {
    const [profileData, billingData] = await Promise.all([api('/api/profile'), api('/api/billing-profile')]);
    const user = profileData.user || {};
    const billing = billingData.billingProfile || {};
    const root = $('#view-root');
    root.innerHTML = `
      ${pageHead('WORKSPACE CONFIGURATION', 'Settings & Profile', 'Manage your personal profile, organisation billing details and team access.', '')}
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><div class="panel-title"><strong>My profile</strong><span>Your name and avatar inside AKARI CRM</span></div><button class="btn small" data-ops-action="edit-profile">Edit profile</button></div><div class="panel-body"><div class="ops-profile"><div class="ops-profile-avatar">${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="" />` : initials(user.fullName || user.email)}</div><div><h2>${esc(user.fullName || 'AKARI User')}</h2><p>${esc(user.email || '—')}</p>${pill(user.role, 'pink')} ${user.financeAccess ? pill('Finance enabled', 'green') : ''}</div></div><div class="property-grid"><div class="property"><span>Workspace</span><strong>${esc(user.tenantName || user.tenantSlug || 'AKARI House')}</strong></div><div class="property"><span>Membership</span><strong>${esc(title(user.membershipStatus || 'ACTIVE'))}</strong></div><div class="property"><span>Authentication</span><strong>Cloudflare Access OTP</strong></div><div class="property"><span>Last login</span><strong>${esc(user.lastLoginAt ? date(user.lastLoginAt) : 'Not recorded')}</strong></div></div></div></section>
        <section class="panel"><div class="panel-head"><div class="panel-title"><strong>Organisation billing</strong><span>Issuer details used on invoices</span></div><button class="btn small" data-ops-action="billing-profile">Edit billing</button></div><div class="panel-body"><div class="property-grid"><div class="property"><span>Legal name</span><strong>${esc(billing.legalName || 'Not completed')}</strong></div><div class="property"><span>Country</span><strong>${esc(billing.country || '—')}</strong></div><div class="property"><span>VAT ID</span><strong>${esc(billing.vatId || '—')}</strong></div><div class="property"><span>Invoice prefix</span><strong>${esc(billing.invoicePrefix || 'AKARI')}</strong></div><div class="property"><span>Default tax</span><strong>${Number(billing.defaultTaxRate || 0)}%</strong></div><div class="property"><span>Payment terms</span><strong>${Number(billing.defaultPaymentTermsDays || 14)} days</strong></div></div>${billingIsComplete(billing) ? `<div class="ops-banner success"><strong>Billing profile ready.</strong><span>You can create invoices from Finance.</span></div>` : `<div class="ops-banner warning"><strong>Billing profile incomplete.</strong><span>Complete it before issuing your first invoice.</span></div>`}</div></section>
        <section class="panel"><div class="panel-head"><div class="panel-title"><strong>Team access</strong><span>Members, roles and finance permission</span></div><button class="btn small" data-ops-action="open-team">Open team</button></div><div class="panel-body">${empty('Manage the AKARI House team', 'Add members and update their server-enforced roles from the Team page.', `<button class="btn primary" data-ops-action="open-team">Manage team</button>`)}</div></section>
        <section class="panel"><div class="panel-head"><div class="panel-title"><strong>Data and privacy</strong><span>Protected tenant controls</span></div></div><div class="panel-body"><div class="task-list"><button class="btn" data-route="leads">Open AKARI Leads</button><button class="btn" data-action="open-import">Import workbook</button><button class="btn" data-action="toggle-finance">Screen-share privacy</button></div></div></section>
      </div>`;
  }

  async function openEditProfile() {
    const payload = await api('/api/profile');
    const user = payload.user || {};
    modal({
      titleText: 'Edit my profile',
      subtitle: 'Your email and role are controlled by the workspace administrator.',
      submitText: 'Save profile',
      body: `<div class="form-grid"><label class="field full"><span>Full name *</span><input name="fullName" value="${valueAttr(user.fullName)}" required /></label><label class="field full"><span>Avatar image URL</span><input name="avatarUrl" type="url" value="${valueAttr(user.avatarUrl)}" placeholder="https://…" /></label><label class="field full"><span>Email</span><input value="${valueAttr(user.email)}" disabled /></label></div>`,
      onSubmit: async (form) => {
        const data = Object.fromEntries(new FormData(form));
        await api('/api/profile', { method: 'PATCH', body: JSON.stringify(data) });
        closeModal();
        state.me = await api('/api/me');
        toast('Profile updated');
        await renderSettings();
      },
    });
  }

  async function action(name, element) {
    if (name === 'new-invoice') return openNewInvoice();
    if (name === 'billing-profile') return openBillingProfile();
    if (name === 'view-invoice') return viewInvoice(element.dataset.id);
    if (name === 'mark-invoice-paid') return markInvoicePaid(element.dataset.id);
    if (name === 'add-member') return openAddMember();
    if (name === 'edit-member') return openEditMember(element.dataset.id);
    if (name === 'edit-profile') return openEditProfile();
    if (name === 'open-team') return go('team');
    if (name === 'add-line') {
      const body = $('#ops-line-items');
      const next = Number(body?.dataset.nextIndex || body?.children.length || 1);
      body.insertAdjacentHTML('beforeend', invoiceLineRow(next));
      body.dataset.nextIndex = String(next + 1);
      recalculateInvoice();
      return;
    }
    if (name === 'remove-line') {
      const rows = $$('.ops-line-row');
      if (rows.length <= 1) return toast('An invoice needs at least one line item.', 'error');
      element.closest('.ops-line-row')?.remove();
      recalculateInvoice();
    }
  }

  document.addEventListener('click', async (event) => {
    const close = event.target.closest('[data-ops-close]');
    if (close) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeModal();
      return;
    }
    const specialRoute = event.target.closest('[data-route]')?.dataset.route;
    const v8Route = event.target.closest('[data-v8-route]')?.dataset.v8Route;
    const requestedRoute = SPECIAL_ROUTES.has(specialRoute) ? specialRoute : SPECIAL_ROUTES.has(v8Route) ? v8Route : null;
    if (requestedRoute) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await go(requestedRoute);
      return;
    }
    if (event.target.closest('.profile-card, .top-actions > .avatar')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await go('settings');
      return;
    }
    const legacyPayment = event.target.closest('[data-action="new-payment"]');
    if (legacyPayment) {
      event.preventDefault();
      event.stopImmediatePropagation();
      await go('finance');
      await openNewInvoice();
      return;
    }
    const actionElement = event.target.closest('[data-ops-action]');
    if (actionElement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try { await action(actionElement.dataset.opsAction, actionElement); } catch (cause) { toast(cause.message || 'Action failed', 'error'); }
    }
  }, true);

  window.addEventListener('popstate', async (event) => {
    const route = currentRoute();
    if (!SPECIAL_ROUTES.has(route)) return;
    event.stopImmediatePropagation();
    await renderSpecial(route);
  }, true);

  async function init() {
    try { state.me = await api('/api/me'); } catch { state.me = null; }
    const wait = () => {
      if (!$('#view-root')) return setTimeout(wait, 50);
      if (SPECIAL_ROUTES.has(currentRoute())) {
        setTimeout(() => renderSpecial(currentRoute()), 350);
        setTimeout(() => renderSpecial(currentRoute()), 900);
      }
    };
    wait();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
