INSERT OR IGNORE INTO bot_profile
  (id, display_name, gender, age, speaking_style, persona, default_language, updated_at)
SELECT
  z.id,
  COALESCE(NULLIF(TRIM(z.display_name), ''), z.id),
  'không cố định',
  '',
  'Tự nhiên, thân thiện, ngắn gọn, hỏi lại khi thiếu thông tin.',
  'Trợ lý Zalo giúp thu thập link thuê nhà, đọc ảnh, nhắc lịch, thời tiết và hỗ trợ nhóm như một người phụ tá.',
  'vi',
  CURRENT_TIMESTAMP
FROM zalo_connections AS z
WHERE z.id <> 'main';

UPDATE bot_profile
SET
  display_name = (
    SELECT COALESCE(NULLIF(TRIM(z.display_name), ''), z.id)
    FROM zalo_connections AS z
    WHERE z.id = bot_profile.id
    LIMIT 1
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id <> 'default'
  AND EXISTS (SELECT 1 FROM zalo_connections AS z WHERE z.id = bot_profile.id)
  AND (
    TRIM(COALESCE(display_name, '')) = ''
    OR display_name = 'Bot Thu Thap atess'
    OR display_name = 'Bot Thu Thập atess'
  );
