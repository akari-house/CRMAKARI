-- AKARI CRM R72 — Institutional Data Room & Diligence
-- Normalizes the R5 Capital Room document/access/diligence layer while preserving legacy_room_id interoperability.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fundraising_data_room_requirements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('CORPORATE','LEGAL','FINANCIALS','PRODUCT','MARKET','TEAM','FUNDRAISING','TOKEN_WEB3')),
  requirement_key TEXT NOT NULL,
  title TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  status TEXT NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING','REQUESTED','UPLOADED','VERIFIED','NOT_APPLICABLE')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, round_id, requirement_key)
);

CREATE TABLE IF NOT EXISTS fundraising_data_room_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  legacy_document_id TEXT,
  requirement_id TEXT REFERENCES fundraising_data_room_requirements(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('CORPORATE','LEGAL','FINANCIALS','PRODUCT','MARKET','TEAM','FUNDRAISING','TOKEN_WEB3')),
  title TEXT NOT NULL,
  confidentiality TEXT NOT NULL DEFAULT 'RESTRICTED' CHECK (confidentiality IN ('STANDARD','RESTRICTED','HIGHLY_RESTRICTED')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','ARCHIVED')),
  current_version_number INTEGER NOT NULL DEFAULT 1 CHECK (current_version_number >= 1),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, round_id, legacy_document_id)
);

CREATE TABLE IF NOT EXISTS fundraising_data_room_document_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES fundraising_data_room_documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  version_label TEXT,
  secure_url TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum TEXT,
  change_note TEXT,
  uploaded_by_source TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (uploaded_by_source IN ('INTERNAL','FOUNDER_PORTAL','IMPORT')),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, document_id, version_number)
);

CREATE TABLE IF NOT EXISTS fundraising_data_room_access (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  legacy_access_id TEXT,
  investor_pipeline_id TEXT NOT NULL,
  nda_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (nda_status IN ('NOT_REQUIRED','REQUESTED','PENDING','SIGNED','REJECTED','EXPIRED')),
  access_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (access_status IN ('PENDING','GRANTED','SUSPENDED','REVOKED','EXPIRED')),
  allowed_categories_json TEXT NOT NULL DEFAULT '[]',
  granted_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, round_id, investor_pipeline_id)
);

CREATE TABLE IF NOT EXISTS fundraising_diligence_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  legacy_request_id TEXT,
  investor_pipeline_id TEXT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_INVESTOR','WAITING_FOUNDER','RESOLVED','CLOSED')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  founder_response TEXT,
  internal_notes TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, round_id, legacy_request_id)
);

CREATE TABLE IF NOT EXISTS fundraising_diligence_request_documents (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES fundraising_diligence_requests(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES fundraising_data_room_documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, request_id, document_id)
);

CREATE TABLE IF NOT EXISTS fundraising_data_room_activity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  access_id TEXT REFERENCES fundraising_data_room_access(id) ON DELETE SET NULL,
  investor_pipeline_id TEXT,
  document_id TEXT REFERENCES fundraising_data_room_documents(id) ON DELETE SET NULL,
  version_id TEXT REFERENCES fundraising_data_room_document_versions(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('ACCESS_GRANTED','ACCESS_REVOKED','ACCESS_EXPIRED','DOCUMENT_VIEWED','DOCUMENT_DOWNLOADED','DOCUMENT_UPLOADED','DOCUMENT_VERSION_ADDED','DILIGENCE_REQUESTED','DILIGENCE_RESPONDED','DILIGENCE_RESOLVED')),
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_fdr_requirements_round ON fundraising_data_room_requirements(tenant_id,round_id,status,category);
CREATE INDEX IF NOT EXISTS idx_fdr_documents_round ON fundraising_data_room_documents(tenant_id,round_id,category,status);
CREATE INDEX IF NOT EXISTS idx_fdr_versions_document ON fundraising_data_room_document_versions(tenant_id,document_id,version_number DESC);
CREATE INDEX IF NOT EXISTS idx_fdr_access_round ON fundraising_data_room_access(tenant_id,round_id,access_status,expires_at);
CREATE INDEX IF NOT EXISTS idx_fdr_diligence_round ON fundraising_diligence_requests(tenant_id,round_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_fdr_activity_round ON fundraising_data_room_activity(tenant_id,round_id,occurred_at DESC);
