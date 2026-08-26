import workerV10 from "./worker-v10.js";
import { normalizeConnectionId } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";

const DEFAULT_SPEAKING_STYLE = "Tự nhiên, thân thiện, ngắn gọn, hỏi lại khi thiếu thông tin.";
const DEFAULT_PERSONA = "Trợ lý Zalo giúp thu thập link thuê nhà, đọc ảnh, nhắc lịch, thời tiết và hỗ trợ nhóm như một người phụ tá.";

function stripVietnamese(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isGenericProfileName(value = "") {
  const normalized = stripVietnamese(value);
  return !normalized || normalized === "bot thu thap atess";
}

function getDashboardConnectionId(request) {
  const url = new URL(request.url);
  let connectionId = url.searchParams.get("connection_id") || "";

  if (!connectionId) {
    const referer = request.headers.get("referer") || request.headers.get("referrer") || "";
    if (referer) {
      try {
        connectionId = new URL(referer).searchParams.get("connection_id") || "";
      } catch {
        // Ignore malformed referrer and fall back to main.
      }
    }
  }

  return normalizeConnectionId(connectionId || "main");
}

function requestWithConnectionId(request, connectionId) {
  if (!connectionId || connectionId === "main") return request;
  const url = new URL(request.url);
  if (url.searchParams.get("connection_id") === connectionId) return request;
  url.searchParams.set("connection_id", connectionId);
  return new Request(url.toString(), request);
}

async function getConnectionDisplayName(env, connectionId) {
  if (connectionId === "main") return "Bot chính";
  if (!env.DB?.prepare) return connectionId;

  const row = await env.DB.prepare(
    `SELECT display_name FROM zalo_connections WHERE id = ? LIMIT 1`
  ).bind(connectionId).first().catch(() => null);

  return String(row?.display_name || connectionId).trim() || connectionId;
}

async function ensureBotProfile(env, connectionId) {
  const id = normalizeConnectionId(connectionId || "main");
  if (id === "main" || !env.DB?.prepare) return;

  const displayName = await getConnectionDisplayName(env, id);
  const existing = await env.DB.prepare(
    `SELECT display_name FROM bot_profile WHERE id = ? LIMIT 1`
  ).bind(id).first().catch(() => null);

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO bot_profile
        (id, display_name, gender, age, speaking_style, persona, default_language, updated_at)
       VALUES (?, ?, 'không cố định', '', ?, ?, 'vi', CURRENT_TIMESTAMP)`
    ).bind(id, displayName, DEFAULT_SPEAKING_STYLE, DEFAULT_PERSONA).run();
    return;
  }

  if (isGenericProfileName(existing.display_name) && displayName && !isGenericProfileName(displayName)) {
    await env.DB.prepare(
      `UPDATE bot_profile SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(displayName, id).run();
  }
}

async function handleDashboardScopedRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (!["/admin/dashboard-data", "/admin/bot-profile"].includes(url.pathname)) return null;

  const connectionId = getDashboardConnectionId(request);
  await ensureBotProfile(env, connectionId).catch((error) => {
    console.error(`Ensure bot profile '${connectionId}' failed:`, error);
  });

  return workerV10.fetch(requestWithConnectionId(request, connectionId), env, ctx);
}

async function handleZaloConnectionSave(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/admin/zalo-connections") return null;

  const body = await request.clone().json().catch(() => ({}));
  const response = await workerV10.fetch(request, env, ctx);

  if (response.ok) {
    const connectionId = normalizeConnectionId(body.id || "main");
    await ensureBotProfile(env, connectionId).catch((error) => {
      console.error(`Seed bot profile '${connectionId}' failed:`, error);
    });
  }

  return response;
}

async function ensureWebhookProfile(request, env) {
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (request.method !== "POST" || !webhook || webhook.connectionId === "main") return;
  await ensureBotProfile(env, webhook.connectionId).catch((error) => {
    console.error(`Webhook bot profile '${webhook.connectionId}' failed:`, error);
  });
}

export default {
  async fetch(request, env, ctx) {
    const dashboard = await handleDashboardScopedRequest(request, env, ctx);
    if (dashboard) return dashboard;

    const savedConnection = await handleZaloConnectionSave(request, env, ctx);
    if (savedConnection) return savedConnection;

    await ensureWebhookProfile(request, env);
    return workerV10.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV10.scheduled === "function") return workerV10.scheduled(event, env, ctx);
  }
};

export { ensureBotProfile, getDashboardConnectionId, isGenericProfileName };
