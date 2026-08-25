const API_BASE_URL = "https://bot-api.zaloplatforms.com";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_GEMINI_SEARCH_MODEL = "gemini-3.5-flash-lite";
const MAX_ZALO_TEXT_LENGTH = 1900;
const DEFAULT_BOT_DISPLAY_NAME = "Bot Thu Thap atess";
const DASHBOARD_SESSION_TTL_SECONDS = 30 * 60;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const DEFAULT_WEATHER_PLACE = {
  name: "TP Ho Chi Minh",
  latitude: 10.8231,
  longitude: 106.6297,
  source: "default"
};
const DEFAULT_WEATHER_TIME = "06:00";
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const SCHEDULE_INTERVAL_MINUTES = 15;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getDashboardCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token, X-Bot-Api-Secret-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function dashboardJson(request, data, status = 200) {
  return json(data, status, getDashboardCorsHeaders(request));
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }

  return diff === 0;
}

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createDashboardSignature(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return base64UrlEncode(signature);
}

function getDashboardMasterSecret(env) {
  return env.DASHBOARD_TOKEN || env.WEBHOOK_SECRET_TOKEN || "";
}

async function createDashboardSessionToken(env) {
  const secret = getDashboardMasterSecret(env);
  const expiresAt = Math.floor(Date.now() / 1000) + DASHBOARD_SESSION_TTL_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = await createDashboardSignature(secret, payload);

  return {
    token: `${payload}.${signature}`,
    expiresAt
  };
}

async function verifyDashboardSessionToken(env, token) {
  const secret = getDashboardMasterSecret(env);
  const parts = String(token || "").split(".");

  if (!secret || parts.length !== 4 || parts[0] !== "v1") {
    return false;
  }

  const expiresAt = Number(parts[1]);

  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = parts.slice(0, 3).join(".");
  const expectedSignature = await createDashboardSignature(secret, payload);

  return constantTimeEqual(parts[3], expectedSignature);
}

function getReplyText(message) {
  const text = String(message?.text || "").trim();

  if (!text) {
    return "Bot đã nhận được tin nhắn của bạn.";
  }

  if (/^(hi|hello|chao|xin chao|\/start)$/i.test(text)) {
    return "Xin chào! Webhook Zalo Bot đã hoạt động.";
  }

  return `Bạn vừa gửi: ${text}`;
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GEMINI_KEY]")
    .replace(/\b\d{8,}:[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_ZALO_TOKEN]")
    .replace(/(token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function limitText(text, maxLength = MAX_ZALO_TEXT_LENGTH) {
  const value = String(text || "").trim();

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 20).trim()}...`;
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function parseJsonFromText(text, fallback = null) {
  const value = String(text || "").trim();

  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
  } catch {
    const match = value.match(/\{[\s\S]*\}/);

    if (!match) {
      return fallback;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

function truncateForDb(value, maxLength = 1200) {
  const text = String(value || "");

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0].replace(/[),.;!?]+$/g, ""))
    .filter(Boolean);
}

function isLikelyMediaUrl(url, source = "") {
  const lowerUrl = String(url || "").toLowerCase();
  const lowerSource = String(source || "").toLowerCase();

  return (
    /\.(avif|gif|heic|jpeg|jpg|mp4|png|webp)(\?|#|$)/i.test(lowerUrl) ||
    /(photo|image|thumbnail|thumb|avatar|sticker)/.test(lowerSource)
  );
}

function collectUrlsDeep(value, path = "", depth = 0, output = []) {
  if (!value || depth > 6) {
    return output;
  }

  if (typeof value === "string") {
    for (const url of extractUrls(value)) {
      output.push({ url, source: path });
    }

    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => collectUrlsDeep(child, `${path}[${index}]`, depth + 1, output));
    return output;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectUrlsDeep(child, path ? `${path}.${key}` : key, depth + 1, output);
    }
  }

  return output;
}

function uniqueUrlItems(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    if (!item?.url || seen.has(item.url)) {
      continue;
    }

    seen.add(item.url);
    unique.push(item);
  }

  return unique;
}

function extractMessageUrlItems(message) {
  const text = getMessageText(message);
  const fromText = extractUrls(text).map((url) => ({ url, source: "text" }));
  const deepItems = collectUrlsDeep(message, "message").filter((item) => !isLikelyMediaUrl(item.url, item.source));

  return uniqueUrlItems([...fromText, ...deepItems]);
}

function extractMessageUrls(message) {
  return extractMessageUrlItems(message).map((item) => item.url);
}

function findUrlDeep(value, path = "", depth = 0) {
  if (!value || depth > 5) {
    return null;
  }

  if (typeof value === "string") {
    const match = value.match(/https?:\/\/[^\s<>"']+/i);

    return match ? { url: match[0], source: path } : null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findUrlDeep(value[index], `${path}[${index}]`, depth + 1);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof value === "object") {
    for (const key of ["photo_url", "photo", "image_url", "media_url", "url", "href", "download_url", "thumbnail_url"]) {
      const found = findUrlDeep(value[key], path ? `${path}.${key}` : key, depth + 1);

      if (found) {
        return found;
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();

      if (!/(photo|image|media|file|attach|payload|url|href|thumb)/.test(lowerKey)) {
        continue;
      }

      const found = findUrlDeep(child, path ? `${path}.${key}` : key, depth + 1);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function extractImageUrl(message) {
  return (
    findUrlDeep(message?.photo_url, "photo_url") ||
    findUrlDeep(message?.photo, "photo") ||
    findUrlDeep(message?.image_url, "image_url") ||
    findUrlDeep(message?.media, "media") ||
    findUrlDeep(message?.attachment, "attachment") ||
    findUrlDeep(message?.attachments, "attachments") ||
    findUrlDeep(message, "message")
  );
}

function getMessageText(message) {
  return String(message?.text || message?.caption || "").trim();
}

function getCleanQuestion(text, botName = "") {
  let cleanText = String(text || "").trim();
  const names = [botName, DEFAULT_BOT_DISPLAY_NAME, "Bot Thu Thập atess"].filter(Boolean);

  for (const name of names) {
    cleanText = cleanText.replaceAll(`@${name}`, "");
  }

  return cleanText.replace(/^@\S+\s*/, "").trim();
}

function isWeatherQuestion(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("thoi tiet") ||
    normalized.includes("du bao") ||
    normalized.includes("mua khong") ||
    normalized.includes("nong khong")
  );
}

function isRentalQuestion(text) {
  const normalized = normalizeText(text);

  if (isWeatherQuestion(text)) {
    return false;
  }

  const hasRentalIntent =
    normalized.includes("nha") ||
    normalized.includes("phong") ||
    normalized.includes("thue") ||
    normalized.includes("tro") ||
    normalized.includes("can ho") ||
    normalized.includes("chung cu") ||
    normalized.includes("tim nha") ||
    normalized.includes("tim phong");

  return (
    hasRentalIntent ||
    normalized.includes("link") ||
    normalized.includes("loi") ||
    normalized.includes("help") ||
    (hasRentalIntent && normalized.includes("search")) ||
    (hasRentalIntent && normalized.includes("google")) ||
    (hasRentalIntent && normalized.includes("gg")) ||
    (hasRentalIntent && normalized.includes("gia")) ||
    (hasRentalIntent && normalized.includes("quan")) ||
    (hasRentalIntent && normalized.includes("hom nay")) ||
    (hasRentalIntent && normalized.includes("tim")) ||
    (hasRentalIntent && normalized.includes("duoi")) ||
    (hasRentalIntent && normalized.includes("ban kinh")) ||
    (hasRentalIntent && normalized.includes("gan")) ||
    (hasRentalIntent && normalized.includes("trieu")) ||
    (hasRentalIntent && normalized.includes("10tr")) ||
    /\b\d+\s*tr\b/.test(normalized)
  );
}

function isContextQuestion(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("thong tin") ||
    normalized.includes("du lieu") ||
    normalized.includes("metadata") ||
    normalized.includes("meta data") ||
    normalized.includes("nhom") ||
    normalized.includes("group") ||
    normalized.includes("thu thap") ||
    normalized.includes("da luu") ||
    normalized.includes("co gi") ||
    normalized.includes("tong hop") ||
    normalized.includes("bao cao") ||
    normalized.includes("bao nhieu") ||
    normalized.includes("bao nhiu") ||
    normalized.includes("so luong") ||
    normalized.includes("dashboard") ||
    normalized.includes("bot biet gi") ||
    normalized.includes("hien tai")
  );
}

function isPrivateChat(message) {
  return normalizeText(message.chat?.chat_type || "").includes("private");
}

function getOwnerUserIds(env) {
  return String(env.OWNER_ZALO_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isOwnerMessage(env, message) {
  const ownerIds = getOwnerUserIds(env);

  return ownerIds.includes(String(message.from?.id || ""));
}

function wantsDashboardKey(text) {
  return normalizeText(text).replace(/[\s-]+/g, "_").includes("key_dashboard");
}

function answerDashboardKey(env, message) {
  if (!wantsDashboardKey(getMessageText(message))) {
    return null;
  }

  if (!isPrivateChat(message)) {
    return "Lệnh KEY_Dashboard chỉ dùng trong tin nhắn riêng với bot, không gửi key trong group.";
  }

  if (!isOwnerMessage(env, message)) {
    return "Tài khoản này không có quyền lấy dashboard key.";
  }

  if (!env.DASHBOARD_TOKEN) {
    return "Worker chưa có DASHBOARD_TOKEN.";
  }

  return [
    "Dashboard key:",
    env.DASHBOARD_TOKEN,
    "",
    "Mở dashboard:",
    "https://dashboard.jean1331.io.vn",
    "Nếu domain chưa vào được, dùng:",
    "https://hehehe1341221-dashboard.vuthien616.workers.dev"
  ].join("\n");
}

function normalizeScheduleMinute(hour, minute) {
  let normalizedHour = hour;
  let normalizedMinute = Math.ceil(minute / SCHEDULE_INTERVAL_MINUTES) * SCHEDULE_INTERVAL_MINUTES;

  if (normalizedMinute >= 60) {
    normalizedHour = (normalizedHour + 1) % 24;
    normalizedMinute = 0;
  }

  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

function parseScheduleTime(text) {
  const normalized = normalizeText(text);
  const match =
    normalized.match(/\b(?:luc|vao|moi ngay|hang ngay)?\s*(\d{1,2})\s*(?::|h|gio)\s*(\d{1,2})?\s*(am|pm)?\b/) ||
    normalized.match(/\b(\d{1,2})\s*(am|pm)\b/);

  if (!match) {
    return DEFAULT_WEATHER_TIME;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || "";

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) {
    return DEFAULT_WEATHER_TIME;
  }

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  if (hour === 24) {
    hour = 0;
  }

  return normalizeScheduleMinute(hour, minute);
}

function normalizeLocationName(text) {
  const normalized = normalizeText(text);

  if (
    normalized.includes("hcm") ||
    normalized.includes("tphcm") ||
    normalized.includes("ho chi minh") ||
    normalized.includes("sai gon")
  ) {
    return "TP Ho Chi Minh";
  }

  if (normalized.includes("quan 12") || normalized.includes("q12")) {
    return "Quận 12, TP Ho Chi Minh";
  }

  if (normalized.includes("an phu dong") || normalized.includes("an thoi dong")) {
    return "An Phú Đông, Quận 12, TP Ho Chi Minh";
  }

  return String(text || "").trim();
}

function parseWeatherSettingsCommand(text, message) {
  const cleanText = getCleanQuestion(text, message.chat?.title || "");
  const normalized = normalizeText(cleanText);
  const asksSettings =
    normalized.includes("xem cai dat") ||
    normalized.includes("xem cau hinh") ||
    normalized.includes("cau hinh bot") ||
    normalized.includes("setting") ||
    normalized.includes("settings") ||
    normalized.includes("lich thoi tiet");

  if (asksSettings) {
    return { action: "show" };
  }

  const mentionsWeather = normalized.includes("thoi tiet") || normalized.includes("du bao");
  const disable =
    mentionsWeather &&
    (normalized.includes("tat ") ||
      normalized.startsWith("tat") ||
      normalized.includes("dung gui") ||
      normalized.includes("huy lich") ||
      normalized.includes("bo lich"));

  if (disable) {
    return { action: "disable" };
  }

  const enable =
    mentionsWeather &&
    (normalized.includes("cai ") ||
      normalized.startsWith("cai") ||
      normalized.includes("set ") ||
      normalized.startsWith("set") ||
      normalized.includes("bat ") ||
      normalized.startsWith("bat") ||
      normalized.includes("hen ") ||
      normalized.startsWith("hen") ||
      normalized.includes("nhac ") ||
      normalized.includes("gui "));

  if (!enable) {
    return null;
  }

  const time = parseScheduleTime(cleanText);
  const originalTimeMatch = cleanText.match(
    /\b(?:lúc|luc|vào|vao|mỗi ngày|moi ngay|hằng ngày|hang ngay)?\s*\d{1,2}\s*(?::|h|giờ|gio)\s*\d{0,2}\s*(?:am|pm)?\b/i
  );
  const withoutTime = cleanText.replace(/\b(?:lúc|luc|vào|vao|mỗi ngày|moi ngay|hằng ngày|hang ngay)?\s*\d{1,2}\s*(?::|h|giờ|gio)\s*\d{0,2}\s*(?:am|pm)?\b/gi, " ");
  const locationAfterTime = originalTimeMatch
    ? cleanText.slice(originalTimeMatch.index + originalTimeMatch[0].length).trim()
    : "";
  const locationCandidate = (locationAfterTime || withoutTime)
    .replace(
      /\b(cài đặt|cài|set|bật|mở|hen|hẹn|nhắc|gửi|lịch|thời tiết|du bao|dự báo|mỗi ngày|hằng ngày|moi ngay|hang ngay|cho|tại|ở|o)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  const location = normalizeLocationName(locationCandidate) || DEFAULT_WEATHER_PLACE.name;

  return {
    action: "enable",
    time,
    location
  };
}

async function getChatSettings(env, chatId) {
  if (!env.DB || !chatId) {
    return null;
  }

  try {
    return await env.DB.prepare(
      `SELECT chat_id, chat_type, chat_title, user_id, user_name, weather_enabled,
              weather_time, weather_location, timezone, last_weather_sent_date, updated_at
       FROM chat_settings
       WHERE chat_id = ?
       LIMIT 1`
    )
      .bind(chatId)
      .first();
  } catch (error) {
    console.error("Failed to read chat settings:", error);
    return null;
  }
}

function formatChatSettings(settings, chatType = "") {
  if (!settings) {
    return [
      "Nhóm/chat này chưa cài lịch riêng.",
      `Mặc định gợi ý: thời tiết ${DEFAULT_WEATHER_TIME} tại ${DEFAULT_WEATHER_PLACE.name}.`,
      "",
      "Ví dụ:",
      `@${DEFAULT_BOT_DISPLAY_NAME} cài gửi thời tiết 6h HCM`
    ].join("\n");
  }

  const enabled = Number(settings.weather_enabled || 0) === 1 ? "đang bật" : "đang tắt";
  const scope = normalizeText(chatType || settings.chat_type).includes("private") ? "chat riêng này" : "nhóm này";

  return [
    `Cài đặt của ${scope}:`,
    `- Thời tiết: ${enabled}`,
    `- Giờ gửi: ${settings.weather_time || DEFAULT_WEATHER_TIME}`,
    `- Địa điểm: ${settings.weather_location || DEFAULT_WEATHER_PLACE.name}`,
    `- Múi giờ: ${settings.timezone || DEFAULT_TIMEZONE}`,
    "",
    "Lệnh nhanh:",
    `@${DEFAULT_BOT_DISPLAY_NAME} cài gửi thời tiết 6h HCM`,
    `@${DEFAULT_BOT_DISPLAY_NAME} tắt thời tiết`
  ].join("\n");
}

async function saveChatWeatherSettings(env, message, parsed) {
  const chatId = message.chat?.id || "";

  if (!env.DB || !chatId) {
    return "Chưa cấu hình database nên chưa lưu được cài đặt.";
  }

  const existing = await getChatSettings(env, chatId);
  const weatherEnabled = parsed.action === "disable" ? 0 : 1;
  const weatherTime = parsed.time || existing?.weather_time || DEFAULT_WEATHER_TIME;
  const weatherLocation = parsed.location || existing?.weather_location || env.DEFAULT_WEATHER_LOCATION || DEFAULT_WEATHER_PLACE.name;
  const timezone = existing?.timezone || DEFAULT_TIMEZONE;

  await env.DB.prepare(
    `INSERT INTO chat_settings
      (chat_id, chat_type, chat_title, user_id, user_name, weather_enabled, weather_time,
       weather_location, timezone, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id) DO UPDATE SET
       chat_type = excluded.chat_type,
       chat_title = excluded.chat_title,
       user_id = excluded.user_id,
       user_name = excluded.user_name,
       weather_enabled = excluded.weather_enabled,
       weather_time = excluded.weather_time,
       weather_location = excluded.weather_location,
       timezone = excluded.timezone,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      chatId,
      message.chat?.chat_type || "",
      message.chat?.title || "",
      message.from?.id || "",
      message.from?.display_name || "",
      weatherEnabled,
      weatherTime,
      weatherLocation,
      timezone
    )
    .run();

  if (parsed.action === "disable") {
    return `Đã tắt lịch gửi thời tiết cho ${isPrivateChat(message) ? "chat riêng này" : "nhóm này"}.`;
  }

  return [
    `Đã bật lịch thời tiết cho ${isPrivateChat(message) ? "chat riêng này" : "nhóm này"}.`,
    `Giờ gửi: ${weatherTime}`,
    `Địa điểm: ${weatherLocation}`,
    "Bot sẽ kiểm tra lịch mỗi 15 phút và chỉ gửi 1 lần/ngày."
  ].join("\n");
}

