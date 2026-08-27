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
  if (Array.isArray(mentions) && mentions.length > 0) return true;
  return Boolean(mentions && typeof mentions === "object" && Object.keys(mentions).length > 0);
}

function shouldRespondInChat(message, text) {
  return isPrivateChat(message) || hasMention(message, text);
}

function isUnsafeImageQuery(text) {
  const normalized = normalizeText(text);
  return /(porn|sex|nude|nudity|khoa than|18\+|hentai|child porn|tre em khoa than)/i.test(normalized);
}

function isImageReferenceQuestion(text) {
  const normalized = normalizeText(text);
  const hasImageWord = /\b(anh|hinh|photo|image)\b/.test(normalized);
  if (!hasImageWord) return false;

  const startsAsCommand = /^(?:@\S+\s+)?(gui|cho|tim|kiem|lay|send)\b/.test(normalized);
  if (startsAsCommand) return false;

  return (
    /\b(anh|hinh)\s+(nay|do|kia)\b/.test(normalized) ||
    /\b(la ai|la gi|cua ai|sao|tai sao|vi sao|ma gui|gui vay|gui cai gi)\b/.test(normalized)
  );
}

function isContextualImageRequest(text) {
  const normalized = normalizeText(text);
  if (!normalized || isImageReferenceQuestion(text)) return false;

  if (/^(?:@\S+\s+)?(gui|cho|tim|kiem|lay|send)\b.{0,36}\b(anh|hinh|photo|image)\b/.test(normalized)) return true;
  if (/^(?:@\S+\s+)?(anh|hinh|photo|image)\b.{0,36}\b(gui|cho|tim|kiem|lay|xem|coi|send)\b/.test(normalized)) return true;
  if (/^(?:@\S+\s+)?(anh|hinh)\s+\S+/.test(normalized)) return true;

  // Vietnamese shorthand: "a" means ảnh only in explicit command shapes.
  if (/^(?:@\S+\s+)?gui\s+a(?:\s+a)?\s+(xem|coi)\b/.test(normalized)) return true;
  if (/^(?:@\S+\s+)?cho\s+a\s+(xem|coi)\b/.test(normalized)) return true;
  if (/^(?:@\S+\s+)?a\s+dau\b/.test(normalized)) return true;
  if (/^(?:@\S+\s+)?(kiem|tim|lay|gui)\s+dai\b.{0,24}\b(anh|hinh)\b/.test(normalized)) return true;

  return false;
}

function cleanExplicitImageQuery(text) {
  let value = String(text || "").trim();
  const normalizedOriginal = normalizeText(value);
  value = value.replace(/@\S+/gu, " ");
  value = value.replace(/\b(gửi|gui|send|cho|lấy|lay|tìm|tim|kiếm|kiem|giúp|giup|mình|minh|tôi|toi|em)\b/giu, " ");
  value = value.replace(/\b(ảnh|anh|hình|hinh|photo|image|trên mạng|tren mang|trên web|tren web|web|mạng|mang)\b/giu, " ");
  value = value.replace(/\b(xem|coi|đi|di|nha|nhé|nhe|đâu|dau|đại|dai|với|voi)\b/giu, " ");
  if (/\bgui\s+a(?:\s+a)?\s+(xem|coi)\b/.test(normalizedOriginal) || /\ba\s+dau\b/.test(normalizedOriginal)) {
    value = value.replace(/\ba\b/giu, " ");
  }
  value = value.replace(/[!?.,:;~]+/g, " ").replace(/\s+/g, " ").trim();

  const normalized = normalizeText(value);
  const fillerOnly = !normalized || /^(anh|a|xem|coi|di|nha|nhe|dau|ma|roi|thoi|nay|do|kia)(\s+(anh|a|xem|coi|di|nha|nhe|dau|ma|roi|thoi|nay|do|kia))*$/.test(normalized);
  return fillerOnly ? "" : value;
}

function topicFromText(text, profile = {}) {
  const original = String(text || "");
  const normalized = normalizeText(original);
  if (!normalized) return "";

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

  for (const [pattern, query] of rules) {
    if (pattern.test(normalized)) return query;
  }

  // If the conversation is about the bot's appearance/persona, use the bot profile instead
  // of a random unrelated picture. This is always presented as an illustration, not a real photo.
  if (/(em mac|em dep|anh em|hinh em|mat em|ngoai hinh|xem em)/.test(normalized)) {
    return personaImageQuery(profile);
  }

  return "";
}

function personaImageQuery(profile = {}) {
  const gender = normalizeText(profile.gender || "");
  const persona = normalizeText(profile.persona || "");
  if (/(nu|female|con gai|co gai)/.test(gender) || /(nu|female|co gai)/.test(persona)) return "adult woman portrait fashion";
  if (/(nam|male|con trai|chang trai)/.test(gender) || /(nam|male|chang trai)/.test(persona)) return "adult man portrait";
  return FALLBACK_IMAGE_QUERY;
}

