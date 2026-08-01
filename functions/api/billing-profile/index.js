import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant, requireRole } from '../../lib/permissions.js';

const text = (value, max = 5000) => value === null || value === undefined ? null : (String(value).trim().slice(0, max) || null);
const numberInRange = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
};

function parseFlags(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

async function load(context, tenantId) {
  const row = await first(context.env.DB, `
    SELECT t.id, t.name, t.slug, t.base_currency, t.timezone, t.logo_url, ts.feature_flags_json
    FROM tenants t
    LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
    WHERE t.id = ?
  `, [tenantId]);
  const flags = parseFlags(row?.feature_flags_json);
  return {
    tenant: {
      id: row?.id,
      name: row?.name,
      slug: row?.slug,
      baseCurrency: row?.base_currency || 'USD',
      timezone: row?.timezone || 'Europe/Berlin',
      logoUrl: row?.logo_url || null,
    },
    billingProfile: flags.billingProfile || {},
  };
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    if (!context.env.DB) return json({ tenant: { name: 'AKARI House', baseCurrency: 'USD' }, billingProfile: {}, demo: true });
    return json(await load(context, tenantId));
  } catch (cause) {
    return error(cause.message || 'Billing profile could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, ['OWNER', 'ADMIN', 'FINANCE']);
    const tenantId = requireTenant(auth);
    const body = await readJson(context.request);
    const billingProfile = {
      legalName: text(body.legalName, 300),
      addressLine1: text(body.addressLine1, 500),
      addressLine2: text(body.addressLine2, 500),
      city: text(body.city, 200),
      postalCode: text(body.postalCode, 60),
      country: text(body.country, 120),
      email: text(body.email, 320),
      phone: text(body.phone, 100),
      vatId: text(body.vatId, 120),
      registrationNumber: text(body.registrationNumber, 160),
      bankName: text(body.bankName, 200),
      iban: text(body.iban, 120),
      bic: text(body.bic, 120),
      walletAddress: text(body.walletAddress, 500),
      paymentInstructions: text(body.paymentInstructions, 5000),
      logoUrl: text(body.logoUrl, 1000),
      invoicePrefix: (text(body.invoicePrefix, 16) || 'AKARI').toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      defaultTaxRate: numberInRange(body.defaultTaxRate, 0, 0, 100),
      defaultPaymentTermsDays: Math.round(numberInRange(body.defaultPaymentTermsDays, 14, 0, 365)),
      updatedAt: nowIso(),
    };
    if (!billingProfile.legalName) return error('Legal or trading name is required', 422);
    if (!context.env.DB) return json({ billingProfile, updated: true, demo: true });

    const existing = await first(context.env.DB, 'SELECT feature_flags_json FROM tenant_settings WHERE tenant_id = ?', [tenantId]);
    const flags = parseFlags(existing?.feature_flags_json);
    flags.billingProfile = billingProfile;
    const now = nowIso();
    await run(context.env.DB, `
      INSERT INTO tenant_settings (tenant_id, feature_flags_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET feature_flags_json = excluded.feature_flags_json, updated_at = excluded.updated_at
    `, [tenantId, JSON.stringify(flags), now]);
    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'BILLING_PROFILE_UPDATED', 'TENANT', ?, ?, ?)
    `, [makeId('aud'), tenantId, auth.userId, tenantId, JSON.stringify({ legalName: billingProfile.legalName, country: billingProfile.country }), now]);
    return json({ billingProfile, updated: true });
  } catch (cause) {
    console.error('AKARI billing profile update error', cause);
    return error(cause.message || 'Billing profile could not be updated', Number(cause.status || 500));
  }
}
