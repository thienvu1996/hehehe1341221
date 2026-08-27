import workerV16 from "./worker-v16.js";
import { verifyDashboardSessionToken } from "./worker-v3.js";
import { connectionPrefix, normalizeConnectionId, unscopeValue } from "./scoped-db.js";

function json(data, status = 200, request = null) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request) {
    headers["Access-Control-Allow-Origin"] = request.headers.get("Origin") || "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Dashboard-Token";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function authorized(request, env) {
  const token = request.headers.get("x-dashboard-token") || "";
  return token.startsWith("v1.") && verifyDashboardSessionToken(env, token);
}

function scope(connectionId, column = "chat_id") {
  const id = normalizeConnectionId(connectionId);
  return id === "main"
    ? { sql: `${column} NOT LIKE '@bot:%'`, binds: [] }
    : { sql: `${column} LIKE ?`, binds: [`${connectionPrefix(id)}%`] };
}

function storedChatId(connectionId, chatId) {
  const id = normalizeConnectionId(connectionId);
  const value = String(chatId || "");
  const prefix = connectionPrefix(id);
  return !prefix || value.startsWith(prefix) ? value : `${prefix}${value}`;
}

async function listSchedules(env, connectionId) {
  const s = scope(connectionId);
  const settings = (await env.DB.prepare(`SELECT chat_id, chat_type, chat_title, user_name, weather_enabled, weather_time, weather_location, timezone, last_weather_sent_date, updated_at FROM chat_settings WHERE ${s.sql} ORDER BY weather_enabled DESC, datetime(updated_at) DESC`).bind(...s.binds).all()).results || [];
  const reminders = (await env.DB.prepare(`SELECT id, chat_id, chat_type, chat_title, user_name, title, due_at_utc, due_local_date, due_local_time, timezone, status, sent_at, created_at FROM reminders WHERE ${s.sql} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'cancelled' THEN 1 ELSE 2 END, datetime(due_at_utc) ASC`).bind(...s.binds).all()).results || [];
  return {
    settings: settings.map((row) => ({ ...row, chat_id: unscopeValue(row.chat_id, connectionId) })),
    reminders: reminders.map((row) => ({ ...row, chat_id: unscopeValue(row.chat_id, connectionId) }))
  };
}

async function handleSchedules(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/admin/schedules") return null;
  if (request.method === "OPTIONS") return json({ ok: true }, 200, request);
  if (!(await authorized(request, env))) return json({ ok: false, message: "Session expired" }, 403, request);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const connectionId = normalizeConnectionId(body.connection_id || url.searchParams.get("connection_id") || "main");

  if (request.method === "GET") return json({ ok: true, connection_id: connectionId, ...(await listSchedules(env, connectionId)) }, 200, request);
  if (request.method !== "POST") return json({ ok: false, message: "Method Not Allowed" }, 405, request);

  const action = String(body.action || "");
  if (action === "weather_set") {
    await env.DB.prepare("UPDATE chat_settings SET weather_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?")
      .bind(body.enabled ? 1 : 0, storedChatId(connectionId, body.chat_id)).run();
  } else if (action === "weather_disable_all") {
    const s = scope(connectionId);
    await env.DB.prepare(`UPDATE chat_settings SET weather_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE weather_enabled = 1 AND ${s.sql}`).bind(...s.binds).run();
  } else if (action === "reminder_cancel") {
    await env.DB.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND chat_id = ? AND status = 'pending'")
      .bind(String(body.reminder_id || ""), storedChatId(connectionId, body.chat_id)).run();
  } else if (action === "reminders_cancel_all") {
    const s = scope(connectionId);
    await env.DB.prepare(`UPDATE reminders SET status = 'cancelled' WHERE status = 'pending' AND ${s.sql}`).bind(...s.binds).run();
  } else {
    return json({ ok: false, message: "Unknown schedule action" }, 400, request);
  }

  return json({ ok: true, connection_id: connectionId, ...(await listSchedules(env, connectionId)) }, 200, request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleSchedules(request, env);
      if (response) return response;
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 400, request);
    }
    return workerV16.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof workerV16.scheduled === "function") return workerV16.scheduled(event, env, ctx);
  }
};

export { handleSchedules, listSchedules };