async function handleSettingsCommand(env, message, text) {
  const parsed = parseWeatherSettingsCommand(text, message);

  if (!parsed) {
    return null;
  }

  if (parsed.action === "show") {
    return formatChatSettings(await getChatSettings(env, message.chat?.id || ""), message.chat?.chat_type || "");
  }

  return saveChatWeatherSettings(env, message, parsed);
}

function buildMessageMetadata(message, eventName = "message.received") {
  const text = redactSensitiveText(getMessageText(message));
  const urlItems = extractMessageUrlItems(message);
  const urls = urlItems.map((item) => item.url);
  const imageInfo = extractImageUrl(message);

  return {
    event_name: eventName,
    chat: {
      id: message.chat?.id || "",
      type: message.chat?.chat_type || "",
      title: message.chat?.title || ""
    },
    sender: {
      id: message.from?.id || "",
      name: message.from?.display_name || ""
    },
    message: {
      id: message.message_id || "",
      date: message.date || null,
      keys: Object.keys(message || {}).slice(0, 30),
      has_text: Boolean(message.text),
      has_caption: Boolean(message.caption),
      has_photo: Boolean(imageInfo?.url),
      photo_source: imageInfo?.source || "",
      url_count: urls.length,
      text_length: text.length
    },
    extracted: {
      urls,
      url_sources: urlItems.map((item) => ({
        url: item.url,
        source: item.source
      }))
    },
    captured_at: new Date().toISOString()
  };
}

function getUsageMetadata(data = {}) {
  const usage = data.usageMetadata || data.usage_metadata || {};

  return {
    promptTokens: usage.promptTokenCount || usage.prompt_token_count || usage.inputTokenCount || usage.input_token_count || 0,
    outputTokens:
      usage.candidatesTokenCount ||
      usage.candidates_token_count ||
      usage.outputTokenCount ||
      usage.output_token_count ||
      0,
    totalTokens: usage.totalTokenCount || usage.total_token_count || 0
  };
}

function getAiErrorInfo(data = {}, httpStatus = null, error = null) {
  const apiError = data.error || {};

  return {
    code: String(apiError.status || apiError.code || error?.name || httpStatus || ""),
    message: truncateForDb(apiError.message || error?.message || error || "", 1200)
  };
}

