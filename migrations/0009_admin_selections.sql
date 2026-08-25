CREATE TABLE IF NOT EXISTS admin_selections (
  owner_user_id TEXT PRIMARY KEY,
  selected_chat_id TEXT NOT NULL,
  selected_chat_type TEXT,
  selected_chat_title TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
