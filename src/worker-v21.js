import workerV18 from "./worker-v18.js";
import { getPayload } from "./worker-v15.js";
import { createScopedDb } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { searchCommonsImages } from "./worker-v19.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const FALLBACK_IMAGE_QUERY = "friendly virtual assistant portrait";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function normalizeText(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

function isPrivateChat(message) {
  return normalizeText(message?.chat?.chat_type || "").includes("private");
}

function hasMention(message, text) {
  if (/@\S+/u.test(String(text || ""))) return true;
  const mentions = message?.mentions || message?.mention || message?.entities || message?.message_entities;
  if (Array.isArray(mentions) && mentions.length) return true;
  return Boolean(mentions && typeof mentions === "object" && Object.keys(mentions).length);
}

function isImageReferenceQuestion(text) {
  const normalized = normalizeText(text);
  if (!/\b(anh|hinh|photo|image)\b/.test(normalized)) return false;
  if (/^(?:@\S+\s+)?(gui|cho|tim|kiem|lay|send)\b/.test(normalized)) return false;
  return /\b(anh|hinh)\s+(nay|do|kia)\b/.test(normalized) || /\b(la ai|la gi|cua ai|sao|tai sao|vi sao|ma gui|gui vay)\b/.test(normalized);
}

function isContextualImageRequest(text) {
  const normalized = normalizeText(text);
  if (!normalized || isImageReferenceQuestion(text)) return false;
  return (
    /^(?:@\S+\s+)?(gui|cho|tim|kiem|lay|send)\b.{0,40}\b(anh|hinh|photo|image)\b/.test(normalized) ||
    /^(?:@\S+\s+)?(anh|hinh|photo|image)\b.{0,40}\b(gui|cho|tim|kiem|lay|xem|coi|send)\b/.test(normalized) ||
    /^(?:@\S+\s+)?(anh|hinh)\s+\S+/.test(normalized) ||
    /^(?:@\S+\s+)?gui\s+a(?:\s+a)?\s+(xem|coi)\b/.test(normalized) ||
    /^(?:@\S+\s+)?cho\s+a\s+(xem|coi)\b/.test(normalized) ||
    /^(?:@\S+\s+)?a\s+dau\b/.test(normalized) ||
    /^(?:@\S+\s+)?(kiem|tim|lay|gui)\s+dai\b.{0,24}\b(anh|hinh)\b/.test(normalized)
  );
}

function cleanExplicitImageQuery(text) {
  const normalizedOriginal = normalizeText(text);
  const shorthandA = /\bgui\s+a(?:\s+a)?\s+(xem|coi)\b/.test(normalizedOriginal) || /\ba\s+dau\b/.test(normalizedOriginal);
  const stop = new Set([
    "gui", "send", "cho", "lay", "tim", "kiem", "giup", "minh", "toi", "em",
    "anh", "hinh", "photo", "image", "tren", "mang", "web", "xem", "coi", "di",
    "nha", "nhe", "dau", "dai", "voi"
  ]);

  const kept = String(text || "")
    .replace(/@\S+/gu, " ")
    .replace(/[!?.,:;~]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const normalized = normalizeText(token);
      if (!normalized) return false;
      if (shorthandA && normalized === "a") return false;
      return !stop.has(normalized);
    });

  const value = kept.join(" ").trim();
  const normalized = normalizeText(value);
  if (!normalized || /^(a|ma|roi|thoi|nay|do|kia)(\s+(a|ma|roi|thoi|nay|do|kia))*$/.test(normalized)) return "";
  return value;
}

function personaImageQuery(profile = {}) {
  const gender = normalizeText(profile.gender || "");
  const persona = normalizeText(profile.persona || "");
  if (/(nu|female|con gai|co gai)/.test(gender) || /(nu|female|co gai)/.test(persona)) return "adult woman portrait fashion";
  if (/(nam|male|con trai|chang trai)/.test(gender) || /(nam|male|chang trai)/.test(persona)) return "adult man portrait";
  return FALLBACK_IMAGE_QUERY;
}

