-- AI provider / API-key storage.
-- Zalo connection storage is created by 0018_zalo_connections.sql and then
-- normalized to the current schema by 0019_normalize_zalo_connections.sql.

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  provider_type TEXT NOT NULL DEFAULT 'openai_compatible',
  base_url TEXT NOT NULL DEFAULT '',
  chat_model TEXT NOT NULL DEFAULT '',
  reasoning_model TEXT NOT NULL DEFAULT '',
  code_model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  capabilities_json TEXT NOT NULL DEFAULT '["chat"]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled_priority
  ON ai_providers(enabled, priority, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_api_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  key_cipher TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  model_allowlist_json TEXT NOT NULL DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_api_keys_provider_enabled_priority
  ON ai_api_keys(provider_id, enabled, priority, failure_count, updated_at DESC);
