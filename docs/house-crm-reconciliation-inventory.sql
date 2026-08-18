-- R84 read-only reconciliation inventory for CRM by AKARI.
-- Run manually against the intended tenant after a production backup.
-- Do not commit query output or production data to GitHub.
--
-- Replace :tenant_id with the authenticated AKARI House CRM tenant id in the
-- operator's query tool. These queries return counts only.

SELECT 'crm_projects' AS metric, COUNT(*) AS value
FROM projects
WHERE tenant_id = :tenant_id;

SELECT 'crm_contacts' AS metric, COUNT(*) AS value
FROM contacts
WHERE tenant_id = :tenant_id;

SELECT 'crm_agreements' AS metric, COUNT(*) AS value
FROM agreements
WHERE tenant_id = :tenant_id;

SELECT 'crm_ndas' AS metric, COUNT(*) AS value
FROM agreements
WHERE tenant_id = :tenant_id AND agreement_type = 'NDA';

SELECT 'crm_current_ndas' AS metric, COUNT(*) AS value
FROM agreements
WHERE tenant_id = :tenant_id
  AND agreement_type = 'NDA'
  AND status IN ('SIGNED','ACTIVE')
  AND (end_date IS NULL OR end_date > datetime('now'));

SELECT 'house_project_links' AS metric, COUNT(*) AS value
FROM external_entity_links
WHERE tenant_id = :tenant_id
  AND external_system = 'AKARI_HOUSE'
  AND external_entity_type = 'PROJECT'
  AND local_entity_type = 'PROJECT';

SELECT 'house_member_links' AS metric, COUNT(*) AS value
FROM external_entity_links
WHERE tenant_id = :tenant_id
  AND external_system = 'AKARI_HOUSE'
  AND external_entity_type = 'MEMBER'
  AND local_entity_type = 'CONTACT';

SELECT 'house_agreement_links' AS metric, COUNT(*) AS value
FROM external_entity_links
WHERE tenant_id = :tenant_id
  AND external_system = 'AKARI_HOUSE'
  AND external_entity_type = 'AGREEMENT'
  AND local_entity_type = 'AGREEMENT';

SELECT 'nda_house_counterparties' AS metric, COUNT(*) AS value
FROM agreement_counterparty_identity aci
JOIN agreements a
  ON a.id = aci.agreement_id
 AND a.tenant_id = aci.tenant_id
WHERE aci.tenant_id = :tenant_id
  AND aci.external_system = 'AKARI_HOUSE'
  AND length(trim(COALESCE(aci.external_member_id,''))) > 0
  AND a.agreement_type = 'NDA';

SELECT 'current_ndas_without_house_member_identity' AS metric, COUNT(*) AS value
FROM agreements a
LEFT JOIN agreement_counterparty_identity aci
  ON aci.agreement_id = a.id
 AND aci.tenant_id = a.tenant_id
WHERE a.tenant_id = :tenant_id
  AND a.agreement_type = 'NDA'
  AND a.status IN ('SIGNED','ACTIVE')
  AND (a.end_date IS NULL OR a.end_date > datetime('now'))
  AND length(trim(COALESCE(aci.external_member_id,''))) = 0;
