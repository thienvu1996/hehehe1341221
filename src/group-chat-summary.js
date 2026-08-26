import { getRuntimeProviders, markApiKeyResult } from "./config-manager.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { connectionPrefix, normalizeConnectionId, unscopeValue } from "./scoped-db.js";

const DEFAULT_NEXUS_BASE_URL = "https://api.nexusapi.co/v1";
const MAX_MESSAGES_FOR_SUMMARY = 260;

function safeJson(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function scopeSql(connectionId) {
  const id = normalizeConnectionId(connectionId || "main");
  if (id === "main") return "m.chat_id NOT LIKE '@bot:%'";
  return `m.chat_id LIKE '${connectionPrefix(id).replace(/'/g, "''")}%'`;
}

function groupTitle(row) {
  if (row.chat_title) return row.chat_title;
  const meta = safeJson(row.metadata_json, {});
  return meta?.message?.chat_title || meta?.chat_title || meta?.message?.chat?.title || "Nhóm chưa đặt tên";
}

async function getCapturedGroupData(env, connectionId, hours = 24) {
  const id = normalizeConnectionId(connectionId || "main");
  const boundedHours = Math.min(24 * 30, Math.max(1, Number(hours || 24)));
  const rows = env.DB?.prepare
    ? (await env.DB.prepare(
        `SELECT m.id, m.chat_id, m.chat_type, m.user_id, m.user_name, m.message_id, m.text,
                m.message_date, m.metadata_json, m.created_at,
                COALESCE(NULLIF(a.chat_title, ''), '') AS chat_title
         FROM messages AS m
         LEFT JOIN chat_aliases AS a ON a.chat_id = m.chat_id
         WHERE ${scopeSql(id)}
           AND UPPER(COALESCE(m.chat_type, '')) LIKE '%GROUP%'
           AND datetime(m.created_at) >= datetime('now', ?)
         ORDER BY datetime(m.created_at) DESC
         LIMIT 1200`
      ).bind(`-${boundedHours} hours`).all()).results || []
    : [];

  const normalizedRows = rows.map((row) => ({
    ...row,
    chat_id: unscopeValue(row.chat_id, id),
    chat_title: groupTitle(row)
  }));

  const grouped = new Map();
  for (const row of normalizedRows) {
    const key = row.chat_id || "unknown";
    const item = grouped.get(key) || {
      chat_id: key,
      chat_title: row.chat_title || "Nhóm chưa đặt tên",
      message_count: 0,
      participants: new Set(),
      last_message_at: row.created_at,
      recent: []
    };
    item.message_count += 1;
    if (row.user_name) item.participants.add(row.user_name);
    if (!item.last_message_at || String(row.created_at) > String(item.last_message_at)) item.last_message_at = row.created_at;
    if (item.recent.length < 12) item.recent.push(row);
    grouped.set(key, item);
  }

  const groups = [...grouped.values()]
    .map((item) => ({
      chat_id: item.chat_id,
      chat_title: item.chat_title,
      message_count: item.message_count,
      participant_count: item.participants.size,
      participants: [...item.participants].slice(0, 12),
      last_message_at: item.last_message_at,
      recent: item.recent
    }))
    .sort((a, b) => String(b.last_message_at || "").localeCompare(String(a.last_message_at || "")));

  return {
    connection_id: id,
    hours: boundedHours,
    message_count: normalizedRows.length,
    group_count: groups.length,
    groups,
    messages: normalizedRows
  };
}

function makeSummaryPrompt(data) {
  const selected = data.messages.slice(0, MAX_MESSAGES_FOR_SUMMARY).reverse();
  const transcript = selected.map((row) => {
    const title = row.chat_title || row.chat_id || "Nhóm";
    return `[${row.created_at || ""}] [${title}] ${row.user_name || "Người dùng"}: ${String(row.text || "").slice(0, 900)}`;
  }).join("\n");

  return `Bạn đang tổng hợp dữ liệu công việc từ nhiều nhóm Zalo cho chủ dashboard.
Chỉ dùng dữ liệu được cung cấp, không bịa. Viết tiếng Việt có dấu, ngắn gọn nhưng hữu ích.

Hãy trả về:
1. Tóm tắt chung trong khoảng thời gian.
2. Theo từng nhóm: việc đang bàn, thông tin quan trọng, người liên quan.
3. Việc cần làm / deadline / yêu cầu đang chờ.
4. Các số liệu, giá, địa điểm, link hoặc quyết định đáng chú ý nếu có.
5. Mục "Cần kiểm tra lại" cho thông tin mơ hồ hoặc thiếu dữ kiện.

Lưu ý: dữ liệu Zalo Bot trong group có thể chỉ gồm các tin mà nền tảng chuyển tới bot; đừng khẳng định đây là toàn bộ hội thoại.

DỮ LIỆU (${selected.length}/${data.message_count} tin gần nhất):
${transcript || "Không có tin nhắn nhóm trong khoảng thời gian."}`;
}

function extractOpenAiText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n").trim();
  return String(data?.output_text || data?.response || "").trim();
}

