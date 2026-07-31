-- AKARI CRM core multi-tenant schema
-- Cloudflare D1 / SQLite
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('TRIAL','ACTIVE','SUSPENDED','CANCELLED')),
  organisation_type TEXT,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  logo_url TEXT,
  plan_code TEXT NOT NULL DEFAULT 'FOUNDING',
  user_limit INTEGER NOT NULL DEFAULT 3,
  storage_limit_mb INTEGER NOT NULL DEFAULT 500,
  trial_start_at TEXT,
  trial_end_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  avatar_url TEXT,
  authentication_provider TEXT NOT NULL DEFAULT 'CLOUDFLARE_ACCESS',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DELETED')),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER','EXTERNAL_COLLABORATOR')),
  finance_access INTEGER NOT NULL DEFAULT 0 CHECK (finance_access IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  joined_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  finance_access INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_json TEXT,
  campaign_statuses_json TEXT,
  task_statuses_json TEXT,
  enabled_modules_json TEXT,
  feature_flags_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  partner_type TEXT NOT NULL DEFAULT 'OTHER',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DORMANT','SUSPENDED','ARCHIVED')),
  website TEXT,
  x_url TEXT,
  telegram TEXT,
  contact_name TEXT,
  contact_email TEXT,
  default_referral_percentage REAL,
  agreement_status TEXT,
  agreement_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'LEAD' CHECK (lifecycle_status IN ('LEAD','PROSPECT','ACTIVE_OPPORTUNITY','CLIENT','DORMANT_CLIENT','FORMER_CLIENT','PARTNER','ARCHIVED')),
  logo_url TEXT,
  website TEXT,
  x_url TEXT,
  telegram TEXT,
  linkedin_url TEXT,
  category TEXT,
  ecosystem TEXT,
  country TEXT,
  region TEXT,
  description TEXT,
  funding_status TEXT,
  funding_amount REAL,
  valuation REAL,
  tge_status TEXT,
  token_symbol TEXT,
  priority TEXT DEFAULT 'MEDIUM' CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW')),
  relationship_health TEXT,
  lead_score REAL,
  source_type TEXT,
  source_name TEXT,
  referral_partner_id TEXT REFERENCES partners(id),
  owner_user_id TEXT REFERENCES users(id),
  last_activity_at TEXT,
  next_follow_up_at TEXT,
  customer_since TEXT,
  original_import_source TEXT,
  original_status TEXT,
  original_notes TEXT,
  legacy_import_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  job_title TEXT,
  contact_role TEXT,
  email TEXT,
  telegram TEXT,
  x_handle TEXT,
  linkedin_url TEXT,
  phone TEXT,
  country TEXT,
  preferred_channel TEXT,
  relationship_strength TEXT,
  is_decision_maker INTEGER NOT NULL DEFAULT 0,
  is_primary_contact INTEGER NOT NULL DEFAULT 0,
  last_contacted_at TEXT,
  next_follow_up_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  primary_contact_id TEXT REFERENCES contacts(id),
  name TEXT NOT NULL,
  service_type TEXT,
  description TEXT,
  owner_user_id TEXT REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'NEW' CHECK (stage IN ('NEW','RESEARCH','CONTACTED','REPLIED','DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','VERBAL_CONFIRMATION','WON','LOST','ON_HOLD')),
  estimated_value REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  estimated_value_base_currency REAL,
  probability_percentage REAL NOT NULL DEFAULT 10 CHECK (probability_percentage >= 0 AND probability_percentage <= 100),
  weighted_value REAL GENERATED ALWAYS AS (COALESCE(estimated_value_base_currency, estimated_value, 0) * probability_percentage / 100.0) STORED,
  expected_close_date TEXT,
  budget_status TEXT,
  need_confirmed INTEGER NOT NULL DEFAULT 0,
  decision_maker_confirmed INTEGER NOT NULL DEFAULT 0,
  timeline_confirmed INTEGER NOT NULL DEFAULT 0,
  next_action TEXT,
  next_follow_up_at TEXT,
  referral_partner_id TEXT REFERENCES partners(id),
  competitor TEXT,
  lost_reason TEXT,
  proposal_sent_at TEXT,
  won_at TEXT,
  lost_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  previous_stage TEXT,
  new_stage TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id),
  changed_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id),
  name TEXT NOT NULL,
  campaign_owner_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','COMPLETED','PAUSED','CANCELLED')),
  region TEXT,
  start_date TEXT,
  end_date TEXT,
  reporting_due_date TEXT,
  telegram_group_url TEXT,
  deliverables_summary TEXT,
  gross_revenue REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  gross_revenue_base_currency REAL,
  campaign_cost REAL NOT NULL DEFAULT 0,
  creator_cost REAL NOT NULL DEFAULT 0,
  other_cost REAL NOT NULL DEFAULT 0,
  referral_partner_id TEXT REFERENCES partners(id),
  referral_percentage REAL NOT NULL DEFAULT 0,
  margin_before_referral REAL GENERATED ALWAYS AS (gross_revenue - campaign_cost - creator_cost - other_cost) STORED,
  referral_reward REAL GENERATED ALWAYS AS ((gross_revenue - campaign_cost - creator_cost - other_cost) * referral_percentage / 100.0) STORED,
  akari_net_revenue REAL GENERATED ALWAYS AS ((gross_revenue - campaign_cost - creator_cost - other_cost) - ((gross_revenue - campaign_cost - creator_cost - other_cost) * referral_percentage / 100.0)) STORED,
  amount_invoiced REAL NOT NULL DEFAULT 0,
  amount_received REAL NOT NULL DEFAULT 0,
  outstanding_amount REAL GENERATED ALWAYS AS (gross_revenue - amount_received) STORED,
  payment_status TEXT,
  next_action TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS campaign_deliverables (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_user_id TEXT REFERENCES users(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  completed_at TEXT,
  evidence_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_user_id TEXT REFERENCES users(id),
  created_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','IN_PROGRESS','WAITING','DONE','CANCELLED','ARCHIVED')),
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW')),
  due_at TEXT,
  completed_at TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  activity_type TEXT,
  recurrence_rule TEXT,
  show_on_home INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id),
  activity_type TEXT NOT NULL,
  subject TEXT,
  description TEXT,
  outcome TEXT,
  occurred_at TEXT NOT NULL,
  next_action TEXT,
  follow_up_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  project_id TEXT REFERENCES projects(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  campaign_id TEXT REFERENCES campaigns(id),
  revenue_basis REAL NOT NULL DEFAULT 0,
  referral_percentage REAL NOT NULL DEFAULT 0,
  referral_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_status TEXT NOT NULL DEFAULT 'ESTIMATED' CHECK (payment_status IN ('ESTIMATED','CONFIRMED','DUE','PAID','DISPUTED','CANCELLED')),
  due_date TEXT,
  paid_date TEXT,
  transaction_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  campaign_id TEXT REFERENCES campaigns(id),
  invoice_reference TEXT,
  payment_type TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_base_currency REAL,
  due_date TEXT,
  received_date TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','INVOICED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED')),
  payment_method TEXT,
  wallet_or_bank_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_targets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  gross_revenue_target REAL NOT NULL DEFAULT 0,
  net_revenue_target REAL NOT NULL DEFAULT 0,
  collected_revenue_target REAL NOT NULL DEFAULT 0,
  new_customer_target INTEGER NOT NULL DEFAULT 0,
  deals_won_target INTEGER NOT NULL DEFAULT 0,
  proposals_target INTEGER NOT NULL DEFAULT 0,
  qualified_opportunities_target INTEGER NOT NULL DEFAULT 0,
  meetings_target INTEGER NOT NULL DEFAULT 0,
  outreach_target INTEGER NOT NULL DEFAULT 0,
  follow_ups_target INTEGER NOT NULL DEFAULT 0,
  telegram_groups_target INTEGER NOT NULL DEFAULT 0,
  partner_introduction_target INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id, year, month)
);

