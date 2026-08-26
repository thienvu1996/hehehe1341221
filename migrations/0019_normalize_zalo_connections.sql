-- Normalize the legacy 0018 zalo_connections table to the schema used by
-- src/config-manager.js. This migration intentionally runs after 0018 so it
-- works both on the existing production D1 and on a fresh database.

PRAGMA foreign_keys = OFF;

ALTER TABLE zalo_connections RENAME TO zalo_connections_legacy_0019;

CREATE TABLE zalo_connections (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  token_cipher TEXT NOT NULL DEFAULT '',
  webhook_secret_cipher TEXT NOT NULL DEFAULT '',
  owner_ids TEXT NOT NULL DEFAULT '',
  webhook_path TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO zalo_connections (
  id,
  display_name,
  enabled,
  token_cipher,
  webhook_secret_cipher,
  owner_ids,
  webhook_path,
  source,
  created_at,
  updated_at
)
SELECT
  connection_id,
  display_name,
  enabled,
  bot_token_encrypted,
  webhook_secret_encrypted,
  owner_ids,
  CASE
    WHEN connection_id = 'main' THEN '/webhook'
    ELSE '/webhook/' || connection_id
  END,
  'dashboard',
  created_at,
  updated_at
FROM zalo_connections_legacy_0019;

DROP TABLE zalo_connections_legacy_0019;

CREATE INDEX IF NOT EXISTS idx_zalo_connections_enabled
  ON zalo_connections(enabled, updated_at DESC);

PRAGMA foreign_keys = ON;
