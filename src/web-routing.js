function normalizeId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "main";
}

function safeJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeProviderIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];
}

function orderProviderIds(preferredIds = [], availableIds = [], includeUnlisted = false) {
  const available = [...new Set((availableIds || []).map(normalizeId).filter(Boolean))];
  const preferred = normalizeProviderIds(preferredIds).filter((id) => available.includes(id));
  if (!preferred.length) return available;
  if (!includeUnlisted) return preferred;
  return [...preferred, ...available.filter((id) => !preferred.includes(id))];
}

async function getAiWebRoute(env, connectionId = "main") {
  const id = normalizeId(connectionId);
  if (!env.DB?.prepare) {
    return {
      connection_id: id,
      search_provider_ids: [],
      answer_provider_ids: [],
      source: "default"
    };
  }

  const row = await env.DB.prepare(
    `SELECT connection_id, search_provider_ids_json, answer_provider_ids_json, created_at, updated_at
     FROM bot_ai_web_routes
     WHERE connection_id = ?
     LIMIT 1`
  ).bind(id).first().catch(() => null);

  if (!row) {
    return {
      connection_id: id,
      search_provider_ids: [],
      answer_provider_ids: [],
      source: "default"
    };
  }

  return {
    ...row,
    search_provider_ids: normalizeProviderIds(safeJson(row.search_provider_ids_json, [])),
    answer_provider_ids: normalizeProviderIds(safeJson(row.answer_provider_ids_json, [])),
    source: "dashboard"
  };
}

async function listAiWebRoutes(env) {
  if (!env.DB?.prepare) return [];
  const rows = (await env.DB.prepare(
    `SELECT connection_id, search_provider_ids_json, answer_provider_ids_json, created_at, updated_at
     FROM bot_ai_web_routes
     ORDER BY CASE WHEN connection_id = 'main' THEN 0 ELSE 1 END, connection_id`
  ).all()).results || [];

  return rows.map((row) => ({
    ...row,
    search_provider_ids: normalizeProviderIds(safeJson(row.search_provider_ids_json, [])),
    answer_provider_ids: normalizeProviderIds(safeJson(row.answer_provider_ids_json, []))
  }));
}

async function upsertAiWebRoute(env, input = {}) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  const connectionId = normalizeId(input.connection_id || "main");
  const searchProviderIds = normalizeProviderIds(input.search_provider_ids || []);
  const answerProviderIds = normalizeProviderIds(input.answer_provider_ids || []);

  await env.DB.prepare(
    `INSERT INTO bot_ai_web_routes
      (connection_id, search_provider_ids_json, answer_provider_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(connection_id) DO UPDATE SET
       search_provider_ids_json = excluded.search_provider_ids_json,
       answer_provider_ids_json = excluded.answer_provider_ids_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    connectionId,
    JSON.stringify(searchProviderIds),
    JSON.stringify(answerProviderIds)
  ).run();

  return connectionId;
}

async function deleteAiWebRoute(env, connectionId = "main") {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  await env.DB.prepare("DELETE FROM bot_ai_web_routes WHERE connection_id = ?")
    .bind(normalizeId(connectionId)).run();
}

export {
  deleteAiWebRoute,
  getAiWebRoute,
  listAiWebRoutes,
  normalizeId,
  normalizeProviderIds,
  orderProviderIds,
  upsertAiWebRoute
};
