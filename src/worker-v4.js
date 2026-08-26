import workerV3, { verifyDashboardSessionToken } from "./worker-v3.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getDashboardCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token, X-Bot-Api-Secret-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function dashboardJson(request, data, status = 200) {
  return json(data, status, getDashboardCorsHeaders(request));
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

async function safeAll(env, sql, label, warnings) {
  try {
    const result = await env.DB.prepare(sql).all();
    return result.results || [];
  } catch (error) {
    const message = String(error?.message || error);
    console.error(`Dashboard query failed [${label}]:`, message);
    warnings.push(label);
    return [];
  }
}

async function safeFirst(env, sql, label, warnings) {
  try {
    return (await env.DB.prepare(sql).first()) || null;
  } catch (error) {
    const message = String(error?.message || error);
    console.error(`Dashboard query failed [${label}]:`, message);
    warnings.push(label);
    return null;
  }
}

async function getCount(env, tableName, warnings) {
  const allowed = new Set([
    "messages",
    "links",
    "searches",
    "images",
    "ai_usage",
    "chat_settings",
    "reminders",
    "chat_memories"
  ]);

  if (!allowed.has(tableName)) {
    return 0;
  }

  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).first();
    return Number(row?.total || 0);
  } catch (error) {
    console.error(`Dashboard count failed [${tableName}]:`, error);
    warnings.push(`count:${tableName}`);
    return 0;
  }
}

