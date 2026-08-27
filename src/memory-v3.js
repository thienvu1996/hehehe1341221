import { getRuntimeProviders, markApiKeyResult } from "./config-manager.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { connectionPrefix, normalizeConnectionId, unscopeValue } from "./scoped-db.js";

const MAX_BATCH_MESSAGES = 30;
const MIN_BATCH_MESSAGES = 3;
const BATCH_TRIGGER_COUNT = 8;
const IDLE_TRIGGER_MINUTES = 30;
const MAX_MEMORY_ENTRIES = 10;
const MEMORY_AI_TIMEOUT_MS = 30000;

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function truncate(value, max = 500) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function redactSensitive(value = "") {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gi, "[REDACTED_API_KEY]")
    .replace(/\b(?:api[_ -]?key|token|secret|password|mat khau|mật khẩu|otp)\s*[:=]\s*\S+/gi, "$1: [REDACTED]")
    .replace(/\b\d{12,19}\b/g, "[REDACTED_NUMBER]");
}

function containsSensitiveMemory(value = "") {
  const text = normalizeText(value);
  return /\b(password|mat khau|otp|api key|apikey|access token|refresh token|secret|bearer|so the|so tai khoan|bank account|cvv)\b/.test(text) ||
    /\bsk-[a-z0-9_-]{12,}\b/i.test(String(value || "")) ||
    /\bAIza[A-Za-z0-9_-]{16,}\b/.test(String(value || ""));
}

function isGroupChat(message = {}) {
  return String(message?.chat?.chat_type || "").toUpperCase().includes("GROUP");
}

function messageText(message = {}) {
  return String(message?.text || message?.caption || "").trim();
}

function isHighSignalMemoryText(value = "") {
  const text = normalizeText(value);
  if (!text || text.length < 6) return false;
  return (
    text.includes("nho giup") ||
    text.includes("nho la") ||
    text.includes("hay nho") ||
    text.includes("goi toi") ||
    text.includes("goi minh") ||
    text.includes("xung ho") ||
    text.includes("dung goi") ||
    text.includes("dung xung") ||
    text.includes("toi thich") ||
    text.includes("minh thich") ||
    text.includes("toi khong thich") ||
    text.includes("minh khong thich") ||
    text.includes("toi la ") ||
    text.includes("minh la ") ||
    text.includes("nhom nay") ||
    text.includes("quy uoc") ||
    text.includes("deadline") ||
    text.includes("chot la") ||
    text.includes("tu nay") ||
    text.includes("lan sau")
  );
}

function scopedIdentity(connectionId, rawValue, useGlobalWhenEmpty = false) {
  const id = normalizeConnectionId(connectionId || "main");
  const value = String(rawValue || "");
  if (id === "main") return value;
  const prefix = connectionPrefix(id);
  if (!value && useGlobalWhenEmpty) return `${prefix}__global__`;
  if (!value || value.startsWith(prefix)) return value;
  return `${prefix}${value}`;
}

function rawIdentity(connectionId, storedValue) {
  return unscopeValue(String(storedValue || ""), normalizeConnectionId(connectionId || "main"));
}

function normalizeMemoryKey(value = "general") {
  return truncate(normalizeText(value).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "general", 100);
}

function normalizeTopic(value = "general") {
  return truncate(normalizeText(value).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "general", 80);
}

