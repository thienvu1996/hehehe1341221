import workerV21, {
  isContextualImageRequest,
  resolveContextualImageQuery
} from "./worker-v21.js";
import { getPayload } from "./worker-v15.js";
import { searchCommonsImages } from "./worker-v19.js";
import { createScopedDb } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const FALLBACK_IMAGE_QUERY = "virtual assistant portrait";

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

function stripHardcodedAge(query = "") {
  return String(query)
    .replace(/\badult\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim() || FALLBACK_IMAGE_QUERY;
}

async function safeAll(db, sql, binds = []) {
  if (!db?.prepare) return [];
  try {
    let stmt = db.prepare(sql);
    if (binds.length) stmt = stmt.bind(...binds);
    return (await stmt.all()).results || [];
  } catch {
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

function randomIndex(max) {
  if (max <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

async function handleAgeNeutralImageRequest(request, env) {
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
  const query = stripHardcodedAge(resolved.query);

  // Keep content-safety blocking independent from age-neutral search wording.
  if (/(porn|sex|nude|nudity|khoa than|18\+|hentai|child porn|tre em khoa than)/i.test(normalizeText(query))) {
    return null;
  }

  let images = await searchCommonsImages(query).catch(() => []);
  if (!images.length) images = await searchCommonsImages(FALLBACK_IMAGE_QUERY).catch(() => []);
  if (!images.length) return null;

  const start = randomIndex(images.length);
  for (let offset = 0; offset < Math.min(images.length, 8); offset += 1) {
    const image = images[(start + offset) % images.length];
    try {
      await sendPhoto(
        connection,
        payload.message.chat.id,
        image.url,
        `📷 Ảnh minh họa theo ngữ cảnh: ${query}\nNguồn: Wikimedia Commons`
      );
      return json({
        message: "Success",
        provider: "image-context-v22",
        found: true,
        query,
        age_filter: "none",
        context_reason: resolved.reason
      });
    } catch {
      // try the next candidate
    }
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleAgeNeutralImageRequest(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V22 age-neutral image router failed:", error);
    }
    return workerV21.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof workerV21.scheduled === "function") return workerV21.scheduled(event, env, ctx);
  }
};

export { handleAgeNeutralImageRequest, stripHardcodedAge };
