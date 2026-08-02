CREATE TABLE IF NOT EXISTS waitlist_interests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  organisation TEXT NOT NULL,
  package_code TEXT NOT NULL,
  preferred_term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITLISTED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_interests_status_updated
  ON waitlist_interests(status, updated_at DESC);