async function logAiUsage(env, usage) {
  if (!env.DB) {
    return;
  }

  try {
    const message = usage.message || {};
    await env.DB.prepare(
      `INSERT INTO ai_usage
        (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
         ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        usage.provider || "gemini",
        usage.model || "",
        usage.feature || "",
        message.chat?.id || usage.chatId || "",
        message.chat?.chat_type || usage.chatType || "",
        message.from?.id || usage.userId || "",
        message.from?.display_name || usage.userName || "",
        message.message_id || usage.messageId || null,
        usage.ok ? 1 : 0,
        usage.httpStatus || null,
        usage.errorCode || "",
        truncateForDb(usage.errorMessage || "", 1200),
        usage.promptTokens || 0,
        usage.outputTokens || 0,
        usage.totalTokens || 0,
        truncateForDb(
          JSON.stringify({
            duration_ms: usage.durationMs || 0,
            endpoint: usage.endpoint || "",
            input_type: usage.inputType || "",
            quota_related: usage.httpStatus === 429 || /quota|rate|resource_exhausted/i.test(usage.errorMessage || ""),
            captured_at: new Date().toISOString()
          }),
          4000
        )
      )
      .run();
  } catch (error) {
    console.error("Failed to log AI usage:", error);
  }
}

function wantsWebSearch(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("/search") ||
    normalized.includes("search") ||
    normalized.includes("google") ||
    normalized.includes(" tren gg") ||
    normalized.includes(" gg ") ||
    normalized.includes("tim tren mang") ||
    normalized.includes("tim tren web") ||
    normalized.includes("tim nha") ||
    normalized.includes("tim phong") ||
    isWeatherQuestion(text) ||
    normalized.includes("tin moi") ||
    normalized.includes("hom nay co gi") ||
    normalized.includes("gia vang") ||
    normalized.includes("ty gia")
  );
}

function isLikelyQuestion(text) {
  const normalized = normalizeText(text).trim();

  return (
    normalized.endsWith("?") ||
    normalized.includes(" sao") ||
    normalized.includes(" nhu nao") ||
    normalized.includes(" la gi") ||
    normalized.includes(" co ") ||
    normalized.startsWith("co ") ||
    normalized.startsWith("hoi ") ||
    normalized.startsWith("tim ") ||
    normalized.startsWith("kiem ") ||
    normalized.startsWith("thu thap ") ||
    normalized.startsWith("tom tat ") ||
    normalized.startsWith("giai thich ") ||
    normalized.startsWith("check ") ||
    normalized.startsWith("xem ")
  );
}

function isLikelyLocationText(text) {
  const normalized = normalizeText(text).trim();

  return (
    normalized.length >= 3 &&
    normalized.length <= 90 &&
    !normalized.includes("?") &&
    !isRentalQuestion(text) &&
    (normalized.includes("quan") ||
      normalized.includes("phuong") ||
      normalized.includes("huyen") ||
      normalized.includes("xa ") ||
      normalized.includes("thi tran") ||
      normalized.includes("thanh pho") ||
      normalized.includes("tp ") ||
      normalized.includes("duong") ||
      normalized.includes("an thoi dong"))
  );
}

function hasWeatherLocation(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes(" tai ") ||
    normalized.includes(" o ") ||
    normalized.includes("hcm") ||
    normalized.includes("tphcm") ||
    normalized.includes("ho chi minh") ||
    normalized.includes("sai gon") ||
    normalized.includes("quan") ||
    normalized.includes("phuong") ||
    normalized.includes("huyen") ||
    normalized.includes("thanh pho") ||
    normalized.includes("tp ") ||
    normalized.includes("ha noi") ||
    normalized.includes("da nang") ||
    normalized.includes("can tho")
  );
}

function isLiveInfoQuestion(text) {
  const normalized = normalizeText(text);

  return (
    wantsWebSearch(text) ||
    normalized.includes("bay gio") ||
    normalized.includes("hien gio") ||
    normalized.includes("luc nay") ||
    normalized.includes("dang co") ||
    normalized.includes("sap toi")
  );
}

async function isWeatherLocationFollowUp(env, message, text) {
  if (!env.DB || !isLikelyLocationText(text)) {
    return false;
  }

  try {
    const result = await env.DB.prepare(
      `SELECT text
       FROM messages
       WHERE chat_id = ? AND (message_id IS NULL OR message_id != ?)
       ORDER BY datetime(created_at) DESC
       LIMIT 5`
    )
      .bind(message.chat?.id || "", message.message_id || "")
      .all();

    return (result.results || []).some((row) => isWeatherQuestion(row.text || ""));
  } catch (error) {
    console.error(error);
    return false;
  }
}

function enrichLiveQuery(env, question) {
  if (isWeatherQuestion(question) && !hasWeatherLocation(question)) {
    return `${question} tai ${env.DEFAULT_WEATHER_LOCATION || "TP Ho Chi Minh, Viet Nam"}`;
  }

  return question;
}

function getWeatherCodeLabel(code) {
  const labels = {
    0: "trời quang",
    1: "ít mây",
    2: "mây rải rác",
    3: "nhiều mây",
    45: "sương mù",
    48: "sương mù đóng băng",
    51: "mưa phùn nhẹ",
    53: "mưa phùn vừa",
    55: "mưa phùn nặng",
    61: "mưa nhẹ",
    63: "mưa vừa",
    65: "mưa nặng",
    80: "mưa rào nhẹ",
    81: "mưa rào vừa",
    82: "mưa rào mạnh",
    95: "có dông",
    96: "dông kèm mưa đá nhẹ",
    99: "dông kèm mưa đá mạnh"
  };

  return labels[code] || "chưa rõ hiện tượng";
}

function getWeatherPlaceFromText(env, text) {
  const normalized = normalizeText(text);
  const defaultName = env.DEFAULT_WEATHER_LOCATION || DEFAULT_WEATHER_PLACE.name;

  if (normalized.includes("an phu dong") || normalized.includes("an thoi dong")) {
    return {
      name: "An Phu Dong, Quan 12, TP Ho Chi Minh",
      latitude: 10.8619,
      longitude: 106.6881,
      source: "local_map"
    };
  }

  if (normalized.includes("quan 12") || normalized.includes("q12")) {
    return {
      name: "Quan 12, TP Ho Chi Minh",
      latitude: 10.8672,
      longitude: 106.6413,
      source: "local_map"
    };
  }

  if (
    normalized.includes("hcm") ||
    normalized.includes("tphcm") ||
    normalized.includes("ho chi minh") ||
    normalized.includes("sai gon")
  ) {
    return {
      ...DEFAULT_WEATHER_PLACE,
      source: "local_map"
    };
  }

  const cleaned = normalized
    .replace(/\b(thoi tiet|du bao|hom nay|nay|bay gio|mua khong|nong khong|lanh khong|tai|o|cho|minh|giup|nhe|sao)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 3) {
    return {
      ...DEFAULT_WEATHER_PLACE,
      name: defaultName,
      source: "default"
    };
  }

  return {
    name: `${cleaned}, Viet Nam`,
    source: "query"
  };
}

async function geocodeWeatherPlace(env, text) {
  const place = getWeatherPlaceFromText(env, text);

  if (typeof place.latitude === "number" && typeof place.longitude === "number") {
    return place;
  }

  try {
    const url = new URL(OPEN_METEO_GEOCODING_URL);
    url.searchParams.set("name", place.name);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "vi");
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(() => ({}));
    const result = data?.results?.[0];

    if (response.ok && result) {
      return {
        name: [result.name, result.admin1, result.country].filter(Boolean).join(", "),
        latitude: result.latitude,
        longitude: result.longitude,
        timezone: result.timezone,
        source: "open_meteo_geocoding"
      };
    }
  } catch (error) {
    console.error("Open-Meteo geocoding failed:", error);
  }

  return {
    ...DEFAULT_WEATHER_PLACE,
    name: env.DEFAULT_WEATHER_LOCATION || DEFAULT_WEATHER_PLACE.name,
    source: "default_fallback"
  };
}

async function answerWeatherQuestion(env, message, question) {
  const place = await geocodeWeatherPlace(env, question);
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", place.timezone || "Asia/Ho_Chi_Minh");

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(9000)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.current) {
    throw new Error(`Open-Meteo failed: HTTP ${response.status}`);
  }

  const current = data.current;
  const nextRainProbability =
    Array.isArray(data.hourly?.precipitation_probability) && data.hourly.precipitation_probability.length
      ? Math.max(...data.hourly.precipitation_probability.slice(0, 6).map((value) => Number(value || 0)))
      : null;
  const rainLine =
    nextRainProbability === null
      ? ""
      : `\nXác suất mưa cao nhất 6 giờ tới: ${Math.round(nextRainProbability)}%.`;
  const sourceLine = place.source === "default_fallback" ? "\nKhông tìm rõ địa điểm, mình tạm dùng TP HCM." : "";

  if (env.DB) {
    await saveSearch(env, message, `weather:${place.name}`, `Open-Meteo ${current.time || ""}`, [
      { title: "Open-Meteo Weather Forecast API", url: "https://open-meteo.com/en/docs" }
    ]);
  }

  return limitText(
    `Thời tiết ${place.name} lúc ${current.time || "hiện tại"}: ${getWeatherCodeLabel(Number(current.weather_code))}.\n` +
      `Nhiệt độ ${Math.round(Number(current.temperature_2m))}C, cảm giác ${Math.round(Number(current.apparent_temperature))}C.\n` +
      `Độ ẩm ${Math.round(Number(current.relative_humidity_2m))}%, gió ${Math.round(Number(current.wind_speed_10m))} km/h, mưa hiện tại ${Number(current.precipitation || 0)} mm.` +
      rainLine +
      sourceLine
  );
}

function extractHtmlMeta(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    "";
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title.replace(/\s+/g, " ").trim(),
    description: description.replace(/\s+/g, " ").trim(),
    plainText: plainText.slice(0, 6000)
  };
}

async function fetchUrlInfo(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 ZaloRentalBot/1.0"
      },
      signal: AbortSignal.timeout(8000)
    });
    const contentType = response.headers.get("content-type") || "";
    let title = "";
    let description = "";
    let plainText = "";

    if (contentType.includes("text/html")) {
      const html = await response.text();
      const meta = extractHtmlMeta(html.slice(0, 120000));
      title = meta.title;
      description = meta.description;
      plainText = meta.plainText;
    }

    return {
      ok: response.ok,
      status: response.ok ? "ok" : "error",
      httpStatus: response.status,
      title,
      description,
      plainText
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      httpStatus: null,
      title: "",
      description: "",
      plainText: String(error?.message || error)
    };
  }
}

async function askGemini(env, prompt, options = {}) {
  if (!env.GEMINI_API_KEY) {
    return "";
  }

  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const startedAt = Date.now();
  let logged = false;

  try {
    const response = await fetch(`${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    const usage = getUsageMetadata(data);
    const errorInfo = getAiErrorInfo(data, response.status);

    await logAiUsage(env, {
      message: options.message,
      model,
      feature: options.feature || "generate_content",
      ok: response.ok,
      httpStatus: response.status,
      errorCode: response.ok ? "" : errorInfo.code,
      errorMessage: response.ok ? "" : errorInfo.message,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs: Date.now() - startedAt,
      endpoint: "generateContent",
      inputType: "text"
    });
    logged = true;

    if (!response.ok) {
      throw new Error(`Gemini API failed: ${JSON.stringify(data)}`);
    }

    return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  } catch (error) {
    if (!logged) {
      const errorInfo = getAiErrorInfo({}, null, error);
      await logAiUsage(env, {
        message: options.message,
        model,
        feature: options.feature || "generate_content",
        ok: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        durationMs: Date.now() - startedAt,
        endpoint: "generateContent",
        inputType: "text"
      });
    }

    throw error;
  }
}

function parseInteractionText(data) {
  if (data?.output_text) {
    return String(data.output_text).trim();
  }

  const blocks = [];

  for (const step of data?.steps || []) {
    if (step.type === "model_output") {
      for (const block of step.content || []) {
        if (block.type === "text" && block.text) {
          blocks.push(block.text);
        }
      }
    }
  }

  return blocks.join("\n").trim();
}

function parseInteractionSources(data) {
  const sources = [];

  for (const step of data?.steps || []) {
    if (step.type !== "model_output") {
      continue;
    }

    for (const block of step.content || []) {
      for (const annotation of block.annotations || []) {
        if (annotation.type === "url_citation" && annotation.url) {
          sources.push({
            title: annotation.title || annotation.url,
            url: annotation.url
          });
        }
      }
    }
  }

  return [...new Map(sources.map((source) => [source.url, source])).values()].slice(0, 3);
}

async function askGeminiInteraction(env, input, options = {}) {
  if (!env.GEMINI_API_KEY) {
    return { text: "", sources: [] };
  }

  const model = options.model || env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_SEARCH_MODEL;
  const startedAt = Date.now();
  let logged = false;
  const payload = {
    model,
    input
  };

  if (options.tools) {
    payload.tools = options.tools;
  }

  if (options.generationConfig) {
    payload.generation_config = options.generationConfig;
  }

  try {
    const response = await fetch(`${GEMINI_API_BASE_URL}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    const usage = getUsageMetadata(data);
    const errorInfo = getAiErrorInfo(data, response.status);

    await logAiUsage(env, {
      message: options.message,
      model,
      feature: options.feature || "interaction",
      ok: response.ok,
      httpStatus: response.status,
      errorCode: response.ok ? "" : errorInfo.code,
      errorMessage: response.ok ? "" : errorInfo.message,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs: Date.now() - startedAt,
      endpoint: "interactions",
      inputType: Array.isArray(input) ? "multimodal" : "text"
    });
    logged = true;

    if (!response.ok) {
      throw new Error(`Gemini interaction failed: ${JSON.stringify(data)}`);
    }

    return {
      text: parseInteractionText(data),
      sources: parseInteractionSources(data)
    };
  } catch (error) {
    if (!logged) {
      const errorInfo = getAiErrorInfo({}, null, error);
      await logAiUsage(env, {
        message: options.message,
        model,
        feature: options.feature || "interaction",
        ok: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        durationMs: Date.now() - startedAt,
        endpoint: "interactions",
        inputType: Array.isArray(input) ? "multimodal" : "text"
      });
    }

    throw error;
  }
}

async function searchWeb(env, query, message = null) {
  const prompt = `
Bạn là trợ lý trong nhóm Zalo.
Hãy tìm web bằng Google Search và trả lời ngắn gọn bằng tiếng Việt có dấu.
Uu tien thong tin moi, dung dieu kien trong cau hoi, va co link nguon.
Nếu câu hỏi về nhà thuê, hãy ưu tiên giá, khu vực, bán kính, tình trạng link.
Nếu câu hỏi về thời tiết, hãy đưa nhiệt độ, mưa/nắng, và gợi ý hành động ngắn gọn.

Câu hỏi: ${query}
`;
  const result = await askGeminiInteraction(env, prompt, {
    tools: [{ type: "google_search" }],
    model: env.GEMINI_SEARCH_MODEL || DEFAULT_GEMINI_SEARCH_MODEL,
    feature: "web_search",
    message
  });
  const sourceText = result.sources.length
    ? `\n\nNguon:\n${result.sources.map((source, index) => `${index + 1}. ${source.title}: ${source.url}`).join("\n")}`
    : "";

  return {
    answer: limitText(`${result.text}${sourceText}`),
    sources: result.sources
  };
}

async function saveSearch(env, message, query, answer, sources) {
  if (!env.DB) {
    return;
  }

  await env.DB.prepare(
    `INSERT INTO searches (chat_id, user_id, user_name, query, answer, sources_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      message.chat?.id || "",
      message.from?.id || "",
      message.from?.display_name || "",
      redactSensitiveText(query),
      redactSensitiveText(answer),
      JSON.stringify(sources || []),
      JSON.stringify(buildMessageMetadata(message, "search.created"))
    )
    .run();
}

async function summarizeRentalLink(env, message, url, sourceText, urlInfo) {
  if (!env.GEMINI_API_KEY) {
    return {
      summary: urlInfo.title || urlInfo.description || "Đã lưu link. Chưa có GEMINI_API_KEY để tóm tắt.",
      priceText: "",
      areaText: ""
    };
  }

  const prompt = `
Bạn là trợ lý thu thập link thuê nhà trong nhóm Zalo.
Hãy tóm tắt ngắn gọn bằng tiếng Việt có dấu, chỉ dùng thông tin có trong input.
Nếu không thấy giá/khu vực thì ghi "chưa rõ".

Tra ve JSON hop le voi cac key:
summary: tóm tắt 1-2 câu
price_text: giá thuê nếu có
area_text: khu vực/địa chỉ nếu có

URL: ${url}
Tin nhắn người dùng: ${sourceText}
Tieu de: ${urlInfo.title}
Mo ta: ${urlInfo.description}
Noi dung trang: ${urlInfo.plainText}
`;
  const text = await askGemini(env, prompt, {
    feature: "link_summary",
    message
  });

  try {
    const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());

    return {
      summary: String(parsed.summary || "").trim(),
      priceText: String(parsed.price_text || "").trim(),
      areaText: String(parsed.area_text || "").trim()
    };
  } catch {
    return {
      summary: text,
      priceText: "",
      areaText: ""
    };
  }
}

async function saveMessage(env, message, eventName = "message.text.received") {
  if (!env.DB) {
    return;
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      message.chat?.id || "",
      message.chat?.chat_type || "",
      message.from?.id || "",
      message.from?.display_name || "",
      message.message_id || null,
      redactSensitiveText(message.text || message.caption || ""),
      message.date || null,
      JSON.stringify(buildMessageMetadata(message, eventName))
    )
    .run();
}

async function getConversationState(env, chatId) {
  if (!env.DB || !chatId) {
    return {};
  }

  try {
    const result = await env.DB.prepare(
      `SELECT state_json
       FROM conversation_state
       WHERE chat_id = ?
       LIMIT 1`
    )
      .bind(chatId)
      .first();

    return safeJsonParse(result?.state_json, {});
  } catch (error) {
    console.error("Failed to read conversation state:", error);
    return {};
  }
}

async function saveConversationState(env, message, route, question) {
  if (!env.DB || !message.chat?.id) {
    return;
  }

  try {
    const state = {
      intent: route.intent || "",
      topic: route.topic || "",
      rewritten_question: route.rewritten_question || question || "",
      target_location: route.target_location || "",
      needs_web: Boolean(route.needs_web),
      confidence: Number(route.confidence || 0),
      last_user_text: redactSensitiveText(question),
      updated_at: new Date().toISOString()
    };

    await env.DB.prepare(
      `INSERT INTO conversation_state
        (chat_id, chat_type, user_id, user_name, intent, topic, state_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chat_id) DO UPDATE SET
         chat_type = excluded.chat_type,
         user_id = excluded.user_id,
         user_name = excluded.user_name,
         intent = excluded.intent,
         topic = excluded.topic,
         state_json = excluded.state_json,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(
        message.chat?.id || "",
        message.chat?.chat_type || "",
        message.from?.id || "",
        message.from?.display_name || "",
        route.intent || "",
        route.topic || "",
        JSON.stringify(state)
      )
      .run();
  } catch (error) {
    console.error("Failed to save conversation state:", error);
  }
}

async function saveLink(env, message, url, urlInfo, summaryInfo, sourceText = "") {
  await env.DB.prepare(
    `INSERT INTO links
      (chat_id, chat_type, user_id, user_name, message_id, url, source_text, title, description,
       summary, price_text, area_text, status, http_status, metadata_json, last_checked_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id, url) DO UPDATE SET
       source_text = excluded.source_text,
       title = excluded.title,
       description = excluded.description,
       summary = excluded.summary,
       price_text = excluded.price_text,
       area_text = excluded.area_text,
       status = excluded.status,
       http_status = excluded.http_status,
       metadata_json = excluded.metadata_json,
       last_checked_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      message.chat?.id || "",
      message.chat?.chat_type || "",
      message.from?.id || "",
      message.from?.display_name || "",
      message.message_id || null,
      url,
      redactSensitiveText(sourceText || message.text || message.caption || ""),
      urlInfo.title || "",
      urlInfo.description || "",
      redactSensitiveText(summaryInfo.summary || ""),
      redactSensitiveText(summaryInfo.priceText || ""),
      redactSensitiveText(summaryInfo.areaText || ""),
      urlInfo.status,
      urlInfo.httpStatus,
      JSON.stringify({
        ...buildMessageMetadata(message, "link.saved"),
        url_status: urlInfo.status,
        http_status: urlInfo.httpStatus
      })
    )
    .run();
}

async function getRecentLinks(env, chatId, limit = 10) {
  const result = await env.DB.prepare(
    `SELECT id, url, title, summary, price_text, area_text, status, http_status, created_at, updated_at
     FROM links
     WHERE chat_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  )
    .bind(chatId, limit)
    .all();

  return result.results || [];
}

async function getBrokenLinks(env, chatId, limit = 10) {
  const result = await env.DB.prepare(
    `SELECT id, url, title, summary, status, http_status, updated_at
     FROM links
     WHERE chat_id = ? AND status != 'ok'
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`
  )
    .bind(chatId, limit)
    .all();

  return result.results || [];
}

function formatLinkList(links) {
  if (links.length === 0) {
    return "Chưa có link nào được lưu trong chat này.";
  }

  return links
    .map((link, index) => {
      const details = [link.price_text, link.area_text].filter(Boolean).join(" | ");
      return `${index + 1}. ${link.summary || link.title || "Link thuê nhà"}${details ? ` (${details})` : ""}\n${link.url}`;
    })
    .join("\n\n");
}

async function getChatContext(env, chatId) {
  const [countsResult, messagesResult, linksResult, searchesResult, imagesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT 'messages' AS name, COUNT(*) AS total FROM messages WHERE chat_id = ?
       UNION ALL SELECT 'links' AS name, COUNT(*) AS total FROM links WHERE chat_id = ?
       UNION ALL SELECT 'searches' AS name, COUNT(*) AS total FROM searches WHERE chat_id = ?
       UNION ALL SELECT 'images' AS name, COUNT(*) AS total FROM images WHERE chat_id = ?`
    )
      .bind(chatId, chatId, chatId, chatId)
      .all(),
    env.DB.prepare(
      `SELECT user_name, text, created_at, metadata_json
       FROM messages
       WHERE chat_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 12`
    )
      .bind(chatId)
      .all(),
    env.DB.prepare(
      `SELECT url, title, summary, price_text, area_text, status, http_status, created_at, updated_at, metadata_json
       FROM links
       WHERE chat_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 12`
    )
      .bind(chatId)
      .all(),
    env.DB.prepare(
      `SELECT query, answer, sources_json, created_at, metadata_json
       FROM searches
       WHERE chat_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    )
      .bind(chatId)
      .all(),
    env.DB.prepare(
      `SELECT caption, analysis, created_at, metadata_json
       FROM images
       WHERE chat_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    )
      .bind(chatId)
      .all()
  ]);
  const counts = Object.fromEntries((countsResult.results || []).map((row) => [row.name, row.total]));

  return {
    counts: {
      messages: counts.messages || 0,
      links: counts.links || 0,
      searches: counts.searches || 0,
      images: counts.images || 0
    },
    messages: messagesResult.results || [],
    links: linksResult.results || [],
    searches: (searchesResult.results || []).map((row) => ({
      ...row,
      sources: safeJsonParse(row.sources_json, [])
    })),
    images: imagesResult.results || []
  };
}

async function getGlobalContext(env) {
  const [countsResult, chatsResult, messagesResult, linksResult, searchesResult, imagesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT 'messages' AS name, COUNT(*) AS total FROM messages
       UNION ALL SELECT 'links' AS name, COUNT(*) AS total FROM links
       UNION ALL SELECT 'searches' AS name, COUNT(*) AS total FROM searches
       UNION ALL SELECT 'images' AS name, COUNT(*) AS total FROM images`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, chat_type, COUNT(*) AS message_count, MAX(created_at) AS last_message_at
       FROM messages
       GROUP BY chat_id, chat_type
       ORDER BY datetime(last_message_at) DESC
       LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, chat_type, user_name, text, created_at, metadata_json
       FROM messages
       ORDER BY datetime(created_at) DESC
       LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, chat_type, url, title, summary, price_text, area_text, status, http_status, created_at, updated_at, metadata_json
       FROM links
       ORDER BY datetime(updated_at) DESC
       LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, user_name, query, answer, sources_json, created_at, metadata_json
       FROM searches
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, user_name, caption, analysis, created_at, metadata_json
       FROM images
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    ).all()
  ]);
  const counts = Object.fromEntries((countsResult.results || []).map((row) => [row.name, row.total]));

  return {
    scope: "global",
    counts: {
      messages: counts.messages || 0,
      links: counts.links || 0,
      searches: counts.searches || 0,
      images: counts.images || 0
    },
    chats: chatsResult.results || [],
    messages: messagesResult.results || [],
    links: linksResult.results || [],
    searches: (searchesResult.results || []).map((row) => ({
      ...row,
      sources: safeJsonParse(row.sources_json, [])
    })),
    images: imagesResult.results || []
  };
}

function formatChatContextFallback(context, scopeLabel = "nhóm này") {
  const lines = [
    `Trong ${scopeLabel} bot đã lưu: ${context.counts.messages} tin nhắn, ${context.counts.links} link, ${context.counts.searches} câu search, ${context.counts.images} ảnh.`
  ];

  if (context.chats?.length > 0) {
    lines.push(
      `\nChat có dữ liệu:\n${context.chats
        .slice(0, 5)
        .map((chat, index) => `${index + 1}. ${chat.chat_type || "CHAT"}: ${chat.message_count} tin nhắn`)
        .join("\n")}`
    );
  }

  if (context.links.length > 0) {
    lines.push(`\nLink gần nhất:\n${formatLinkList(context.links.slice(0, 5))}`);
  } else {
    lines.push(`\nChưa có link thuê nhà nào được lưu trong ${scopeLabel}.`);
  }

  if (context.messages.length > 0) {
    lines.push(
      `\nTin nhắn gần nhất:\n${context.messages
        .slice(0, 5)
        .map((message, index) => `${index + 1}. ${message.user_name || "Người dùng"}: ${limitText(message.text, 90)}`)
        .join("\n")}`
    );
  }

  if (context.images.length > 0) {
    lines.push(
      `\nẢnh gần nhất:\n${context.images
        .slice(0, 3)
        .map((image, index) => `${index + 1}. ${image.caption || image.analysis || "Ảnh không có caption"}`)
        .join("\n")}`
    );
  }

  return limitText(lines.join("\n"));
}

async function answerContextQuestion(env, message, question) {
  const chatId = message.chat?.id || "";
  const canViewGlobal = isPrivateChat(message) && isOwnerMessage(env, message);
  const context = canViewGlobal ? await getGlobalContext(env) : await getChatContext(env, chatId);
  const scopeLabel = canViewGlobal ? "tất cả chat/group" : isPrivateChat(message) ? "chat riêng này" : "nhóm này";

  if (isPrivateChat(message) && !canViewGlobal && getOwnerUserIds(env).length > 0) {
    return "Tin nhắn riêng chỉ cho admin xem tổng dữ liệu. Tài khoản này chưa nằm trong OWNER_ZALO_USER_IDS.";
  }

  if (!env.GEMINI_API_KEY) {
    return formatChatContextFallback(context, scopeLabel);
  }

  const compactContext = {
    scope: scopeLabel,
    counts: context.counts,
    chats: context.chats || [],
    recent_messages: context.messages.map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      user: row.user_name,
      text: redactSensitiveText(row.text),
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_links: context.links.map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      url: row.url,
      title: row.title,
      summary: row.summary,
      price: row.price_text,
      area: row.area_text,
      status: row.status,
      updated_at: row.updated_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_searches: context.searches.map((row) => ({
      chat_id: row.chat_id,
      query: row.query,
      answer: row.answer,
      sources: row.sources,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_images: context.images.map((row) => ({
      chat_id: row.chat_id,
      caption: row.caption,
      analysis: row.analysis,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    }))
  };
  const prompt = `
Bạn là bot quản lý thông tin trong Zalo.
Trả lời ngắn gọn bằng tiếng Việt có dấu.
Hãy dựa trên context đã lưu trong D1: messages, links, searches, images và metadata_json.
Nếu người dùng hỏi có thông tin/dữ liệu chưa, hãy nói rõ phạm vi context, số lượng và tóm tắt những gì bot đang biết.
Không lặp lại token, secret, api key, hay nội dung nhạy cảm nếu thấy trong context.
Nếu chưa có dữ liệu, hãy hướng dẫn gửi link/ảnh/câu hỏi để bot thu thập.

Câu hỏi: ${question}

Context JSON:
${JSON.stringify(compactContext).slice(0, 14000)}
`;

  try {
    return limitText(
      await askGemini(env, prompt, {
        feature: "context_answer",
        message
      })
    );
  } catch (error) {
    console.error(error);
    return formatChatContextFallback(context, scopeLabel);
  }
}

function buildConversationContext(context, scopeLabel) {
  return {
    scope: scopeLabel,
    counts: context.counts,
    chats: context.chats || [],
    recent_messages: context.messages.slice(0, 10).map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      user: row.user_name,
      text: redactSensitiveText(row.text),
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_links: context.links.slice(0, 10).map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      url: row.url,
      title: row.title,
      summary: row.summary,
      price: row.price_text,
      area: row.area_text,
      status: row.status,
      updated_at: row.updated_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_searches: context.searches.slice(0, 6).map((row) => ({
      chat_id: row.chat_id,
      query: row.query,
      answer: row.answer,
      sources: row.sources,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_images: context.images.slice(0, 6).map((row) => ({
      chat_id: row.chat_id,
      caption: row.caption,
      analysis: row.analysis,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    }))
  };
}

async function getVisibleContext(env, message) {
  const canViewGlobal = isPrivateChat(message) && isOwnerMessage(env, message);
  const context = canViewGlobal ? await getGlobalContext(env) : await getChatContext(env, message.chat?.id || "");
  const scopeLabel = canViewGlobal ? "tất cả chat/group" : isPrivateChat(message) ? "chat riêng này" : "nhóm này";

  return { context, scopeLabel, canViewGlobal };
}

function normalizeRouteIntent(intent) {
  const normalized = normalizeText(intent).replace(/[^a-z0-9_]+/g, "_");
  const allowed = new Set([
    "weather",
    "live_search",
    "rental_search",
    "context_summary",
    "broken_links",
    "help",
    "general_chat",
    "small_talk",
    "ignore"
  ]);

  return allowed.has(normalized) ? normalized : "general_chat";
}

async function inferConversationRoute(env, message, question) {
  if (!env.GEMINI_API_KEY || !question.trim()) {
    return null;
  }

  const { context, scopeLabel } = await getVisibleContext(env, message);
  const compactContext = buildConversationContext(context, scopeLabel);
  const previousState = await getConversationState(env, message.chat?.id || "");
  const prompt = `
Bạn là bộ định tuyến ý định cho Zalo bot. Chỉ trả về JSON hợp lệ, không viết giải thích.
Nhiệm vụ: đọc tin nhắn mới, state cũ và context gần nhất để hiểu người dùng đang muốn gì như một người đang nói chuyện tự nhiên.

Intent hợp lệ:
- weather: hỏi thời tiết/dự báo/mưa/nóng/lạnh.
- live_search: hỏi thông tin mới cần web, tin tức, giá vàng, tỷ giá, lịch, sự kiện hiện tại.
- rental_search: tìm nhà/phòng/căn hộ/thuê nhà/kiểm tra link thuê nhà.
- context_summary: hỏi bot đã lưu/thu thập/biết bao nhiêu/có dữ liệu gì trong chat/group.
- broken_links: hỏi link lỗi/hỏng/chết.
- help: hỏi cách dùng bot.
- general_chat: câu hỏi chung, hỏi tiếp, giải thích, tư vấn.
- small_talk: chào hỏi/nói chuyện nhẹ.
- ignore: tin vô nghĩa không cần trả lời dài.

Quy tac:
- Nếu tin mới ngắn/cụt như "cái đó sao", "rồi sao", "ở đâu", hãy mở rộng bằng state cũ và recent_messages.
- Nếu tin mới chỉ là địa điểm và state cũ/recent_messages là weather, chọn weather và viết lại câu hỏi đầy đủ.
- Nếu nhắc "KEY_Dashboard" thì không xử lý ở router vì code riêng đã xử lý bảo mật.
- Không bao giờ đưa token, secret, api key vào rewritten_question.
- needs_web=true cho weather/live_search và rental_search khi cần tìm trên internet.
- confidence từ 0 đến 1.

Trả về đúng JSON schema:
{
  "intent": "general_chat",
  "confidence": 0.8,
  "topic": "chủ đề ngắn",
  "rewritten_question": "câu hỏi đã viết lại đầy đủ bằng tiếng Việt có dấu",
  "target_location": "",
  "needs_web": false,
  "reason": "lý do rất ngắn"
}

Tin nhắn mới: ${redactSensitiveText(question)}
Chat scope: ${scopeLabel}
State cũ JSON:
${JSON.stringify(previousState).slice(0, 3000)}
Context gần nhất JSON:
${JSON.stringify(compactContext).slice(0, 12000)}
`;

  try {
    const text = await askGemini(env, prompt, {
      feature: "intent_router",
      message
    });
    const parsed = parseJsonFromText(text, null);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      intent: normalizeRouteIntent(parsed.intent),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
      topic: truncateForDb(parsed.topic || "", 160),
      rewritten_question: truncateForDb(parsed.rewritten_question || question, 600),
      target_location: truncateForDb(parsed.target_location || "", 180),
      needs_web: Boolean(parsed.needs_web),
      reason: truncateForDb(parsed.reason || "", 240)
    };
  } catch (error) {
    console.error("Intent router failed:", error);
    return null;
  }
}

async function answerGeneralQuestion(env, message, question) {
  const { context, scopeLabel } = await getVisibleContext(env, message);

  if (isWeatherQuestion(question)) {
    try {
      return await answerWeatherQuestion(env, message, question);
    } catch (error) {
      console.error(error);
      return "Mình chưa lấy được thời tiết lúc này. Bạn gửi lại địa điểm cụ thể hơn nhé, ví dụ: thời tiết Quận 12 TP HCM.";
    }
  }

  if (isLiveInfoQuestion(question)) {
    try {
      const query = enrichLiveQuery(env, question);
      const result = await searchWeb(env, query, message);
      await saveSearch(env, message, query, result.answer, result.sources);
      return result.answer || "Chưa tìm được thông tin mới phù hợp.";
    } catch (error) {
      console.error(error);
    }
  }

  if (!env.GEMINI_API_KEY) {
    return `${formatChatContextFallback(context, scopeLabel)}\n\nChưa có Gemini nên bot chưa trả lời hỏi đáp tự nhiên được.`;
  }

  const compactContext = buildConversationContext(context, scopeLabel);
  const prompt = `
Bạn là trợ lý Zalo nói chuyện tự nhiên như một người bình thường, nhưng ngắn gọn và hữu ích.
Trả lời bằng tiếng Việt có dấu.
Nếu câu hỏi liên quan đến dữ liệu nhóm/chat, hãy dựa vào Context JSON.
Nếu câu hỏi là kiến thức chung, hãy trả lời theo hiểu biết của bạn.
Nếu câu hỏi cần dữ liệu thời gian thực mà web search không có kết quả trong context, hãy nói rõ cần search lại hoặc cần địa điểm/cụ thể hơn.
Không lặp lại token, secret, api key, hay nội dung nhạy cảm.

Câu hỏi: ${question}

Context JSON:
${JSON.stringify(compactContext).slice(0, 14000)}
`;

  try {
    return limitText(
      await askGemini(env, prompt, {
        feature: "general_answer",
        message
      })
    );
  } catch (error) {
    console.error(error);
    if (isContextQuestion(question)) {
      return formatChatContextFallback(context, scopeLabel);
    }

    return "Gemini đang lỗi hoặc hết quota nên mình chưa trả lời thông minh được lúc này. Các lệnh lưu link, dashboard và thời tiết vẫn chạy riêng.";
  }
}

function getHelpText() {
  return [
    "Lệnh bot:",
    "- Gửi link thuê nhà: bot tự lưu và tóm tắt.",
    "- Hỏi: hôm nay có link nào?",
    "- Hỏi: link nào lỗi?",
    "- Hỏi: có thông tin trong nhóm chưa?",
    "- Hỏi: thời tiết hôm nay sao?",
    "- Cài lịch thời tiết: @Bot Thu Thập atess cài gửi thời tiết 6h HCM",
    "- Xem/tắt lịch: @Bot Thu Thập atess xem cài đặt / tắt thời tiết",
    "- Hỏi tự nhiên như: cái này là gì / nên làm sao / tóm tắt giúp",
    "- Gửi ảnh bản đồ kèm caption: Tâm Ga Bình Triệu, bán kính 2km, tìm nhà dưới 10tr",
    "- Hỏi: tìm phòng dưới 5 triệu / quận 7 / gần trường..."
  ].join("\n");
}

async function answerQuestion(env, message, question) {
  const chatId = message.chat?.id;
  const normalized = normalizeText(question);

  if (!env.DB) {
    return "Chưa cấu hình database Cloudflare D1.";
  }

  if (normalized.includes("help") || normalized.includes("huong dan")) {
    return getHelpText();
  }

  if (isLiveInfoQuestion(question) && !isRentalQuestion(question)) {
    return answerGeneralQuestion(env, message, question);
  }

  if (isContextQuestion(question)) {
    return answerContextQuestion(env, message, question);
  }

  if (normalized.includes("loi") || normalized.includes("hong") || normalized.includes("die")) {
    return `Các link đang lỗi:\n${formatLinkList(await getBrokenLinks(env, chatId))}`;
  }

  const links = await getRecentLinks(env, chatId, 20);

  if (!env.GEMINI_API_KEY) {
    return `Đã có ${links.length} link gần nhất.\n${formatLinkList(links.slice(0, 8))}\n\nChưa có GEMINI_API_KEY nên bot chưa trả lời thông minh được.`;
  }

  if (links.length === 0) {
    try {
      const result = await searchWeb(env, question, message);
      await saveSearch(env, message, question, result.answer, result.sources);
      return result.answer || "Chưa tìm được kết quả phù hợp.";
    } catch (error) {
      console.error(error);
      return "Chưa có link nào để trả lời. Gemini Google Search đang lỗi/hết quota, hãy gửi link thuê nhà vào nhóm trước.";
    }
  }

  if (wantsWebSearch(question)) {
    try {
      const result = await searchWeb(env, question, message);
      await saveSearch(env, message, question, result.answer, result.sources);
      return result.answer || "Chưa tìm được kết quả phù hợp.";
    } catch (error) {
      console.error(error);
    }
  }

  const context = links
    .map((link, index) => {
      return [
        `#${index + 1}`,
        `url: ${link.url}`,
        `title: ${link.title || ""}`,
        `summary: ${link.summary || ""}`,
        `price: ${link.price_text || ""}`,
        `area: ${link.area_text || ""}`,
        `status: ${link.status || ""}`,
        `created_at: ${link.created_at || ""}`
      ].join("\n");
    })
    .join("\n\n");
  const prompt = `
Bạn là trợ lý quản lý link thuê nhà trong nhóm Zalo.
Trả lời ngắn gọn, thực dụng, bằng tiếng Việt có dấu.
Chỉ dựa vào danh sách link đã lưu bên dưới. Nếu không đủ thông tin thì nói chưa rõ.

Câu hỏi: ${question}

Danh sách link:
${context}
`;

  return limitText(
    await askGemini(env, prompt, {
      feature: "rental_answer",
      message
    })
  );
}

