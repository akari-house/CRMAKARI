import { json, error, readJson } from '../../../lib/response.js';
import { first, run, makeId, nowIso } from '../../../lib/db.js';
import { requireTenant, requireRole } from '../../../lib/permissions.js';
import { parseJson, text } from '../../../lib/revenue-lifecycle.js';

export const CLIENT_BILLING_MARKER = 'AKARI_CLIENT_BILLING_PROFILE_V1';
const EDIT_ROLES = ['OWNER', 'ADMIN', 'BD_MANAGER', 'FINANCE'];
const REQUIRED_FIELDS = ['legalName', 'billingEmail', 'addressLine1', 'city', 'country'];

function profileFromInput(body = {}) {
  const paymentTermsDays = Number(body.paymentTermsDays ?? 14);
  const taxRate = Number(body.defaultTaxRate ?? 0);
  const defaultTaxMode = String(body.defaultTaxMode || (taxRate > 0 ? 'EXCLUSIVE' : 'NONE')).trim().toUpperCase();
  return {
    legalName: text(body.legalName, 300),
    billingEmail: text(body.billingEmail, 320),
    contactName: text(body.contactName, 300),
    addressLine1: text(body.addressLine1, 500),
    addressLine2: text(body.addressLine2, 500),
    city: text(body.city, 200),
    postalCode: text(body.postalCode, 60),
    country: text(body.country, 120),
    vatId: text(body.vatId, 120),
    registrationNumber: text(body.registrationNumber, 160),
    preferredCurrency: (text(body.preferredCurrency, 10) || 'USD').toUpperCase(),
    defaultTaxMode: ['EXCLUSIVE', 'INCLUSIVE', 'NONE'].includes(defaultTaxMode) ? defaultTaxMode : 'NONE',
    defaultTaxRate: Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 100 ? taxRate : 0,
    paymentTermsDays: Number.isFinite(paymentTermsDays) && paymentTermsDays >= 0 && paymentTermsDays <= 365
      ? Math.round(paymentTermsDays)
      : 14,
    paymentInstructions: text(body.paymentInstructions, 5000),
    internalNotes: text(body.internalNotes, 5000),
  };
}

function readiness(profile = {}) {
  const missing = REQUIRED_FIELDS.filter((field) => !String(profile[field] || '').trim());
  return {
    complete: missing.length === 0,
    missing,
    requiredFields: [...REQUIRED_FIELDS],
  };
}

function parseStoredProfile(row) {
  const metadata = parseJson(row?.description, {});
  if (metadata.recordType !== CLIENT_BILLING_MARKER) return null;
  const profile = profileFromInput(metadata.profile || metadata);
  return {
    id: row.id,
    profile,
    readiness: readiness(profile),
    saved: true,
    updatedAt: metadata.updatedAt || row.occurred_at || row.created_at,
    updatedBy: metadata.updatedBy || row.user_id || null,
  };
}

async function loadProject(db, tenantId, projectId) {
  return first(db, `
    SELECT p.id, p.name, p.country, p.lifecycle_status,
           c.full_name AS primary_contact_name, c.email AS primary_contact_email
    FROM projects p
    LEFT JOIN contacts c
      ON c.project_id = p.id
     AND c.tenant_id = p.tenant_id
     AND c.is_primary_contact = 1
    WHERE p.tenant_id = ? AND p.id = ?
    LIMIT 1
  `, [tenantId, projectId]);
}

async function loadLatest(db, tenantId, projectId) {
  return first(db, `
    SELECT id, user_id, description, outcome, occurred_at, created_at
    FROM activities
    WHERE tenant_id = ?
      AND project_id = ?
      AND activity_type = 'CLIENT_BILLING_PROFILE'
      AND description LIKE '%\"recordType\":\"AKARI_CLIENT_BILLING_PROFILE_V1\"%'
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT 1
  `, [tenantId, projectId]);
}

