const BOT_SCOPE_PREFIX = "@bot:";

function normalizeId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function safeJson(value, fallback = []) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function scopeWhere(connectionId) {
  const id = normalizeId(connectionId || "main") || "main";
  if (id === "main") return "chat_id NOT LIKE '@bot:%'";
  const prefix = `${BOT_SCOPE_PREFIX}${id}:%`.replace(/'/g, "''");
  return `chat_id LIKE '${prefix}'`;
}

async function getUsage(env, connectionId) {
  if (!env.DB?.prepare) {
    return { day_requests: 0, day_tokens: 0, month_requests: 0, month_tokens: 0 };
  }
  const where = scopeWhere(connectionId);
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN date(created_at, '+7 hours') = date('now', '+7 hours') THEN 1 ELSE 0 END) AS day_requests,
       SUM(CASE WHEN date(created_at, '+7 hours') = date('now', '+7 hours') THEN COALESCE(total_tokens,0) ELSE 0 END) AS day_tokens,
       SUM(CASE WHEN strftime('%Y-%m', created_at, '+7 hours') = strftime('%Y-%m', 'now', '+7 hours') THEN 1 ELSE 0 END) AS month_requests,
       SUM(CASE WHEN strftime('%Y-%m', created_at, '+7 hours') = strftime('%Y-%m', 'now', '+7 hours') THEN COALESCE(total_tokens,0) ELSE 0 END) AS month_tokens
     FROM ai_usage
     WHERE ${where}`
  ).first().catch(() => null);

  return {
    day_requests: Number(row?.day_requests || 0),
    day_tokens: Number(row?.day_tokens || 0),
    month_requests: Number(row?.month_requests || 0),
    month_tokens: Number(row?.month_tokens || 0)
  };
}

async function listAiPermissions(env) {
  if (!env.DB?.prepare) return [];
  const rows = (await env.DB.prepare(
    `SELECT connection_id, enabled, inherit_main, provider_ids_json,
            allow_chat, allow_reasoning, allow_code,
            daily_request_limit, daily_token_limit,
            monthly_request_limit, monthly_token_limit,
            created_at, updated_at
     FROM bot_ai_permissions
     ORDER BY connection_id`
  ).all()).results || [];

  const result = [];
  for (const row of rows) {
    result.push({
      ...row,
      provider_ids: safeJson(row.provider_ids_json, []),
      usage: await getUsage(env, row.connection_id)
    });
  }
  return result;
}

async function getAiPermission(env, connectionId) {
  const id = normalizeId(connectionId || "main") || "main";
  if (id === "main") {
    return {
      connection_id: "main",
      enabled: 1,
      inherit_main: 1,
      provider_ids: ["*"],
      allow_chat: 1,
      allow_reasoning: 1,
      allow_code: 1,
      daily_request_limit: 0,
      daily_token_limit: 0,
      monthly_request_limit: 0,
      monthly_token_limit: 0,
      source: "owner"
    };
  }
  if (!env.DB?.prepare) return null;
  const row = await env.DB.prepare(
    `SELECT connection_id, enabled, inherit_main, provider_ids_json,
            allow_chat, allow_reasoning, allow_code,
            daily_request_limit, daily_token_limit,
            monthly_request_limit, monthly_token_limit,
            created_at, updated_at
     FROM bot_ai_permissions
     WHERE connection_id = ? LIMIT 1`
  ).bind(id).first();
  if (!row) return null;
  return { ...row, provider_ids: safeJson(row.provider_ids_json, []) };
}

async function upsertAiPermission(env, input) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  const connectionId = normalizeId(input.connection_id);
  if (!connectionId || connectionId === "main") throw new Error("Chỉ cấp quyền cho bot phụ");
  const providers = Array.isArray(input.provider_ids)
    ? [...new Set(input.provider_ids.map(normalizeId).filter(Boolean))]
    : [];

  await env.DB.prepare(
    `INSERT INTO bot_ai_permissions
      (connection_id, enabled, inherit_main, provider_ids_json,
       allow_chat, allow_reasoning, allow_code,
       daily_request_limit, daily_token_limit,
       monthly_request_limit, monthly_token_limit,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(connection_id) DO UPDATE SET
       enabled = excluded.enabled,
       inherit_main = excluded.inherit_main,
       provider_ids_json = excluded.provider_ids_json,
       allow_chat = excluded.allow_chat,
       allow_reasoning = excluded.allow_reasoning,
       allow_code = excluded.allow_code,
       daily_request_limit = excluded.daily_request_limit,
       daily_token_limit = excluded.daily_token_limit,
       monthly_request_limit = excluded.monthly_request_limit,
       monthly_token_limit = excluded.monthly_token_limit,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    connectionId,
    input.enabled === false ? 0 : 1,
    input.inherit_main === false ? 0 : 1,
    JSON.stringify(providers),
    input.allow_chat === false ? 0 : 1,
    input.allow_reasoning === false ? 0 : 1,
    input.allow_code === false ? 0 : 1,
    num(input.daily_request_limit),
    num(input.daily_token_limit),
    num(input.monthly_request_limit),
    num(input.monthly_token_limit)
  ).run();
  return connectionId;
}