async function safeAll(db, sql, binds = []) {
  if (!db?.prepare) return [];
  try {
    let stmt = db.prepare(sql);
    if (binds.length) stmt = stmt.bind(...binds);
    return (await stmt.all()).results || [];
  } catch (error) {
    console.error("V20 context query failed:", error);
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

function resolveContextualImageQuery(text, context = {}) {
  const explicit = cleanExplicitImageQuery(text);
  const profile = context.profile || {};

  if (explicit) {
    return {
      query: topicFromText(explicit, profile) || explicit,
      reason: "explicit"
    };
  }

  // Prefer the latest meaningful conversation topic. Bot output rows are also considered
  // when available, so shorthand such as "gửi a xem đi" can resolve what "a" refers to.
  for (const row of context.recent || []) {
    const candidate = topicFromText(row?.text || "", profile);
    if (candidate) return { query: candidate, reason: "recent_context" };
  }

  for (const row of context.memories || []) {
    const candidate = topicFromText(`${row?.topic || ""} ${row?.summary || ""}`, profile);
    if (candidate) return { query: candidate, reason: "memory" };
  }

  return { query: personaImageQuery(profile), reason: "persona" };
}

async function saveIncoming(db, connectionId, payload) {
  if (!db?.prepare) return;
  const message = payload.message;
  await db.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(message.message_id || crypto.randomUUID()),
    String(payload.text || "").slice(0, 4000),
    Number(message.date || 0),
    JSON.stringify({ source: "image-context-v20", connection_id: connectionId })
  ).run().catch(() => {});
}

async function saveOutgoingImageContext(db, connection, payload, query, image) {
  if (!db?.prepare) return;
  const message = payload.message;
  const botName = connection.displayName || "Bot";
  const syntheticMessageId = `bot:${connection.id}:${message.message_id || crypto.randomUUID()}:image`;
  const text = `[Ảnh web đã gửi] Chủ đề: ${query}. Ảnh: ${image?.title || "Wikimedia Commons"}. Nguồn: Wikimedia Commons.`;
  await db.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    `__bot__:${connection.id}`,
    botName,
    syntheticMessageId,
    text.slice(0, 4000),
    Math.floor(Date.now() / 1000),
    JSON.stringify({ source: "image-context-v20", connection_id: connection.id, role: "assistant", image_url: image?.url || "" })
  ).run().catch(() => {});
}

async function sendPhoto(connection, chatId, photo, caption = "") {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId),
      photo,
      ...(caption ? { caption: caption.slice(0, 1900) } : {})
    }),
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

async function logImageSearch(env, connectionId, message, query, image, ok, reason = "", error = "") {
  if (!env?.DB?.prepare) return;
  try {
    await env.DB.prepare(
      `INSERT INTO searches (chat_id, user_id, user_name, query, answer, sources_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      String(message?.chat?.id || ""),
      String(message?.from?.id || ""),
      String(message?.from?.display_name || ""),
      `[image-context:${reason}] ${query}`,
      ok ? String(image?.url || "") : String(error || "image_search_failed"),
      JSON.stringify(ok && image ? [{ title: image.title || "Wikimedia Commons", url: image.originalUrl || image.url, connection_id: connectionId }] : [])
    ).run();
  } catch (logError) {
    console.error("V20 image search log failed:", logError);
  }
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
  if (!shouldRespondInChat(payload.message, payload.text)) return null;

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

  await saveIncoming(db, connection.id, payload);

  if (isUnsafeImageQuery(query)) {
    await sendMessage(connection, payload.message.chat.id, "Mình không tìm/gửi ảnh nhạy cảm kiểu đó. Đổi chủ đề ảnh khác nhé.");
    return json({ message: "Success", provider: "image-context-v20", blocked: true });
  }

  try {
    let images = await searchCommonsImages(query);
    if (!images.length && query !== personaImageQuery(context.profile)) {
      images = await searchCommonsImages(personaImageQuery(context.profile));
    }
    if (!images.length) images = await searchCommonsImages(FALLBACK_IMAGE_QUERY);

    if (!images.length) {
      await sendMessage(connection, payload.message.chat.id, "Mình hiểu ngữ cảnh ảnh rồi nhưng nguồn ảnh web chưa trả kết quả lúc này. Thử lại sau chút nha.");
      await logImageSearch(env, connection.id, payload.message, query, null, false, resolved.reason, "no_results");
      return json({ message: "Success", provider: "image-context-v20", found: false });
    }

    const start = randomIndex(images.length);
    let lastError = null;
    for (let offset = 0; offset < Math.min(images.length, 8); offset += 1) {
      const image = images[(start + offset) % images.length];
      try {
        const caption = `📷 Ảnh minh họa theo ngữ cảnh: ${query}\nNguồn: Wikimedia Commons`;
        await sendPhoto(connection, payload.message.chat.id, image.url, caption);
        await saveOutgoingImageContext(db, connection, payload, query, image);
        await logImageSearch(env, connection.id, payload.message, query, image, true, resolved.reason);
        return json({
          message: "Success",
          provider: "image-context-v20",
          found: true,
          query,
          context_reason: resolved.reason,
          source: "wikimedia_commons"
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Không gửi được ảnh từ các kết quả tìm kiếm.");
  } catch (error) {
    console.error("V20 contextual image request failed:", error);
    await logImageSearch(env, connection.id, payload.message, query, null, false, resolved.reason, String(error?.message || error));
    await sendMessage(connection, payload.message.chat.id, "Mình đã hiểu ảnh bạn đang nói theo ngữ cảnh, nhưng Zalo đang từ chối URL ảnh web. Thử lại sau một chút nha.").catch(() => {});
    return json({ message: "Success", provider: "image-context-v20", found: false, error: String(error?.message || error) });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleContextualImageRequest(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V20 image context router failed:", error);
    }

    // Important: bypass V19 here. If a user is only discussing the previous image
    // (for example "em là ai mà gửi ảnh này"), it must go to normal chat instead of
    // being misclassified as another image command by the old keyword router.
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
  personaImageQuery,
  resolveContextualImageQuery,
  topicFromText
};
