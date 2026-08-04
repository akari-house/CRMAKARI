import { json, error, readJson } from '../../lib/response.js';
import { all, first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { text, parseJson } from '../../lib/revenue-lifecycle.js';
import {
  INVOICE_MARKER,
  INVOICE_STATUSES,
  INVOICE_TAX_MODES,
  calculateInvoiceTax,
  parseInvoice,
  roundMoney,
  sanitizePaymentSchedule,
} from '../../lib/commercial-hardening.js';

const CLIENT_BILLING_MARKER = 'AKARI_CLIENT_BILLING_PROFILE_V1';
const ISSUED_RECIPIENT_FIELDS = ['name', 'email', 'addressLine1', 'city', 'country'];

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const permissionError = new Error('Finance permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

function sanitizeLineItems(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 25) {
    const validationError = new Error('Add between 1 and 25 invoice line items');
    validationError.status = 422;
    throw validationError;
  }
  return input.map((item, index) => {
    const description = text(item?.description, 500);
    const quantity = Number(item?.quantity ?? 1);
    const unitPrice = Number(item?.unitPrice ?? 0);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      const validationError = new Error(`Invoice line ${index + 1} is invalid`);
      validationError.status = 422;
      throw validationError;
    }
    return {
      description,
      quantity: roundMoney(quantity),
      unitPrice: roundMoney(unitPrice),
      amount: roundMoney(quantity * unitPrice),
    };
  });
}

async function loadBillingProfile(db, tenantId) {
  const row = await first(db, `
    SELECT t.name, t.base_currency, ts.feature_flags_json
    FROM tenants t
    LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
    WHERE t.id = ?
  `, [tenantId]);
  let flags = {};
  try { flags = JSON.parse(row?.feature_flags_json || '{}'); } catch { flags = {}; }
  return {
    tenantName: row?.name || 'AKARI House',
    baseCurrency: row?.base_currency || 'USD',
    billingProfile: flags.billingProfile || {},
  };
}

async function loadClientBillingProfile(db, tenantId, projectId) {
  const row = await first(db, `
    SELECT description
    FROM activities
    WHERE tenant_id = ?
      AND project_id = ?
      AND activity_type = 'CLIENT_BILLING_PROFILE'
      AND description LIKE '%\"recordType\":\"AKARI_CLIENT_BILLING_PROFILE_V1\"%'
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT 1
  `, [tenantId, projectId]);
  const metadata = parseJson(row?.description, {});
  return metadata.recordType === CLIENT_BILLING_MARKER ? (metadata.profile || {}) : {};
}

function validateIssuedRecipient(recipient) {
  const missing = ISSUED_RECIPIENT_FIELDS.filter((field) => !String(recipient?.[field] || '').trim());
  if (missing.length) {
    const labels = {
      name: 'legal or billing name',
      email: 'billing email',
      addressLine1: 'address line 1',
      city: 'city',
      country: 'country',
    };
    const validationError = new Error(`Complete the client billing profile before issuing this invoice: ${missing.map((field) => labels[field]).join(', ')}`);
    validationError.status = 422;
    throw validationError;
  }
}

function invoiceEligibility(campaign) {
  const metadata = parseJson(campaign?.notes, {});
  const dealModel = String(metadata.dealModel || '').toUpperCase();
  const invoiceEligible = metadata.invoiceEligible !== undefined
    ? Boolean(metadata.invoiceEligible)
    : dealModel !== 'PARTNERSHIP';
  return { invoiceEligible, dealModel };
}