async function answerWithConversationRoute(env, message, question) {
  const route = await inferConversationRoute(env, message, question);

  if (!route || route.confidence < 0.35) {
    return null;
  }

  await saveConversationState(env, message, route, question);

  const rewrittenQuestion = route.rewritten_question || question;

  if (route.intent === "ignore") {
    return getReplyText(message);
  }

  if (route.intent === "help") {
    return getHelpText();
  }

  if (route.intent === "context_summary") {
    return answerContextQuestion(env, message, rewrittenQuestion);
  }

  if (route.intent === "broken_links") {
    return `Các link đang lỗi:\n${formatLinkList(await getBrokenLinks(env, message.chat?.id || ""))}`;
  }

  if (route.intent === "rental_search") {
    return answerQuestion(env, message, rewrittenQuestion);
  }

  if (["weather", "live_search", "general_chat", "small_talk"].includes(route.intent)) {
    return answerGeneralQuestion(env, message, rewrittenQuestion);
  }

  return null;
}

async function processTextMessage(env, message, eventName = "message.text.received") {
  const text = getMessageText(message);
  const urlItems = extractMessageUrlItems(message);
  const urls = urlItems.map((item) => item.url);
  const sourceText = [text, ...urlItems.filter((item) => !text.includes(item.url)).map((item) => item.url)]
    .filter(Boolean)
    .join("\n");

  await saveMessage(env, message, eventName);

  const dashboardKeyReply = answerDashboardKey(env, message);

  if (dashboardKeyReply) {
    return dashboardKeyReply;
  }

  if (!env.DB) {
    return getReplyText(message);
  }

  const settingsReply = await handleSettingsCommand(env, message, text);

  if (settingsReply) {
    return settingsReply;
  }

  if (urls.length > 0) {
    const savedLinks = [];

    for (const url of urls.slice(0, 5)) {
      const urlInfo = await fetchUrlInfo(url);
      const summaryInfo = await summarizeRentalLink(env, message, url, sourceText, urlInfo).catch((error) => {
        console.error(error);
        return {
          summary: urlInfo.title || urlInfo.description || "Đã lưu link, nhưng chưa tóm tắt được.",
          priceText: "",
          areaText: ""
        };
      });
      await saveLink(env, message, url, urlInfo, summaryInfo, sourceText);
      savedLinks.push({ url, ...urlInfo, ...summaryInfo });
    }

    const lines = savedLinks.map((link, index) => {
      const status = link.status === "ok" ? "OK" : `LỖI${link.httpStatus ? ` ${link.httpStatus}` : ""}`;
      return `${index + 1}. ${status}: ${link.summary || link.title || link.url}`;
    });

    return limitText(`Đã lưu ${savedLinks.length} link.\n${lines.join("\n")}`);
  }

  const cleanQuestion = getCleanQuestion(text, message.chat?.title || "");
  if (isWeatherQuestion(cleanQuestion || text)) {
    return answerGeneralQuestion(env, message, cleanQuestion || text);
  }

  if (await isWeatherLocationFollowUp(env, message, cleanQuestion || text)) {
    return answerGeneralQuestion(env, message, `thời tiết tại ${cleanQuestion || text}`);
  }

  const routedAnswer = await answerWithConversationRoute(env, message, cleanQuestion || text);

  if (routedAnswer) {
    return routedAnswer;
  }

  if (isRentalQuestion(text) || isRentalQuestion(cleanQuestion) || isContextQuestion(text) || isContextQuestion(cleanQuestion)) {
    return answerQuestion(env, message, cleanQuestion || text);
  }

  if (isLikelyQuestion(cleanQuestion || text)) {
    return answerGeneralQuestion(env, message, cleanQuestion || text);
  }

  if (env.GEMINI_API_KEY && cleanQuestion) {
    return answerGeneralQuestion(env, message, cleanQuestion);
  }

  return getReplyText(message);
}

