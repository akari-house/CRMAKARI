-- CRM by AKARI R84 — AKARI House boundary bridge
--
-- CRM remains the canonical owner of agreements and commercial relationship data.
-- These tables provide stable cross-system identity links and NDA counterparty
-- provenance without copying CRM workflow state back into AKARI House.
--
-- This migration is intentionally idempotent because production deployment
-- replays the explicit migration chain.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS external_entity_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_system TEXT NOT NULL DEFAULT 'AKARI_HOUSE'
    CHECK (external_system IN ('AKARI_HOUSE')),
  external_entity_type TEXT NOT NULL
    CHECK (external_entity_type IN ('PROJECT','MEMBER','AGREEMENT')),
  external_entity_id TEXT NOT NULL,
  local_entity_type TEXT NOT NULL
    CHECK (local_entity_type IN ('PROJECT','CONTACT','AGREEMENT')),
  local_entity_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (
    tenant_id,
    external_system,
    external_entity_type,
    external_entity_id,
    local_entity_type
  )
);

CREATE INDEX IF NOT EXISTS idx_external_entity_links_local
  ON external_entity_links(tenant_id, local_entity_type, local_entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_entity_links_reverse_unique
  ON external_entity_links(
    tenant_id,
    external_system,
    external_entity_type,
    local_entity_type,
    local_entity_id
  );

CREATE TABLE IF NOT EXISTS agreement_counterparty_identity (
  agreement_id TEXT PRIMARY KEY REFERENCES agreements(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  external_system TEXT NOT NULL DEFAULT 'AKARI_HOUSE'
    CHECK (external_system IN ('AKARI_HOUSE')),
  external_member_id TEXT,
  email TEXT COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (
    contact_id IS NOT NULL
    OR length(trim(COALESCE(external_member_id, ''))) > 0
    OR length(trim(COALESCE(email, ''))) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_agreement_counterparty_member
  ON agreement_counterparty_identity(
    tenant_id,
    external_system,
    external_member_id,
    agreement_id
  );

CREATE INDEX IF NOT EXISTS idx_agreement_counterparty_email
  ON agreement_counterparty_identity(tenant_id, email, agreement_id);
