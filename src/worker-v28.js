import workerV27 from "./worker-v27.js";
import {
  buildProviderGroups,
  getPayload,
  orderGroupsByRoute
} from "./worker-v15.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { markApiKeyResult } from "./config-manager.js";
import { createScopedDb } from "./scoped-db.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { getAiWebRoute } from "./web-routing.js";
import {
  expandLiveQuery,
  hasExplicitMention,
  isPrivateChat,
  shouldHandleLiveMessage
} from "./live-intel.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const SEARCH_TIMEOUT_MS = 22000;
const ANSWER_TIMEOUT_MS = 22000;
const MAX_REPLY_LENGTH = 1900;
const QUEUE_EXPIRE_MS = 24 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 10 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function normalizeText(value = "") {
  return String(value || "")
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
  for (let i = 0; i < length; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function isOperationalBotCommand(text = "") {
  const n = normalizeText(text);
  return /\b(lich thong bao|huy thong bao|huy mention|huy tag|nhac @|dat lich|hen gio|key_dashboard)\b/.test(n);
}

function isExplicitWebIntent(text = "") {
  const n = normalizeText(text);
  if (!n) return false;
  if (/\b(tim|kiem|search|tra|check|kiem tra)\b/.test(n)
      && /\b(web|internet|online|ngoai web|tren web|google)\b/.test(n)) return true;
  if (/\b(tim|kiem|check|loc|xem)\b/.test(n)
      && /\b(nha|thue nha|phong tro|can ho|phong thue|nha tro|bat dong san)\b/.test(n)) return true;
  if (/\b(ban kinh|quanh day|quanh khu|gan day|khu vuc nay)\b/.test(n)
      && /\b(tim|kiem|check|xem|loc)\b/.test(n)) return true;
  return false;
}

function hasHousingSignals(text = "") {
  const n = normalizeText(text);
  return /\b(thue nha|nha thue|phong tro|can ho|phong thue|nha tro|bat dong san|tim nha|kiem nha)\b/.test(n);
}

function hasSearchAction(text = "") {
  const n = normalizeText(text);
  return /\b(tim|kiem|check|kiem tra|loc|xem|ban kinh|quanh|gan|ngoai web|tren web)\b/.test(n);
}

async function loadRecentChatText(db, chatId) {
  if (!db?.prepare) return "";
  try {
    const rows = (await db.prepare(
      `SELECT text FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) DESC LIMIT 8`
    ).bind(String(chatId)).all()).results || [];
    return rows.map((row) => String(row.text || "")).join("\n");
  } catch {
    return "";
  }
}

async function shouldHandleDeferredWeb(db, message, text) {
  if (isOperationalBotCommand(text)) return false;
  if (shouldHandleLiveMessage(message, text)) return true;
  if (!(isPrivateChat(message) || hasExplicitMention(message))) return false;
  if (isExplicitWebIntent(text)) return true;

  if (hasSearchAction(text)) {
    const recent = await loadRecentChatText(db, message?.chat?.id || "");
    if (hasHousingSignals(`${text}\n${recent}`)) return true;
  }
  return false;
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseResponseText(data = {}) {
  if (data?.output_text) return String(data.output_text).trim();
  const blocks = [];
  for (const item of data?.output || data?.steps || []) {
    if (item?.type === "model_output" || item?.type === "message") {
      for (const block of item.content || []) {
        if ((block?.type === "text" || block?.type === "output_text") && block?.text) blocks.push(block.text);
      }
    }
  }
  if (blocks.length) return blocks.join("\n").trim();
  const gemini = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("\n")
    .trim();
  if (gemini) return gemini;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n").trim();
  }
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

function chooseModel(group, key, purpose = "answer") {
  const preferred = purpose === "search"
    ? group.searchModel || group.chatModel || group.reasoningModel
    : group.chatModel || group.reasoningModel || group.searchModel;
  const allowlist = Array.isArray(key?.modelAllowlist) ? key.modelAllowlist.filter(Boolean) : [];
  if (allowlist.length && preferred && !allowlist.includes(preferred)) return allowlist[0];
  return preferred || allowlist[0] || "";
}

function makeCandidate(group, key, purpose) {
  return {
    id: group.id,
    label: group.label || group.id,
    type: group.type,
    baseUrl: String(group.baseUrl || "").replace(/\/$/, ""),
    model: chooseModel(group, key, purpose),
    apiKey: key?.apiKey || "",
    keyId: key?.id || "",
    managed: Boolean(key?.managed)
  };
}

async function markCandidate(env, candidate, ok, errorMessage = "") {
  if (candidate?.managed && candidate?.keyId) {
    await markApiKeyResult(env, candidate.keyId, ok, errorMessage).catch(() => {});
  }
}

async function callSearch(candidate, query) {
  if (candidate.type === "gemini") {
    const response = await fetch(`${candidate.baseUrl}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": candidate.apiKey },
      body: JSON.stringify({
        model: candidate.model,
        input: `Hãy tra cứu web trước khi trả lời. Trả lời tiếng Việt tự nhiên, ngắn gọn, không bịa dữ liệu thời gian thực. Giữ URL nguồn quan trọng nếu có.\n\nYêu cầu:\n${query}`,
        tools: [{ type: "google_search" }],
        generation_config: { temperature: 0.1 }
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    const text = parseResponseText(data);
    if (!response.ok || !text) throw new Error(data?.error?.message || `Gemini Search HTTP ${response.status}`);
    return { text, status: response.status, sources: collectSources(data).slice(0, 6), usage: usageFromData(data) };
  }

  const response = await fetch(`${candidate.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${candidate.apiKey}` },
    body: JSON.stringify({
      model: candidate.model,
      input: `Search the live web first. Answer in Vietnamese naturally and briefly. Do not invent current facts. Keep important source URLs when available.\n\nYêu cầu:\n${query}`,
      tools: [{ type: "web_search" }]
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = parseResponseText(data);
  if (!response.ok || !text) throw new Error(data?.error?.message || data?.message || `Web Search HTTP ${response.status}`);
  return { text, status: response.status, sources: collectSources(data).slice(0, 6), usage: usageFromData(data) };
}

function answerPrompt(query, searchResult) {
  const sources = (searchResult.sources || [])
    .map((row, index) => `${index + 1}. ${row.title || "Nguồn"}: ${row.url}`)
    .join("\n");
  return `Trả lời người dùng bằng tiếng Việt tự nhiên, gọn, thân thiện. Chỉ dùng dữ liệu web vừa tìm được cho thông tin thời gian thực, không bịa thêm.\n\nCâu hỏi:\n${query}\n\nDữ liệu web:\n${searchResult.text}\n\nNguồn:\n${sources || "(nguồn nằm trong dữ liệu web)"}`;
}

async function callAnswer(candidate, query, searchResult) {
  const prompt = answerPrompt(query, searchResult);
  if (candidate.type === "gemini") {
    const response = await fetch(`${candidate.baseUrl}/models/${encodeURIComponent(candidate.model)}:generateContent?key=${encodeURIComponent(candidate.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
      }),
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    const text = parseResponseText(data);
    if (!response.ok || !text) throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
    return { text, status: response.status, usage: usageFromData(data) };
  }

  const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${candidate.apiKey}` },
    body: JSON.stringify({
      model: candidate.model,
      messages: [
        { role: "system", content: "Bạn là trợ lý Zalo. Trả lời tự nhiên, ngắn gọn, không bịa dữ liệu realtime." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1200
    }),
    signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = parseResponseText(data);
  if (!response.ok || !text) throw new Error(data?.error?.message || data?.message || `Chat HTTP ${response.status}`);
  return { text, status: response.status, usage: usageFromData(data) };
}

async function logUsage(db, payload, candidate, feature, ok, result = {}, errorMessage = "") {
  if (!db?.prepare) return;
  const message = payload.message;
  const usage = result.usage || {};
  await db.prepare(
    `INSERT INTO ai_usage
      (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
       ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    candidate?.id || "web-retry-v28",
    candidate?.model || "",
    feature,
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(message.message_id || ""),
    ok ? 1 : 0,
    Number(result.status || 0),
    ok ? "" : "WEB_RETRY_ERROR",
    ok ? "" : String(errorMessage || "").slice(0, 900),
    Number(usage.promptTokens || 0),
    Number(usage.outputTokens || 0),
    Number(usage.totalTokens || 0),
    JSON.stringify({ deferred_queue: true }),
  ).run().catch(() => {});
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
    JSON.stringify({ event_name: payload.eventName, source: "web-retry-v28", connection_id: connectionId })
  ).run().catch(() => {});
}

async function saveSearchResult(db, payload, query, finalText, searchResult, meta = {}) {
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
    String(finalText || "").slice(0, 6000),
    JSON.stringify(searchResult.sources || []),
    JSON.stringify({ source: "web-retry-v28", deferred_queue: true, ...meta })
  ).run().catch(() => {});
}

async function sendMessage(connection, chatId, text) {
  const raw = String(text || "").trim();
  const limited = raw.length <= MAX_REPLY_LENGTH ? raw : `${raw.slice(0, MAX_REPLY_LENGTH - 20).trim()}...`;
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text: limited }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo HTTP ${response.status}`);
  return data;
}

async function tryWebTask(env, connection, payload) {
  const policy = await evaluateAiPermission(env, connection.id).catch(() => null);
  if (connection.id !== "main" && (!policy?.allowed || !policy?.allowChat)) {
    if (policy?.quotaExceeded) throw new Error("Shared AI quota is temporarily exhausted");
    return { blocked: true, reason: "permission_denied" };
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
  if (!searchGroups.length) throw new Error("No Web Search provider is currently available");

  const query = expandLiveQuery(payload.text, env);
  let searchResult = null;
  let searchCandidate = null;
  let lastError = "";

  outerSearch:
  for (const group of searchGroups) {
    for (const key of group.keys || []) {
      const candidate = makeCandidate(group, key, "search");
      if (!candidate.apiKey || !candidate.model) continue;
      try {
        const result = await callSearch(candidate, query);
        await markCandidate(env, candidate, true);
        await logUsage(db, payload, candidate, "deferred_web_search_v28", true, result);
        searchResult = result;
        searchCandidate = candidate;
        break outerSearch;
      } catch (error) {
        lastError = String(error?.message || error);
        await markCandidate(env, candidate, false, lastError);
        await logUsage(db, payload, candidate, "deferred_web_search_v28", false, {}, lastError);
      }
    }
  }

  if (!searchResult) throw new Error(lastError || "All Web Search providers failed");

  let finalText = searchResult.text;
  let answerCandidate = searchCandidate;
  for (const group of answerGroups) {
    let answered = false;
    for (const key of group.keys || []) {
      const candidate = makeCandidate(group, key, "answer");
      if (!candidate.apiKey || !candidate.model) continue;
      if (candidate.id === searchCandidate?.id && candidate.model === searchCandidate?.model) continue;
      try {
        const result = await callAnswer(candidate, query, searchResult);
        await markCandidate(env, candidate, true);
        await logUsage(db, payload, candidate, "deferred_web_answer_v28", true, result);
        finalText = result.text;
        answerCandidate = candidate;
        answered = true;
        break;
      } catch (error) {
        const message = String(error?.message || error);
        await markCandidate(env, candidate, false, message);
        await logUsage(db, payload, candidate, "deferred_web_answer_v28", false, {}, message);
      }
    }
    if (answered) break;
  }

  await saveSearchResult(db, payload, query, finalText, searchResult, {
    search_provider: searchCandidate?.id || "",
    search_model: searchCandidate?.model || "",
    answer_provider: answerCandidate?.id || "",
    answer_model: answerCandidate?.model || ""
  });

  return { ok: true, text: finalText };
}

function retryDelayMinutes(attemptCount = 1) {
  const schedule = [1, 2, 5, 10, 20, 30, 60];
  const index = Math.max(0, Math.min(schedule.length - 1, Number(attemptCount || 1) - 1));
  return schedule[index];
}

function makeQueueId(connectionId, messageId) {
  return messageId ? `${connectionId}:${messageId}` : crypto.randomUUID();
}

async function enqueueWebRetry(env, connection, payload, rawBody, errorMessage = "") {
  const now = new Date();
  const next = new Date(now.getTime() + retryDelayMinutes(1) * 60000);
  const expires = new Date(now.getTime() + QUEUE_EXPIRE_MS);
  const message = payload.message;
  const messageId = String(message.message_id || "");
  const id = makeQueueId(connection.id || "main", messageId);

  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO web_retry_queue
      (id, connection_id, message_id, chat_id, chat_type, user_id, user_name, request_text,
       event_json, status, attempt_count, next_attempt_at, last_error, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`
  ).bind(
    id,
    connection.id || "main",
    messageId,
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    String(payload.text || "").slice(0, 4000),
    JSON.stringify(rawBody || {}),
    next.toISOString(),
    String(errorMessage || "").slice(0, 1000),
    expires.toISOString()
  ).run();

  return {
    id,
    inserted: Number(result?.meta?.changes || 0) > 0,
    nextAttemptAt: next.toISOString()
  };
}

async function handleDeferredWebWebhook(request, env) {
  if (request.method !== "POST" || !env.DB?.prepare) return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const rawBody = await request.clone().json().catch(() => null);
  const payload = getPayload(rawBody);
  if (!payload || payload.eventName !== "message.text.received") return null;

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

  if (!(await shouldHandleDeferredWeb(db, payload.message, payload.text))) return null;

  try {
    const result = await tryWebTask(env, connection, payload);
    if (result?.blocked) return null;
    if (result?.ok) {
      await sendMessage(connection, payload.message.chat.id, result.text);
      return json({ message: "Success", provider: "web-retry-v28", queued: false });
    }
  } catch (error) {
    const errorMessage = String(error?.message || error);
    const queued = await enqueueWebRetry(env, connection, payload, rawBody, errorMessage);
    if (queued.inserted) {
      await sendMessage(
        connection,
        payload.message.chat.id,
        "Anh/chị đợi em chút nha, bên tìm kiếm đang bận. Em đã xếp yêu cầu này vào hàng chờ rồi; khi lấy được dữ liệu em gửi lại ngay, không cần nhắn lại ạ."
      ).catch(() => {});
    }
    return json({
      message: "Success",
      provider: "web-retry-v28",
      queued: true,
      queue_id: queued.id,
      reason: "web_temporarily_unavailable"
    });
  }

  return null;
}

async function reclaimStaleProcessing(env, now = new Date()) {
  const cutoff = new Date(now.getTime() - PROCESSING_STALE_MS).toISOString();
  await env.DB.prepare(
    `UPDATE web_retry_queue
     SET status = 'pending', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND updated_at < ?`
  ).bind(cutoff).run().catch(() => {});
}

async function processWebRetryQueue(env, now = new Date()) {
  if (!env.DB?.prepare) return [];
  await reclaimStaleProcessing(env, now);

  const expired = (await env.DB.prepare(
    `SELECT id, connection_id, chat_id FROM web_retry_queue
     WHERE status = 'pending' AND expires_at <= ? LIMIT 10`
  ).bind(now.toISOString()).all()).results || [];

  for (const row of expired) {
    await env.DB.prepare(
      `UPDATE web_retry_queue SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
    ).bind(row.id).run().catch(() => {});
    const connection = await resolveZaloConnection(env, row.connection_id || "main").catch(() => null);
    if (connection?.token) {
      await sendMessage(connection, row.chat_id, "Em vẫn chưa lấy được dữ liệu cho yêu cầu lúc nãy. Khi tiện anh/chị nhắn lại em câu đó, em tra lại ngay nha.").catch(() => {});
    }
  }

  const rows = (await env.DB.prepare(
    `SELECT * FROM web_retry_queue
     WHERE status = 'pending' AND next_attempt_at <= ? AND expires_at > ?
     ORDER BY next_attempt_at ASC LIMIT 4`
  ).bind(now.toISOString(), now.toISOString()).all()).results || [];

  const results = [];
  for (const row of rows) {
    const claimed = await env.DB.prepare(
      `UPDATE web_retry_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`
    ).bind(row.id).run();
    if (Number(claimed?.meta?.changes || 0) < 1) continue;

    try {
      const rawBody = JSON.parse(String(row.event_json || "{}"));
      const payload = getPayload(rawBody);
      const connection = await resolveZaloConnection(env, row.connection_id || "main");
      if (!payload || !connection?.token) throw new Error("Queued request context is unavailable");

      const result = await tryWebTask(env, connection, payload);
      if (!result?.ok) throw new Error(result?.reason || "Web task is still unavailable");

      await sendMessage(connection, row.chat_id, `Em tìm được rồi nè:\n\n${result.text}`);
      await env.DB.prepare(
        `UPDATE web_retry_queue
         SET status = 'done', completed_at = CURRENT_TIMESTAMP, last_error = '', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(row.id).run();
      results.push({ id: row.id, ok: true });
    } catch (error) {
      const nextAttempt = Number(row.attempt_count || 1) + 1;
      const delay = retryDelayMinutes(nextAttempt);
      const nextAt = new Date(now.getTime() + delay * 60000).toISOString();
      const errorMessage = String(error?.message || error).slice(0, 1000);
      await env.DB.prepare(
        `UPDATE web_retry_queue
         SET status = 'pending', attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(nextAttempt, nextAt, errorMessage, row.id).run().catch(() => {});
      results.push({ id: row.id, ok: false, next_attempt_at: nextAt });
    }
  }
  return results;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const deferred = await handleDeferredWebWebhook(request, env);
      if (deferred) return deferred;
    } catch (error) {
      console.error("V28 deferred web handler failed:", error);
    }
    return workerV27.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const queueJob = processWebRetryQueue(env, new Date(event?.scheduledTime || Date.now())).catch((error) => {
      console.error("V28 web retry queue failed:", error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(queueJob);
    else await queueJob;

    if (typeof workerV27.scheduled === "function") return workerV27.scheduled(event, env, ctx);
  }
};

export {
  hasHousingSignals,
  isExplicitWebIntent,
  isOperationalBotCommand,
  processWebRetryQueue,
  retryDelayMinutes,
  shouldHandleDeferredWeb
};
