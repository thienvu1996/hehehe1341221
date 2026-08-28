CREATE TABLE IF NOT EXISTS web_retry_queue (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT 'main',
  message_id TEXT NOT NULL DEFAULT '',
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  request_text TEXT NOT NULL,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_retry_queue_message
  ON web_retry_queue(connection_id, message_id)
  WHERE message_id <> '';

CREATE INDEX IF NOT EXISTS idx_web_retry_queue_due
  ON web_retry_queue(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_web_retry_queue_chat
  ON web_retry_queue(connection_id, chat_id, status, created_at DESC);