function fallbackProfile(project) {
  return profileFromInput({
    legalName: project?.name,
    billingEmail: project?.primary_contact_email,
    contactName: project?.primary_contact_name,
    country: project?.country,
    preferredCurrency: 'USD',
    paymentTermsDays: 14,
  });
}

export async function onRequestGet(context) {
  try {
    const tenantId = requireTenant(context.data.auth);
    const projectId = String(context.params.id || '').trim();
    if (!projectId) return error('Client project is required', 422);
    if (!context.env.DB) {
      const profile = fallbackProfile({ name: 'Demo client', country: 'Germany' });
      return json({ project: { id: projectId, name: 'Demo client' }, profile, readiness: readiness(profile), saved: false, demo: true });
    }

    const project = await loadProject(context.env.DB, tenantId, projectId);
    if (!project) return error('Client project was not found', 404);
    const stored = parseStoredProfile(await loadLatest(context.env.DB, tenantId, projectId));
    if (stored) return json({ project, ...stored });

    const profile = fallbackProfile(project);
    return json({
      project,
      profile,
      readiness: readiness(profile),
      saved: false,
      updatedAt: null,
      updatedBy: null,
    });
  } catch (cause) {
    return error(cause.message || 'Client billing profile could not be loaded', Number(cause.status || 500));
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = context.data.auth;
    requireRole(auth, EDIT_ROLES);
    const tenantId = requireTenant(auth);
    const projectId = String(context.params.id || '').trim();
    const body = await readJson(context.request);
    if (!projectId) return error('Client project is required', 422);
    const profile = profileFromInput(body);
    if (!profile.legalName) return error('Client legal or billing name is required', 422);
    if (profile.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.billingEmail)) {
      return error('Billing email is invalid', 422);
    }

    const profileReadiness = readiness(profile);
    if (!context.env.DB) return json({ profile, readiness: profileReadiness, saved: true, demo: true });
    const project = await loadProject(context.env.DB, tenantId, projectId);
    if (!project) return error('Client project was not found', 404);

    const id = makeId('act');
    const now = nowIso();
    const metadata = {
      recordType: CLIENT_BILLING_MARKER,
      version: 1,
      profile,
      readiness: profileReadiness,
      updatedAt: now,
      updatedBy: auth.userId,
    };

    await run(context.env.DB, `
      INSERT INTO activities (
        id, tenant_id, project_id, user_id, activity_type, subject,
        description, outcome, occurred_at, next_action, created_at
      ) VALUES (?, ?, ?, ?, 'CLIENT_BILLING_PROFILE', 'Client billing profile', ?, ?, ?, ?, ?)
    `, [
      id,
      tenantId,
      projectId,
      auth.userId,
      JSON.stringify(metadata),
      profileReadiness.complete ? 'COMPLETE' : 'INCOMPLETE',
      now,
      profileReadiness.complete ? 'Ready for invoicing' : 'Complete client billing details',
      now,
    ]);

    await run(context.env.DB, `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
      VALUES (?, ?, ?, 'CLIENT_BILLING_PROFILE_UPDATED', 'PROJECT', ?, ?, ?)
    `, [
      makeId('aud'),
      tenantId,
      auth.userId,
      projectId,
      JSON.stringify({
        profileId: id,
        complete: profileReadiness.complete,
        missing: profileReadiness.missing,
        country: profile.country,
        preferredCurrency: profile.preferredCurrency,
      }),
      now,
    ]);

    const confirmed = parseStoredProfile(await loadLatest(context.env.DB, tenantId, projectId));
    if (!confirmed || confirmed.id !== id) return error('Client billing profile could not be confirmed after saving', 500);
    return json({ project, ...confirmed, updated: true });
  } catch (cause) {
    console.error('AKARI client billing profile update error', cause);
    return error(cause.message || 'Client billing profile could not be updated', Number(cause.status || 500));
  }
}
