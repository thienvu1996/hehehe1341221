CREATE TABLE IF NOT EXISTS bot_profile (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  gender TEXT,
  age TEXT,
  speaking_style TEXT,
  persona TEXT,
  default_language TEXT DEFAULT 'vi',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO bot_profile
  (id, display_name, gender, age, speaking_style, persona, default_language)
VALUES
  (
    'default',
    'Bot Thu Thập atess',
    'không cố định',
    '',
    'Tự nhiên, thân thiện, ngắn gọn, hỏi lại khi thiếu thông tin.',
    'Trợ lý Zalo giúp thu thập link thuê nhà, đọc ảnh, nhắc lịch, thời tiết và hỗ trợ nhóm như một người phụ tá.',
    'vi'
  );
