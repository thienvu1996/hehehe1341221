CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  chat_title TEXT,
  user_id TEXT,
  user_name TEXT,
  title TEXT NOT NULL,
  due_at_utc TEXT NOT NULL,
  due_local_date TEXT,
  due_local_time TEXT,
  timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders(status, due_at_utc);

CREATE INDEX IF NOT EXISTS idx_reminders_chat
  ON reminders(chat_id, status, due_at_utc);
