import { error } from '../../../lib/response.js';
import { first } from '../../../lib/db.js';
import { requireTenant } from '../../../lib/permissions.js';
import { parseFeatureFlags, parseProposal } from '../../../lib/commercial-hardening.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const paragraphs = (value) => esc(value || '-').replaceAll('\n', '<br/>');
const money = (value, currency) => new Intl.NumberFormat('en-US', { style:'currency', currency: currency || 'USD', maximumFractionDigits:2 }).format(Number(value || 0));

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const row = await first(context.env.DB, `
      SELECT a.*, o.name AS opportunity_name, p.name AS project_name, p.website,
        c.full_name AS contact_name, c.job_title AS contact_title, c.email AS contact_email,
        t.name AS tenant_name, t.logo_url, ts.feature_flags_json
      FROM activities a
      JOIN opportunities o ON o.id = a.opportunity_id AND o.tenant_id = a.tenant_id
      JOIN projects p ON p.id = a.project_id AND p.tenant_id = a.tenant_id
      JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN contacts c ON c.id = o.primary_contact_id AND c.tenant_id = o.tenant_id
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE a.tenant_id = ? AND a.id = ? AND a.activity_type = 'PROPOSAL'
        AND a.description LIKE '%\"recordType\":\"AKARI_PROPOSAL_V1\"%'
      LIMIT 1
    `, [tenantId, context.params.id]);
    if (!row) return error('Proposal not found', 404);
    const proposal = parseProposal(row);
    const flags = parseFeatureFlags(row.feature_flags_json);
    const issuer = flags.billingProfile || {};
    const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(proposal.title)} · v${proposal.version}</title><style>
      :root{color-scheme:light;font-family:Inter,Arial,sans-serif;color:#17191d;background:#eef0f3}*{box-sizing:border-box}body{margin:0;padding:32px}.sheet{max-width:900px;margin:auto;background:white;padding:56px;border:1px solid #ddd;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.08)}header{display:flex;justify-content:space-between;gap:32px;border-bottom:3px solid #f59e0b;padding-bottom:28px}.brand img{max-width:180px;max-height:54px;object-fit:contain}.brand h1{margin:0;font-size:24px}.meta{text-align:right;color:#60646c;font-size:13px}.hero{padding:34px 0 22px}.eyebrow{font-size:12px;letter-spacing:.16em;color:#b45309;font-weight:800}.hero h2{font-size:36px;line-height:1.1;margin:8px 0}.amount{font-size:28px;font-weight:800;color:#b45309}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{border:1px solid #e5e7eb;border-radius:12px;padding:18px}.card h3{margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280}.card p{margin:0;line-height:1.65}.full{grid-column:1/-1}.status{display:inline-block;padding:7px 10px;border-radius:999px;background:#fff7ed;color:#9a3412;font-weight:700;font-size:12px}.footer{margin-top:36px;padding-top:20px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;color:#6b7280;font-size:12px}.toolbar{max-width:900px;margin:0 auto 16px;display:flex;justify-content:flex-end;gap:8px}.toolbar button{border:0;border-radius:8px;padding:10px 16px;background:#111827;color:#fff;font-weight:700;cursor:pointer}@media(max-width:700px){body{padding:0}.toolbar{padding:12px}.sheet{border:0;border-radius:0;padding:28px}.grid{grid-template-columns:1fr}header{flex-direction:column}.meta{text-align:left}.full{grid-column:auto}}@media print{body{background:white;padding:0}.toolbar{display:none}.sheet{max-width:none;border:0;border-radius:0;box-shadow:none;padding:24mm 18mm}@page{size:A4;margin:0}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header><div class="brand"><img src="/assets/brand/akari-crm-lockup.png" alt="AKARI CRM"/><h1>${esc(issuer.legalName || row.tenant_name || 'AKARI House')}</h1></div><div class="meta"><strong>Proposal v${proposal.version}</strong><br/>Created ${esc(String(proposal.createdAt || '').slice(0,10))}<br/><span class="status">${esc(proposal.status)}</span></div></header><section class="hero"><div class="eyebrow">COMMERCIAL PROPOSAL</div><h2>${esc(proposal.title)}</h2><p>Prepared for <strong>${esc(row.project_name)}</strong>${row.contact_name ? ` · ${esc(row.contact_name)}${row.contact_title ? `, ${esc(row.contact_title)}` : ''}` : ''}</p><div class="amount">${esc(money(proposal.amount, proposal.currency))}</div></section><section class="grid"><article class="card full"><h3>Scope</h3><p>${paragraphs(proposal.scope)}</p></article><article class="card full"><h3>Deliverables</h3><p>${paragraphs(proposal.deliverables)}</p></article><article class="card"><h3>Timeline</h3><p>${paragraphs(proposal.timeline)}</p></article><article class="card"><h3>Payment terms</h3><p>${paragraphs(proposal.paymentTerms)}</p></article><article class="card full"><h3>Assumptions and conditions</h3><p>${paragraphs(proposal.assumptions)}</p></article><article class="card"><h3>Valid until</h3><p>${esc(proposal.validityDate || 'Not specified')}</p></article><article class="card"><h3>Approval</h3><p>${proposal.approvedAt ? `Approved ${esc(String(proposal.approvedAt).slice(0,10))}` : 'Awaiting internal approval'}${proposal.acceptedAt ? `<br/>Accepted by ${esc(proposal.acceptedBy || 'client')} on ${esc(String(proposal.acceptedAt).slice(0,10))}` : ''}</p></article></section><footer class="footer"><span>${esc(issuer.email || '')}${issuer.phone ? ` · ${esc(issuer.phone)}` : ''}</span><span>${esc(issuer.country || '')}${issuer.vatId ? ` · VAT ${esc(issuer.vatId)}` : ''}</span></footer></main></body></html>`;
    return new Response(html, { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'private, no-store', 'x-content-type-options':'nosniff', 'content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
  } catch (cause) {
    return error(cause.message || 'Proposal document could not be generated', Number(cause.status || 500));
  }
}
