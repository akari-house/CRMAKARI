-- AKARI CRM R75 — SaaS Workspace Administration
-- Keeps tenant billing/limits/modules in the existing core tables and adds only
-- platform-level administration plus usage history needed to operate CRM by AKARI.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_admins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS workspace_usage_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  active_seats INTEGER NOT NULL DEFAULT 0,
  invited_seats INTEGER NOT NULL DEFAULT 0,
  storage_used_bytes INTEGER NOT NULL DEFAULT 0,
  project_count INTEGER NOT NULL DEFAULT 0,
  campaign_count INTEGER NOT NULL DEFAULT 0,
  fundraising_round_count INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  captured_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_status ON platform_admins(status,user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_usage_tenant ON workspace_usage_snapshots(tenant_id,captured_at DESC);