async function nextInvoiceNumber(db, tenantId, prefix, invoiceDate) {
  const year = String(invoiceDate || new Date().toISOString()).slice(0, 4);
  const safePrefix = String(prefix || 'AKARI').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'AKARI';
  const pattern = `${safePrefix}-${year}-%`;
  const result = await first(db, `
    SELECT COUNT(*) AS value
    FROM payments
    WHERE tenant_id = ? AND payment_type = 'INVOICE' AND invoice_reference LIKE ?
  `, [tenantId, pattern]);
  let sequence = Number(result?.value || 0) + 1;
  while (sequence < 100000) {
    const candidate = `${safePrefix}-${year}-${String(sequence).padStart(4, '0')}`;
    const exists = await first(db, 'SELECT id FROM payments WHERE tenant_id = ? AND invoice_reference = ? LIMIT 1', [tenantId, candidate]);
    if (!exists) return candidate;
    sequence += 1;
  }
  throw new Error('Unable to generate a unique invoice number');
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const [invoiceRows, relatedRows] = await Promise.all([
      all(context.env.DB, `
        SELECT pay.*, p.name AS project_name
        FROM payments pay
        JOIN projects p ON p.id = pay.project_id AND p.tenant_id = pay.tenant_id
        WHERE pay.tenant_id = ?
          AND pay.payment_type = 'INVOICE'
          AND pay.notes LIKE '%\"recordType\":\"INVOICE_V1\"%'
        ORDER BY pay.created_at DESC
        LIMIT 250
      `, [tenantId]),
      all(context.env.DB, `
        SELECT * FROM payments
        WHERE tenant_id = ? AND payment_type IN ('INVOICE_RECEIPT','CREDIT_NOTE')
        ORDER BY created_at DESC
        LIMIT 1000
      `, [tenantId]),
    ]);
    const receipts = relatedRows.filter((row) => row.payment_type === 'INVOICE_RECEIPT');
    const credits = relatedRows.filter((row) => row.payment_type === 'CREDIT_NOTE');
    const today = new Date().toISOString().slice(0, 10);
    const invoices = invoiceRows.map((row) => {
      const item = parseInvoice(row, receipts, credits);
      if (item.outstanding > 0 && item.dueDate && item.dueDate < today && ['INVOICED','PARTIALLY_PAID','PARTIALLY_CREDITED'].includes(item.status)) item.status = 'OVERDUE';
      return item;
    });
    return json({ items: invoices, total: invoices.length });
  } catch (cause) {
    return error(cause.message || 'Invoices could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const projectId = text(body.projectId, 120);
    const campaignId = text(body.campaignId, 120);
    const requestedOpportunityId = text(body.opportunityId, 120);
    const invoiceDate = text(body.invoiceDate, 10) || new Date().toISOString().slice(0, 10);
    const dueDate = text(body.dueDate, 10);
    const currency = (text(body.currency, 10) || 'USD').toUpperCase();
    const status = String(body.status || 'DRAFT').toUpperCase();
    const requestedTaxRate = Number(body.taxRate || 0);
    const requestedTaxMode = String(body.taxMode || '').trim().toUpperCase();
    if (!projectId) return error('Client project is required', 422);
    if (!INVOICE_STATUSES.has(status) || ['CANCELLED','CREDITED','PARTIALLY_CREDITED','OVERDUE'].includes(status)) return error('Invoice creation status is invalid', 422);
    if (status === 'INVOICED' && !dueDate) return error('Due date is required for an issued invoice', 422);
    if (!Number.isFinite(requestedTaxRate) || requestedTaxRate < 0 || requestedTaxRate > 100) return error('Tax rate must be between 0 and 100', 422);
    if (requestedTaxMode && !INVOICE_TAX_MODES.has(requestedTaxMode)) return error('Tax treatment must be inclusive, exclusive or no tax', 422);
    const lineItems = sanitizeLineItems(body.lineItems);
    const tax = calculateInvoiceTax(lineItems, requestedTaxRate, requestedTaxMode);
    const {
      taxMode,
      pricesIncludeTax,
      enteredSubtotal,
      subtotal,
      taxRate,
      taxAmount,
      total,
    } = tax;
    const paymentSchedule = sanitizePaymentSchedule(body.paymentSchedule, total);
    if (!context.env.DB) return json({
      id: makeId('inv'),
      invoiceNumber: 'DEMO-0001',
      taxMode,
      subtotal,
      taxAmount,
      total,
      created: true,
      demo: true,
    }, 201);

    const project = await first(context.env.DB, `
      SELECT p.id, p.name, p.website, p.telegram, p.country,
             c.full_name AS contact_name, c.email AS contact_email
      FROM projects p
      LEFT JOIN contacts c ON c.project_id = p.id AND c.tenant_id = p.tenant_id AND c.is_primary_contact = 1
      WHERE p.tenant_id = ? AND p.id = ?
      LIMIT 1
    `, [tenantId, projectId]);
    if (!project) return error('Client project was not found', 404);

    let opportunityId = requestedOpportunityId;
    let linkedCampaign = null;
    if (campaignId) {
      linkedCampaign = await first(context.env.DB, `
        SELECT c.id, c.opportunity_id, c.status, c.notes,
               o.stage AS opportunity_stage
        FROM campaigns c
        LEFT JOIN opportunities o
          ON o.id = c.opportunity_id
         AND o.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.id = ? AND c.project_id = ?
        LIMIT 1
      `, [tenantId, campaignId, projectId]);
      if (!linkedCampaign) return error('Selected engagement does not belong to this client and workspace', 422);
      if (opportunityId && linkedCampaign.opportunity_id && opportunityId !== linkedCampaign.opportunity_id) {
        return error('Selected opportunity does not match the engagement', 422);
      }
      opportunityId = linkedCampaign.opportunity_id || opportunityId;
      if (status !== 'DRAFT') {
        if (String(linkedCampaign.status || '').toUpperCase() === 'CANCELLED') return error('Cancelled engagements cannot be invoiced', 422);
        if (String(linkedCampaign.opportunity_stage || '').toUpperCase() !== 'WON') return error('Issue the invoice from a won opportunity and active engagement', 422);
        if (!invoiceEligibility(linkedCampaign).invoiceEligible) return error('This partnership engagement is marked as non-billable', 422);
      }
    } else if (opportunityId) {
      const opportunity = await first(context.env.DB, `
        SELECT id, stage FROM opportunities
        WHERE tenant_id = ? AND id = ? AND project_id = ?
        LIMIT 1
      `, [tenantId, opportunityId, projectId]);
      if (!opportunity) return error('Selected opportunity does not belong to this client and workspace', 422);
      if (status !== 'DRAFT' && String(opportunity.stage || '').toUpperCase() !== 'WON') {
        return error('Issued commercial invoices must be linked to a won opportunity', 422);
      }
    }

    const tenant = await loadBillingProfile(context.env.DB, tenantId);
    const billingProfile = tenant.billingProfile || {};
    const issuer = {
      legalName: text(body.issuer?.legalName || billingProfile.legalName || tenant.tenantName, 300),
      addressLine1: text(body.issuer?.addressLine1 || billingProfile.addressLine1, 500),
      addressLine2: text(body.issuer?.addressLine2 || billingProfile.addressLine2, 500),
      city: text(body.issuer?.city || billingProfile.city, 200),
      postalCode: text(body.issuer?.postalCode || billingProfile.postalCode, 60),
      country: text(body.issuer?.country || billingProfile.country, 120),
      email: text(body.issuer?.email || billingProfile.email, 320),
      phone: text(body.issuer?.phone || billingProfile.phone, 100),
      vatId: text(body.issuer?.vatId || billingProfile.vatId, 120),
      registrationNumber: text(body.issuer?.registrationNumber || billingProfile.registrationNumber, 160),
      bankName: text(body.issuer?.bankName || billingProfile.bankName, 200),
      iban: text(body.issuer?.iban || billingProfile.iban, 120),
      bic: text(body.issuer?.bic || billingProfile.bic, 120),
      walletAddress: text(body.issuer?.walletAddress || billingProfile.walletAddress, 500),
      logoUrl: text(body.issuer?.logoUrl || billingProfile.logoUrl, 1000),
    };
    if (!issuer.legalName || !issuer.addressLine1 || !issuer.country) {
      return error('Complete the organisation billing profile before creating an invoice', 422);
    }

    const clientBillingProfile = await loadClientBillingProfile(context.env.DB, tenantId, projectId);
    const recipient = {
      name: text(body.recipient?.name || clientBillingProfile.legalName || project.name, 300),
      contactName: text(body.recipient?.contactName || clientBillingProfile.contactName || project.contact_name, 300),
      email: text(body.recipient?.email || clientBillingProfile.billingEmail || project.contact_email, 320),
      addressLine1: text(body.recipient?.addressLine1 || clientBillingProfile.addressLine1, 500),
      addressLine2: text(body.recipient?.addressLine2 || clientBillingProfile.addressLine2, 500),
      city: text(body.recipient?.city || clientBillingProfile.city, 200),
      postalCode: text(body.recipient?.postalCode || clientBillingProfile.postalCode, 60),
      country: text(body.recipient?.country || clientBillingProfile.country || project.country, 120),
      vatId: text(body.recipient?.vatId || clientBillingProfile.vatId, 120),
      registrationNumber: text(body.recipient?.registrationNumber || clientBillingProfile.registrationNumber, 160),
    };
    if (!recipient.name) return error('Client billing name is required', 422);
    if (status !== 'DRAFT') validateIssuedRecipient(recipient);

    const requestedNumber = text(body.invoiceNumber, 80);
    const invoiceNumber = requestedNumber || await nextInvoiceNumber(context.env.DB, tenantId, billingProfile.invoicePrefix || 'AKARI', invoiceDate);
    const duplicate = await first(context.env.DB, 'SELECT id FROM payments WHERE tenant_id = ? AND invoice_reference = ? LIMIT 1', [tenantId, invoiceNumber]);
    if (duplicate) return error('This invoice number already exists', 409);

    const id = makeId('inv');
    const now = nowIso();
    const metadata = {
      recordType: INVOICE_MARKER,
      invoiceDate,
      engagementId: campaignId,
      opportunityId,
      issuer,
      recipient,
      lineItems,
      paymentSchedule,
      taxMode,
      pricesIncludeTax,
      enteredSubtotal,
      subtotal,
      taxRate,
      taxAmount,
      total,
      taxLabel: text(body.taxLabel, 500),
      notes: text(body.notes, 5000),
      paymentInstructions: text(body.paymentInstructions || billingProfile.paymentInstructions, 5000),
      createdBy: auth.userId,
    };
    const receivedDate = status === 'PAID' ? (text(body.receivedDate, 10) || invoiceDate) : null;
    await run(context.env.DB, `
      INSERT INTO payments (
        id, tenant_id, project_id, campaign_id, invoice_reference, payment_type,
        amount, currency, amount_base_currency, due_date, received_date, status,
        payment_method, wallet_or_bank_reference, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, tenantId, projectId, campaignId, invoiceNumber,
      total, currency, total, dueDate, receivedDate, status,
      text(body.paymentMethod, 200), text(body.reference, 1000), JSON.stringify(metadata), now, now,
    ]);

    if (campaignId && status !== 'DRAFT') {
      const totals = await first(context.env.DB, `
        SELECT COALESCE(SUM(CASE WHEN payment_type = 'INVOICE' AND status NOT IN ('DRAFT','CANCELLED') THEN amount ELSE 0 END), 0) AS value
        FROM payments
        WHERE tenant_id = ? AND campaign_id = ?
      `, [tenantId, campaignId]);
      await run(context.env.DB, `
        UPDATE campaigns SET amount_invoiced = ?, payment_status = CASE WHEN amount_received > 0 THEN 'PARTIALLY_PAID' ELSE 'INVOICED' END,
          updated_at = ?, updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `, [Number(totals?.value || total), now, auth.userId, tenantId, campaignId]);
    }

    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'INVOICE_CREATED', 'INVOICE', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, id, JSON.stringify({
      invoiceNumber,
      projectId,
      campaignId,
      opportunityId,
      taxMode,
      taxRate,
      subtotal,
      taxAmount,
      total,
      currency,
      status,
      scheduleItems: paymentSchedule.length,
      clientBillingProfileUsed: Boolean(Object.keys(clientBillingProfile).length),
    }), now]);
    return json({
      id,
      invoiceNumber,
      engagementId: campaignId,
      opportunityId,
      taxMode,
      subtotal,
      taxAmount,
      total,
      status,
      paymentSchedule,
      created: true,
    }, 201);
  } catch (cause) {
    console.error('AKARI invoice creation error', cause);
    return error(cause.message || 'Invoice could not be created', Number(cause.status || 500));
  }
}
