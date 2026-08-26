CREATE TABLE IF NOT EXISTS zalo_connections (
  connection_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  bot_token_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT NOT NULL,
  owner_ids TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  webhook_registered INTEGER NOT NULL DEFAULT 0,
  last_register_status INTEGER,
  last_register_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_zalo_connections_enabled
  ON zalo_connections(enabled, updated_at DESC);
