CREATE TABLE IF NOT EXISTS character_profiles (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT 'main',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  age_range TEXT NOT NULL DEFAULT '',
  style_tags TEXT NOT NULL DEFAULT '',
  base_prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  seed TEXT NOT NULL DEFAULT '',
  source_model TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_character_profiles_connection
  ON character_profiles(connection_id, is_active, is_default, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_reference_images (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  connection_id TEXT NOT NULL DEFAULT 'main',
  angle_type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  file_key TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0,
  is_image_seed INTEGER NOT NULL DEFAULT 1,
  is_video_seed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(character_id) REFERENCES character_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_reference_images_character
  ON character_reference_images(character_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_character_reference_images_connection
  ON character_reference_images(connection_id, character_id);

CREATE TABLE IF NOT EXISTS media_generations (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT 'main',
  character_id TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  reference_image_ids TEXT NOT NULL DEFAULT '[]',
  output_url TEXT NOT NULL DEFAULT '',
  provider_job_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_generations_connection
  ON media_generations(connection_id, created_at DESC);