function topicFromText(text, profile = {}) {
  const normalized = normalizeText(text);
  const rules = [
    [/(cay coi|cay xanh|thien nhien|rung|forest|tree)/, "trees nature"],
    [/(con meo|meo|cat)/, "cat"],
    [/(con cho|dog|puppy)/, "dog"],
    [/(sai gon|tp hcm|ho chi minh)/, "Ho Chi Minh City"],
    [/(da lat|dalat)/, "Da Lat Vietnam"],
    [/(bien|bai bien|beach)/, "beach landscape"],
    [/(hoa hong|flower|flowers)/, "flowers"],
    [/(xe hoi|oto|o to|car)/, "car"],
    [/(can ho|chung cu|apartment)/, "apartment interior"],
    [/(nha dep|house|home)/, "beautiful house"],
    [/(do ho|quan ao|thoi trang|fashion|mac do|vay|dam|ao)/, "adult fashion portrait"],
    [/(mon an|do an|food|an gi)/, "Vietnamese food"],
    [/(bong da|football|soccer)/, "football match"],
    [/(phong canh|landscape)/, "beautiful landscape"]
  ];
  for (const [pattern, query] of rules) if (pattern.test(normalized)) return query;
  if (/(em mac|em dep|anh em|hinh em|mat em|ngoai hinh|xem em)/.test(normalized)) return personaImageQuery(profile);
  return "";
}

function resolveContextualImageQuery(text, context = {}) {
  const profile = context.profile || {};
  const explicit = cleanExplicitImageQuery(text);
  if (explicit) return { query: topicFromText(explicit, profile) || explicit, reason: "explicit" };
  for (const row of context.recent || []) {
    const query = topicFromText(row?.text || "", profile);
    if (query) return { query, reason: "recent_context" };
  }
  for (const row of context.memories || []) {
    const query = topicFromText(`${row?.topic || ""} ${row?.summary || ""}`, profile);
    if (query) return { query, reason: "memory" };
  }
  return { query: personaImageQuery(profile), reason: "persona" };
}

async function safeAll(db, sql, binds = []) {
  if (!db?.prepare) return [];
  try {
    let stmt = db.prepare(sql);
    if (binds.length) stmt = stmt.bind(...binds);
    return (await stmt.all()).results || [];
  } catch (error) {
    console.error("V21 image context query failed:", error);
    return [];
  }
}

async function loadImageContext(db, message) {
  const chatId = String(message.chat?.id || "");
  const userId = String(message.from?.id || "");
  const [profiles, recent, memories] = await Promise.all([
    safeAll(db, `SELECT display_name, gender, age, speaking_style, persona FROM bot_profile WHERE id = 'default' LIMIT 1`),
    safeAll(db, `SELECT user_id, user_name, text, created_at FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) DESC LIMIT 18`, [chatId]),
    safeAll(db, `SELECT topic, summary FROM chat_memories WHERE (chat_id = ? OR user_id = ? OR scope = 'global') AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) ORDER BY importance DESC, datetime(updated_at) DESC LIMIT 10`, [chatId, userId])
  ]);
  return { profile: profiles[0] || {}, recent, memories };
}

async function saveTurn(db, connection, payload, text, role = "user", metadata = {}) {
  if (!db?.prepare) return;
  const message = payload.message;
  const isBot = role === "assistant";
  const messageId = isBot
    ? `bot:${connection.id}:${message.message_id || crypto.randomUUID()}:${metadata.kind || "reply"}`
    : String(message.message_id || crypto.randomUUID());
  await db.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    isBot ? `__bot__:${connection.id}` : String(message.from?.id || ""),
    isBot ? String(connection.displayName || "Bot") : String(message.from?.display_name || ""),
    messageId,
    String(text || "").slice(0, 4000),
    isBot ? Math.floor(Date.now() / 1000) : Number(message.date || 0),
    JSON.stringify({ source: "image-context-v21", connection_id: connection.id, role, ...metadata })
  ).run().catch(() => {});
}

