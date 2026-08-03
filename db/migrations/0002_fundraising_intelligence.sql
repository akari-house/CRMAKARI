-- AKARI CRM Fundraising OS 2.0 normalized intelligence schema
-- Cloudflare D1 / SQLite
-- Non-destructive: creates new tenant-scoped tables only.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fundraising_rounds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legacy_room_id TEXT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  round_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'PREPARING' CHECK (stage IN ('PREPARING','OPEN','OUTREACH','DILIGENCE','COMMITMENTS','CLOSING','CLOSED','PAUSED')),
  instrument TEXT,
  funding_stage TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  target_amount REAL NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  valuation REAL NOT NULL DEFAULT 0 CHECK (valuation >= 0),
  minimum_ticket REAL NOT NULL DEFAULT 0 CHECK (minimum_ticket >= 0),
  maximum_ticket REAL NOT NULL DEFAULT 0 CHECK (maximum_ticket >= 0),
  launch_date TEXT,
  target_close_date TEXT,
  thesis TEXT,
  next_action TEXT,
  readiness_score REAL NOT NULL DEFAULT 0 CHECK (readiness_score >= 0 AND readiness_score <= 100),
  source_model TEXT NOT NULL DEFAULT 'NORMALIZED' CHECK (source_model IN ('NORMALIZED','LEGACY_CONVERTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, project_id, round_name),
  UNIQUE (tenant_id, legacy_room_id)
);

CREATE TABLE IF NOT EXISTS investor_organisations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canonical_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  investor_type TEXT NOT NULL DEFAULT 'OTHER',
  website TEXT,
  headquarters TEXT,
  description TEXT,
  current_fund TEXT,
  minimum_check REAL CHECK (minimum_check IS NULL OR minimum_check >= 0),
  maximum_check REAL CHECK (maximum_check IS NULL OR maximum_check >= 0),
  typical_check REAL CHECK (typical_check IS NULL OR typical_check >= 0),
  lead_behavior TEXT,
  conflict_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (conflict_status IN ('NONE','POSSIBLE','CONFIRMED','UNKNOWN')),
  data_origin TEXT NOT NULL DEFAULT 'LOCAL' CHECK (data_origin IN ('LOCAL','CRM_PROJECT','IMPORT','PUBLIC_RESEARCH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DORMANT','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, normalized_name),
  UNIQUE (tenant_id, canonical_project_id)
);

CREATE TABLE IF NOT EXISTS investor_people (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organisation_id TEXT REFERENCES investor_organisations(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  title TEXT,
  city TEXT,
  bio TEXT,
  is_decision_maker INTEGER NOT NULL DEFAULT 0 CHECK (is_decision_maker IN (0,1)),
  origin TEXT NOT NULL DEFAULT 'LOCAL' CHECK (origin IN ('LOCAL','CRM_CONTACT','IMPORT','PUBLIC_RESEARCH')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DORMANT','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, organisation_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS investor_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  source_type TEXT NOT NULL DEFAULT 'OTHER',
  observed_at TEXT NOT NULL,
  published_on TEXT,
  rights_class TEXT,
  redistribution_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (redistribution_status IN ('ALLOWED','ATTRIBUTION_REQUIRED','UNKNOWN','PROHIBITED')),
  confidence_status TEXT NOT NULL DEFAULT 'ASSERTED' CHECK (confidence_status IN ('ASSERTED','VERIFIED','STALE','DISPUTED')),
  attribution TEXT,
  excerpt TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, canonical_url)
);

CREATE TABLE IF NOT EXISTS investor_contact_methods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES investor_people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('WORK_EMAIL','PERSONAL_EMAIL','PHONE','LINKEDIN','X','TELEGRAM','WEBSITE','OTHER')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  label TEXT,
  source_id TEXT REFERENCES investor_sources(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','PUBLIC')),
  contribution_eligible INTEGER NOT NULL DEFAULT 0 CHECK (contribution_eligible IN (0,1)),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, person_id, kind, normalized_value)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_contact_email_owner
  ON investor_contact_methods(tenant_id, normalized_value)
  WHERE kind IN ('WORK_EMAIL','PERSONAL_EMAIL');

CREATE TABLE IF NOT EXISTS investor_claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ORGANISATION','PERSON')),
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_id TEXT REFERENCES investor_sources(id) ON DELETE SET NULL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  observed_at TEXT,
  status TEXT NOT NULL DEFAULT 'ASSERTED' CHECK (status IN ('ASSERTED','VERIFIED','STALE','DISPUTED')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','PUBLIC')),
  contribution_eligible INTEGER NOT NULL DEFAULT 0 CHECK (contribution_eligible IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, entity_type, entity_id, field, source_id, value_json)
);

CREATE TABLE IF NOT EXISTS investor_portfolio_evidence (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES investor_organisations(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  round_name TEXT,
  sector TEXT,
  announced_at TEXT,
  source_id TEXT REFERENCES investor_sources(id) ON DELETE SET NULL,
  confidence_status TEXT NOT NULL DEFAULT 'ASSERTED' CHECK (confidence_status IN ('ASSERTED','VERIFIED','STALE','DISPUTED')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fundraising_targets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES investor_organisations(id) ON DELETE CASCADE,
  primary_person_id TEXT REFERENCES investor_people(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'RESEARCHING' CHECK (stage IN ('RESEARCHING','READY','INTRO_REQUESTED','CONTACTED','MEETING','DILIGENCE','PARTNER_MEETING','SOFT_CIRCLE','COMMITTED','PASSED','NOT_NOW')),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  fit_score REAL CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  fit_components_json TEXT NOT NULL DEFAULT '{}',
  fit_reasons_json TEXT NOT NULL DEFAULT '[]',
  fit_warnings_json TEXT NOT NULL DEFAULT '[]',
  fit_override_reason TEXT,
  conflict_signal TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (conflict_signal IN ('NONE','POSSIBLE','CONFIRMED','UNKNOWN')),
  expected_check REAL CHECK (expected_check IS NULL OR expected_check >= 0),
  probability_percentage REAL NOT NULL DEFAULT 0 CHECK (probability_percentage >= 0 AND probability_percentage <= 100),
  warm_intro_source TEXT,
  introduction_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  last_contact_at TEXT,
  next_follow_up_at TEXT,
  next_action TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, round_id, organisation_id)
);

CREATE TABLE IF NOT EXISTS fundraising_pipeline_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES fundraising_targets(id) ON DELETE CASCADE,
  previous_stage TEXT,
  new_stage TEXT NOT NULL,
  reason TEXT,
  occurred_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fundraising_commitments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES fundraising_targets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'SOFT' CHECK (status IN ('SOFT','CONFIRMED','SIGNED','FUNDED','CANCELLED')),
  committed_amount REAL NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  allocated_amount REAL NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  received_amount REAL NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  instrument TEXT,
  signed_document_url TEXT,
  committed_at TEXT,
  signed_at TEXT,
  received_at TEXT,
  transaction_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (allocated_amount <= committed_amount),
  CHECK (received_amount <= committed_amount)
);

CREATE TABLE IF NOT EXISTS fundraising_introduction_paths (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES fundraising_targets(id) ON DELETE CASCADE,
  target_person_id TEXT REFERENCES investor_people(id) ON DELETE SET NULL,
  connector_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  connector_name TEXT,
  relationship_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  relationship_strength TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (relationship_strength IN ('STRONG','MEDIUM','WEAK','UNKNOWN')),
  evidence_source_id TEXT REFERENCES investor_sources(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED','RESEARCHING','VERIFIED','STALE','REJECTED')),
  consent_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (consent_status IN ('NOT_REQUESTED','REQUESTED','GRANTED','DECLINED','REVOKED')),
  request_status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (request_status IN ('PLANNED','REQUESTED','ACCEPTED','COMPLETED','DECLINED','CANCELLED')),
  last_verified_at TEXT,
  requested_at TEXT,
  completed_at TEXT,
  outcome TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS fundraising_knowledge_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'OTHER',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  share_policy TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (share_policy IN ('INTERNAL','SAFE_FOR_OUTREACH','MEETING_ONLY','DILIGENCE_ONLY')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS fundraising_outreach_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES fundraising_targets(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES investor_people(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL','LINKEDIN','X','TELEGRAM','OTHER')),
  recipient TEXT,
  subject TEXT,
  body_text TEXT NOT NULL,
  content_sha256 TEXT,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','FOUNDER_APPROVED','AKARI_APPROVED','EXPORTED','SENT','REPLIED','CLOSED','CANCELLED')),
  founder_approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  founder_approved_at TEXT,
  akari_approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  akari_approved_at TEXT,
  exported_at TEXT,
  sent_at TEXT,
  reply_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fundraising_rounds_tenant_stage ON fundraising_rounds(tenant_id, stage, target_close_date);
CREATE INDEX IF NOT EXISTS idx_investor_organisations_tenant_type ON investor_organisations(tenant_id, investor_type, status);
CREATE INDEX IF NOT EXISTS idx_investor_people_organisation ON investor_people(tenant_id, organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_investor_sources_tenant_observed ON investor_sources(tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_claims_entity ON investor_claims(tenant_id, entity_type, entity_id, field);
CREATE INDEX IF NOT EXISTS idx_portfolio_evidence_organisation ON investor_portfolio_evidence(tenant_id, organisation_id);
CREATE INDEX IF NOT EXISTS idx_fundraising_targets_pipeline ON fundraising_targets(tenant_id, round_id, stage, priority DESC);
CREATE INDEX IF NOT EXISTS idx_fundraising_targets_followup ON fundraising_targets(tenant_id, next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_fundraising_events_target ON fundraising_pipeline_events(tenant_id, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fundraising_commitments_round ON fundraising_commitments(tenant_id, round_id, status);
CREATE INDEX IF NOT EXISTS idx_introduction_paths_target ON fundraising_introduction_paths(tenant_id, target_id, request_status);
CREATE INDEX IF NOT EXISTS idx_fundraising_knowledge_round ON fundraising_knowledge_items(tenant_id, round_id, share_policy);
CREATE INDEX IF NOT EXISTS idx_fundraising_outreach_target ON fundraising_outreach_drafts(tenant_id, target_id, state);
