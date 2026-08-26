import workerV11 from "./worker-v11.js";
import { verifyDashboardSessionToken } from "./worker-v3.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { createScopedDb, normalizeConnectionId } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { generateGroupSummary, getCapturedGroupData, getLatestSummary } from "./group-chat-summary.js";

function json(data, status = 200, request = null) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request) {
    headers["Access-Control-Allow-Origin"] = request.headers.get("Origin") || "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Dashboard-Token";
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

function isGroupMessage(message) {
  return String(message?.chat?.chat_type || "").toUpperCase().includes("GROUP");
}

function hasExplicitMention(message) {
  const text = String(message?.text || message?.caption || "");
  if (text.includes("@")) return true;
  const mentions = message?.mentions || message?.mention || message?.entities;
  return Array.isArray(mentions) ? mentions.length > 0 : Boolean(mentions);
}

function isPassiveGroupMessage(eventName, message) {
  return ["message.text.received", "message.image.received"].includes(eventName) && isGroupMessage(message) && !hasExplicitMention(message);
}

function extractPassiveImageUrl(message) {
  const candidates = [
    message?.photo_url,
    message?.url,
    message?.photo?.url,
    message?.image?.url,
    message?.attachment?.url,
    message?.attachment?.payload?.url,
    message?.attachments?.[0]?.url,
    message?.attachments?.[0]?.payload?.url
  ];
  return String(candidates.find(Boolean) || "");
}

async function savePassiveGroupEvent(env, connectionId, eventName, message) {
  if (!env.DB?.prepare) return;
  const chatId = String(message?.chat?.id || "");
  const userId = String(message?.from?.id || "");
  const messageId = String(message?.message_id || "");
  const text = String(message?.text || message?.caption || "").trim();
  const db = createScopedDb(env.DB, {
    connectionId,
    chatId,
    userId,
    messageId,
    mode: "request"
  });
  const metadata = JSON.stringify({
    event_name: eventName,
    source: "passive-group-capture-v12",
    connection_id: connectionId,
    passive_capture: true,
    platform_delivery_note: "Only events actually delivered by Zalo can be stored."
  });

  await db.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    chatId,
    message?.chat?.chat_type || "GROUP",
    userId,
    message?.from?.display_name || "",
    messageId || null,
    text.slice(0, 4000),
    Number(message?.date || 0),
    metadata
  ).run();

  if (eventName === "message.image.received") {
    const photoUrl = extractPassiveImageUrl(message);
    if (photoUrl) {
      await db.prepare(
        `INSERT INTO images
          (chat_id, chat_type, user_id, user_name, message_id, photo_url, caption, analysis, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           photo_url = excluded.photo_url,
           caption = excluded.caption,
           metadata_json = excluded.metadata_json`
      ).bind(
        chatId,
        message?.chat?.chat_type || "GROUP",
        userId,
        message?.from?.display_name || "",
        messageId || null,
        photoUrl,
        text.slice(0, 2000),
        "Thu thập thụ động; chưa chạy AI phân tích ảnh.",
        metadata
      ).run().catch(() => {});
    }
  }
}

async function handlePassiveGroupCapture(request, env) {
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (request.method !== "POST" || !webhook) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.webhookSecret) return null;
  const requestSecret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(requestSecret, connection.webhookSecret)) return null;

  const body = await request.clone().json().catch(() => null);
  const event = body?.result || body;
  const eventName = event?.event_name || "";
  const message = event?.message;
  if (!message?.chat?.id || !isPassiveGroupMessage(eventName, message)) return null;

  await savePassiveGroupEvent(env, connection.id, eventName, message).catch((error) => {
    console.error("Passive group capture failed:", error);
  });

  return json({ message: "Success", passive_capture: true, replied: false });
}

async function requireDashboardSession(request, env) {
  const token = request.headers.get("x-dashboard-token") || "";
  if (!token.startsWith("v1.") || !(await verifyDashboardSessionToken(env, token))) {
    return json({ ok: false, message: "Session expired" }, 403, request);
  }
  return null;
}

async function handleChatSummary(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/admin/chat-summary") return null;
  if (request.method === "OPTIONS") return json({ ok: true }, 200, request);
  if (!["GET", "POST"].includes(request.method)) return json({ ok: false, message: "Method Not Allowed" }, 405, request);

  const denied = await requireDashboardSession(request, env);
  if (denied) return denied;

  try {
    let connectionId = normalizeConnectionId(url.searchParams.get("connection_id") || "main");
    let hours = Math.min(24 * 30, Math.max(1, Number(url.searchParams.get("hours") || 24)));

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      connectionId = normalizeConnectionId(body.connection_id || connectionId);
      hours = Math.min(24 * 30, Math.max(1, Number(body.hours || hours)));
      const result = await generateGroupSummary(env, connectionId, hours);
      return json({
        ok: true,
        coverage: "zalo-bot-mention-gated",
        note: "Chỉ tổng hợp các tin mà Zalo thực tế chuyển tới Bot API.",
        ...result
      }, 200, request);
    }

    const data = await getCapturedGroupData(env, connectionId, hours);
    const latestSummary = await getLatestSummary(env, connectionId, hours);
    return json({
      ok: true,
      coverage: "zalo-bot-mention-gated",
      note: "Zalo Bot trong group chỉ lưu được event mà nền tảng chuyển tới webhook; tin không được Zalo gửi tới server thì không thể quét từ Worker.",
      ...data,
      latest_summary: latestSummary
    }, 200, request);
  } catch (error) {
    console.error("Dashboard chat summary failed:", error);
    return json({ ok: false, message: String(error?.message || error) }, 400, request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const summary = await handleChatSummary(request, env);
    if (summary) return summary;

    const passive = await handlePassiveGroupCapture(request, env);
    if (passive) return passive;

    return workerV11.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV11.scheduled === "function") return workerV11.scheduled(event, env, ctx);
  }
};

export { hasExplicitMention, isGroupMessage, isPassiveGroupMessage };