async function handleDashboardData(request, env) {
  const sessionToken = request.headers.get("x-dashboard-token") || "";

  if (!sessionToken.startsWith("v1.")) {
    return null;
  }

  if (!(await verifyDashboardSessionToken(env, sessionToken))) {
    return dashboardJson(request, { message: "Session expired" }, 403);
  }

  if (!env.DB?.prepare) {
    return dashboardJson(request, { ok: false, message: "Cloudflare D1 is not configured" }, 500);
  }

  const warnings = [];

  const [
    counts,
    messages,
    links,
    searches,
    images,
    aiStats,
    aiUsage,
    chatSettings,
    reminders,
    memories,
    botProfile
  ] = await Promise.all([
    Promise.all(
      ["messages", "links", "searches", "images", "ai_usage", "chat_settings", "reminders", "chat_memories"].map(
        async (name) => [name, await getCount(env, name, warnings)]
      )
    ).then((pairs) => Object.fromEntries(pairs)),
    safeAll(
      env,
      `SELECT id, chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at
       FROM messages
       ORDER BY datetime(created_at) DESC
       LIMIT 40`,
      "messages",
      warnings
    ),
    safeAll(
      env,
      `SELECT id, chat_id, chat_type, user_name, message_id, url, source_text, title, description,
              summary, price_text, area_text, status, http_status, metadata_json, last_checked_at, created_at, updated_at
       FROM links
       ORDER BY datetime(updated_at) DESC
       LIMIT 60`,
      "links",
      warnings
    ),
    safeAll(
      env,
      `SELECT id, chat_id, user_name, query, answer, sources_json, metadata_json, created_at
       FROM searches
       ORDER BY datetime(created_at) DESC
       LIMIT 30`,
      "searches",
      warnings
    ),
    safeAll(
      env,
      `SELECT id, chat_id, user_name, message_id, photo_url, caption, analysis, metadata_json, created_at
       FROM images
       ORDER BY datetime(created_at) DESC
       LIMIT 30`,
      "images",
      warnings
    ),
    safeFirst(
      env,
      `SELECT
         COUNT(*) AS calls_total,
         SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS calls_ok,
         SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS calls_error,
         SUM(CASE WHEN http_status = 429 OR error_code LIKE '%RESOURCE_EXHAUSTED%' OR lower(error_message) LIKE '%quota%' THEN 1 ELSE 0 END) AS quota_errors,
         SUM(prompt_tokens) AS prompt_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(total_tokens) AS total_tokens,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS calls_24h,
         SUM(CASE WHEN ok = 0 AND created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS errors_24h,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN total_tokens ELSE 0 END) AS tokens_24h
       FROM ai_usage`,
      "ai-stats",
      warnings
    ),
    safeAll(
      env,
      `SELECT id, provider, model, feature, chat_id, chat_type, user_name, ok, http_status, error_code,
              error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at
       FROM ai_usage
       ORDER BY datetime(created_at) DESC
       LIMIT 60`,
      "ai-usage",
      warnings
    ),
    safeAll(
      env,
      `SELECT settings.chat_id,
              settings.chat_type,
              COALESCE(NULLIF(alias.chat_title, ''), settings.chat_title) AS chat_title,
              settings.user_name,
              settings.weather_enabled,
              settings.weather_time,
              settings.weather_location,
              settings.timezone,
              settings.last_weather_sent_date,
              settings.updated_at
       FROM chat_settings AS settings
       LEFT JOIN chat_aliases AS alias ON alias.chat_id = settings.chat_id
       ORDER BY datetime(settings.updated_at) DESC
       LIMIT 60`,
      "chat-settings",
      warnings
    ),
    safeAll(
      env,
      `SELECT reminders.id,
              reminders.chat_id,
              reminders.chat_type,
              COALESCE(NULLIF(alias.chat_title, ''), reminders.chat_title) AS chat_title,
              reminders.user_name,
              reminders.title,
              reminders.due_at_utc,
              reminders.due_local_date,
              reminders.due_local_time,
              reminders.timezone,
              reminders.status,
              reminders.sent_at,
              reminders.created_at,
              reminders.metadata_json
       FROM reminders
       LEFT JOIN chat_aliases AS alias ON alias.chat_id = reminders.chat_id
       ORDER BY
         CASE WHEN reminders.status = 'pending' THEN 0 ELSE 1 END,
         datetime(reminders.due_at_utc) ASC
       LIMIT 80`,
      "reminders",
      warnings
    ),
    safeAll(
      env,
      `SELECT memories.id,
              memories.scope,
              memories.chat_id,
              memories.chat_type,
              COALESCE(NULLIF(alias.chat_title, ''), memories.chat_title) AS chat_title,
              memories.user_id,
              memories.user_name,
              memories.memory_type,
              memories.topic,
              memories.memory_key,
              memories.summary,
              memories.value_json,
              memories.confidence,
              memories.importance,
              memories.expires_at,
              memories.updated_at,
              memories.last_seen_at
       FROM chat_memories AS memories
       LEFT JOIN chat_aliases AS alias ON alias.chat_id = memories.chat_id
       WHERE memories.expires_at IS NULL OR datetime(memories.expires_at) > datetime('now')
       ORDER BY memories.importance DESC, datetime(memories.updated_at) DESC
       LIMIT 100`,
      "memories",
      warnings
    ),
    safeFirst(
      env,
      `SELECT display_name, gender, age, speaking_style, persona, default_language, updated_at
       FROM bot_profile
       WHERE id = 'default'
       LIMIT 1`,
      "bot-profile",
      warnings
    )
  ]);

  const stats = aiStats || {};
  const profile = botProfile || {
    display_name: "Bot Thu Thap atess",
    gender: "không cố định",
    age: "",
    speaking_style: "Tự nhiên, thân thiện, ngắn gọn, hỏi lại khi thiếu thông tin.",
    persona: "Trợ lý Zalo giúp thu thập link thuê nhà, đọc ảnh, nhắc lịch, thời tiết và hỗ trợ nhóm như một người phụ tá.",
    default_language: "vi"
  };

  return dashboardJson(request, {
    ok: true,
    generated_at: new Date().toISOString(),
    profile,
    counts,
    ai_usage: {
      stats: {
        calls_total: Number(stats.calls_total || 0),
        calls_ok: Number(stats.calls_ok || 0),
        calls_error: Number(stats.calls_error || 0),
        quota_errors: Number(stats.quota_errors || 0),
        prompt_tokens: Number(stats.prompt_tokens || 0),
        output_tokens: Number(stats.output_tokens || 0),
        total_tokens: Number(stats.total_tokens || 0),
        calls_24h: Number(stats.calls_24h || 0),
        errors_24h: Number(stats.errors_24h || 0),
        tokens_24h: Number(stats.tokens_24h || 0)
      },
      recent: aiUsage.map((row) => ({ ...row, metadata: safeJsonParse(row.metadata_json) }))
    },
    recent: {
      messages: messages.map((row) => ({ ...row, metadata: safeJsonParse(row.metadata_json) })),
      links: links.map((row) => ({ ...row, metadata: safeJsonParse(row.metadata_json) })),
      searches: searches.map((row) => ({
        ...row,
        sources: safeJsonParse(row.sources_json, []),
        metadata: safeJsonParse(row.metadata_json)
      })),
      images: images.map((row) => ({ ...row, metadata: safeJsonParse(row.metadata_json) })),
      chat_settings: chatSettings,
      reminders: reminders.map((row) => ({ ...row, metadata: safeJsonParse(row.metadata_json) })),
      memories: memories.map((row) => ({ ...row, value: safeJsonParse(row.value_json) }))
    },
    warnings: Array.from(new Set(warnings))
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/admin/dashboard-data") {
      try {
        const response = await handleDashboardData(request, env);
        if (response) {
          return response;
        }
      } catch (error) {
        console.error("Dashboard data endpoint failed:", error);
        return dashboardJson(request, { ok: false, message: "Dashboard data failed" }, 500);
      }
    }

    return workerV3.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV3.scheduled === "function") {
      return workerV3.scheduled(event, env, ctx);
    }
  }
};
