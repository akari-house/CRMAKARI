-- AKARI CRM R74 — Reporting + Attention Engine
-- Derived operational attention and immutable report snapshots.
-- Canonical business data remains in its source tables; this layer stores only
-- attention state and point-in-time report evidence.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operational_attention (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW')),
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED','DISMISSED')),
  source_url TEXT,
  metadata_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  snoozed_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, source_type, source_id, reason_key)
);

CREATE TABLE IF NOT EXISTS operating_report_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('FOUNDER_WEEKLY','CLIENT','CAMPAIGN','FUNDRAISING','INVESTOR_UPDATE','REVENUE','MANAGEMENT')),
  entity_type TEXT,
  entity_id TEXT,
  period_start TEXT,
  period_end TEXT,
  payload_json TEXT NOT NULL,
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attention_tenant_status ON operational_attention(tenant_id, status, priority, due_at);
CREATE INDEX IF NOT EXISTS idx_attention_owner ON operational_attention(tenant_id, owner_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_attention_source ON operational_attention(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_tenant_type ON operating_report_snapshots(tenant_id, report_type, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_entity ON operating_report_snapshots(tenant_id, entity_type, entity_id, generated_at DESC);
