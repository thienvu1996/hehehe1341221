ALTER TABLE messages ADD COLUMN metadata_json TEXT;
ALTER TABLE links ADD COLUMN metadata_json TEXT;
ALTER TABLE searches ADD COLUMN metadata_json TEXT;
ALTER TABLE images ADD COLUMN metadata_json TEXT;
