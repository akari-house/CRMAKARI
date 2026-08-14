-- AKARI CRM R76 — Essential Integrations
-- Google Calendar/Gmail/Drive, CSV portability, external API keys and outbound webhooks.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('GOOGLE')),
  account_email TEXT,
  status TEXT NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED','REAUTH_REQUIRED','DISCONNECTED','ERROR')),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  access_token_ciphertext TEXT,
  access_token_iv TEXT,
  refresh_token_ciphertext TEXT,
  refresh_token_iv TEXT,
  token_expires_at TEXT,
  sync_cursor_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  last_error TEXT,
  connected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, provider, account_email)
);

CREATE TABLE IF NOT EXISTS integration_oauth_states (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('GOOGLE')),
  state_hash TEXT NOT NULL UNIQUE,
  requested_scopes_json TEXT NOT NULL DEFAULT '[]',
  return_path TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_external_refs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL REFERENCES workspace_integrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  internal_type TEXT,
  internal_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, provider, external_type, external_id)
);

CREATE TABLE IF NOT EXISTS external_document_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'GOOGLE_DRIVE' CHECK (provider IN ('GOOGLE_DRIVE','URL')),
  external_file_id TEXT,
  document_url TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, entity_type, entity_id, document_url)
);

CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["read"]',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  expires_at TEXT,
  last_used_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  event_types_json TEXT NOT NULL DEFAULT '[]',
  signing_secret_ciphertext TEXT NOT NULL,
  signing_secret_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','REVOKED')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_delivered_at TEXT,
  last_error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  response_status INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','FAILED')),
  attempted_at TEXT,
  delivered_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (webhook_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_integrations_tenant ON workspace_integrations(tenant_id,provider,status);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON integration_oauth_states(provider,expires_at,consumed_at);
CREATE INDEX IF NOT EXISTS idx_external_refs_tenant ON integration_external_refs(tenant_id,provider,external_type);
CREATE INDEX IF NOT EXISTS idx_document_links_entity ON external_document_links(tenant_id,entity_type,entity_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON workspace_api_keys(tenant_id,status);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhook_endpoints(tenant_id,status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(tenant_id,status,created_at);
