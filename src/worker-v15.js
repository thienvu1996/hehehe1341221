import workerV14 from "./worker-v14.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { getRuntimeProviders, listAiProviders, markApiKeyResult } from "./config-manager.js";
import { queueMemoryEvent } from "./memory-v3.js";
import { createScopedDb } from "./scoped-db.js";
import { verifyDashboardSessionToken } from "./worker-v3.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { expandLiveQuery, shouldHandleLiveMessage } from "./live-intel.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import {
  deleteAiWebRoute,
  getAiWebRoute,
  listAiWebRoutes,
  orderProviderIds,
  upsertAiWebRoute
} from "./web-routing.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_REPLY_LENGTH = 1900;
const SEARCH_TIMEOUT_MS = 22000;
const ANSWER_TIMEOUT_MS = 22000;

function json(data, status = 200, request = null) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request) {
    headers["Access-Control-Allow-Origin"] = request.headers.get("Origin") || "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
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

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizedCapabilities(provider = {}) {
  const raw = Array.isArray(provider.capabilities) ? provider.capabilities : [];
  const capabilities = uniqueStrings(raw.map((value) => String(value).toLowerCase()));
  const type = String(provider.provider_type || provider.type || "").toLowerCase();
  const baseUrl = String(provider.base_url || provider.baseUrl || "").toLowerCase();
  if (type === "gemini" && !capabilities.includes("search")) capabilities.push("search");
  if (baseUrl.includes("api.x.ai") && !capabilities.includes("search")) capabilities.push("search");
  if (!capabilities.includes("chat")) capabilities.push("chat");
  return capabilities;
}

function providerSupportsNativeSearch(provider = {}) {
  const capabilities = normalizedCapabilities(provider);
  return capabilities.includes("search") || capabilities.includes("web_search");
}

function orderGroupsByRoute(groups = [], providerIds = [], searchOnly = false) {
  const eligible = searchOnly ? groups.filter(providerSupportsNativeSearch) : groups.slice();
  const ids = eligible.map((group) => group.id);
  const orderedIds = orderProviderIds(providerIds, ids, false);
  const map = new Map(eligible.map((group) => [group.id, group]));
  return orderedIds.map((id) => map.get(id)).filter(Boolean);
}

function parseResponseText(data = {}) {
  if (data?.output_text) return String(data.output_text).trim();
  const blocks = [];
  for (const item of data?.output || data?.steps || []) {
    if (item?.type === "model_output") {
      for (const block of item.content || []) {
        if ((block?.type === "text" || block?.type === "output_text") && block?.text) blocks.push(block.text);
      }
      continue;
    }
    if (item?.type === "message") {
      for (const block of item.content || []) {
        if ((block?.type === "text" || block?.type === "output_text") && block?.text) blocks.push(block.text);
      }
    }
  }
  if (blocks.length) return blocks.join("\n").trim();
  const gemini = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("\n").trim();
  if (gemini) return gemini;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n").trim();
  return "";
}

function collectSources(value, output = [], depth = 0) {
  if (!value || depth > 8 || output.length >= 8) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectSources(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  const url = String(value.url || value.uri || value.href || "");
  if (/^https?:\/\//i.test(url) && !output.some((row) => row.url === url)) {
    output.push({ title: String(value.title || value.name || "Nguồn web"), url });
  }
  for (const child of Object.values(value)) collectSources(child, output, depth + 1);
  return output;
}

function usageFromData(data = {}) {
  const usage = data.usageMetadata || data.usage_metadata || data.usage || {};
  return {
    promptTokens: Number(usage.promptTokenCount || usage.prompt_tokens || usage.input_tokens || 0),
    outputTokens: Number(usage.candidatesTokenCount || usage.completion_tokens || usage.output_tokens || 0),
    totalTokens: Number(usage.totalTokenCount || usage.total_tokens || 0)
  };
}

function makeHttpError(message, response, data = {}) {
  const error = new Error(message || `HTTP ${response?.status || 0}`);
  error.httpStatus = Number(response?.status || 0);
  error.errorCode = String(data?.error?.status || data?.error?.code || data?.code || "PROVIDER_ERROR");
  return error;
}

function chooseModel(group, key, purpose = "answer") {
  const preferred = purpose === "search"
    ? group.searchModel || group.chatModel || group.reasoningModel
    : group.chatModel || group.reasoningModel || group.searchModel;
  const allowlist = Array.isArray(key?.modelAllowlist) ? key.modelAllowlist.filter(Boolean) : [];
  if (allowlist.length && !allowlist.includes(preferred)) return allowlist[0];
  return preferred || allowlist[0] || "";
}

async function buildProviderGroups(env, connectionId, policy) {
  const [runtime, metadata] = await Promise.all([
    getRuntimeProviders(env).catch(() => []),
    listAiProviders(env).catch(() => [])
  ]);
  const metaMap = new Map(metadata.map((row) => [row.id, row]));
  const groups = [];
  const allowedManaged = connectionId === "main" ? "*" : policy?.allowedManagedProviderIds;

  for (const provider of runtime) {
    if (Array.isArray(allowedManaged) && !allowedManaged.includes(provider.id)) continue;
    const meta = metaMap.get(provider.id) || {};
    groups.push({
      id: provider.id,
      label: provider.label || meta.label || provider.id,
      type: provider.provider_type || meta.provider_type || "openai_compatible",
      baseUrl: String(provider.base_url || meta.base_url || "").replace(/\/$/, ""),
      chatModel: provider.chat_model || meta.chat_model || "",
      reasoningModel: provider.reasoning_model || meta.reasoning_model || "",
      searchModel: provider.chat_model || meta.chat_model || "",
      priority: Number(provider.priority ?? meta.priority ?? 100),
      capabilities: normalizedCapabilities(meta),
      keys: (provider.keys || []).map((key) => ({ ...key, managed: true }))
    });
  }

  const envGrokKey = String(env.Grok || env.GROK_API_KEY || env.XAI_API_KEY || "").trim();
  if ((connectionId === "main" || policy?.allowEnvGrok) && envGrokKey) {
    const meta = metaMap.get("env-grok") || {};
    const baseUrl = String(env.NEXUS_API_BASE_URL || "https://api.nexusapi.co/v1").replace(/\/$/, "");
    groups.push({
      id: "env-grok",
      label: meta.label || "Grok / Nexus (Cloudflare Env)",
      type: "openai_compatible",
      baseUrl,
      chatModel: String(env.GROK_MODEL || "grok-4.6"),
      reasoningModel: String(env.GROK_REASONING_MODEL || "grok-4.6-high"),
      searchModel: String(env.GROK_MODEL || "grok-4.6"),
      priority: 900,
      capabilities: normalizedCapabilities({ ...meta, provider_type: "openai_compatible", base_url: baseUrl }),
      keys: [{ id: "env-grok-key", apiKey: envGrokKey, managed: false, modelAllowlist: [] }]
    });
  }

  const envGeminiKeys = uniqueStrings([
    env.GEMINI_API_KEY,
    ...String(env.GEMINI_API_KEYS || "").split(",")
  ]);
  if ((connectionId === "main" || policy?.allowEnvGemini) && envGeminiKeys.length) {
    const meta = metaMap.get("env-gemini") || {};
    groups.push({
      id: "env-gemini",
      label: meta.label || "Google Gemini (Cloudflare Env)",
      type: "gemini",
      baseUrl: GEMINI_API_BASE_URL,
      chatModel: String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
      reasoningModel: String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
      searchModel: String(env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
      priority: 1000,
      capabilities: ["chat", "search", "image"],
      keys: envGeminiKeys.map((apiKey, index) => ({ id: `env-gemini-key-${index + 1}`, apiKey, managed: false, modelAllowlist: [] }))
    });
  }

  return groups.sort((a, b) => a.priority - b.priority);
}

function makeCandidate(group, key, purpose) {
  return {
    id: group.id,
    label: group.label,
    type: group.type,
    baseUrl: group.baseUrl,
    model: chooseModel(group, key, purpose),
    apiKey: key.apiKey,
    keyId: key.id || "",
    managed: Boolean(key.managed),
    capabilities: group.capabilities
  };
}

async function callGeminiWebSearch(candidate, query) {
  const prompt = `Bạn là bộ tra cứu THỜI GIAN THỰC. Bắt buộc dùng Google Search trước khi trả lời. Không đoán lịch thi đấu, sự kiện, giá, kết quả hoặc tin mới. Ưu tiên nguồn chính thức/báo uy tín, ghi thời gian theo Asia/Ho_Chi_Minh và giữ URL nguồn nếu công cụ cung cấp.\n\nYêu cầu:\n${query}`;
  const response = await fetch(`${candidate.baseUrl}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": candidate.apiKey },
    body: JSON.stringify({
      model: candidate.model,
      input: prompt,
      tools: [{ type: "google_search" }],
      generation_config: { temperature: 0.1 }
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = parseResponseText(data);
  if (!response.ok || !text) throw makeHttpError(data?.error?.message || `Gemini Search HTTP ${response.status}`, response, data);
  return { text, status: response.status, sources: collectSources(data).slice(0, 6), usage: usageFromData(data) };
}

async function callResponsesWebSearch(candidate, query) {
  const prompt = `Search the live web before answering. Do not rely on stale model knowledge for schedules, events, scores, prices or breaking information. Prefer primary/official sources and trustworthy news. Answer in Vietnamese and use Asia/Ho_Chi_Minh time.\n\nYêu cầu:\n${query}`;
  const response = await fetch(`${candidate.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${candidate.apiKey}` },
    body: JSON.stringify({
      model: candidate.model,
      input: prompt,
      tools: [{ type: "web_search" }]
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = parseResponseText(data);
  if (!response.ok || !text) throw makeHttpError(data?.error?.message || data?.message || `Responses Search HTTP ${response.status}`, response, data);
  return { text, status: response.status, sources: collectSources(data).slice(0, 6), usage: usageFromData(data) };
}

async function callNativeWebSearch(candidate, query) {
  if (candidate.type === "gemini") return callGeminiWebSearch(candidate, query);
  return callResponsesWebSearch(candidate, query);
}

function answerPrompt(query, searchResult) {
  const sourceLines = (searchResult.sources || []).map((row, index) => `${index + 1}. ${row.title || "Nguồn"}: ${row.url}`).join("\n");
  return `Bạn là AI trả lời cuối cho chatbot Zalo. Dữ liệu web bên dưới vừa được một công cụ Web Search lấy ở thời điểm hiện tại. Hãy trả lời bằng tiếng Việt tự nhiên, ngắn gọn, đúng trọng tâm. Chỉ dùng dữ liệu web này cho các chi tiết thời gian thực; không bịa thêm. Nếu dữ liệu chưa đủ thì nói chưa xác nhận. Giữ lại nguồn quan trọng ở cuối.\n\nCâu hỏi người dùng:\n${query}\n\nDữ liệu Web Search:\n${searchResult.text}\n\nNguồn:\n${sourceLines || "(nguồn nằm trong nội dung search)"}`;
}

async function callAnswer(candidate, query, searchResult) {
  const prompt = answerPrompt(query, searchResult);
  if (candidate.type === "gemini") {
    const response = await fetch(`${candidate.baseUrl}/models/${encodeURIComponent(candidate.model)}:generateContent?key=${encodeURIComponent(candidate.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 1200 }
      }),
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    const text = parseResponseText(data);
    if (!response.ok || !text) throw makeHttpError(data?.error?.message || `Gemini HTTP ${response.status}`, response, data);
    return { text, status: response.status, usage: usageFromData(data) };
  }

  const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${candidate.apiKey}` },
    body: JSON.stringify({
      model: candidate.model,
      messages: [
        { role: "system", content: "Bạn là trợ lý Zalo. Trả lời tiếng Việt, không bịa dữ liệu realtime ngoài bằng chứng web được cung cấp." },
        { role: "user", content: prompt }
      ],
      temperature: 0.15,
      max_tokens: 1200
    }),
    signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = parseResponseText(data);
  if (!response.ok || !text) throw makeHttpError(data?.error?.message || data?.message || `Chat HTTP ${response.status}`, response, data);
  return { text, status: response.status, usage: usageFromData(data) };
}

async function markCandidate(env, candidate, ok, errorMessage = "") {
  if (candidate.managed && candidate.keyId) {
    await markApiKeyResult(env, candidate.keyId, ok, errorMessage).catch(() => {});
  }
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
    JSON.stringify({ event_name: payload.eventName, source: "live-intel-v15", connection_id: connectionId })
  ).run().catch(() => {});
}

async function saveSearchResult(db, payload, query, answer, searchResult, routeMeta) {
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
    String(answer || "").slice(0, 6000),
    JSON.stringify(searchResult.sources || []),
    JSON.stringify({ source: "live-intel-v15", realtime: true, ...routeMeta })
  ).run().catch(() => {});
}

async function logUsage(db, payload, candidate, feature, ok, status = 0, usage = {}, error = null, metadata = {}) {
  if (!db?.prepare) return;
  const message = payload.message;
  const errorMessage = error ? String(error?.message || error) : "";
  await db.prepare(
    `INSERT INTO ai_usage
      (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
       ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    candidate?.id || "web-routing-v15",
    candidate?.model || "",
    feature,
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(message.message_id || ""),
    ok ? 1 : 0,
    Number(status || error?.httpStatus || 0),
    ok ? "" : String(error?.errorCode || error?.name || "PROVIDER_ERROR"),
    ok ? "" : errorMessage.slice(0, 1000),
    Number(usage.promptTokens || 0),
    Number(usage.outputTokens || 0),
    Number(usage.totalTokens || 0),
    JSON.stringify({ realtime: true, routing: "per-bot-v15", key_id: candidate?.keyId || "", ...metadata })
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

async function requireDashboardSession(request, env) {
  const token = request.headers.get("x-dashboard-token") || "";
  if (!token.startsWith("v1.") || !(await verifyDashboardSessionToken(env, token))) {
    return json({ ok: false, message: "Session expired" }, 403, request);
  }
  return null;
}

async function handleWebRouteAdmin(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/admin/ai-web-routes") return null;
  if (request.method === "OPTIONS") return json({ ok: true }, 200, request);
  const denied = await requireDashboardSession(request, env);
  if (denied) return denied;

  try {
    if (request.method === "GET") {
      return json({ ok: true, routes: await listAiWebRoutes(env) }, 200, request);
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const connectionId = await upsertAiWebRoute(env, body);
      return json({ ok: true, connection_id: connectionId, routes: await listAiWebRoutes(env) }, 200, request);
    }
    if (request.method === "DELETE") {
      await deleteAiWebRoute(env, url.searchParams.get("connection_id") || "main");
      return json({ ok: true, routes: await listAiWebRoutes(env) }, 200, request);
    }
  } catch (error) {
    console.error("AI web route admin failed:", error);
    return json({ ok: false, message: String(error?.message || error) }, 400, request);
  }

  return json({ ok: false, message: "Method Not Allowed" }, 405, request);
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
  if (connection.id !== "main" && (!policy?.allowed || !policy?.allowChat)) {
    const reply = policy?.quotaExceeded
      ? "Bot này đã chạm giới hạn AI được chia sẻ. Chủ bot có thể tăng hạn mức trong Dashboard."
      : "Bot này chưa được Bot chính cấp quyền dùng AI cho Web/Chat.";
    await sendMessage(connection, payload.message.chat.id, reply);
    return json({ message: "Success", provider: "web-routing-v15", blocked: true });
  }

  const db = createScopedDb(env.DB, {
    connectionId: connection.id,
    chatId: String(payload.message.chat?.id || ""),
    userId: String(payload.message.from?.id || ""),
    messageId: String(payload.message.message_id || ""),
    mode: "request",
    allowedProviderIds: connection.id === "main" ? null : policy?.allowedManagedProviderIds
  });
  await saveIncoming(db, connection.id, payload);

  const [route, groups] = await Promise.all([
    getAiWebRoute(env, connection.id),
    buildProviderGroups(env, connection.id, policy || {})
  ]);
  const searchGroups = orderGroupsByRoute(groups, route.search_provider_ids || [], true);
  const answerGroups = orderGroupsByRoute(groups, route.answer_provider_ids || [], false);
  const query = expandLiveQuery(payload.text, env);

  if (!searchGroups.length) {
    const reply = "Bot chưa có AI Web Search phù hợp cho cấu hình của bot này. Vào Dashboard → Kết nối Zalo & AI → AI xử lý Web để chọn provider có Web Search.";
    await sendMessage(connection, payload.message.chat.id, reply);
    return json({ message: "Success", provider: "web-routing-v15", live_search: false, reason: "no_search_provider" });
  }

  let searchResult = null;
  let searchCandidate = null;
  let lastSearchError = null;
  outerSearch:
  for (const group of searchGroups) {
    for (const key of group.keys || []) {
      const candidate = makeCandidate(group, key, "search");
      if (!candidate.model || !candidate.apiKey) continue;
      try {
        const result = await callNativeWebSearch(candidate, query);
        await markCandidate(env, candidate, true);
        await logUsage(db, payload, candidate, "live_web_search_v15", true, result.status, result.usage, null, {
          route_search_priority: route.search_provider_ids || [],
          route_answer_priority: route.answer_provider_ids || []
        });
        searchResult = { ...result, providerId: candidate.id, model: candidate.model };
        searchCandidate = candidate;
        break outerSearch;
      } catch (error) {
        lastSearchError = error;
        await markCandidate(env, candidate, false, String(error?.message || error));
        await logUsage(db, payload, candidate, "live_web_search_v15", false, 0, {}, error, {
          route_search_priority: route.search_provider_ids || [],
          route_answer_priority: route.answer_provider_ids || []
        });
      }
    }
  }

  if (!searchResult) {
    console.error("All routed web search providers failed:", lastSearchError);
    const reply = "Mình không lấy được dữ liệu Web từ các AI Search đã chọn. Mở Dashboard → AI quota để xem lỗi thật của từng provider, rồi đổi thứ tự AI Web Search nếu cần.";
    await sendMessage(connection, payload.message.chat.id, reply);
    return json({ message: "Success", provider: "web-routing-v15", live_search: false, reason: "all_search_providers_failed" });
  }

  let finalText = searchResult.text;
  let answerCandidate = searchCandidate;
  let answerResult = null;

  if (answerGroups.length && answerGroups[0]?.id !== searchCandidate?.id) {
    outerAnswer:
    for (const group of answerGroups) {
      for (const key of group.keys || []) {
        const candidate = makeCandidate(group, key, "answer");
        if (!candidate.model || !candidate.apiKey) continue;
        try {
          const result = await callAnswer(candidate, query, searchResult);
          await markCandidate(env, candidate, true);
          await logUsage(db, payload, candidate, "live_web_answer_v15", true, result.status, result.usage, null, {
            search_provider: searchCandidate?.id || "",
            search_model: searchCandidate?.model || "",
            route_answer_priority: route.answer_provider_ids || []
          });
          finalText = result.text;
          answerCandidate = candidate;
          answerResult = result;
          break outerAnswer;
        } catch (error) {
          await markCandidate(env, candidate, false, String(error?.message || error));
          await logUsage(db, payload, candidate, "live_web_answer_v15", false, 0, {}, error, {
            search_provider: searchCandidate?.id || "",
            search_model: searchCandidate?.model || "",
            route_answer_priority: route.answer_provider_ids || []
          });
        }
      }
    }
  }

  await saveSearchResult(db, payload, query, finalText, searchResult, {
    search_provider: searchCandidate?.id || "",
    search_model: searchCandidate?.model || "",
    answer_provider: answerCandidate?.id || searchCandidate?.id || "",
    answer_model: answerCandidate?.model || searchCandidate?.model || "",
    answer_synthesized: Boolean(answerResult)
  });
  await sendMessage(connection, payload.message.chat.id, finalText);

  const memoryJob = queueMemoryEvent(env, connection.id, payload.eventName, payload.message).catch((error) => {
    console.error("Memory V3 routed live event failed:", error);
  });
  if (ctx?.waitUntil) ctx.waitUntil(memoryJob);

  return json({
    message: "Success",
    feature: "web-routing-v15",
    search_provider: searchCandidate?.id || "",
    search_model: searchCandidate?.model || "",
    answer_provider: answerCandidate?.id || "",
    answer_model: answerCandidate?.model || ""
  });
}

export default {
  async fetch(request, env, ctx) {
    const admin = await handleWebRouteAdmin(request, env);
    if (admin) return admin;

    const live = await handleLiveWebhook(request, env, ctx);
    if (live) return live;

    return workerV14.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV14.scheduled === "function") return workerV14.scheduled(event, env, ctx);
  }
};

export {
  buildProviderGroups,
  getPayload,
  handleLiveWebhook,
  orderGroupsByRoute,
  providerSupportsNativeSearch
};
