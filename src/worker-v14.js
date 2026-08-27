import workerV13 from "./worker-v13.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { getRuntimeProviders, markApiKeyResult } from "./config-manager.js";
import { queueMemoryEvent } from "./memory-v3.js";
import { createScopedDb } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { expandLiveQuery, shouldHandleLiveMessage } from "./live-intel.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_REPLY_LENGTH = 1900;
const SEARCH_TIMEOUT_MS = 20000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

function getPayload(body) {
  const event = body?.result || body;
  const message = event?.message;
  if (!event || !message?.chat?.id) return null;
  return {
    eventName: String(event.event_name || ""),
    message,
    text: String(message.text || message.caption || "").trim()
  };
}

function parseInteractionText(data = {}) {
  if (data?.output_text) return String(data.output_text).trim();
  const blocks = [];
  for (const step of data?.steps || []) {
    if (step?.type !== "model_output") continue;
    for (const block of step?.content || []) {
      if (block?.type === "text" && block?.text) blocks.push(block.text);
    }
  }
  if (blocks.length) return blocks.join("\n").trim();
  const candidateText = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("\n").trim();
  return candidateText;
}

function collectSources(value, output = [], depth = 0) {
  if (!value || depth > 7 || output.length >= 8) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;

  const url = String(value.url || value.uri || value.href || "");
  if (/^https?:\/\//i.test(url)) {
    const title = String(value.title || value.name || value.display_name || "Nguồn web").trim();
    if (!output.some((row) => row.url === url)) output.push({ title, url });
  }
  for (const child of Object.values(value)) collectSources(child, output, depth + 1);
  return output;
}

function usageFromInteraction(data = {}) {
  const usage = data.usageMetadata || data.usage_metadata || data.usage || {};
  return {
    promptTokens: Number(usage.promptTokenCount || usage.prompt_tokens || usage.input_tokens || 0),
    outputTokens: Number(usage.candidatesTokenCount || usage.completion_tokens || usage.output_tokens || 0),
    totalTokens: Number(usage.totalTokenCount || usage.total_tokens || 0)
  };
}

function envGeminiKeys(env) {
  return [...new Set([
    String(env.GEMINI_API_KEY || "").trim(),
    ...String(env.GEMINI_API_KEYS || "").split(",").map((key) => key.trim())
  ].filter(Boolean))];
}

async function getSearchCandidates(env, connectionId, policy) {
  const candidates = [];
  const managed = await getRuntimeProviders(env).catch(() => []);
  const allowedManaged = connectionId === "main" ? "*" : policy?.allowedManagedProviderIds;

  for (const provider of managed) {
    if (provider.provider_type !== "gemini") continue;
    if (Array.isArray(allowedManaged) && !allowedManaged.includes(provider.id)) continue;
    const model = provider.chat_model || provider.reasoning_model || "gemini-3.5-flash-lite";
    for (const key of provider.keys || []) {
      candidates.push({
        id: provider.id,
        label: provider.label || provider.id,
        model: Array.isArray(key.modelAllowlist) && key.modelAllowlist.length && !key.modelAllowlist.includes(model)
          ? key.modelAllowlist[0]
          : model,
        apiKey: key.apiKey,
        keyId: key.id,
        baseUrl: String(provider.base_url || GEMINI_API_BASE_URL).replace(/\/$/, ""),
        managed: true
      });
    }
  }

  const mayUseEnvGemini = connectionId === "main" || Boolean(policy?.allowEnvGemini);
  if (mayUseEnvGemini) {
    const models = [...new Set([
      String(env.GEMINI_SEARCH_MODEL || "").trim(),
      String(env.GEMINI_MODEL || "").trim(),
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash-lite"
    ].filter(Boolean))];
    for (const apiKey of envGeminiKeys(env)) {
      for (const model of models) {
        candidates.push({
          id: "env-gemini",
          label: "Google Gemini Search",
          model,
          apiKey,
          keyId: "",
          baseUrl: GEMINI_API_BASE_URL,
          managed: false
        });
      }
    }
  }

  return candidates;
}

