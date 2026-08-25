CREATE TABLE IF NOT EXISTS chat_aliases (
  chat_id TEXT PRIMARY KEY,
  chat_title TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_by_user_name TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
