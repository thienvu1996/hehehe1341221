CREATE TABLE IF NOT EXISTS bot_ai_permissions (
  connection_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  inherit_main INTEGER NOT NULL DEFAULT 1,
  provider_ids_json TEXT NOT NULL DEFAULT '[]',
  allow_chat INTEGER NOT NULL DEFAULT 1,
  allow_reasoning INTEGER NOT NULL DEFAULT 1,
  allow_code INTEGER NOT NULL DEFAULT 1,
  daily_request_limit INTEGER NOT NULL DEFAULT 0,
  daily_token_limit INTEGER NOT NULL DEFAULT 0,
  monthly_request_limit INTEGER NOT NULL DEFAULT 0,
  monthly_token_limit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_ai_permissions_enabled
  ON bot_ai_permissions(enabled, updated_at DESC);
