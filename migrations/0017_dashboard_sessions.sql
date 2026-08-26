CREATE TABLE IF NOT EXISTS dashboard_sessions (
  nonce TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_last_seen
  ON dashboard_sessions(last_seen_at DESC);
