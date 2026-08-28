CREATE TABLE IF NOT EXISTS media_generation_queue (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT 'main',
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'image',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  output_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_generation_queue_due
ON media_generation_queue(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_media_generation_queue_message
ON media_generation_queue(connection_id, chat_id, message_id);
