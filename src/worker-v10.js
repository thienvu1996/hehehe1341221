import workerV9 from "./worker-v9.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { verifyDashboardSessionToken } from "./worker-v3.js";
import {
  isAiRuntimeQuestion,
  isCodeQuestion,
  isReasoningQuestion,
  shouldUseGrokForMessage
} from "./worker-v6.js";
import { listZaloConnections } from "./config-manager.js";
import {
  deleteAiPermission,
  evaluateAiPermission,
  listAiPermissions,
  upsertAiPermission
} from "./ai-permissions.js";
import { createScopedDb, normalizeConnectionId } from "./scoped-db.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";

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

async function requireDashboardSession(request, env) {
  const token = request.headers.get("x-dashboard-token") || "";
  if (!token.startsWith("v1.") || !(await verifyDashboardSessionToken(env, token))) {
    return json({ ok: false, message: "Session expired" }, 403, request);
  }
  return null;
}

function getPayload(body) {
  const event = body?.result || body;
  const message = event?.message;
  if (!event || !message?.chat?.id) return null;
  return {
    eventName: event.event_name || "",
    message,
    text: String(message.text || message.caption || "").trim()
  };
}

function taskForText(text) {
  if (isCodeQuestion(text)) return "code";
  if (isReasoningQuestion(text)) return "reasoning";
  return "chat";
}

function taskAllowed(policy, task) {
  if (task === "code") return policy.allowCode;
  if (task === "reasoning") return policy.allowReasoning;
  return policy.allowChat;
}

async function sendMessage(connection, chatId, text) {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: String(text || "").slice(0, 1900) }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || `Zalo HTTP ${response.status}`);
}

function permissionMessage(policy, task) {
  if (policy.quotaExceeded) {
    const usage = policy.usage || {};
    return [
      "Bot này đã chạm giới hạn AI được chia sẻ.",
      `Hôm nay: ${usage.day_requests || 0} lượt / ${usage.day_tokens || 0} token.`,
      `Tháng này: ${usage.month_requests || 0} lượt / ${usage.month_tokens || 0} token.`,
      "Chủ bot có thể tăng hạn mức trong Dashboard → Kết nối Zalo & AI."
    ].join("\n");
  }
  if (!policy.permission || !Number(policy.permission.enabled)) {
    return "Bot này chưa được Bot chính cấp quyền dùng AI. Chủ bot có thể bật quyền trong Dashboard → Kết nối Zalo & AI.";
  }
  return `Bot này chưa được cấp quyền AI cho tác vụ ${task}.`;
}

function scopedEnv(env, connection, policy, db) {
  const scoped = Object.create(env || null);
  scoped.DB = db;
  scoped.ZALO_CONNECTION_ID = connection.id;
  scoped.ZALO_BOT_TOKEN = connection.token;
  scoped.WEBHOOK_SECRET_TOKEN = connection.webhookSecret;
  scoped.OWNER_ZALO_USER_IDS = connection.ownerIds || "";

  if (connection.id !== "main") {
    scoped.AI_PROVIDER_ACCESS_ENFORCED = "1";
    if (!policy.allowEnvGrok) {
      scoped.Grok = "";
      scoped.GROK_API_KEY = "";
      scoped.XAI_API_KEY = "";
    }
    if (!policy.allowEnvGemini) {
      scoped.GEMINI_API_KEY = "";
      scoped.GEMINI_API_KEYS = "";
    }
  }
  return scoped;
}

