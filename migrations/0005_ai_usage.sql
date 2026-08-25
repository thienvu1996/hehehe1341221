CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT,
  feature TEXT,
  chat_id TEXT,
  chat_type TEXT,
  user_id TEXT,
  user_name TEXT,
  message_id TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_chat_created ON ai_usage(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model_created ON ai_usage(model, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ok_created ON ai_usage(ok, created_at);
