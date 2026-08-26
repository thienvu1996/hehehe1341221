CREATE TABLE IF NOT EXISTS group_chat_summaries (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  hours INTEGER NOT NULL DEFAULT 24,
  message_count INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_group_chat_summaries_connection
  ON group_chat_summaries(connection_id, hours, created_at DESC);