async function sendPhoto(connection, chatId, photo, caption = "") {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), photo, ...(caption ? { caption: caption.slice(0, 1900) } : {}) }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo sendPhoto HTTP ${response.status}`);
  return data;
}

async function sendMessage(connection, chatId, text) {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text: String(text).slice(0, 1900) }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo sendMessage HTTP ${response.status}`);
  return data;
}

async function logSearch(env, connection, message, query, image, reason, error = "") {
  if (!env?.DB?.prepare) return;
  await env.DB.prepare(
    `INSERT INTO searches (chat_id, user_id, user_name, query, answer, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    String(message.chat?.id || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    `[image-context:${reason}] ${query}`,
    image ? image.url : error || "image_search_failed",
    JSON.stringify(image ? [{ title: image.title || "Wikimedia Commons", url: image.originalUrl || image.url, connection_id: connection.id }] : [])
  ).run().catch(() => {});
}

function randomIndex(max) {
  if (max <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

async function handleContextualImageRequest(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;
  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received" || !isContextualImageRequest(payload.text)) return null;
  if (!(isPrivateChat(payload.message) || hasMention(payload.message, payload.text))) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const db = createScopedDb(env.DB, {
    connectionId: connection.id,
    chatId: String(payload.message.chat?.id || ""),
    userId: String(payload.message.from?.id || ""),
    messageId: String(payload.message.message_id || ""),
    mode: "request"
  });
  const context = await loadImageContext(db, payload.message);
  const resolved = resolveContextualImageQuery(payload.text, context);
  const query = resolved.query || FALLBACK_IMAGE_QUERY;
  await saveTurn(db, connection, payload, payload.text, "user", { kind: "image_request" });

  if (/(porn|sex|nude|nudity|khoa than|18\+|hentai|child porn|tre em khoa than)/i.test(normalizeText(query))) {
    await sendMessage(connection, payload.message.chat.id, "Mình không tìm/gửi ảnh nhạy cảm kiểu đó. Đổi chủ đề ảnh khác nhé.");
    return json({ message: "Success", provider: "image-context-v21", blocked: true });
  }

  try {
    let images = await searchCommonsImages(query);
    if (!images.length) images = await searchCommonsImages(personaImageQuery(context.profile));
    if (!images.length) images = await searchCommonsImages(FALLBACK_IMAGE_QUERY);
    if (!images.length) throw new Error("no_results");

    const start = randomIndex(images.length);
    let lastError = null;
    for (let offset = 0; offset < Math.min(images.length, 8); offset += 1) {
      const image = images[(start + offset) % images.length];
      try {
        const caption = `📷 Ảnh minh họa theo ngữ cảnh: ${query}\nNguồn: Wikimedia Commons`;
        await sendPhoto(connection, payload.message.chat.id, image.url, caption);
        await saveTurn(
          db,
          connection,
          payload,
          `[Ảnh web đã gửi] Chủ đề: ${query}. Ảnh: ${image.title || "Wikimedia Commons"}. Nguồn: Wikimedia Commons.`,
          "assistant",
          { kind: "image", image_url: image.url }
        );
        await logSearch(env, connection, payload.message, query, image, resolved.reason);
        return json({ message: "Success", provider: "image-context-v21", found: true, query, context_reason: resolved.reason });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("send_photo_failed");
  } catch (error) {
    await logSearch(env, connection, payload.message, query, null, resolved.reason, String(error?.message || error));
    await sendMessage(connection, payload.message.chat.id, "Mình đã hiểu ảnh theo ngữ cảnh nhưng nguồn ảnh/Zalo đang lỗi. Thử lại sau chút nha.").catch(() => {});
    return json({ message: "Success", provider: "image-context-v21", found: false, error: String(error?.message || error) });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleContextualImageRequest(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V21 image context router failed:", error);
    }
    return workerV18.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof workerV18.scheduled === "function") return workerV18.scheduled(event, env, ctx);
  }
};

export {
  cleanExplicitImageQuery,
  handleContextualImageRequest,
  isContextualImageRequest,
  isImageReferenceQuestion,
  normalizeText,
  personaImageQuery,
  resolveContextualImageQuery,
  topicFromText
};