function getImageMimeType(url = "") {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes(".png")) {
    return "image/png";
  }

  if (lowerUrl.includes(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks = [];

  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }

  return btoa(chunks.join(""));
}

async function downloadImageAsBase64(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 ZaloRentalBot/1.0"
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Download image failed: HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes`);
  }

  const contentType = response.headers.get("content-type") || "";
  const buffer = await response.arrayBuffer();

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${buffer.byteLength} bytes`);
  }

  return {
    data: arrayBufferToBase64(buffer),
    mimeType: contentType.startsWith("image/") ? contentType.split(";")[0] : getImageMimeType(url),
    byteLength: buffer.byteLength
  };
}

async function askGeminiImage(env, prompt, image, options = {}) {
  if (!env.GEMINI_API_KEY) {
    return "";
  }

  const model = options.model || env.GEMINI_IMAGE_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const startedAt = Date.now();
  let logged = false;

  try {
    const response = await fetch(`${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    const usage = getUsageMetadata(data);
    const errorInfo = getAiErrorInfo(data, response.status);

    await logAiUsage(env, {
      message: options.message,
      model,
      feature: options.feature || "image_analysis",
      ok: response.ok,
      httpStatus: response.status,
      errorCode: response.ok ? "" : errorInfo.code,
      errorMessage: response.ok ? "" : errorInfo.message,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs: Date.now() - startedAt,
      endpoint: "generateContent",
      inputType: "image_base64"
    });
    logged = true;

    if (!response.ok) {
      throw new Error(`Gemini image API failed: ${JSON.stringify(data)}`);
    }

    return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  } catch (error) {
    if (!logged) {
      const errorInfo = getAiErrorInfo({}, null, error);
      await logAiUsage(env, {
        message: options.message,
        model,
        feature: options.feature || "image_analysis",
        ok: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        durationMs: Date.now() - startedAt,
        endpoint: "generateContent",
        inputType: "image_base64"
      });
    }

    throw error;
  }
}

async function analyzeImage(env, message, eventName = "message.image.received") {
  const imageInfo = extractImageUrl(message);
  const photoUrl = imageInfo?.url || "";
  const caption = getMessageText(message);

  await saveMessage(env, message, eventName);

  if (!photoUrl) {
    return "Đã nhận event ảnh, nhưng webhook không có photo_url/url để tải ảnh. Hãy thử gửi lại ảnh hoặc xem dashboard metadata.";
  }

  if (!env.GEMINI_API_KEY) {
    return "Đã nhận ảnh, nhưng chưa có GEMINI_API_KEY để nhận diện.";
  }

  let imagePayload;

  try {
    imagePayload = await downloadImageAsBase64(photoUrl);
  } catch (error) {
    console.error(error);
    return `Đã thấy URL ảnh (${imageInfo?.source || "unknown"}), nhưng chưa tải được ảnh để phân tích: ${limitText(error?.message || error, 180)}`;
  }

  const prompt = `
Bạn là trợ lý thu thập thông tin thuê nhà từ ảnh người dùng gửi trong nhóm Zalo.
Hãy đọc ảnh và caption. Nếu là ảnh bản đồ, nhận diện các địa danh thấy được, vùng được khoanh, điểm trung tâm nếu có, và ước lượng khu vực. Không khẳng định bán kính km chính xác nếu ảnh không có tỷ lệ/dữ liệu tọa độ.
Nếu caption có yêu cầu tìm nhà/phòng/giá/bán kính, hãy tạo thêm gợi ý truy vấn web ngắn gọn.
Trả lời bằng tiếng Việt có dấu, ngắn gọn.

Caption: ${caption}
`;
  let answer = await askGeminiImage(env, prompt, imagePayload, {
    feature: "image_analysis",
    message
  });

  answer = answer || "Đã nhận ảnh nhưng chưa phân tích được.";

  if (wantsWebSearch(caption)) {
    try {
      const searchQuery = `${caption}\nKhu vực/ảnh: ${answer}`;
      const searchResult = await searchWeb(env, searchQuery, message);
      answer = `${answer}\n\nKết quả web:\n${searchResult.answer}`;
      await saveSearch(env, message, searchQuery, searchResult.answer, searchResult.sources);
    } catch (error) {
      console.error(error);
      answer = `${answer}\n\nChưa search web được, có thể Gemini Google Search đang hết quota.`;
    }
  }

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO images (chat_id, chat_type, user_id, user_name, message_id, photo_url, caption, analysis, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, message_id) DO UPDATE SET
         photo_url = excluded.photo_url,
         caption = excluded.caption,
         analysis = excluded.analysis,
         metadata_json = excluded.metadata_json`
    )
      .bind(
        message.chat?.id || "",
        message.chat?.chat_type || "",
        message.from?.id || "",
        message.from?.display_name || "",
        message.message_id || null,
        photoUrl,
        redactSensitiveText(caption),
        redactSensitiveText(answer),
        JSON.stringify({
          ...buildMessageMetadata(message, "image.analyzed"),
          image: {
            source: imageInfo?.source || "",
            mime_type: imagePayload.mimeType,
            byte_length: imagePayload.byteLength,
            stored_as: "url_and_analysis_only"
          }
        })
      )
      .run();
  }

  return limitText(answer);
}

