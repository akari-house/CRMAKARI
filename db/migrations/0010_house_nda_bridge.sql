-- CRM by AKARI R77 — AKARI House NDA provenance bridge
-- Canonical, tenant-scoped identity links used only to answer whether a specific
-- AKARI House member has a valid NDA for a specific AKARI House project.
-- This intentionally does not copy House CRM workflows back into AKARI House.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS house_project_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  house_project_id TEXT NOT NULL,
  crm_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','LEGACY_RECONCILIATION','SYSTEM')),
  linked_at TEXT NOT NULL,
  linked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, house_project_id),
  UNIQUE (tenant_id, crm_project_id)
);

CREATE TABLE IF NOT EXISTS agreement_counterparty_identities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  counterparty_email TEXT NOT NULL,
  house_user_id TEXT,
  house_agreement_record_id TEXT,
  identity_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (identity_status IN ('PENDING','VERIFIED','REVOKED')),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','LEGACY_HOUSE','SYSTEM')),
  verified_at TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agreement_counterparty_identity_email
  ON agreement_counterparty_identities(tenant_id, agreement_id, lower(trim(counterparty_email)));
CREATE INDEX IF NOT EXISTS idx_house_project_links_lookup
  ON house_project_links(tenant_id, house_project_id, status);
CREATE INDEX IF NOT EXISTS idx_agreement_counterparty_house_user
  ON agreement_counterparty_identities(tenant_id, house_user_id, identity_status);
CREATE INDEX IF NOT EXISTS idx_agreement_counterparty_legacy_record
  ON agreement_counterparty_identities(tenant_id, house_agreement_record_id);
