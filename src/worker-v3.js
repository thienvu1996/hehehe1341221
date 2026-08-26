import memoryWorker from "./worker-v2.js";

const API_BASE_URL = "https://bot-api.zaloplatforms.com";
const DASHBOARD_SESSION_TTL_SECONDS = 30 * 60;
const DASHBOARD_SESSION_IDLE_TTL_MS = DASHBOARD_SESSION_TTL_SECONDS * 1000;
const DASHBOARD_AUTH_PATHS = new Set(["/admin/dashboard-data", "/admin/bot-profile"]);

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

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }

  return diff === 0;
}

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getDashboardMasterSecret(env) {
  return env.DASHBOARD_TOKEN || env.WEBHOOK_SECRET_TOKEN || "";
}

async function createDashboardSignature(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return base64UrlEncode(signature);
}

function parseD1Timestamp(value) {
  const text = String(value || "").trim();

  if (!text) {
    return Number.NaN;
  }

  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

async function registerDashboardSession(env, nonce) {
  if (!env.DB?.prepare || !nonce) {
    return false;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO dashboard_sessions (nonce, created_at, last_seen_at)
       VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(nonce) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`
    )
      .bind(nonce)
      .run();
    return true;
  } catch (error) {
    console.error("Failed to register dashboard session:", error);
    return false;
  }
}

async function touchDashboardSession(env, nonce) {
  if (!env.DB?.prepare || !nonce) {
    return false;
  }

  try {
    await env.DB.prepare(
      `UPDATE dashboard_sessions
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE nonce = ?`
    )
      .bind(nonce)
      .run();
    return true;
  } catch (error) {
    console.error("Failed to touch dashboard session:", error);
    return false;
  }
}

async function createDashboardSessionToken(env) {
  const secret = getDashboardMasterSecret(env);

  if (!secret) {
    return null;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + DASHBOARD_SESSION_TTL_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = await createDashboardSignature(secret, payload);

  await registerDashboardSession(env, nonce);

  return {
    token: `${payload}.${signature}`,
    expiresAt
  };
}

async function verifyDashboardSessionToken(env, token) {
  const secret = getDashboardMasterSecret(env);
  const parts = String(token || "").split(".");

  if (!secret || parts.length !== 4 || parts[0] !== "v1") {
    return false;
  }

  const expiresAt = Number(parts[1]);
  const nonce = parts[2];

  if (!Number.isFinite(expiresAt) || !nonce) {
    return false;
  }

  const payload = parts.slice(0, 3).join(".");
  const expectedSignature = await createDashboardSignature(secret, payload);

  if (!constantTimeEqual(parts[3], expectedSignature)) {
    return false;
  }

  const now = Date.now();

  if (env.DB?.prepare) {
    try {
      const row = await env.DB.prepare(
        `SELECT nonce, last_seen_at
         FROM dashboard_sessions
         WHERE nonce = ?
         LIMIT 1`
      )
        .bind(nonce)
        .first();

      if (row) {
        const lastSeenAt = parseD1Timestamp(row.last_seen_at);

        if (!Number.isFinite(lastSeenAt) || now - lastSeenAt > DASHBOARD_SESSION_IDLE_TTL_MS) {
          await env.DB.prepare("DELETE FROM dashboard_sessions WHERE nonce = ?").bind(nonce).run().catch(() => {});
          return false;
        }

        await touchDashboardSession(env, nonce);
        return true;
      }

      if (expiresAt * 1000 <= now) {
        return false;
      }

      await registerDashboardSession(env, nonce);
      return true;
    } catch (error) {
      console.error("Failed to verify sliding dashboard session:", error);
    }
  }

  return expiresAt * 1000 > now;
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getOwnerUserIds(env) {
  return String(env.OWNER_ZALO_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isPrivateChat(message) {
  return normalizeText(message?.chat?.chat_type || "").includes("private");
}

function isOwnerMessage(env, message) {
  return getOwnerUserIds(env).includes(String(message?.from?.id || ""));
}

function wantsDashboardKey(text) {
  return normalizeText(text).replace(/[\s-]+/g, "_").includes("key_dashboard");
}

function getWebhookPayload(body) {
  const event = body?.result || body;
  const message = event?.message;

  if (!event || !message?.chat?.id) {
    return null;
  }

  return {
    eventName: event.event_name || "",
    message,
    text: String(message.text || message.caption || "").trim()
  };
}

async function callZaloApi(env, methodName, payload = {}) {
  if (!env.ZALO_BOT_TOKEN) {
    throw new Error("Missing ZALO_BOT_TOKEN");
  }

  const response = await fetch(`${API_BASE_URL}/bot${env.ZALO_BOT_TOKEN}/${methodName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(`Zalo API ${methodName} failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendMessage(env, chatId, text) {
  return callZaloApi(env, "sendMessage", {
    chat_id: chatId,
    text
  });
}

async function handleDashboardKeyWebhook(request, env) {
  if (!env.WEBHOOK_SECRET_TOKEN) {
    return null;
  }

  const requestSecret = request.headers.get("x-bot-api-secret-token") || "";

  if (!constantTimeEqual(requestSecret, env.WEBHOOK_SECRET_TOKEN)) {
    return null;
  }

  const body = await request.clone().json().catch(() => null);
  const payload = getWebhookPayload(body);

  if (
    !payload ||
    payload.eventName !== "message.text.received" ||
    !wantsDashboardKey(payload.text)
  ) {
    return null;
  }

  const { message } = payload;
  let reply;

  if (!isPrivateChat(message)) {
    reply = "Lệnh KEY_Dashboard chỉ dùng trong tin nhắn riêng với bot, không gửi key trong group.";
  } else if (!isOwnerMessage(env, message)) {
    reply = "Tài khoản này không có quyền lấy dashboard key.";
  } else {
    const session = await createDashboardSessionToken(env);

    if (!session) {
      reply = "Worker chưa có secret để tạo phiên dashboard.";
    } else {
      reply = [
        "Dashboard key tạm thời (30 phút để mở dashboard):",
        session.token,
        "",
        "Mở dashboard:",
        "https://dashboard.jean1331.io.vn",
        "Dán key tạm thời ở trên vào ô Dashboard key.",
        "Khi dashboard còn mở, session sẽ tự được giữ. Rời/đóng trang quá 30 phút thì session hết hạn.",
        "",
        "Nếu domain chính chưa vào được, dùng:",
        "https://hehehe1341221-dashboard.vuthien616.workers.dev"
      ].join("\n");
    }
  }

  await sendMessage(env, message.chat.id, reply);
  return json({ message: "Success" });
}

async function handleTemporaryDashboardSession(request, env) {
  const body = await request.clone().json().catch(() => ({}));
  const token = String(body?.token || request.headers.get("x-dashboard-token") || "").trim();

  if (!token.startsWith("v1.")) {
    return null;
  }

  const valid = await verifyDashboardSessionToken(env, token);

  if (!valid) {
    return dashboardJson(request, { message: "Session expired" }, 403);
  }

  return dashboardJson(request, {
    ok: true,
    session_token: token,
    expires_at: Math.floor(Date.now() / 1000) + DASHBOARD_SESSION_TTL_SECONDS,
    ttl_seconds: DASHBOARD_SESSION_TTL_SECONDS,
    sliding: true
  });
}

async function forwardTemporaryDashboardRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (!DASHBOARD_AUTH_PATHS.has(url.pathname)) {
    return null;
  }

  const sessionToken = request.headers.get("x-dashboard-token") || "";

  if (!sessionToken.startsWith("v1.")) {
    return null;
  }

  if (!(await verifyDashboardSessionToken(env, sessionToken))) {
    return dashboardJson(request, { message: "Session expired" }, 403);
  }

  const masterSecret = getDashboardMasterSecret(env);

  if (!masterSecret) {
    return dashboardJson(request, { message: "Dashboard secret is not configured" }, 500);
  }

  const headers = new Headers(request.headers);
  headers.delete("x-dashboard-token");
  headers.set("x-bot-api-secret-token", masterSecret);

  const forwardedRequest = new Request(request, { headers });
  return memoryWorker.fetch(forwardedRequest, env, ctx);
}

export { createDashboardSessionToken, verifyDashboardSessionToken, wantsDashboardKey };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/admin/dashboard-session") {
      const temporarySessionResponse = await handleTemporaryDashboardSession(request, env);

      if (temporarySessionResponse) {
        return temporarySessionResponse;
      }
    }

    if (DASHBOARD_AUTH_PATHS.has(url.pathname)) {
      const temporaryDashboardResponse = await forwardTemporaryDashboardRequest(request, env, ctx);

      if (temporaryDashboardResponse) {
        return temporaryDashboardResponse;
      }
    }

    if (request.method === "POST" && ["/webhook", "/webhooks"].includes(url.pathname)) {
      const dashboardKeyResponse = await handleDashboardKeyWebhook(request, env);

      if (dashboardKeyResponse) {
        return dashboardKeyResponse;
      }
    }

    return memoryWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof memoryWorker.scheduled === "function") {
      return memoryWorker.scheduled(event, env, ctx);
    }
  }
};
