CREATE TABLE IF NOT EXISTS general_ai_retry_queue (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT 'main',
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_general_ai_retry_message
  ON general_ai_retry_queue(connection_id, message_id)
  WHERE message_id <> '';

CREATE INDEX IF NOT EXISTS idx_general_ai_retry_due
  ON general_ai_retry_queue(status, next_attempt_at, created_at);
