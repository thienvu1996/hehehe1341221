CREATE TABLE IF NOT EXISTS memory_pipeline_state (
  connection_id TEXT NOT NULL DEFAULT 'main',
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  chat_title TEXT,
  last_message_id TEXT,
  last_event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_extracted_at TEXT,
  pending_count INTEGER NOT NULL DEFAULT 0,
  total_extractions INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (connection_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_pipeline_pending
  ON memory_pipeline_state(pending_count, last_event_at);

CREATE INDEX IF NOT EXISTS idx_memory_pipeline_connection
  ON memory_pipeline_state(connection_id, updated_at);
