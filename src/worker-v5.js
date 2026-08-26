import workerV4 from "./worker-v4.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_GEMINI_SEARCH_MODEL = "gemini-3.5-flash-lite";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
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

function isAiRuntimeQuestion(text) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  if (["/model", "model", "ai model", "model ai"].includes(normalized)) {
    return true;
  }

  const mentionsAi = /\b(ai|model|mo hinh|llm|gemini|openai|chatgpt|grok|claude|provider|nha cung cap)\b/.test(normalized);
  if (!mentionsAi) {
    return false;
  }

  const asksIdentity =
    /\b(model|ai|mo hinh)\s*(nao|gi|cua ai)\b/.test(normalized) ||
    /\b(dang|hien tai)\s*(xai|sai|dung|chay)\b/.test(normalized) ||
    /\b(xai|sai|dung|chay)\s*(model|ai|mo hinh)\b/.test(normalized) ||
    /\b(gemini|openai|chatgpt|grok|claude)\s*(hay|or|voi)\b/.test(normalized) ||
    normalized.includes("ai cua ai") ||
    normalized.includes("model cua ai") ||
    normalized.includes("nha cung cap ai") ||
    normalized.includes("provider nao");

  return asksIdentity;
}

function getWebhookPayload(body) {
  const event = body?.result || body;
  const message = event?.message;

  if (!event || !message?.chat?.id) {
    return null;
  }

  return {
    eventName: event.event_name || "",
    message,
    text: String(message.text || message.caption || "").trim()
  };
}

function getConfiguredModels(env) {
  const general = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const search = String(env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_SEARCH_MODEL).trim();
  const image = String(env.GEMINI_IMAGE_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const configuredFallbacks = String(env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const fallbacks = [...new Set([general, DEFAULT_GEMINI_MODEL, "gemini-2.5-flash-lite", ...configuredFallbacks])];

  return { general, search, image, fallbacks };
}

async function getLatestAiUsage(env, chatId = "") {
  if (!env.DB?.prepare) {
    return null;
  }

  try {
    const row = await env.DB.prepare(
      `SELECT provider, model, feature, chat_id, ok, http_status, created_at
       FROM ai_usage
       WHERE ok = 1 AND COALESCE(model, '') != ''
       ORDER BY CASE WHEN chat_id = ? THEN 0 ELSE 1 END,
                datetime(created_at) DESC
       LIMIT 1`
    )
      .bind(chatId)
      .first();

    return row || null;
  } catch (error) {
    console.error("Failed to read latest AI runtime:", error);
    return null;
  }
}

function formatAiRuntimeReply(env, latestUsage) {
  const models = getConfiguredModels(env);
  const provider = latestUsage?.provider || "gemini";
  const providerLabel = normalizeText(provider).includes("gemini") ? "Google Gemini (Google)" : provider;
  const lines = [
    "AI bot đang dùng:",
    `- Provider: ${providerLabel}`,
    `- Model ưu tiên chat: ${models.general}`,
    `- Model search: ${models.search}`,
    `- Model đọc ảnh: ${models.image}`
  ];

  if (latestUsage?.model) {
    lines.push(
      `- Model vừa chạy thực tế: ${latestUsage.model}`,
      latestUsage.feature ? `- Tác vụ gần nhất: ${latestUsage.feature}` : "",
      latestUsage.created_at ? `- Log lúc: ${latestUsage.created_at} UTC` : ""
    );
  } else {
    lines.push("- Chưa có log AI thành công gần đây để xác nhận model thực tế.");
  }

  lines.push(
    `- Fallback: ${models.fallbacks.join(" → ")}`,
    "",
    "Nếu model ưu tiên lỗi/quota, bot có thể tự rơi xuống model fallback. Vì vậy dòng 'Model vừa chạy thực tế' là dòng đáng tin nhất để biết request gần nhất đã dùng model nào."
  );

  return lines.filter(Boolean).join("\n");
}

async function callZaloApi(env, methodName, payload = {}) {
  if (!env.ZALO_BOT_TOKEN) {
    throw new Error("Missing ZALO_BOT_TOKEN");
  }

  const response = await fetch(`${ZALO_API_BASE_URL}/bot${env.ZALO_BOT_TOKEN}/${methodName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return callZaloApi(env, "sendMessage", { chat_id: chatId, text });
}

async function handleAiRuntimeWebhook(request, env) {
  if (!env.WEBHOOK_SECRET_TOKEN) {
    return null;
  }

  const requestSecret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(requestSecret, env.WEBHOOK_SECRET_TOKEN)) {
    return null;
  }

  const body = await request.clone().json().catch(() => null);
  const payload = getWebhookPayload(body);

  if (!payload || payload.eventName !== "message.text.received" || !isAiRuntimeQuestion(payload.text)) {
    return null;
  }

  const latestUsage = await getLatestAiUsage(env, String(payload.message.chat.id || ""));
  const reply = formatAiRuntimeReply(env, latestUsage);

  await sendMessage(env, payload.message.chat.id, reply);
  return json({ message: "Success" });
}

export { formatAiRuntimeReply, getConfiguredModels, isAiRuntimeQuestion };

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && ["/webhook", "/webhooks"].includes(url.pathname)) {
        const response = await handleAiRuntimeWebhook(request, env);
        if (response) {
          return response;
        }
      }
    } catch (error) {
      console.error("AI runtime introspection failed:", error);
    }

    return workerV4.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV4.scheduled === "function") {
      return workerV4.scheduled(event, env, ctx);
    }
  }
};
