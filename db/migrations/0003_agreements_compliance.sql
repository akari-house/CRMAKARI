-- AKARI CRM R70 — Agreements, Mandates & Compliance
-- Canonical tenant-scoped agreement registry and review evidence.
-- This stores governance evidence and workflow state; it does not make legal determinations.
-- fundraising_round_id is intentionally not a database foreign key because the CRM
-- supports tenants still running the legacy fundraising compatibility layer without
-- normalized fundraising migration 0002. The API validates the round when that
-- normalized table is available and required.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  partner_id TEXT REFERENCES partners(id) ON DELETE SET NULL,
  fundraising_round_id TEXT,
  agreement_type TEXT NOT NULL CHECK (agreement_type IN ('SERVICE_AGREEMENT','FUNDRAISING_MANDATE','NDA','PARTNERSHIP_AGREEMENT','ADVISORY_AGREEMENT','OTHER')),
  title TEXT NOT NULL,
  counterparty_name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEW','APPROVED','SENT','SIGNED','ACTIVE','EXPIRED','TERMINATED','CANCELLED')),
  jurisdiction TEXT,
  governing_law_note TEXT,
  scope_summary TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  retainer_amount REAL NOT NULL DEFAULT 0 CHECK (retainer_amount >= 0),
  success_fee_percentage REAL NOT NULL DEFAULT 0 CHECK (success_fee_percentage >= 0 AND success_fee_percentage <= 100),
  success_fee_note TEXT,
  exclusivity TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (exclusivity IN ('NONE','NON_EXCLUSIVE','EXCLUSIVE','UNKNOWN')),
  confidentiality_required INTEGER NOT NULL DEFAULT 0 CHECK (confidentiality_required IN (0,1)),
  conflict_review_required INTEGER NOT NULL DEFAULT 0 CHECK (conflict_review_required IN (0,1)),
  privacy_review_required INTEGER NOT NULL DEFAULT 0 CHECK (privacy_review_required IN (0,1)),
  compliance_review_required INTEGER NOT NULL DEFAULT 0 CHECK (compliance_review_required IN (0,1)),
  start_date TEXT,
  end_date TEXT,
  renewal_date TEXT,
  sent_at TEXT,
  signed_at TEXT,
  signed_by_name TEXT,
  signature_method TEXT,
  signed_document_url TEXT,
  signature_evidence_reference TEXT,
  activated_at TEXT,
  terminated_at TEXT,
  termination_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agreement_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL CHECK (review_type IN ('JURISDICTION','CONFLICT','PRIVACY','COMPLIANCE','COMMERCIAL','OTHER')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_REVIEW','CLEAR','ISSUES','BLOCKED','NOT_REQUIRED')),
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_note TEXT,
  evidence_reference TEXT,
  reviewed_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, agreement_id, review_type)
);

CREATE INDEX IF NOT EXISTS idx_agreements_tenant_status ON agreements(tenant_id, status, renewal_date);
CREATE INDEX IF NOT EXISTS idx_agreements_project ON agreements(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_agreements_opportunity ON agreements(tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_agreements_campaign ON agreements(tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_agreements_fundraising_round ON agreements(tenant_id, fundraising_round_id);
CREATE INDEX IF NOT EXISTS idx_agreement_reviews_agreement ON agreement_reviews(tenant_id, agreement_id, review_type, status);
