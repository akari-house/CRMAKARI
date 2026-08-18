import { error, json, readJson } from '../../lib/response.js';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const text = (value, max = 160) => String(value || '').trim().slice(0, max);

function agreementIsValid(row, now = Date.now()) {
  if (!row || !['SIGNED', 'ACTIVE'].includes(String(row.status || '').toUpperCase())) return false;
  if (!row.signed_at || !Number.isFinite(Date.parse(row.signed_at))) return false;
  if (row.end_date && Number.isFinite(Date.parse(row.end_date)) && Date.parse(row.end_date) <= now) return false;
  return true;
}

export async function onRequestPost(context) {
  const auth = context.data?.auth;
  if (auth?.role !== 'API' || !auth?.tenantId) return error('AKARI API authentication is required', 401);
  if (!Array.isArray(auth.scopes) || !auth.scopes.includes('house_nda_read')) {
    return error('API key requires house_nda_read scope', 403);
  }
  if (!context.env?.DB) return error('D1 binding DB is not configured', 500);

  let body;
  try {
    body = await readJson(context.request);
  } catch {
    return error('Expected an application/json request body', 400);
  }

  const houseProjectId = text(body?.houseProjectId, 160);
  const counterpartyEmail = normalizeEmail(body?.counterpartyEmail).slice(0, 320);
  if (!houseProjectId) return error('houseProjectId is required', 422);
  if (!counterpartyEmail || !counterpartyEmail.includes('@')) return error('counterpartyEmail is invalid', 422);

  const projectLink = await context.env.DB.prepare(`
    SELECT id, crm_project_id AS crmProjectId, source
    FROM house_project_links
    WHERE tenant_id = ? AND house_project_id = ? AND status = 'ACTIVE'
    LIMIT 1
  `).bind(auth.tenantId, houseProjectId).first();

  if (!projectLink) {
    return json({
      source: 'crm',
      authoritative: false,
      ndaValid: false,
      reason: 'PROJECT_NOT_LINKED',
    });
  }

  const result = await context.env.DB.prepare(`
    SELECT
      a.id AS agreementId,
      a.status,
      a.signed_at AS signedAt,
      a.start_date AS startDate,
      a.end_date AS endDate,
      aci.id AS identityId,
      aci.house_user_id AS houseUserId,
      aci.house_agreement_record_id AS houseAgreementRecordId,
      aci.source AS identitySource
    FROM agreements a
    JOIN agreement_counterparty_identities aci
      ON aci.tenant_id = a.tenant_id
     AND aci.agreement_id = a.id
    WHERE a.tenant_id = ?
      AND a.project_id = ?
      AND a.agreement_type = 'NDA'
      AND aci.identity_status = 'VERIFIED'
      AND lower(trim(aci.counterparty_email)) = lower(trim(?))
    ORDER BY
      CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'SIGNED' THEN 1 ELSE 2 END,
      COALESCE(a.signed_at, a.updated_at) DESC,
      a.id DESC
  `).bind(auth.tenantId, projectLink.crmProjectId, counterpartyEmail).all();

  const rows = result?.results || [];
  if (!rows.length) {
    return json({
      source: 'crm',
      authoritative: false,
      ndaValid: false,
      reason: 'COUNTERPARTY_NOT_LINKED',
      projectLinkId: projectLink.id,
    });
  }

  const valid = rows.find((row) => agreementIsValid({
    status: row.status,
    signed_at: row.signedAt,
    end_date: row.endDate,
  }));

  if (!valid) {
    return json({
      source: 'crm',
      authoritative: true,
      ndaValid: false,
      reason: 'NO_VALID_SIGNED_NDA',
      projectLinkId: projectLink.id,
    });
  }

  return json({
    source: 'crm',
    authoritative: true,
    ndaValid: true,
    reason: 'VALID_SIGNED_NDA',
    projectLinkId: projectLink.id,
    agreementId: valid.agreementId,
    identityId: valid.identityId,
    houseAgreementRecordId: valid.houseAgreementRecordId || null,
    status: valid.status,
    signedAt: valid.signedAt,
    startsAt: valid.startDate || null,
    expiresAt: valid.endDate || null,
  });
}

export const __test__ = { agreementIsValid, normalizeEmail };
