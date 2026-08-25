CREATE TABLE IF NOT EXISTS conversation_state (
  chat_id TEXT PRIMARY KEY,
  chat_type TEXT,
  user_id TEXT,
  user_name TEXT,
  intent TEXT,
  topic TEXT,
  state_json TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_state_updated
  ON conversation_state(updated_at);
