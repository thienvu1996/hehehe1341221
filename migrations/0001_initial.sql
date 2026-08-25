CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  user_id TEXT,
  user_name TEXT,
  message_id TEXT,
  text TEXT,
  message_date INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  user_id TEXT,
  user_name TEXT,
  message_id TEXT,
  url TEXT NOT NULL,
  source_text TEXT,
  title TEXT,
  description TEXT,
  summary TEXT,
  price_text TEXT,
  area_text TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  http_status INTEGER,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, url)
);

CREATE INDEX IF NOT EXISTS idx_links_chat_created ON links(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_links_chat_status ON links(chat_id, status);
