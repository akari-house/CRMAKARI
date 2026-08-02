(() => {
  'use strict';

  let loading = false;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const title = (value) => String(value || '').toLowerCase().split('_').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  const money = (value, currency = 'USD') => new Intl.NumberFormat('en-US', { style:'currency', currency:currency || 'USD', maximumFractionDigits:2 }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '-';
  const isCanonicalFinancePage = () => $('#view-root .page-head h1')?.textContent?.trim() === 'Invoices & Finance';

  function tone(value) {
    const key = String(value || '').toUpperCase();
    if (['PAID','ACCEPTED','APPROVED'].includes(key)) return 'green';
    if (['OVERDUE','REJECTED','CANCELLED'].includes(key)) return 'red';
    if (['INTERNAL_REVIEW','SENT','DUE','PARTIALLY_PAID','PARTIALLY_CREDITED'].includes(key)) return 'yellow';
    return '';
  }

  function pill(value, color = '') {
    return `<span class="commercial-pill ${color}">${esc(title(value || '-'))}</span>`;
  }

  function invoiceTable(items) {
    if (!items.length) return '<div class="commercial-empty">No hardened invoice records yet.</div>';
    return `<div class="commercial-table-wrap"><table class="commercial-table"><thead><tr><th>Invoice</th><th>Client</th><th>Total</th><th>Received</th><th>Outstanding</th><th>Status</th><th>Actions</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${esc(item.invoiceNumber)}</strong><span>${esc(date(item.dueDate))}</span></td><td>${esc(item.projectName || '-')}</td><td>${money(item.total,item.currency)}</td><td>${money(item.received,item.currency)}</td><td>${money(item.outstanding,item.currency)}</td><td>${pill(item.displayStatus || item.status,tone(item.displayStatus || item.status))}</td><td><div class="commercial-row-actions"><button class="btn small" data-commercial-action="print-invoice" data-id="${esc(item.id)}">View</button>${item.outstanding > 0 && !['DRAFT','CANCELLED','CREDITED'].includes(item.status) ? `<button class="btn small primary" data-commercial-action="pay-invoice" data-id="${esc(item.id)}">Payment</button><button class="btn small" data-commercial-action="remind-invoice" data-id="${esc(item.id)}">Reminder</button><button class="btn small" data-commercial-action="credit-invoice" data-id="${esc(item.id)}">Credit</button>` : ''}${['DRAFT','INVOICED'].includes(item.status) && item.received <= 0 && item.credited <= 0 ? `<button class="btn small" data-commercial-action="cancel-invoice" data-id="${esc(item.id)}">Cancel</button>` : ''}${item.status === 'DRAFT' ? `<button class="btn small primary" data-commercial-action="issue-invoice" data-id="${esc(item.id)}">Issue</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  }

  function proposalList(items) {
    const active = items.filter((item) => ['INTERNAL_REVIEW','APPROVED','SENT'].includes(item.status)).slice(0, 8);
    if (!active.length) return '<div class="commercial-empty">No proposals awaiting commercial action.</div>';
    return `<div class="commercial-list">${active.map((item) => `<article><div><strong>${esc(item.title)}</strong><span>v${esc(item.version)} · ${money(item.amount,item.currency)}</span></div><div>${pill(item.status,tone(item.status))}<button class="btn small" data-commercial-action="print-proposal" data-id="${esc(item.id)}">View</button>${item.status === 'INTERNAL_REVIEW' ? `<button class="btn small primary" data-commercial-action="proposal-status" data-id="${esc(item.id)}" data-status="APPROVED">Approve</button>` : ''}${item.status === 'APPROVED' ? `<button class="btn small primary" data-commercial-action="proposal-status" data-id="${esc(item.id)}" data-status="SENT">Mark sent</button>` : ''}${item.status === 'SENT' ? `<button class="btn small" data-commercial-action="proposal-decision" data-id="${esc(item.id)}">Decision</button>` : ''}</div></article>`).join('')}</div>`;
  }

  function referralList(items) {
    const active = items.filter((item) => ['CONFIRMED','DUE','PAID'].includes(item.status)).slice(0, 8);
    if (!active.length) return '<div class="commercial-empty">No referral statements yet.</div>';
    return `<div class="commercial-list">${active.map((item) => `<article><div><strong>${esc(item.partnerName)}</strong><span>${esc(item.projectName || item.engagementName || 'Commercial engagement')}</span></div><div><strong>${money(item.amount,item.currency)}</strong>${pill(item.status,tone(item.status))}</div></article>`).join('')}</div>`;
  }

  async function renderFinance(force = false) {
    if (!isCanonicalFinancePage() || loading) return;
    const existing = $('#commercial-command-centre');
    if (existing && !force) return;
    loading = true;
    try {
      const response = await fetch('/api/commercial/overview', { credentials:'same-origin', cache:'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      if (!isCanonicalFinancePage()) return;
      $('#commercial-command-centre')?.remove();
      const invoices = payload.invoices || [];
      const referrals = payload.referrals || [];
      const proposals = payload.proposals || [];
      const root = document.createElement('section');
      root.id = 'commercial-command-centre';
      root.className = 'commercial-command-centre';
      root.dataset.commercialFinanceRouteFix = 'v31';
      root.innerHTML = `
        <div class="commercial-kpis">
          <article><span>Invoiced</span><strong>${money(payload.metrics?.invoiced || 0)}</strong><small>After credit notes</small></article>
          <article><span>Collected</span><strong>${money(payload.metrics?.collected || 0)}</strong><small>Allocated receipts</small></article>
          <article class="attention"><span>Outstanding</span><strong>${money(payload.metrics?.outstanding || 0)}</strong><small>${payload.metrics?.overdueInvoices || 0} overdue</small></article>
          <article><span>Referral due</span><strong>${money(payload.metrics?.referralDue || 0)}</strong><small>Approved liability</small></article>
        </div>
        <div class="commercial-toolbar"><div><strong>Commercial operations</strong><span>Proposal approvals, invoice schedules, collections and referral settlement.</span></div><div><button class="btn" data-commercial-action="templates">Proposal templates</button><a class="btn" href="/api/commercial/export?type=invoices">Export ledger</a><a class="btn" href="/api/commercial/export?type=referrals">Export referrals</a></div></div>
        <div class="commercial-grid">
          <article class="commercial-panel wide"><header><div><strong>Invoice collection queue</strong><span>Draft, outstanding and overdue invoices.</span></div>${pill(`${invoices.length} invoices`)}</header>${invoiceTable(invoices)}</article>
          <article class="commercial-panel"><header><div><strong>Proposal approvals</strong><span>Internal review and approved proposals.</span></div>${pill(`${proposals.filter((item) => ['INTERNAL_REVIEW','APPROVED','SENT'].includes(item.status)).length} active`)}</header>${proposalList(proposals)}</article>
          <article class="commercial-panel"><header><div><strong>Referral statements</strong><span>Confirmed, due and paid rewards.</span></div>${pill(`${referrals.length} records`)}</header>${referralList(referrals)}</article>
        </div>`;
      $('#view-root .page-head')?.insertAdjacentElement('afterend', root);
    } catch (cause) {
      console.warn('Canonical finance commercial controls could not be loaded', cause);
    } finally {
      loading = false;
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!isCanonicalFinancePage()) return;
    const successfulCommercialAction = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.('.toast:not(.error)')));
    renderFinance(successfulCommercialAction);
  });

  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', () => renderFinance());
})();