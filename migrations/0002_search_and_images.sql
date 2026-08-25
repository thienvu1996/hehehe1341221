CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  query TEXT NOT NULL,
  answer TEXT,
  sources_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_searches_chat_created ON searches(chat_id, created_at);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  user_id TEXT,
  user_name TEXT,
  message_id TEXT,
  photo_url TEXT NOT NULL,
  caption TEXT,
  analysis TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_images_chat_created ON images(chat_id, created_at);
