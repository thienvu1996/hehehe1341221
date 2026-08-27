CREATE TABLE IF NOT EXISTS bot_ai_web_routes (
  connection_id TEXT PRIMARY KEY,
  search_provider_ids_json TEXT NOT NULL DEFAULT '[]',
  answer_provider_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_ai_web_routes_updated
  ON bot_ai_web_routes(updated_at DESC);
