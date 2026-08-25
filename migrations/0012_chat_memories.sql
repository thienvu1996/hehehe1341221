CREATE TABLE IF NOT EXISTS chat_memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  chat_id TEXT NOT NULL DEFAULT '',
  chat_type TEXT,
  chat_title TEXT,
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT,
  memory_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  value_json TEXT,
  confidence REAL DEFAULT 0,
  importance INTEGER DEFAULT 1,
  source_message_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_memories_identity
  ON chat_memories(scope, chat_id, user_id, topic, memory_key);

CREATE INDEX IF NOT EXISTS idx_chat_memories_chat
  ON chat_memories(chat_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_chat_memories_user
  ON chat_memories(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_chat_memories_topic
  ON chat_memories(topic, updated_at);