CREATE TABLE IF NOT EXISTS daily_scorecards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scorecard_date TEXT NOT NULL,
  outreach_target INTEGER NOT NULL DEFAULT 0,
  outreach_completed INTEGER NOT NULL DEFAULT 0,
  follow_ups_target INTEGER NOT NULL DEFAULT 0,
  follow_ups_completed INTEGER NOT NULL DEFAULT 0,
  telegram_groups_target INTEGER NOT NULL DEFAULT 0,
  telegram_groups_opened INTEGER NOT NULL DEFAULT 0,
  meetings_target INTEGER NOT NULL DEFAULT 0,
  meetings_completed INTEGER NOT NULL DEFAULT 0,
  proposals_target INTEGER NOT NULL DEFAULT 0,
  proposals_sent INTEGER NOT NULL DEFAULT 0,
  deals_target INTEGER NOT NULL DEFAULT 0,
  deals_won INTEGER NOT NULL DEFAULT 0,
  revenue_target REAL NOT NULL DEFAULT 0,
  revenue_achieved REAL NOT NULL DEFAULT 0,
  achievement_percentage REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id, scorecard_date)
);

CREATE TABLE IF NOT EXISTS source_directory (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_category TEXT,
  website TEXT,
  social_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  storage_key TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data TEXT,
  after_data TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_status ON projects(tenant_id, lifecycle_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_followup ON projects(tenant_id, next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline ON opportunities(tenant_id, stage, expected_close_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities(tenant_id, owner_user_id, stage);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(tenant_id, owner_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(tenant_id, status, end_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(tenant_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);

