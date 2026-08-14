-- AKARI CRM R71 — Founder Onboarding + Fundraising Readiness
-- Tenant-scoped, round-linked onboarding evidence. Round economics remain canonical in fundraising_rounds.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS founder_onboarding_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES fundraising_rounds(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL CHECK (item_key IN ('COMPANY','TEAM','TRACTION','RAISE','USE_OF_FUNDS','FINANCIALS','CAP_TABLE','DECK','ONE_PAGER','LEGAL','TOKENOMICS')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETE','NOT_APPLICABLE')),
  data_json TEXT NOT NULL DEFAULT '{}',
  evidence_url TEXT,
  notes TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, round_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_founder_onboarding_round
  ON founder_onboarding_items(tenant_id, round_id, item_key);
CREATE INDEX IF NOT EXISTS idx_founder_onboarding_project
  ON founder_onboarding_items(tenant_id, project_id, status);
