-- AKARI CRM R73 — Relationship Intelligence + 360° Account View
-- Adds governed cross-entity relationship metadata and interactions without duplicating canonical CRM/fundraising entities.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relationship_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('PROJECT','CONTACT','PARTNER','INVESTOR_ORGANISATION','INVESTOR_PERSON','CREATOR')),
  entity_id TEXT NOT NULL,
  display_name TEXT,
  company_name TEXT,
  relationship_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  strength TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (strength IN ('STRONG','MEDIUM','WEAK','UNKNOWN')),
  strength_score REAL CHECK (strength_score IS NULL OR (strength_score >= 0 AND strength_score <= 100)),
  introduction_source TEXT,
  introduction_source_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  consent_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (consent_status IN ('NOT_REQUESTED','REQUESTED','GRANTED','DECLINED','REVOKED')),
  conflict_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (conflict_status IN ('NONE','POSSIBLE','CONFIRMED','UNKNOWN')),
  last_interaction_at TEXT,
  next_action TEXT,
  next_action_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS relationship_paths (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_entity_type TEXT NOT NULL CHECK (subject_entity_type IN ('PROJECT','CONTACT','PARTNER','INVESTOR_ORGANISATION','INVESTOR_PERSON','CREATOR')),
  subject_entity_id TEXT NOT NULL,
  target_entity_type TEXT NOT NULL CHECK (target_entity_type IN ('PROJECT','CONTACT','PARTNER','INVESTOR_ORGANISATION','INVESTOR_PERSON','CREATOR')),
  target_entity_id TEXT NOT NULL,
  connector_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  connector_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  connector_name TEXT,
  path_type TEXT NOT NULL DEFAULT 'WARM_INTRO' CHECK (path_type IN ('WARM_INTRO','DIRECT','SHARED_COMPANY','SHARED_INVESTMENT','SHARED_CAMPAIGN','OTHER')),
  strength TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (strength IN ('STRONG','MEDIUM','WEAK','UNKNOWN')),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED','RESEARCHING','VERIFIED','STALE','REJECTED')),
  consent_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (consent_status IN ('NOT_REQUESTED','REQUESTED','GRANTED','DECLINED','REVOKED')),
  evidence_note TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS relationship_interactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('PROJECT','CONTACT','PARTNER','INVESTOR_ORGANISATION','INVESTOR_PERSON','CREATOR')),
  entity_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL DEFAULT 'NOTE' CHECK (interaction_type IN ('EMAIL','CALL','MEETING','TELEGRAM','X','LINKEDIN','INTRODUCTION','EVENT','NOTE','OTHER')),
  subject TEXT,
  summary TEXT NOT NULL,
  outcome TEXT,
  occurred_at TEXT NOT NULL,
  next_action TEXT,
  next_action_at TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  round_id TEXT REFERENCES fundraising_rounds(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS relationship_entity_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('PROJECT','CONTACT','PARTNER','INVESTOR_ORGANISATION','INVESTOR_PERSON','CREATOR')),
  source_entity_id TEXT NOT NULL,
  target_entity_type TEXT NOT NULL CHECK (target_entity_type IN ('PROJECT','CONTACT','PARTNER','INVESTOR_ORGANISATION','INVESTOR_PERSON','CREATOR')),
  target_entity_id TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('WORKS_AT','FOUNDER_OF','INVESTOR_AT','ADVISOR_TO','CREATOR_FOR','PARTNER_WITH','CLIENT_OF','INTRODUCED_BY','OTHER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HISTORICAL','DISPUTED')),
  source_note TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_relationship_profile_entity ON relationship_profiles(tenant_id,entity_type,entity_id);
CREATE INDEX IF NOT EXISTS idx_relationship_profile_owner ON relationship_profiles(tenant_id,relationship_owner_user_id,strength);
CREATE INDEX IF NOT EXISTS idx_relationship_paths_target ON relationship_paths(tenant_id,target_entity_type,target_entity_id,strength,verification_status);
CREATE INDEX IF NOT EXISTS idx_relationship_paths_subject ON relationship_paths(tenant_id,subject_entity_type,subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationship_interactions_entity ON relationship_interactions(tenant_id,entity_type,entity_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_links_source ON relationship_entity_links(tenant_id,source_entity_type,source_entity_id,status);
CREATE INDEX IF NOT EXISTS idx_relationship_links_target ON relationship_entity_links(tenant_id,target_entity_type,target_entity_id,status);
