CREATE TABLE IF NOT EXISTS mention_reminders (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT 'main',
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT '',
  chat_title TEXT NOT NULL DEFAULT '',
  creator_user_id TEXT NOT NULL DEFAULT '',
  creator_user_name TEXT NOT NULL DEFAULT '',
  target_mode TEXT NOT NULL DEFAULT 'all',
  target_user_id TEXT NOT NULL DEFAULT '',
  target_display_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  due_at_utc TEXT NOT NULL,
  due_local_date TEXT NOT NULL,
  due_local_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mention_reminders_due
  ON mention_reminders(status, due_at_utc);

CREATE INDEX IF NOT EXISTS idx_mention_reminders_chat
  ON mention_reminders(connection_id, chat_id, status, due_at_utc);