async function handlePermissionAdmin(request, env) {
  const url = new URL(request.url);
  if (!(url.pathname === "/admin/ai-permissions" || url.pathname.startsWith("/admin/ai-permissions/"))) return null;
  if (request.method === "OPTIONS") return json({ ok: true }, 200, request);
  const denied = await requireDashboardSession(request, env);
  if (denied) return denied;

  try {
    if (request.method === "GET" && url.pathname === "/admin/ai-permissions") {
      return json({ ok: true, permissions: await listAiPermissions(env) }, 200, request);
    }
    if (request.method === "POST" && url.pathname === "/admin/ai-permissions") {
      const body = await request.json().catch(() => ({}));
      const connectionId = await upsertAiPermission(env, body);
      return json({ ok: true, connection_id: connectionId, permissions: await listAiPermissions(env) }, 200, request);
    }
    if (request.method === "DELETE" && url.pathname === "/admin/ai-permissions") {
      await deleteAiPermission(env, url.searchParams.get("connection_id") || "");
      return json({ ok: true, permissions: await listAiPermissions(env) }, 200, request);
    }
  } catch (error) {
    console.error("AI permission admin failed:", error);
    return json({ ok: false, message: String(error?.message || error) }, 400, request);
  }

  return json({ ok: false, message: "Not Found" }, 404, request);
}

async function scopedDashboardRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (!["/admin/dashboard-data", "/admin/bot-profile"].includes(url.pathname)) return null;
  const connectionId = normalizeConnectionId(url.searchParams.get("connection_id") || "main");
  const db = createScopedDb(env.DB, { connectionId, mode: "dashboard" });
  const scoped = Object.create(env || null);
  scoped.DB = db;
  scoped.ZALO_CONNECTION_ID = connectionId;
  return workerV9.fetch(request, scoped, ctx);
}

async function scopedWebhookRequest(request, env, ctx) {
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (request.method !== "POST" || !webhook) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId);
  if (!connection?.token || !connection?.webhookSecret) {
    return json({ ok: false, message: `Zalo connection '${webhook.connectionId}' is not configured` }, 503);
  }

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  const policy = await evaluateAiPermission(env, connection.id);
  const task = taskForText(payload?.text || "");

  if (
    connection.id !== "main" &&
    payload?.eventName === "message.text.received" &&
    !isAiRuntimeQuestion(payload.text) &&
    shouldUseGrokForMessage(payload.message, payload.text) &&
    (!policy.allowed || !taskAllowed(policy, task))
  ) {
    await sendMessage(connection, payload.message.chat.id, permissionMessage(policy, task));
    return json({ message: "Success", provider: "ai-permission-v10", blocked: true });
  }

  const db = createScopedDb(env.DB, {
    connectionId: connection.id,
    chatId: String(payload?.message?.chat?.id || ""),
    userId: String(payload?.message?.from?.id || ""),
    messageId: String(payload?.message?.message_id || ""),
    mode: "request",
    allowedProviderIds: connection.id === "main" ? null : policy.allowedManagedProviderIds
  });
  const scoped = scopedEnv(env, connection, policy, db);
  return workerV9.fetch(request, scoped, ctx);
}

async function runScheduledForConnection(event, env, ctx, connection) {
  const policy = await evaluateAiPermission(env, connection.id);
  const db = createScopedDb(env.DB, {
    connectionId: connection.id,
    mode: "scheduled",
    allowedProviderIds: connection.id === "main" ? null : policy.allowedManagedProviderIds
  });
  const scoped = scopedEnv(env, connection, policy, db);
  return workerV9.scheduled(event, scoped, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const permissionAdmin = await handlePermissionAdmin(request, env);
    if (permissionAdmin) return permissionAdmin;

    const dashboard = await scopedDashboardRequest(request, env, ctx);
    if (dashboard) return dashboard;

    const webhook = await scopedWebhookRequest(request, env, ctx);
    if (webhook) return webhook;

    return workerV9.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const rows = await listZaloConnections(env).catch(() => []);
    for (const row of rows) {
      if (!Number(row.enabled)) continue;
      try {
        const connection = await resolveZaloConnection(env, row.id || "main");
        if (!connection?.token) continue;
        await runScheduledForConnection(event, env, ctx, connection);
      } catch (error) {
        console.error(`Scheduled bot ${row.id || "main"} failed:`, error);
      }
    }
  }
};
