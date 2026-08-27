import workerV17 from "./worker-v17.js";
import { getPayload } from "./worker-v15.js";
import { createScopedDb } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => match[0].replace(/[),.;!?]+$/g, ""));
}

function collectUrlCandidates(value, path = "", depth = 0, output = []) {
  if (value == null || depth > 7) return output;

  if (typeof value === "string") {
    for (const url of extractUrls(value)) output.push({ url, path });
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => collectUrlCandidates(child, `${path}[${index}]`, depth + 1, output));
    return output;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectUrlCandidates(child, path ? `${path}.${key}` : key, depth + 1, output);
    }
  }

  return output;
}

function pickImageUrl(message) {
  const candidates = collectUrlCandidates(message);
  const scored = candidates
    .map((item) => {
      const source = String(item.path || "").toLowerCase();
      const url = String(item.url || "");
      let score = 0;
      if (/(photo|image|media|attachment|thumbnail|thumb|download)/.test(source)) score += 6;
      if (/\.(?:avif|gif|heic|jpeg|jpg|png|webp)(?:\?|#|$)/i.test(url)) score += 5;
      if (/(photo|image|media|cdn|zalo)/i.test(url)) score += 2;
      if (/(avatar|profile)/.test(source)) score -= 5;
      return { ...item, score };
    })
    .filter((item) => item.url && item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.url || "";
}

function isImageEvent(eventName, message) {
  const name = String(eventName || "").toLowerCase();
  if (/(image|photo)/.test(name)) return true;
  if (message?.photo_url || message?.photo || message?.image_url || message?.image) return true;
  return Boolean(pickImageUrl(message));
}

async function captureImageBeforeAnalysis(request, env) {
  if (request.method !== "POST" || !env?.DB) return;

  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload?.message || !isImageEvent(payload.eventName, payload.message)) return;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  const connectionId = connection?.id || webhook.connectionId || "main";
  const message = payload.message;
  const photoUrl = pickImageUrl(message);
  if (!photoUrl) return;

  const db = createScopedDb(env.DB, {
    connectionId,
    chatId: String(message.chat?.id || ""),
    userId: String(message.from?.id || ""),
    messageId: String(message.message_id || ""),
    mode: "request"
  });

  await db.prepare(
    `INSERT INTO images
      (chat_id, chat_type, user_id, user_name, message_id, photo_url, caption, analysis, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id, message_id) DO UPDATE SET
       photo_url = excluded.photo_url,
       caption = CASE WHEN excluded.caption <> '' THEN excluded.caption ELSE images.caption END,
       metadata_json = excluded.metadata_json`
  ).bind(
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(message.message_id || crypto.randomUUID()),
    photoUrl,
    String(message.caption || message.text || "").slice(0, 2000),
    "",
    JSON.stringify({
      event_name: payload.eventName || "",
      source: "image-capture-v18",
      connection_id: connectionId,
      captured_before_ai: true
    })
  ).run();
}

export default {
  async fetch(request, env, ctx) {
    try {
      await captureImageBeforeAnalysis(request, env);
    } catch (error) {
      // Never break the normal bot flow just because dashboard image capture failed.
      console.error("V18 image capture failed:", error);
    }
    return workerV17.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof workerV17.scheduled === "function") return workerV17.scheduled(event, env, ctx);
  }
};

export { captureImageBeforeAnalysis, pickImageUrl, isImageEvent };
