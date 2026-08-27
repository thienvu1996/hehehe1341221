import workerV18 from "./worker-v18.js";
import { getPayload } from "./worker-v15.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
const DEFAULT_RANDOM_IMAGE_QUERY = "phong cảnh thiên nhiên đẹp";

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
    .toLowerCase();
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

function isWebImageRequest(text) {
  const normalized = normalizeText(text).replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  // Full Vietnamese/English wording.
  if (/\b(gui|tim|kiem|cho|lay|send)\b.{0,28}\b(anh|hinh|photo|image)\b/.test(normalized)) return true;
  if (/\b(anh|hinh|photo|image)\b.{0,28}\b(gui|tim|kiem|cho|lay|send|xem)\b/.test(normalized)) return true;
  if (/^(anh|hinh)\s+\S+/.test(normalized)) return true;

  // Vietnamese chat shorthand used in this bot: "a" = ảnh in phrases such as
  // "gửi a xem đi", "gửi a a xem đi", "a đâu", "cho a xem".
  if (/\bgui\s+a(?:\s+a)?\s+(?:xem|coi)\b/.test(normalized)) return true;
  if (/\bcho\s+a\s+(?:xem|coi)\b/.test(normalized)) return true;
  if (/\ba\s+dau\b/.test(normalized)) return true;

  // "kiếm đại/tìm đại ảnh trên mạng" and similar loose wording.
  if (/\b(kiem|tim|lay|gui)\s+dai\b.{0,24}\b(anh|hinh)\b/.test(normalized)) return true;

  return false;
}

function extractImageQuery(text) {
  let value = String(text || "").trim();
  value = value.replace(/@\S+/gu, " ");
  value = value.replace(/\b(gửi|gui|send|cho|lấy|lay|tìm|tim|kiếm|kiem|giúp|giup|mình|minh|tôi|toi|em)\b/giu, " ");
  value = value.replace(/\b(ảnh|hình|hinh|photo|image|trên mạng|tren mang|trên web|tren web|web|mạng|mang)\b/giu, " ");
  value = value.replace(/\b(xem|coi|đi|di|nha|nhé|nhe|đâu|dau|đại|dai)\b/giu, " ");
  // Remove a standalone "a" only for the known image-shorthand request shapes.
  if (/\bgui\s+a(?:\s+a)?\s+(?:xem|coi)\b/i.test(normalizeText(text)) || /\ba\s+dau\b/i.test(normalizeText(text))) {
    value = value.replace(/\ba\b/giu, " ");
  }
  value = value.replace(/[!?.,:;~]+/g, " ").replace(/\s+/g, " ").trim();

  const normalized = normalizeText(value).replace(/\s+/g, " ").trim();
  const fillerOnly = !normalized || /^(anh|a|xem|coi|di|nha|nhe|dau|ma|roi|thoi)(\s+(anh|a|xem|coi|di|nha|nhe|dau|ma|roi|thoi))*$/.test(normalized);
  return fillerOnly ? DEFAULT_RANDOM_IMAGE_QUERY : value;
}

function randomIndex(max) {
  if (max <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

async function searchCommonsImages(query) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "16",
    prop: "imageinfo",
    iiprop: "url|mime|size",
    iiurlwidth: "1400",
    format: "json",
    origin: "*"
  });

  const response = await fetch(`${COMMONS_API_URL}?${params.toString()}`, {
    headers: { "User-Agent": "RentalIntelZaloBot/1.0" },
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);

  const pages = Object.values(data?.query?.pages || {});
  return pages
    .map((page) => {
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      const mime = String(info?.mime || "").toLowerCase();
      const url = String(info?.thumburl || info?.url || "");
      return {
        title: String(page?.title || "").replace(/^File:/i, ""),
        url,
        originalUrl: String(info?.url || url),
        mime,
        width: Number(info?.width || info?.thumbwidth || 0),
        height: Number(info?.height || info?.thumbheight || 0)
      };
    })
    .filter((item) => /^https:\/\//i.test(item.url))
    .filter((item) => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(item.mime))
    .filter((item) => !item.width || item.width >= 320);
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

async function logImageSearch(env, connectionId, message, query, image, ok, error = "") {
  if (!env?.DB?.prepare) return;
  try {
    await env.DB.prepare(
      `INSERT INTO searches (chat_id, user_id, user_name, query, answer, sources_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      String(message?.chat?.id || ""),
      String(message?.from?.id || ""),
      String(message?.from?.display_name || ""),
      `[image] ${query}`,
      ok ? String(image?.url || "") : String(error || "image_search_failed"),
      JSON.stringify(ok && image ? [{ title: image.title || "Wikimedia Commons", url: image.originalUrl || image.url, connection_id: connectionId }] : [])
    ).run();
  } catch (logError) {
    console.error("V19 image search log failed:", logError);
  }
}

async function handleWebImageRequest(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received" || !isWebImageRequest(payload.text)) return null;
  if (!shouldRespondInChat(payload.message, payload.text)) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const query = extractImageQuery(payload.text);
  if (isUnsafeImageQuery(query)) {
    await sendMessage(connection, payload.message.chat.id, "Mình không tìm/gửi ảnh nhạy cảm kiểu đó. Đổi chủ đề ảnh khác nhé.");
    return json({ message: "Success", provider: "web-image-v19", blocked: true });
  }

  try {
    let images = await searchCommonsImages(query);
    // If a vague Vietnamese phrase produces no result, still satisfy the user's intent by
    // falling back to a generic safe photo instead of returning text-only chat.
    if (!images.length && query !== DEFAULT_RANDOM_IMAGE_QUERY) {
      images = await searchCommonsImages(DEFAULT_RANDOM_IMAGE_QUERY);
    }
    if (!images.length) {
      await sendMessage(connection, payload.message.chat.id, "Mình chưa lấy được ảnh từ web lúc này. Thử lại sau một chút nha.");
      await logImageSearch(env, connection.id, payload.message, query, null, false, "no_results");
      return json({ message: "Success", provider: "web-image-v19", found: false });
    }

    // Try several candidates because a remote host/CDN URL can occasionally be rejected by Zalo.
    const start = randomIndex(images.length);
    let lastError = null;
    for (let offset = 0; offset < Math.min(images.length, 8); offset += 1) {
      const image = images[(start + offset) % images.length];
      try {
        await sendPhoto(connection, payload.message.chat.id, image.url, `📷 ${query}\nNguồn: Wikimedia Commons`);
        await logImageSearch(env, connection.id, payload.message, query, image, true);
        return json({ message: "Success", provider: "web-image-v19", found: true, source: "wikimedia_commons" });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Không gửi được ảnh từ các kết quả tìm kiếm.");
  } catch (error) {
    console.error("V19 web image request failed:", error);
    await logImageSearch(env, connection.id, payload.message, query, null, false, String(error?.message || error));
    await sendMessage(connection, payload.message.chat.id, "Mình có nhận ra bạn đang xin ảnh, nhưng Zalo đang từ chối URL ảnh web. Thử lại sau một chút nha.").catch(() => {});
    return json({ message: "Success", provider: "web-image-v19", found: false, error: String(error?.message || error) });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleWebImageRequest(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V19 image router failed:", error);
    }
    return workerV18.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof workerV18.scheduled === "function") return workerV18.scheduled(event, env, ctx);
  }
};

export { isWebImageRequest, extractImageQuery, searchCommonsImages, handleWebImageRequest };