async function callOpenAiCompatible(baseUrl, apiKey, model, prompt) {
  const response = await fetch(`${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Bạn là trợ lý tổng hợp dữ liệu công việc từ hội thoại Zalo." },
        { role: "user", content: prompt }
      ],
      temperature: 0.25,
      max_tokens: 1800
    }),
    signal: AbortSignal.timeout(35000)
  });
  const data = await response.json().catch(() => ({}));
  const text = extractOpenAiText(data);
  if (!response.ok || !text) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  return { text, model: data?.model || model, status: response.status, usage: data?.usage || {} };
}

async function callGemini(baseUrl, apiKey, model, prompt) {
  const base = String(baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const response = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 1800 }
    }),
    signal: AbortSignal.timeout(35000)
  });
  const data = await response.json().catch(() => ({}));
  const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("\n").trim();
  if (!response.ok || !text) throw new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
  return {
    text,
    model,
    status: response.status,
    usage: {
      prompt_tokens: data?.usageMetadata?.promptTokenCount || 0,
      completion_tokens: data?.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: data?.usageMetadata?.totalTokenCount || 0
    }
  };
}

async function logSummaryUsage(env, connectionId, provider, result, errorMessage = "") {
  if (!env.DB?.prepare) return;
  const id = normalizeConnectionId(connectionId || "main");
  const syntheticChatId = id === "main" ? "__dashboard_group_summary__" : `${connectionPrefix(id)}__dashboard_group_summary__`;
  const usage = result?.usage || {};
  await env.DB.prepare(
    `INSERT INTO ai_usage
      (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
       ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens,
       metadata_json, created_at)
     VALUES (?, ?, 'group_summary', ?, 'DASHBOARD', '', 'Dashboard', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    provider,
    result?.model || "",
    syntheticChatId,
    `summary-${Date.now()}`,
    errorMessage ? 0 : 1,
    Number(result?.status || 0),
    errorMessage ? "SUMMARY_ERROR" : "",
    String(errorMessage || "").slice(0, 800),
    Number(usage.prompt_tokens || usage.input_tokens || 0),
    Number(usage.completion_tokens || usage.output_tokens || 0),
    Number(usage.total_tokens || 0),
    JSON.stringify({ connection_id: id, source: "dashboard-group-summary" })
  ).run().catch(() => {});
}

async function runSummaryAi(env, connectionId, prompt) {
  const id = normalizeConnectionId(connectionId || "main");
  const policy = await evaluateAiPermission(env, id);
  if (id !== "main" && (!policy.allowed || !policy.allowChat)) {
    const reason = policy.quotaExceeded ? "Bot đã chạm quota AI được chia sẻ." : "Bot chưa được cấp quyền Chat AI.";
    throw new Error(reason);
  }

  const managed = await getRuntimeProviders(env).catch(() => []);
  const allowedManaged = policy.allowedManagedProviderIds;
  const providers = allowedManaged === "*"
    ? managed
    : managed.filter((provider) => Array.isArray(allowedManaged) && allowedManaged.includes(provider.id));

  for (const provider of providers) {
    const model = provider.chat_model || provider.reasoning_model || provider.code_model;
    if (!model) continue;
    for (const key of provider.keys || []) {
      const selectedModel = Array.isArray(key.modelAllowlist) && key.modelAllowlist.length && !key.modelAllowlist.includes(model)
        ? key.modelAllowlist[0]
        : model;
      try {
        const result = provider.provider_type === "gemini"
          ? await callGemini(provider.base_url, key.apiKey, selectedModel, prompt)
          : await callOpenAiCompatible(provider.base_url, key.apiKey, selectedModel, prompt);
        await markApiKeyResult(env, key.id, true);
        await logSummaryUsage(env, id, `managed:${provider.id}`, result);
        return { summary: result.text, provider: `managed:${provider.id}`, model: result.model };
      } catch (error) {
        const message = String(error?.message || error);
        await markApiKeyResult(env, key.id, false, message);
        await logSummaryUsage(env, id, `managed:${provider.id}`, { model: selectedModel }, message);
      }
    }
  }

  if (policy.allowEnvGrok) {
    const apiKey = String(env.Grok || env.GROK_API_KEY || env.XAI_API_KEY || "").trim();
    if (apiKey) {
      try {
        const result = await callOpenAiCompatible(
          env.NEXUS_API_BASE_URL || DEFAULT_NEXUS_BASE_URL,
          apiKey,
          env.GROK_MODEL || "grok-4.6",
          prompt
        );
        await logSummaryUsage(env, id, "nexus-grok", result);
        return { summary: result.text, provider: "nexus-grok", model: result.model };
      } catch (error) {
        await logSummaryUsage(env, id, "nexus-grok", { model: env.GROK_MODEL || "grok-4.6" }, String(error?.message || error));
      }
    }
  }

  if (policy.allowEnvGemini && env.GEMINI_API_KEY) {
    const result = await callGemini(
      "https://generativelanguage.googleapis.com/v1beta",
      String(env.GEMINI_API_KEY),
      String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
      prompt
    );
    await logSummaryUsage(env, id, "gemini", result);
    return { summary: result.text, provider: "gemini", model: result.model };
  }

  throw new Error("Không có AI provider khả dụng cho bot này.");
}

async function getLatestSummary(env, connectionId, hours) {
  if (!env.DB?.prepare) return null;
  return env.DB.prepare(
    `SELECT id, connection_id, hours, message_count, group_count, summary, provider, model, created_at
     FROM group_chat_summaries
     WHERE connection_id = ? AND hours = ?
     ORDER BY datetime(created_at) DESC
     LIMIT 1`
  ).bind(normalizeConnectionId(connectionId || "main"), Number(hours || 24)).first().catch(() => null);
}

async function generateGroupSummary(env, connectionId, hours = 24) {
  const data = await getCapturedGroupData(env, connectionId, hours);
  if (!data.message_count) {
    return { ...data, summary: "Chưa có tin nhắn group nào được Zalo chuyển tới bot trong khoảng thời gian này.", provider: "none", model: "" };
  }

  const ai = await runSummaryAi(env, data.connection_id, makeSummaryPrompt(data));
  await env.DB.prepare(
    `INSERT INTO group_chat_summaries
      (id, connection_id, hours, message_count, group_count, summary, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(
    crypto.randomUUID(),
    data.connection_id,
    data.hours,
    data.message_count,
    data.group_count,
    ai.summary,
    ai.provider,
    ai.model
  ).run();

  return { ...data, ...ai };
}

export { generateGroupSummary, getCapturedGroupData, getLatestSummary, makeSummaryPrompt };