async function deleteAiPermission(env, connectionId) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  await env.DB.prepare("DELETE FROM bot_ai_permissions WHERE connection_id = ?")
    .bind(normalizeId(connectionId)).run();
}

function reached(value, limit) {
  return Number(limit || 0) > 0 && Number(value || 0) >= Number(limit || 0);
}

async function evaluateAiPermission(env, connectionId) {
  const id = normalizeId(connectionId || "main") || "main";
  const permission = await getAiPermission(env, id);
  const usage = await getUsage(env, id);

  if (id === "main") {
    return {
      connectionId: id,
      allowed: true,
      quotaExceeded: false,
      inheritMain: true,
      allowedManagedProviderIds: "*",
      allowEnvGrok: true,
      allowEnvGemini: true,
      allowChat: true,
      allowReasoning: true,
      allowCode: true,
      usage,
      permission
    };
  }

  if (!permission || !Number(permission.enabled)) {
    return {
      connectionId: id,
      allowed: false,
      quotaExceeded: false,
      reason: "not_granted",
      inheritMain: false,
      allowedManagedProviderIds: [],
      allowEnvGrok: false,
      allowEnvGemini: false,
      allowChat: false,
      allowReasoning: false,
      allowCode: false,
      usage,
      permission
    };
  }

  const quotaExceeded =
    reached(usage.day_requests, permission.daily_request_limit) ||
    reached(usage.day_tokens, permission.daily_token_limit) ||
    reached(usage.month_requests, permission.monthly_request_limit) ||
    reached(usage.month_tokens, permission.monthly_token_limit);

  const ids = Array.isArray(permission.provider_ids) ? permission.provider_ids : [];
  const inheritMain = Number(permission.inherit_main) === 1;
  const managedIds = inheritMain ? "*" : ids.filter((idValue) => !idValue.startsWith("env-"));

  return {
    connectionId: id,
    allowed: !quotaExceeded,
    quotaExceeded,
    reason: quotaExceeded ? "quota_exceeded" : "ok",
    inheritMain,
    allowedManagedProviderIds: managedIds,
    allowEnvGrok: !quotaExceeded && (inheritMain || ids.includes("env-grok")),
    allowEnvGemini: !quotaExceeded && (inheritMain || ids.includes("env-gemini")),
    allowChat: !quotaExceeded && Number(permission.allow_chat) === 1,
    allowReasoning: !quotaExceeded && Number(permission.allow_reasoning) === 1,
    allowCode: !quotaExceeded && Number(permission.allow_code) === 1,
    usage,
    permission
  };
}

export {
  deleteAiPermission,
  evaluateAiPermission,
  getAiPermission,
  getUsage,
  listAiPermissions,
  normalizeId,
  upsertAiPermission
};
