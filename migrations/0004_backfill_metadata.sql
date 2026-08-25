UPDATE messages
SET metadata_json = json_object(
  'event_name', 'backfill.message',
  'chat_id', chat_id,
  'chat_type', chat_type,
  'user_id', user_id,
  'user_name', user_name,
  'message_id', message_id,
  'message_date', message_date,
  'text_length', length(coalesce(text, '')),
  'captured_at', created_at
)
WHERE metadata_json IS NULL;

UPDATE links
SET metadata_json = json_object(
  'event_name', 'backfill.link',
  'chat_id', chat_id,
  'chat_type', chat_type,
  'user_id', user_id,
  'user_name', user_name,
  'message_id', message_id,
  'url_status', status,
  'http_status', http_status,
  'captured_at', created_at
)
WHERE metadata_json IS NULL;

UPDATE searches
SET metadata_json = json_object(
  'event_name', 'backfill.search',
  'chat_id', chat_id,
  'user_id', user_id,
  'user_name', user_name,
  'captured_at', created_at
)
WHERE metadata_json IS NULL;

UPDATE images
SET metadata_json = json_object(
  'event_name', 'backfill.image',
  'chat_id', chat_id,
  'chat_type', chat_type,
  'user_id', user_id,
  'user_name', user_name,
  'message_id', message_id,
  'captured_at', created_at
)
WHERE metadata_json IS NULL;