function styleTokens(text = "") {
  return normalizeText(text)
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function analyzeCommunicationStyle(messages = []) {
  const clean = messages
    .map((row) => ({ ...row, text: String(row?.text || "").trim() }))
    .filter((row) => row.text.length > 0);
  if (!clean.length) return null;

  const abbreviations = ["k", "ko", "kh", "dc", "r", "vs", "nt", "mn", "ae", "ib", "rep", "ok", "oke", "nha", "nhe"];
  const pronouns = ["toi", "minh", "em", "anh", "chi", "ban", "tao", "may", "t", "m", "ong", "ba"];
  const tokenCounts = new Map();
  let chars = 0;
  let emojiMessages = 0;
  let diacriticMessages = 0;

  for (const row of clean) {
    chars += row.text.length;
    if (/\p{Extended_Pictographic}/u.test(row.text)) emojiMessages += 1;
    if (/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(row.text)) {
      diacriticMessages += 1;
    }
    for (const token of styleTokens(row.text)) tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }

  const commonAbbreviations = abbreviations
    .map((token) => [token, tokenCounts.get(token) || 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token);
  const commonPronouns = pronouns
    .map((token) => [token, tokenCounts.get(token) || 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);

  const averageLength = Math.round(chars / clean.length);
  const shortness = averageLength <= 35 ? "ngắn" : averageLength <= 90 ? "vừa" : "khá dài";
  const emojiLevel = emojiMessages / clean.length >= 0.35 ? "hay dùng emoji" : emojiMessages ? "thỉnh thoảng dùng emoji" : "ít dùng emoji";
  const accentLevel = diacriticMessages / clean.length >= 0.6 ? "thường gõ có dấu" : "thường gõ nhanh/ít dấu";

  return {
    observed_messages: clean.length,
    average_length: averageLength,
    message_length_style: shortness,
    abbreviations: commonAbbreviations,
    pronouns: commonPronouns,
    emoji_ratio: Number((emojiMessages / clean.length).toFixed(2)),
    diacritic_ratio: Number((diacriticMessages / clean.length).toFixed(2)),
    summary_parts: [
      `thường nhắn ${shortness}`,
      commonAbbreviations.length ? `hay dùng viết tắt ${commonAbbreviations.join(", ")}` : "ít dùng viết tắt phổ biến",
      commonPronouns.length ? `xưng hô thường gặp ${commonPronouns.join("/")}` : "chưa rõ cách xưng hô",
      emojiLevel,
      accentLevel
    ]
  };
}

async function touchPipelineState(env, connectionId, eventName, message) {
  if (!env.DB?.prepare || !message?.chat?.id) return null;
  const id = normalizeConnectionId(connectionId || "main");
  const chatId = String(message.chat.id);
  const messageId = String(message.message_id || `${eventName}:${message.date || Date.now()}`);

  await env.DB.prepare(
    `INSERT INTO memory_pipeline_state
      (connection_id, chat_id, chat_type, chat_title, last_message_id, last_event_at, pending_count, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, '', CURRENT_TIMESTAMP)
     ON CONFLICT(connection_id, chat_id) DO UPDATE SET
       chat_type = excluded.chat_type,
       chat_title = CASE WHEN excluded.chat_title != '' THEN excluded.chat_title ELSE memory_pipeline_state.chat_title END,
       pending_count = CASE
         WHEN memory_pipeline_state.last_message_id = excluded.last_message_id THEN memory_pipeline_state.pending_count
         ELSE MIN(memory_pipeline_state.pending_count + 1, 500)
       END,
       last_message_id = excluded.last_message_id,
       last_event_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    id,
    chatId,
    String(message.chat?.chat_type || ""),
    String(message.chat?.title || ""),
    messageId
  ).run();

  return env.DB.prepare(
    `SELECT connection_id, chat_id, chat_type, chat_title, last_message_id, last_event_at,
            last_extracted_at, pending_count, total_extractions, last_error
     FROM memory_pipeline_state WHERE connection_id = ? AND chat_id = ? LIMIT 1`
  ).bind(id, chatId).first();
}

function shouldRunNow(state, currentText = "") {
  if (!state) return false;
  const pending = Number(state.pending_count || 0);
  if (pending >= BATCH_TRIGGER_COUNT) return true;
  if (pending > 0 && isHighSignalMemoryText(currentText)) return true;
  if (pending < MIN_BATCH_MESSAGES) return false;
  if (!state.last_extracted_at) return true;
  const last = Date.parse(`${String(state.last_extracted_at).replace(" ", "T")}Z`);
  return Number.isFinite(last) && Date.now() - last >= IDLE_TRIGGER_MINUTES * 60000;
}

async function loadChatMessages(env, connectionId, chatId, limit = MAX_BATCH_MESSAGES) {
  const storedChatId = scopedIdentity(connectionId, chatId);
  const rows = (await env.DB.prepare(
    `SELECT chat_id, chat_type, user_id, user_name, message_id, text, created_at
     FROM messages
     WHERE chat_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  ).bind(storedChatId, Math.min(MAX_BATCH_MESSAGES, Math.max(1, limit))).all()).results || [];

  return rows
    .map((row) => ({
      ...row,
      chat_id: rawIdentity(connectionId, row.chat_id),
      user_id: rawIdentity(connectionId, row.user_id),
      text: redactSensitive(row.text || "")
    }))
    .reverse();
}

async function loadUserMessages(env, connectionId, userId, limit = 40) {
  if (!userId) return [];
  const storedUserId = scopedIdentity(connectionId, userId);
  const rows = (await env.DB.prepare(
    `SELECT user_id, user_name, text, created_at
     FROM messages
     WHERE user_id = ? AND COALESCE(text, '') != ''
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  ).bind(storedUserId, Math.min(60, Math.max(1, limit))).all()).results || [];
  return rows.map((row) => ({ ...row, user_id: rawIdentity(connectionId, row.user_id), text: redactSensitive(row.text || "") }));
}

async function loadExistingMemories(env, connectionId, chatId, userIds = []) {
  const storedChat = scopedIdentity(connectionId, chatId);
  const storedUsers = [...new Set(userIds.filter(Boolean).map((id) => scopedIdentity(connectionId, id)))].slice(0, 12);
  const clauses = ["chat_id = ?"];
  const binds = [storedChat];
  if (storedUsers.length) {
    clauses.push(`user_id IN (${storedUsers.map(() => "?").join(",")})`);
    binds.push(...storedUsers);
  }
  const rows = (await env.DB.prepare(
    `SELECT scope, chat_id, user_id, user_name, memory_type, topic, memory_key, summary, value_json,
            confidence, importance, updated_at
     FROM chat_memories
     WHERE (${clauses.join(" OR ")})
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
     ORDER BY importance DESC, datetime(updated_at) DESC
     LIMIT 30`
  ).bind(...binds).all()).results || [];
  return rows.map((row) => ({
    ...row,
    chat_id: rawIdentity(connectionId, row.chat_id),
    user_id: rawIdentity(connectionId, row.user_id),
    value: safeJson(row.value_json, {})
  }));
}

function storageIds(connectionId, chatId, userId, scope) {
  if (normalizeConnectionId(connectionId) === "main") {
    return {
      chatId: scope === "user" ? "" : String(chatId || ""),
      userId: scope === "user" ? String(userId || "") : ""
    };
  }
  return {
    chatId: scope === "user" ? scopedIdentity(connectionId, "", true) : scopedIdentity(connectionId, chatId),
    userId: scope === "user" ? scopedIdentity(connectionId, userId) : scopedIdentity(connectionId, "", true)
  };
}

async function upsertMemory(env, connectionId, chat, entry) {
  if (!env.DB?.prepare) return false;
  const scope = ["user", "group", "chat"].includes(entry.scope) ? entry.scope : "chat";
  const targetUserId = scope === "user" ? String(entry.target_user_id || entry.user_id || "") : "";
  if (scope === "user" && !targetUserId) return false;
  const summary = truncate(redactSensitive(entry.summary || ""), 500);
  if (!summary || containsSensitiveMemory(summary)) return false;

  const topic = normalizeTopic(entry.topic || (entry.memory_type === "communication_style" ? "communication" : "general"));
  const memoryKey = normalizeMemoryKey(entry.memory_key || entry.key || entry.memory_type || topic);
  const ids = storageIds(connectionId, chat.id, targetUserId, scope);
  const ttlDays = clamp(entry.ttl_days || 0, 0, 3650);
  const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86400000).toISOString() : null;
  const value = entry.value && typeof entry.value === "object" ? entry.value : {};

  await env.DB.prepare(
    `INSERT INTO chat_memories
      (id, scope, chat_id, chat_type, chat_title, user_id, user_name, memory_type, topic, memory_key,
       summary, value_json, confidence, importance, source_message_id, expires_at, updated_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(scope, chat_id, user_id, topic, memory_key) DO UPDATE SET
       chat_type = excluded.chat_type,
       chat_title = CASE WHEN excluded.chat_title != '' THEN excluded.chat_title ELSE chat_memories.chat_title END,
       user_name = CASE WHEN excluded.user_name != '' THEN excluded.user_name ELSE chat_memories.user_name END,
       memory_type = excluded.memory_type,
       summary = excluded.summary,
       value_json = excluded.value_json,
       confidence = MAX(chat_memories.confidence, excluded.confidence),
       importance = MAX(chat_memories.importance, excluded.importance),
       source_message_id = excluded.source_message_id,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP,
       last_seen_at = CURRENT_TIMESTAMP`
  ).bind(
    crypto.randomUUID(),
    scope,
    ids.chatId,
    String(chat.type || ""),
    String(chat.title || ""),
    ids.userId,
    truncate(entry.target_user_name || entry.user_name || "", 120),
    truncate(entry.memory_type || "fact", 80),
    topic,
    memoryKey,
    summary,
    JSON.stringify(value),
    clamp(entry.confidence || 0.72, 0, 1),
    clamp(entry.importance || 2, 1, 5),
    String(entry.source_message_id || ""),
    expiresAt
  ).run();
  return true;
}

async function saveDeterministicStyles(env, connectionId, chat, messages) {
  let saved = 0;
  const byUser = new Map();
  for (const row of messages) {
    if (!row.user_id || !String(row.text || "").trim()) continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, { name: row.user_name || "", rows: [] });
    byUser.get(row.user_id).rows.push(row);
  }

  for (const [userId, info] of [...byUser.entries()].slice(0, 10)) {
    const history = await loadUserMessages(env, connectionId, userId, 40).catch(() => info.rows);
    if (history.length < 5) continue;
    const style = analyzeCommunicationStyle(history);
    if (!style) continue;
    const summary = `Cách giao tiếp của ${info.name || "người dùng"}: ${style.summary_parts.join("; ")}. Khi trả lời nên thích nghi vừa phải với nhịp/cách xưng hô này, không bắt chước lời xúc phạm.`;
    if (await upsertMemory(env, connectionId, chat, {
      scope: "user",
      target_user_id: userId,
      target_user_name: info.name,
      memory_type: "communication_style",
      topic: "communication",
      memory_key: "communication_style",
      summary,
      value: style,
      confidence: Math.min(0.92, 0.55 + history.length / 120),
      importance: 3,
      ttl_days: 0,
      source_message_id: messages.at(-1)?.message_id || ""
    })) saved += 1;
  }

  if (String(chat.type || "").toUpperCase().includes("GROUP") && messages.length >= 6) {
    const style = analyzeCommunicationStyle(messages);
    const participants = new Set(messages.map((row) => row.user_id).filter(Boolean)).size;
    if (style && await upsertMemory(env, connectionId, chat, {
      scope: "group",
      memory_type: "group_conversation_style",
      topic: "communication",
      memory_key: "group_conversation_style",
      summary: `Phong cách group: ${style.summary_parts.join("; ")}; có khoảng ${participants} người xuất hiện trong batch gần đây. Bot nên hòa vào giọng nhóm nhưng vẫn rõ ràng và lịch sự.`,
      value: { ...style, participants_in_recent_batch: participants },
      confidence: Math.min(0.9, 0.55 + messages.length / 100),
      importance: 3,
      ttl_days: 0,
      source_message_id: messages.at(-1)?.message_id || ""
    })) saved += 1;
  }

  return saved;
}

async function saveExplicitCommunicationPreference(env, connectionId, chat, message) {
  const text = redactSensitive(messageText(message));
  const normalized = normalizeText(text);
  if (!text || containsSensitiveMemory(text)) return 0;
  if (!/(goi toi|goi minh|xung ho|dung goi|dung xung|lan sau|tu nay)/.test(normalized)) return 0;
  const userId = String(message?.from?.id || "");
  if (!userId) return 0;
  return (await upsertMemory(env, connectionId, chat, {
    scope: "user",
    target_user_id: userId,
    target_user_name: message?.from?.display_name || "",
    memory_type: "communication_preference",
    topic: "communication",
    memory_key: "explicit_communication_preference",
    summary: `Quy ước giao tiếp người dùng đã nói rõ: ${truncate(text, 320)}`,
    value: { source_text: truncate(text, 500) },
    confidence: 0.96,
    importance: 5,
    ttl_days: 0,
    source_message_id: message.message_id || ""
  })) ? 1 : 0;
}

function parseAiJson(text = "") {
  const clean = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(clean.slice(start, end + 1)); } catch { return {}; }
    }
    return {};
  }
}

function extractOpenAiText(data = {}) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n").trim();
  return String(data?.output_text || data?.response || "").trim();
}

async function logMemoryAi(env, connectionId, chat, candidate, result = {}) {
  if (!env.DB?.prepare) return;
  const storedChat = scopedIdentity(connectionId, chat.id);
  const userId = result.userId ? scopedIdentity(connectionId, result.userId) : "";
  await env.DB.prepare(
    `INSERT INTO ai_usage
      (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
       ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at)
     VALUES (?, ?, 'memory_v3_extractor', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    `memory:${candidate.id}`,
    candidate.model || "",
    storedChat,
    chat.type || "",
    userId,
    result.userName || "",
    result.messageId || "",
    result.ok ? 1 : 0,
    Number(result.status || 0),
    result.ok ? "" : truncate(result.errorCode || "MEMORY_AI_ERROR", 120),
    result.ok ? "" : truncate(result.errorMessage || "", 800),
    Number(result.promptTokens || 0),
    Number(result.outputTokens || 0),
    Number(result.totalTokens || 0),
    JSON.stringify({ connection_id: connectionId, key_id: candidate.keyId || "", background: true })
  ).run().catch(() => {});
}

async function getMemoryAiCandidates(env, connectionId) {
  const policy = await evaluateAiPermission(env, connectionId).catch(() => null);
  if (connectionId !== "main" && (!policy?.allowed || !policy?.allowChat)) return [];
  const managed = await getRuntimeProviders(env).catch(() => []);
  const allowed = policy?.allowedManagedProviderIds;
  const candidates = [];

  for (const provider of managed) {
    if (Array.isArray(allowed) && !allowed.includes(provider.id)) continue;
    const model = provider.chat_model || provider.reasoning_model || provider.code_model;
    if (!model) continue;
    for (const key of provider.keys || []) {
      const pickedModel = Array.isArray(key.modelAllowlist) && key.modelAllowlist.length && !key.modelAllowlist.includes(model)
        ? key.modelAllowlist[0]
        : model;
      candidates.push({
        id: provider.id,
        type: provider.provider_type || "openai_compatible",
        baseUrl: provider.base_url || "",
        model: pickedModel,
        apiKey: key.apiKey,
        keyId: key.id,
        managed: true
      });
    }
  }

  const allowEnvGrok = connectionId === "main" || policy?.allowEnvGrok;
  const grokKey = String(env.Grok || env.GROK_API_KEY || env.XAI_API_KEY || "").trim();
  if (allowEnvGrok && grokKey) {
    candidates.push({
      id: "env-grok",
      type: "openai_compatible",
      baseUrl: String(env.NEXUS_API_BASE_URL || "https://api.nexusapi.co/v1"),
      model: String(env.GROK_MODEL || "grok-4.6"),
      apiKey: grokKey,
      keyId: "",
      managed: false
    });
  }

  const allowEnvGemini = connectionId === "main" || policy?.allowEnvGemini;
  if (allowEnvGemini && env.GEMINI_API_KEY) {
    candidates.push({
      id: "env-gemini",
      type: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
      apiKey: String(env.GEMINI_API_KEY),
      keyId: "",
      managed: false
    });
  }

  return candidates;
}

async function callMemoryCandidate(candidate, system, user) {
  if (candidate.type === "gemini") {
    const base = String(candidate.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const response = await fetch(`${base}/models/${encodeURIComponent(candidate.model)}:generateContent?key=${encodeURIComponent(candidate.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500, responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(MEMORY_AI_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("\n").trim();
    if (!response.ok || !text) throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
    return {
      text,
      status: response.status,
      model: candidate.model,
      promptTokens: data?.usageMetadata?.promptTokenCount || 0,
      outputTokens: data?.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data?.usageMetadata?.totalTokenCount || 0
    };
  }

  const response = await fetch(`${String(candidate.baseUrl || "").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${candidate.apiKey}` },
    body: JSON.stringify({
      model: candidate.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: "json_object" }
    }),
    signal: AbortSignal.timeout(MEMORY_AI_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const text = extractOpenAiText(data);
  if (!response.ok || !text) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  return {
    text,
    status: response.status,
    model: data?.model || candidate.model,
    promptTokens: data?.usage?.prompt_tokens || data?.usage?.input_tokens || 0,
    outputTokens: data?.usage?.completion_tokens || data?.usage?.output_tokens || 0,
    totalTokens: data?.usage?.total_tokens || 0
  };
}

async function extractAiMemories(env, connectionId, chat, messages, existingMemories) {
  const candidates = await getMemoryAiCandidates(env, connectionId);
  if (!candidates.length || !messages.length) return { saved: 0, provider: "", error: "ai_not_available" };

  const observedUsers = new Map(messages.filter((row) => row.user_id).map((row) => [row.user_id, row.user_name || ""]));
  const transcript = messages.map((row) => `[${row.created_at || ""}] ${row.user_name || "User"} (${row.user_id || ""}): ${truncate(row.text || "", 700)}`).join("\n");
  const existing = existingMemories.slice(0, 24).map((row) => `- ${row.scope}/${row.topic}/${row.memory_key}: ${row.summary}`).join("\n");
  const system = `Bạn là Memory V3 extractor cho chatbot Zalo. Chỉ trả JSON hợp lệ.\n\nMục tiêu: rút ra trí nhớ BỀN VỮ giúp bot hiểu người, group và công việc sau nhiều ngày/tháng. Không phải tóm tắt hội thoại.\n\nĐược lưu: cách xưng hô/cách nói, sở thích ổn định, vai trò công việc, quan hệ/xưng hô giữa người, quy ước group, từ viết tắt/alias, quyết định đã chốt, thói quen hoặc nhu cầu lặp lại.\nKhông lưu: chào hỏi, câu hỏi một lần, thời tiết tạm thời, suy đoán, mật khẩu/token/API key/OTP/thẻ ngân hàng, dữ liệu sức khỏe/tôn giáo/chính trị/đời sống tình dục hoặc thông tin nhạy cảm không cần thiết. Không bịa.\n\nSchema bắt buộc:\n{"memories":[{"scope":"user|group|chat","target_user_id":"chỉ bắt buộc nếu scope=user","target_user_name":"","memory_type":"communication_style|communication_preference|preference|work_context|relationship|group_convention|decision|entity_alias|fact","topic":"communication|work|rental|general","memory_key":"stable_snake_case_key","summary":"1-2 câu ngắn","value":{},"confidence":0.0,"importance":1,"ttl_days":0}]}\n\nDùng memory_key ổn định để lần sau UPDATE cùng trí nhớ thay vì tạo vô hạn. communication_style, communication_preference và group_convention thường ttl_days=0. Thông tin tạm thời có ttl_days phù hợp.`;
  const user = `Connection: ${connectionId}\nChat: ${chat.title || chat.id} (${chat.type || ""})\n\nMemory hiện có:\n${existing || "(chưa có)"}\n\nCác user_id hợp lệ cho scope=user:\n${[...observedUsers.entries()].map(([id, name]) => `${id} = ${name}`).join("\n") || "(không có)"}\n\nHội thoại gần đây:\n${transcript}\n\nChỉ trích xuất tối đa ${MAX_MEMORY_ENTRIES} memory thực sự đáng nhớ.`;

  let lastError = "";
  for (const candidate of candidates) {
    try {
      const result = await callMemoryCandidate(candidate, system, user);
      if (candidate.managed && candidate.keyId) await markApiKeyResult(env, candidate.keyId, true).catch(() => {});
      await logMemoryAi(env, connectionId, chat, { ...candidate, model: result.model }, {
        ok: true,
        status: result.status,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        messageId: messages.at(-1)?.message_id || ""
      });
      const parsed = parseAiJson(result.text);
      const entries = Array.isArray(parsed?.memories) ? parsed.memories.slice(0, MAX_MEMORY_ENTRIES) : [];
      let saved = 0;
      for (const entry of entries) {
        if (!["user", "group", "chat"].includes(entry?.scope)) continue;
        if (entry.scope === "user" && !observedUsers.has(String(entry.target_user_id || ""))) continue;
        const summary = String(entry.summary || "");
        if (!summary || containsSensitiveMemory(summary)) continue;
        if (await upsertMemory(env, connectionId, chat, {
          ...entry,
          target_user_name: entry.target_user_name || observedUsers.get(String(entry.target_user_id || "")) || "",
          source_message_id: messages.at(-1)?.message_id || ""
        })) saved += 1;
      }
      return { saved, provider: candidate.id, error: "" };
    } catch (error) {
      lastError = String(error?.message || error);
      if (candidate.managed && candidate.keyId) await markApiKeyResult(env, candidate.keyId, false, lastError).catch(() => {});
      await logMemoryAi(env, connectionId, chat, candidate, {
        ok: false,
        status: 0,
        errorCode: error?.name || "MEMORY_AI_ERROR",
        errorMessage: lastError,
        messageId: messages.at(-1)?.message_id || ""
      });
    }
  }
  return { saved: 0, provider: "", error: truncate(lastError || "all_memory_providers_failed", 500) };
}

async function markExtractionResult(env, connectionId, chatId, result) {
  const keepPending = Boolean(result?.retry);
  await env.DB.prepare(
    `UPDATE memory_pipeline_state SET
       pending_count = CASE WHEN ? THEN MIN(pending_count, ?) ELSE 0 END,
       last_extracted_at = CURRENT_TIMESTAMP,
       total_extractions = total_extractions + 1,
       last_error = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE connection_id = ? AND chat_id = ?`
  ).bind(keepPending ? 1 : 0, BATCH_TRIGGER_COUNT, truncate(result?.error || "", 500), connectionId, chatId).run();
}

async function runMemoryExtractionForChat(env, connectionId, chatId, options = {}) {
  if (!env.DB?.prepare || !chatId) return { ok: false, saved: 0, error: "db_or_chat_missing" };
  const id = normalizeConnectionId(connectionId || "main");
  const state = await env.DB.prepare(
    `SELECT connection_id, chat_id, chat_type, chat_title, last_message_id, pending_count
     FROM memory_pipeline_state WHERE connection_id = ? AND chat_id = ? LIMIT 1`
  ).bind(id, chatId).first();
  const chat = {
    id: chatId,
    type: options.chatType || state?.chat_type || "",
    title: options.chatTitle || state?.chat_title || ""
  };
  const messages = await loadChatMessages(env, id, chatId, MAX_BATCH_MESSAGES);
  if (!messages.length) {
    await markExtractionResult(env, id, chatId, { error: "no_messages", retry: false });
    return { ok: true, saved: 0, error: "no_messages" };
  }

  const userIds = [...new Set(messages.map((row) => row.user_id).filter(Boolean))];
  const existing = await loadExistingMemories(env, id, chatId, userIds).catch(() => []);
  const deterministicSaved = await saveDeterministicStyles(env, id, chat, messages).catch((error) => {
    console.error("Memory V3 deterministic style failed:", error);
    return 0;
  });
  const ai = messages.length >= MIN_BATCH_MESSAGES || options.forceAi
    ? await extractAiMemories(env, id, chat, messages, existing)
    : { saved: 0, provider: "", error: "batch_too_small" };
  const retry = Boolean(ai.error && !["ai_not_available", "batch_too_small"].includes(ai.error));
  await markExtractionResult(env, id, chatId, { error: ai.error, retry });
  return {
    ok: !retry,
    saved: deterministicSaved + Number(ai.saved || 0),
    deterministic_saved: deterministicSaved,
    ai_saved: Number(ai.saved || 0),
    provider: ai.provider || "",
    error: ai.error || "",
    messages: messages.length
  };
}

async function queueMemoryEvent(env, connectionId, eventName, message) {
  if (!env.DB?.prepare || !message?.chat?.id) return { queued: false };
  const id = normalizeConnectionId(connectionId || "main");
  const state = await touchPipelineState(env, id, eventName, message);
  const chat = { id: String(message.chat.id), type: message.chat?.chat_type || "", title: message.chat?.title || "" };
  const explicitSaved = await saveExplicitCommunicationPreference(env, id, chat, message).catch(() => 0);
  if (!shouldRunNow(state, messageText(message))) return { queued: true, extracted: false, explicit_saved: explicitSaved };
  const result = await runMemoryExtractionForChat(env, id, chat.id, {
    chatType: chat.type,
    chatTitle: chat.title,
    forceAi: isHighSignalMemoryText(messageText(message))
  });
  return { queued: true, extracted: true, explicit_saved: explicitSaved, ...result };
}

async function processPendingMemoryPipelines(env, limit = 16) {
  if (!env.DB?.prepare) return { checked: 0, processed: 0, results: [] };
  const rows = (await env.DB.prepare(
    `SELECT connection_id, chat_id, chat_type, chat_title, pending_count, last_event_at, last_extracted_at
     FROM memory_pipeline_state
     WHERE pending_count > 0
       AND (pending_count >= ? OR datetime(last_event_at) <= datetime('now', ?))
     ORDER BY pending_count DESC, datetime(last_event_at) ASC
     LIMIT ?`
  ).bind(BATCH_TRIGGER_COUNT, `-${IDLE_TRIGGER_MINUTES} minutes`, Math.max(1, Math.min(50, limit))).all()).results || [];
  const results = [];
  for (const row of rows) {
    try {
      results.push(await runMemoryExtractionForChat(env, row.connection_id, row.chat_id, {
        chatType: row.chat_type,
        chatTitle: row.chat_title
      }));
    } catch (error) {
      const message = truncate(error?.message || error, 500);
      await env.DB.prepare(
        `UPDATE memory_pipeline_state SET last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE connection_id = ? AND chat_id = ?`
      ).bind(message, row.connection_id, row.chat_id).run().catch(() => {});
      results.push({ ok: false, saved: 0, error: message });
    }
  }
  return { checked: rows.length, processed: results.length, results };
}

export {
  analyzeCommunicationStyle,
  isHighSignalMemoryText,
  processPendingMemoryPipelines,
  queueMemoryEvent,
  runMemoryExtractionForChat,
  shouldRunNow
};
