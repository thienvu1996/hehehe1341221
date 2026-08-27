import workerV23 from "./worker-v23.js";
import {
  isContextualImageRequest,
  resolveContextualImageQuery
} from "./worker-v21.js";
import { getPayload } from "./worker-v15.js";
import { searchCommonsImages } from "./worker-v19.js";
import { createScopedDb } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";

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

function hasMention(message, text = "") {
  if (/@\S+/u.test(String(text || ""))) return true;
  const mentions = message?.mentions || message?.mention || message?.entities || message?.message_entities;
  if (Array.isArray(mentions) && mentions.length > 0) return true;
  return Boolean(mentions && typeof mentions === "object" && Object.keys(mentions).length > 0);
}

function isSexyImageIntent(text = "") {
  const normalized = normalizeText(text);
  return /\b(sexy|goi cam|quyen ru|nong bong|glamour|bikini)\b/.test(normalized);
}

function isExplicitSexualImageIntent(text = "") {
  const normalized = normalizeText(text);
  return /\b(porn|pornography|sex|sexual intercourse|nude|nudity|naked|hentai)\b/.test(normalized)
    || /\b(khoa than|lo hang|quan he tinh duc|anh 18\+)\b/.test(normalized);
}

function mentionsMinor(text = "") {
  const normalized = normalizeText(text);
  return /\b(child|children|kid|kids|minor|teen|teenager|underage|tre em|be gai|be trai|vi thanh nien|hoc sinh)\b/.test(normalized);
}

function buildSexySearchQuery(text = "", resolvedQuery = "") {
  const normalized = normalizeText(`${text} ${resolvedQuery}`);
  const gender = /\b(nu|woman|female|girl|co gai)\b/.test(normalized)
    ? "woman"
    : /\b(nam|man|male|guy|chang trai)\b/.test(normalized)
      ? "man"
      : "person";

  const style = /\bbikini\b/.test(normalized)
    ? "bikini fashion"
    : "glamour fashion";

  // For sexualized/suggestive requests, explicitly constrain the subject to an adult.
  return `adult ${gender} ${style} portrait`;
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

function randomIndex(max) {
  if (max <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

async function handleSexyImageRequest(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received" || !isContextualImageRequest(payload.text)) return null;
  if (!isSexyImageIntent(payload.text)) return null;
  if (!(isPrivateChat(payload.message) || hasMention(payload.message, payload.text))) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;

  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  if (isExplicitSexualImageIntent(payload.text) || mentionsMinor(payload.text)) {
    await sendMessage(connection, payload.message.chat.id, "Mình có thể gửi ảnh gợi cảm/sexy không khỏa thân của người lớn, nhưng không gửi ảnh tình dục rõ ràng hoặc liên quan người chưa thành niên.").catch(() => {});
    return json({ message: "Success", provider: "image-sexy-v24", blocked: true });
  }

  const db = createScopedDb(env.DB, {
    connectionId: connection.id,
    chatId: String(payload.message.chat?.id || ""),
    userId: String(payload.message.from?.id || ""),
    messageId: String(payload.message.message_id || ""),
    mode: "request"
  });

  const context = await loadImageContext(db, payload.message);
  const resolved = resolveContextualImageQuery(payload.text, context);
  const query = buildSexySearchQuery(payload.text, resolved.query);

  let images = await searchCommonsImages(query).catch(() => []);
  if (!images.length) images = await searchCommonsImages("adult glamour fashion portrait").catch(() => []);
  if (!images.length) return null;

  const start = randomIndex(images.length);
  for (let offset = 0; offset < Math.min(images.length, 8); offset += 1) {
    const image = images[(start + offset) % images.length];
    try {
      await sendPhoto(
        connection,
        payload.message.chat.id,
        image.url,
        `📷 Ảnh gợi cảm theo ngữ cảnh\nNguồn: Wikimedia Commons`
      );
      return json({
        message: "Success",
        provider: "image-sexy-v24",
        found: true,
        query,
        content_mode: "suggestive_non_explicit_adult"
      });
    } catch {
      // try another result
    }
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleSexyImageRequest(request, env);
      if (response) return response;
    } catch (error) {
      console.warn("V24 sexy image router failed:", error?.message || error);
    }
    return workerV23.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV23.scheduled === "function") return workerV23.scheduled(event, env, ctx);
  }
};

export {
  buildSexySearchQuery,
  handleSexyImageRequest,
  isExplicitSexualImageIntent,
  isSexyImageIntent,
  mentionsMinor
};
