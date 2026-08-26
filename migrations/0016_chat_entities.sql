CREATE TABLE IF NOT EXISTS chat_entities (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT,
  entity_type TEXT NOT NULL DEFAULT 'link',
  entity_key TEXT NOT NULL,
  display_name TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  value_json TEXT NOT NULL DEFAULT '{}',
  source_message_id TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_entities_identity
  ON chat_entities(chat_id, entity_type, entity_key);

CREATE INDEX IF NOT EXISTS idx_chat_entities_chat_recent
  ON chat_entities(chat_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_entities_user_recent
  ON chat_entities(chat_id, user_id, updated_at DESC);
