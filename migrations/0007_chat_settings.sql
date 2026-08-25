CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id TEXT PRIMARY KEY,
  chat_type TEXT,
  chat_title TEXT,
  user_id TEXT,
  user_name TEXT,
  weather_enabled INTEGER DEFAULT 0,
  weather_time TEXT DEFAULT '06:00',
  weather_location TEXT DEFAULT 'TP Ho Chi Minh',
  timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
  last_weather_sent_date TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_settings_weather
  ON chat_settings(weather_enabled, weather_time);