async function callLiveSearch(candidate, query) {
  const prompt = `Bạn là bộ tra cứu THỜI GIAN THỰC cho chatbot Zalo. BẮT BUỘC dùng Google Search tool trước khi trả lời.\n\nKhông được trả lời lịch thi đấu, sự kiện, giờ diễn ra, kết quả hoặc tin mới chỉ từ kiến thức huấn luyện. Nếu nguồn mới không xác nhận thì nói chưa xác nhận, không đoán.\n\nVới bóng đá Việt Nam: phân biệt ĐTQG, U23/U22, đội nữ, futsal và CLB; chỉ nói trận đúng mốc thời gian người dùng hỏi; đổi giờ sang Asia/Ho_Chi_Minh.\nVới sự kiện: ghi tên sự kiện, thời gian, địa điểm; nếu không đủ thông tin thì nêu rõ.\nƯu tiên nguồn chính thức/liên đoàn/ban tổ chức/báo uy tín. Trả lời tiếng Việt tự nhiên, ngắn gọn. Nếu công cụ cung cấp URL nguồn, thêm mục 'Nguồn' ở cuối.\n\nYêu cầu:\n${query}`;

  const response = await fetch(`${candidate.baseUrl}/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": candidate.apiKey
    },
    body: JSON.stringify({
      model: candidate.model,
      input: prompt,
      tools: [{ type: "google_search" }],
      generation_config: { temperature: 0.1 }
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = parseInteractionText(data);
  if (!response.ok || !text) {
    throw new Error(data?.error?.message || data?.message || `Gemini Search HTTP ${response.status}`);
  }
  return {
    text,
    status: response.status,
    sources: collectSources(data).slice(0, 5),
    usage: usageFromInteraction(data)
  };
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
    message.message_id || null,
    String(payload.text || "").slice(0, 4000),
    Number(message.date || 0),
    JSON.stringify({ event_name: payload.eventName, source: "live-intel-v14", connection_id: connectionId })
  ).run().catch(() => {});
}

async function saveSearchResult(db, payload, query, result) {
  if (!db?.prepare) return;
  const message = payload.message;
  await db.prepare(
    `INSERT INTO searches (chat_id, user_id, user_name, query, answer, sources_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    String(message.chat?.id || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(query || "").slice(0, 2000),
    String(result.text || "").slice(0, 6000),
    JSON.stringify(result.sources || []),
    JSON.stringify({ source: "live-intel-v14", realtime: true })
  ).run().catch(() => {});
}

async function logUsage(db, payload, candidate, ok, status = 0, usage = {}, errorMessage = "") {
  if (!db?.prepare) return;
  const message = payload.message;
  await db.prepare(
    `INSERT INTO ai_usage
      (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
       ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at)
     VALUES (?, ?, 'live_web_search_v14', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    candidate?.id || "live-search",
    candidate?.model || "",
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(message.message_id || ""),
    ok ? 1 : 0,
    Number(status || 0),
    ok ? "" : "LIVE_SEARCH_ERROR",
    ok ? "" : String(errorMessage || "").slice(0, 800),
    Number(usage.promptTokens || 0),
    Number(usage.outputTokens || 0),
    Number(usage.totalTokens || 0),
    JSON.stringify({ realtime: true, search_tool: "google_search", provider_id: candidate?.id || "" })
  ).run().catch(() => {});
}

async function sendMessage(connection, chatId, text) {
  const raw = String(text || "").trim();
  const limited = raw.length <= MAX_REPLY_LENGTH ? raw : `${raw.slice(0, MAX_REPLY_LENGTH - 20).trim()}...`;
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: limited }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo HTTP ${response.status}`);
}

async function handleLiveWebhook(request, env, ctx) {
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (request.method !== "POST" || !webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received" || !shouldHandleLiveMessage(payload.message, payload.text)) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const policy = await evaluateAiPermission(env, connection.id).catch(() => null);
  if (connection.id !== "main" && (!policy?.allowed || !policy?.allowChat)) return null;

  const db = createScopedDb(env.DB, {
    connectionId: connection.id,
    chatId: String(payload.message.chat?.id || ""),
    userId: String(payload.message.from?.id || ""),
    messageId: String(payload.message.message_id || ""),
    mode: "request",
    allowedProviderIds: connection.id === "main" ? null : policy?.allowedManagedProviderIds
  });
  await saveIncoming(db, connection.id, payload);

  const query = expandLiveQuery(payload.text, env);
  const candidates = await getSearchCandidates(env, connection.id, policy);
  if (!candidates.length) {
    const reply = "Câu này cần dữ liệu thời gian thực nhưng bot chưa có provider/quyền Web Search. Mình không đoán lịch hay sự kiện để tránh trả sai.";
    await sendMessage(connection, payload.message.chat.id, reply);
    return json({ message: "Success", provider: "live-intel-v14", live_search: false, reason: "search_provider_unavailable" });
  }

  let lastError = "";
  for (const candidate of candidates) {
    try {
      const result = await callLiveSearch(candidate, query);
      if (candidate.managed && candidate.keyId) await markApiKeyResult(env, candidate.keyId, true).catch(() => {});
      await logUsage(db, payload, candidate, true, result.status, result.usage);
      await saveSearchResult(db, payload, query, result);
      await sendMessage(connection, payload.message.chat.id, result.text);

      const memoryJob = queueMemoryEvent(env, connection.id, payload.eventName, payload.message).catch((error) => {
        console.error("Memory V3 live event failed:", error);
      });
      if (ctx?.waitUntil) ctx.waitUntil(memoryJob);

      return json({ message: "Success", provider: candidate.id, model: candidate.model, feature: "live_web_search_v14" });
    } catch (error) {
      lastError = String(error?.message || error);
      if (candidate.managed && candidate.keyId) await markApiKeyResult(env, candidate.keyId, false, lastError).catch(() => {});
      await logUsage(db, payload, candidate, false, 0, {}, lastError);
    }
  }

  const reply = "Mình nhận ra đây là câu hỏi live nhưng Web Search đang lỗi/hết quota. Mình không đoán lịch thi đấu hay sự kiện. Thử lại sau một chút nhé.";
  await sendMessage(connection, payload.message.chat.id, reply);
  return json({ message: "Success", provider: "live-intel-v14", live_search: false, reason: "all_search_candidates_failed" });
}

export default {
  async fetch(request, env, ctx) {
    const live = await handleLiveWebhook(request, env, ctx);
    if (live) return live;
    return workerV13.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV13.scheduled === "function") return workerV13.scheduled(event, env, ctx);
  }
};

export { getPayload, handleLiveWebhook, parseInteractionText };