async function callZaloApi(env, methodName, payload = {}) {
  if (!env.ZALO_BOT_TOKEN) {
    throw new Error("Missing ZALO_BOT_TOKEN");
  }

  const response = await fetch(`${API_BASE_URL}/bot${env.ZALO_BOT_TOKEN}/${methodName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(`Zalo API ${methodName} failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendMessage(env, chatId, text) {
  return callZaloApi(env, "sendMessage", {
    chat_id: chatId,
    text
  });
}

async function sendChatAction(env, chatId, action = "typing") {
  if (!env.ZALO_BOT_TOKEN || !chatId) {
    return null;
  }

  try {
    return await callZaloApi(env, "sendChatAction", {
      chat_id: chatId,
      action
    });
  } catch (error) {
    console.error("Zalo sendChatAction failed:", error);
    return null;
  }
}

function parseCsvValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDailyWeatherChatIds(env) {
  const configuredChatIds = parseCsvValues(env.DAILY_WEATHER_CHAT_IDS);

  if (configuredChatIds.length > 0) {
    return configuredChatIds;
  }

  return getOwnerUserIds(env);
}

function buildSystemMessage(chatId, chatType = "PRIVATE", options = {}) {
  return {
    chat: {
      id: chatId,
      chat_type: chatType,
      title: options.chatTitle || ""
    },
    from: {
      id: "system",
      display_name: "Daily Weather Scheduler"
    },
    message_id: `daily-weather-${Date.now()}-${chatId}`,
    date: Math.floor(Date.now() / 1000),
    text: ""
  };
}

function getZonedDateTimeParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    totalMinutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function scheduleTimeToMinutes(time) {
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function isWeatherScheduleDue(setting, date = new Date()) {
  const timeZone = setting.timezone || DEFAULT_TIMEZONE;
  const now = getZonedDateTimeParts(date, timeZone);
  const targetMinutes = scheduleTimeToMinutes(setting.weather_time || DEFAULT_WEATHER_TIME);

  if (targetMinutes === null || setting.last_weather_sent_date === now.date) {
    return false;
  }

  const delta = now.totalMinutes - targetMinutes;

  return delta >= 0 && delta < SCHEDULE_INTERVAL_MINUTES;
}

async function getWeatherScheduleSettings(env) {
  if (!env.DB) {
    return [];
  }

  try {
    const result = await env.DB.prepare(
      `SELECT chat_id, chat_type, chat_title, user_id, user_name, weather_enabled,
              weather_time, weather_location, timezone, last_weather_sent_date
       FROM chat_settings
       WHERE weather_enabled = 1`
    ).all();

    return result.results || [];
  } catch (error) {
    console.error("Failed to load weather schedules:", error);
    return [];
  }
}

async function markWeatherScheduleSent(env, chatId, sentDate) {
  if (!env.DB || !chatId || !sentDate) {
    return;
  }

  try {
    await env.DB.prepare(
      `UPDATE chat_settings
       SET last_weather_sent_date = ?, updated_at = CURRENT_TIMESTAMP
       WHERE chat_id = ?`
    )
      .bind(sentDate, chatId)
      .run();
  } catch (error) {
    console.error("Failed to mark weather schedule sent:", error);
  }
}

async function sendDueWeatherSchedules(env, options = {}) {
  const nowDate = new Date(options.scheduledTime || Date.now());
  const settings = await getWeatherScheduleSettings(env);
  const dueSettings = settings.filter((setting) => isWeatherScheduleDue(setting, nowDate));
  const results = [];

  for (const setting of dueSettings) {
    const timeZone = setting.timezone || DEFAULT_TIMEZONE;
    const localNow = getZonedDateTimeParts(nowDate, timeZone);
    const syntheticMessage = buildSystemMessage(setting.chat_id, setting.chat_type || "PRIVATE", {
      chatTitle: setting.chat_title || ""
    });
    const location = setting.weather_location || env.DEFAULT_WEATHER_LOCATION || DEFAULT_WEATHER_PLACE.name;

    try {
      const weatherText = await answerWeatherQuestion(env, syntheticMessage, `thời tiết ${location}`);
      await sendChatAction(env, setting.chat_id, "typing");
      await sendMessage(env, setting.chat_id, `Bản tin thời tiết ${setting.weather_time || DEFAULT_WEATHER_TIME}:\n${weatherText}`);
      await markWeatherScheduleSent(env, setting.chat_id, localNow.date);
      results.push({ chat_id: setting.chat_id, ok: true, date: localNow.date });
    } catch (error) {
      console.error("Failed to send configured weather schedule:", error);
      results.push({
        chat_id: setting.chat_id,
        ok: false,
        error: String(error?.message || error)
      });
    }
  }

  return {
    ok: results.some((result) => result.ok),
    checked: settings.length,
    due: dueSettings.length,
    sent: results.filter((result) => result.ok).length,
    results
  };
}

async function sendDailyWeather(env, options = {}) {
  const chatIds = getDailyWeatherChatIds(env);
  const location = env.DAILY_WEATHER_LOCATION || env.DEFAULT_WEATHER_LOCATION || "TP Ho Chi Minh";
  const results = [];

  if (chatIds.length === 0) {
    return {
      ok: false,
      sent: 0,
      message: "Missing DAILY_WEATHER_CHAT_IDS or OWNER_ZALO_USER_IDS",
      results
    };
  }

  for (const chatId of chatIds) {
    const syntheticMessage = buildSystemMessage(chatId, options.chatType || "PRIVATE");

    try {
      const weatherText = await answerWeatherQuestion(env, syntheticMessage, `thoi tiet ${location}`);
      const prefix = options.manual ? "Test lịch thời tiết 6h:\n" : "Bản tin thời tiết 6h sáng:\n";
      await sendChatAction(env, chatId, "typing");
      await sendMessage(env, chatId, `${prefix}${weatherText}`);
      results.push({ chat_id: chatId, ok: true });
    } catch (error) {
      console.error("Failed to send daily weather:", error);
      results.push({
        chat_id: chatId,
        ok: false,
        error: String(error?.message || error)
      });
    }
  }

  return {
    ok: results.some((result) => result.ok),
    sent: results.filter((result) => result.ok).length,
    location,
    results
  };
}

async function handleWebhook(request, env) {
  if (!env.WEBHOOK_SECRET_TOKEN) {
    return json({ message: "Server is missing WEBHOOK_SECRET_TOKEN" }, 500);
  }

  const secretToken = request.headers.get("x-bot-api-secret-token") || "";

  if (!constantTimeEqual(secretToken, env.WEBHOOK_SECRET_TOKEN)) {
    return json({ message: "Unauthorized" }, 403);
  }

  const body = await request.json().catch(() => null);
  const event = body?.result || body;
  const eventName = event?.event_name;
  const message = event?.message;

  console.log("Received Zalo event:", JSON.stringify(body));

  if (["message.text.received", "message.image.received"].includes(eventName) && message?.chat?.id) {
    try {
      await sendChatAction(env, message.chat.id, "typing");
      const reply =
        eventName === "message.image.received"
          ? await analyzeImage(env, message, eventName)
          : await processTextMessage(env, message, eventName);
      await sendMessage(env, message.chat.id, reply);
    } catch (error) {
      console.error(error);
    }
  }

  return json({ message: "Success" });
}

function authorizeAdminRequest(request, env) {
  if (!env.WEBHOOK_SECRET_TOKEN) {
    return json({ message: "Server is missing WEBHOOK_SECRET_TOKEN" }, 500);
  }

  const secretToken = request.headers.get("x-bot-api-secret-token") || "";

  if (!constantTimeEqual(secretToken, env.WEBHOOK_SECRET_TOKEN)) {
    return json({ message: "Unauthorized" }, 403);
  }

  return null;
}

function authorizeDashboardMasterKey(request, env, token) {
  const expectedToken = getDashboardMasterSecret(env);

  if (!expectedToken) {
    return json({ message: "Server is missing DASHBOARD_TOKEN" }, 500);
  }

  if (!constantTimeEqual(token, expectedToken)) {
    return json({ message: "Unauthorized" }, 403);
  }

  return null;
}

async function authorizeDashboardRequest(request, env) {
  const masterSecret = getDashboardMasterSecret(env);

  if (!masterSecret) {
    return json({ message: "Server is missing DASHBOARD_TOKEN" }, 500);
  }

  const sessionToken = request.headers.get("x-dashboard-token") || "";
  const adminToken = request.headers.get("x-bot-api-secret-token") || "";

  if (sessionToken && (await verifyDashboardSessionToken(env, sessionToken))) {
    return null;
  }

  if (adminToken && constantTimeEqual(adminToken, masterSecret)) {
    return null;
  }

  return json({ message: "Session expired" }, 403);
}

async function handleDashboardSession(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || request.headers.get("x-dashboard-token") || "").trim();
  const unauthorizedResponse = authorizeDashboardMasterKey(request, env, token);

  if (unauthorizedResponse) {
    return dashboardJson(request, await unauthorizedResponse.json(), unauthorizedResponse.status);
  }

  const session = await createDashboardSessionToken(env);

  return dashboardJson(request, {
    ok: true,
    session_token: session.token,
    expires_at: session.expiresAt,
    ttl_seconds: DASHBOARD_SESSION_TTL_SECONDS
  });
}

async function handleDashboardData(request, env) {
  const unauthorizedResponse = await authorizeDashboardRequest(request, env);

  if (unauthorizedResponse) {
    return dashboardJson(request, await unauthorizedResponse.json(), unauthorizedResponse.status);
  }

  if (!env.DB) {
    return dashboardJson(request, { ok: false, message: "Cloudflare D1 is not configured" }, 500);
  }

  const [countsResult, messagesResult, linksResult, searchesResult, imagesResult, aiStatsResult, aiUsageResult] =
    await Promise.all([
    env.DB.prepare(
      `SELECT 'messages' AS name, COUNT(*) AS total FROM messages
       UNION ALL SELECT 'links' AS name, COUNT(*) AS total FROM links
       UNION ALL SELECT 'searches' AS name, COUNT(*) AS total FROM searches
       UNION ALL SELECT 'images' AS name, COUNT(*) AS total FROM images
       UNION ALL SELECT 'ai_usage' AS name, COUNT(*) AS total FROM ai_usage`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at
       FROM messages
       ORDER BY datetime(created_at) DESC
       LIMIT 40`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, chat_type, user_name, message_id, url, source_text, title, description,
              summary, price_text, area_text, status, http_status, metadata_json, last_checked_at, created_at, updated_at
       FROM links
       ORDER BY datetime(updated_at) DESC
       LIMIT 60`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, user_name, query, answer, sources_json, metadata_json, created_at
       FROM searches
       ORDER BY datetime(created_at) DESC
       LIMIT 30`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, user_name, message_id, photo_url, caption, analysis, metadata_json, created_at
       FROM images
       ORDER BY datetime(created_at) DESC
       LIMIT 30`
    ).all(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS calls_total,
         SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS calls_ok,
         SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS calls_error,
         SUM(CASE WHEN http_status = 429 OR error_code LIKE '%RESOURCE_EXHAUSTED%' OR lower(error_message) LIKE '%quota%' THEN 1 ELSE 0 END) AS quota_errors,
         SUM(prompt_tokens) AS prompt_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(total_tokens) AS total_tokens,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS calls_24h,
         SUM(CASE WHEN ok = 0 AND created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS errors_24h,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN total_tokens ELSE 0 END) AS tokens_24h
       FROM ai_usage`
    ).all(),
    env.DB.prepare(
      `SELECT id, provider, model, feature, chat_id, chat_type, user_name, ok, http_status, error_code,
              error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at
       FROM ai_usage
       ORDER BY datetime(created_at) DESC
       LIMIT 60`
    ).all()
  ]);
  const counts = Object.fromEntries((countsResult.results || []).map((row) => [row.name, row.total]));
  const aiStats = aiStatsResult.results?.[0] || {};

  return dashboardJson(request, {
    ok: true,
    generated_at: new Date().toISOString(),
    counts: {
      messages: counts.messages || 0,
      links: counts.links || 0,
      searches: counts.searches || 0,
      images: counts.images || 0,
      ai_usage: counts.ai_usage || 0
    },
    ai_usage: {
      stats: {
        calls_total: aiStats.calls_total || 0,
        calls_ok: aiStats.calls_ok || 0,
        calls_error: aiStats.calls_error || 0,
        quota_errors: aiStats.quota_errors || 0,
        prompt_tokens: aiStats.prompt_tokens || 0,
        output_tokens: aiStats.output_tokens || 0,
        total_tokens: aiStats.total_tokens || 0,
        calls_24h: aiStats.calls_24h || 0,
        errors_24h: aiStats.errors_24h || 0,
        tokens_24h: aiStats.tokens_24h || 0
      },
      recent: (aiUsageResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      }))
    },
    recent: {
      messages: (messagesResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      })),
      links: (linksResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      })),
      searches: (searchesResult.results || []).map((row) => ({
        ...row,
        sources: safeJsonParse(row.sources_json, []),
        metadata: safeJsonParse(row.metadata_json)
      })),
      images: (imagesResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      }))
    }
  });
}

async function handleRegisterWebhook(request, env) {
  const unauthorizedResponse = authorizeAdminRequest(request, env);

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhook`;
  const data = await callZaloApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.WEBHOOK_SECRET_TOKEN
  });

  return json(data);
}

async function handleTestWebhook(request, env) {
  const unauthorizedResponse = authorizeAdminRequest(request, env);

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const data = await callZaloApi(env, "testWebhook");

  return json(data);
}

async function handleSendDailyWeather(request, env) {
  const unauthorizedResponse = authorizeAdminRequest(request, env);

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  return json(await sendDailyWeather(env, { manual: true }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "hehehe1341221-zalo-webhook",
        webhook_paths: ["/webhook", "/webhooks"]
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    if (request.method === "POST" && ["/webhook", "/webhooks"].includes(url.pathname)) {
      return handleWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/register-webhook") {
      return handleRegisterWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/test-webhook") {
      return handleTestWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/send-daily-weather") {
      return handleSendDailyWeather(request, env);
    }

    if (request.method === "OPTIONS" && ["/admin/dashboard-data", "/admin/dashboard-session"].includes(url.pathname)) {
      return new Response(null, {
        status: 204,
        headers: getDashboardCorsHeaders(request)
      });
    }

    if (request.method === "POST" && url.pathname === "/admin/dashboard-session") {
      return handleDashboardSession(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin/dashboard-data") {
      return handleDashboardData(request, env);
    }

    return json({ message: "Not Found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      sendDueWeatherSchedules(env, { scheduledTime: event.scheduledTime }).catch((error) => {
        console.error("Scheduled weather settings failed:", error);
      })
    );
  }
};
