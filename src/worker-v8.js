import workerV7 from "./worker-v7.js";
import { verifyDashboardSessionToken } from "./worker-v3.js";
import {
  getConnectionBindingNames,
  getZaloConnection,
  isZaloConnectionConfigured,
  normalizeConnectionId,
  parseZaloWebhookPath
} from "./zalo-connections.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const PUBLIC_BOT_ORIGIN = "https://bot.jean1331.io.vn";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function dashboardJson(request, data, status = 200) {
  return json(data, status, corsHeaders(request));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getEncryptionKey(env) {
  const secret = String(env.DASHBOARD_TOKEN || env.WEBHOOK_SECRET_TOKEN || "").trim();
  if (!secret) throw new Error("Missing DASHBOARD_TOKEN/WEBHOOK_SECRET_TOKEN for connection encryption");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env, value) {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(String(value || ""))
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecret(env, value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported encrypted secret format");
  const key = await getEncryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parts[1]) },
    key,
    base64ToBytes(parts[2])
  );
  return new TextDecoder().decode(decrypted);
}

async function requireDashboardSession(request, env) {
  const token = request.headers.get("x-dashboard-token") || "";
  if (!token.startsWith("v1.")) return false;
  return verifyDashboardSessionToken(env, token);
}

function webhookUrlFor(connectionId) {
  const id = normalizeConnectionId(connectionId);
  return `${PUBLIC_BOT_ORIGIN}${id === "main" ? "/webhook" : `/webhook/${id}`}`;
}

async function loadManagedRow(env, connectionId) {
  if (!env.DB?.prepare) return null;
  const id = normalizeConnectionId(connectionId);
  return (
    (await env.DB.prepare(
      `SELECT connection_id, display_name, bot_token_encrypted, webhook_secret_encrypted,
              owner_ids, enabled, webhook_registered, last_register_status,
              last_register_message, created_at, updated_at
       FROM zalo_connections
       WHERE connection_id = ?
       LIMIT 1`
    ).bind(id).first()) || null
  );
}

async function loadManagedConnection(env, connectionId) {
  const row = await loadManagedRow(env, connectionId);
  if (!row || Number(row.enabled) !== 1) return null;
  return {
    id: row.connection_id,
    displayName: row.display_name || row.connection_id,
    token: await decryptSecret(env, row.bot_token_encrypted),
    webhookSecret: await decryptSecret(env, row.webhook_secret_encrypted),
    ownerIds: String(row.owner_ids || ""),
    source: "dashboard"
  };
}

function createEnvForConnection(env, connection) {
  const scoped = Object.create(env || null);
  const names = getConnectionBindingNames(connection.id);
  scoped[names.tokenEnv] = connection.token;
  scoped[names.secretEnv] = connection.webhookSecret;
  scoped[names.ownersEnv] = connection.ownerIds;
  return scoped;
}

async function registerWebhook(token, secret, connectionId) {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrlFor(connectionId),
      secret_token: secret
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  const ok = response.ok && data.ok !== false;
  return {
    ok,
    status: response.status,
    message: ok ? "Webhook registered" : String(data?.description || data?.message || `HTTP ${response.status}`),
    data
  };
}

async function listConnections(request, env) {
  const main = getZaloConnection(env, "main");
  let rows = [];
  if (env.DB?.prepare) {
    try {
      rows = (await env.DB.prepare(
        `SELECT connection_id, display_name, owner_ids, enabled, webhook_registered,
                last_register_status, last_register_message, created_at, updated_at
         FROM zalo_connections
         ORDER BY CASE WHEN connection_id = 'main' THEN 0 ELSE 1 END, datetime(updated_at) DESC`
      ).all()).results || [];
    } catch (error) {
      console.error("Failed to list managed Zalo connections:", error);
    }
  }

  const managed = rows
    .filter((row) => row.connection_id !== "main")
    .map((row) => ({
      connection_id: row.connection_id,
      display_name: row.display_name || row.connection_id,
      source: "dashboard",
      configured: true,
      token_configured: true,
      webhook_secret_configured: true,
      owners_configured: Boolean(row.owner_ids),
      owner_ids: row.owner_ids || "",
      enabled: Number(row.enabled) === 1,
      webhook_registered: Number(row.webhook_registered) === 1,
      last_register_status: row.last_register_status,
      last_register_message: row.last_register_message || "",
      webhook_url: webhookUrlFor(row.connection_id),
      updated_at: row.updated_at
    }));

  return dashboardJson(request, {
    ok: true,
    connections: [
      {
        connection_id: "main",
        display_name: "Bot chính",
        source: "cloudflare-env",
        configured: isZaloConnectionConfigured(main),
        token_configured: Boolean(main.token),
        webhook_secret_configured: Boolean(main.webhookSecret),
        owners_configured: Boolean(main.ownerIds),
        owner_ids: main.ownerIds || "",
        enabled: true,
        webhook_registered: true,
        webhook_url: webhookUrlFor("main"),
        updated_at: null
      },
      ...managed
    ]
  });
}

async function saveConnection(request, env) {
  const body = await request.json().catch(() => ({}));
  const connectionId = normalizeConnectionId(body.connection_id || "");
  const displayName = String(body.display_name || connectionId).trim().slice(0, 120);
  const botToken = String(body.bot_token || "").trim();
  const webhookSecret = String(body.webhook_secret || "").trim();
  const ownerIds = String(body.owner_ids || "").trim().slice(0, 1000);
  const enabled = body.enabled === false ? 0 : 1;

  if (!body.connection_id || connectionId === "main") {
    return dashboardJson(request, { ok: false, message: "Connection ID 'main' được quản lý bằng Cloudflare Env; hãy dùng tên khác như bot2, sale, rent." }, 400);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(connectionId)) {
    return dashboardJson(request, { ok: false, message: "Connection ID chỉ dùng a-z, 0-9, _ hoặc -, tối đa 40 ký tự." }, 400);
  }
  if (!botToken || !webhookSecret) {
    return dashboardJson(request, { ok: false, message: "Cần nhập Zalo Bot Token và Webhook Secret." }, 400);
  }
  if (!env.DB?.prepare) {
    return dashboardJson(request, { ok: false, message: "D1 chưa được cấu hình." }, 500);
  }

  const [tokenEncrypted, secretEncrypted] = await Promise.all([
    encryptSecret(env, botToken),
    encryptSecret(env, webhookSecret)
  ]);

  await env.DB.prepare(
    `INSERT INTO zalo_connections
       (connection_id, display_name, bot_token_encrypted, webhook_secret_encrypted,
        owner_ids, enabled, webhook_registered, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(connection_id) DO UPDATE SET
       display_name = excluded.display_name,
       bot_token_encrypted = excluded.bot_token_encrypted,
       webhook_secret_encrypted = excluded.webhook_secret_encrypted,
       owner_ids = excluded.owner_ids,
       enabled = excluded.enabled,
       webhook_registered = 0,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(connectionId, displayName, tokenEncrypted, secretEncrypted, ownerIds, enabled).run();

  let registration = null;
  if (body.register_webhook !== false) {
    try {
      registration = await registerWebhook(botToken, webhookSecret, connectionId);
    } catch (error) {
      registration = { ok: false, status: 0, message: String(error?.message || error) };
    }

    await env.DB.prepare(
      `UPDATE zalo_connections
       SET webhook_registered = ?, last_register_status = ?, last_register_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE connection_id = ?`
    ).bind(registration.ok ? 1 : 0, registration.status || 0, String(registration.message || "").slice(0, 500), connectionId).run();
  }

  return dashboardJson(request, {
    ok: true,
    connection_id: connectionId,
    webhook_url: webhookUrlFor(connectionId),
    registration
  });
}

async function registerManagedConnection(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = normalizeConnectionId(body.connection_id || "");
  if (!id || id === "main") return dashboardJson(request, { ok: false, message: "Không đăng ký lại bot main từ trang này." }, 400);
  const connection = await loadManagedConnection(env, id);
  if (!connection) return dashboardJson(request, { ok: false, message: "Không tìm thấy connection hoặc connection đang tắt." }, 404);

  let registration;
  try {
    registration = await registerWebhook(connection.token, connection.webhookSecret, id);
  } catch (error) {
    registration = { ok: false, status: 0, message: String(error?.message || error) };
  }
  await env.DB.prepare(
    `UPDATE zalo_connections
     SET webhook_registered = ?, last_register_status = ?, last_register_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE connection_id = ?`
  ).bind(registration.ok ? 1 : 0, registration.status || 0, String(registration.message || "").slice(0, 500), id).run();

  return dashboardJson(request, { ok: registration.ok, connection_id: id, webhook_url: webhookUrlFor(id), registration }, registration.ok ? 200 : 502);
}

async function deleteManagedConnection(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = normalizeConnectionId(body.connection_id || "");
  if (!id || id === "main") return dashboardJson(request, { ok: false, message: "Không thể xóa bot main từ dashboard." }, 400);
  await env.DB.prepare(`DELETE FROM zalo_connections WHERE connection_id = ?`).bind(id).run();
  return dashboardJson(request, { ok: true, connection_id: id });
}

async function healthForConnection(env, connectionId) {
  const id = normalizeConnectionId(connectionId);
  if (id !== "main") {
    try {
      const managed = await loadManagedConnection(env, id);
      if (managed) {
        return {
          ok: true,
          connection_id: id,
          source: "dashboard",
          configured: true,
          token_configured: true,
          webhook_secret_configured: true,
          owners_configured: Boolean(managed.ownerIds)
        };
      }
    } catch (error) {
      console.error("Managed Zalo health failed:", error);
    }
  }

  const envConnection = getZaloConnection(env, id);
  return {
    ok: true,
    connection_id: id,
    source: "cloudflare-env",
    configured: isZaloConnectionConfigured(envConnection),
    token_configured: Boolean(envConnection.token),
    webhook_secret_configured: Boolean(envConnection.webhookSecret),
    owners_configured: Boolean(envConnection.ownerIds)
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/admin/zalo-connections")) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname.startsWith("/admin/zalo-connections")) {
      if (!(await requireDashboardSession(request, env))) {
        return dashboardJson(request, { ok: false, message: "Session expired" }, 403);
      }

      try {
        if (request.method === "GET" && url.pathname === "/admin/zalo-connections") return listConnections(request, env);
        if (request.method === "POST" && url.pathname === "/admin/zalo-connections") return saveConnection(request, env);
        if (request.method === "POST" && url.pathname === "/admin/zalo-connections/register") return registerManagedConnection(request, env);
        if (request.method === "POST" && url.pathname === "/admin/zalo-connections/delete") return deleteManagedConnection(request, env);
      } catch (error) {
        console.error("Zalo connections admin endpoint failed:", error);
        return dashboardJson(request, { ok: false, message: String(error?.message || error) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/health/zalo-connection") {
      return json(await healthForConnection(env, url.searchParams.get("id") || "main"));
    }

    const webhook = parseZaloWebhookPath(url.pathname);
    if (request.method === "POST" && webhook && webhook.connectionId !== "main") {
      try {
        const managed = await loadManagedConnection(env, webhook.connectionId);
        if (managed) {
          return workerV7.fetch(request, createEnvForConnection(env, managed), ctx);
        }
      } catch (error) {
        console.error(`Failed to load managed Zalo connection '${webhook.connectionId}':`, error);
      }
    }

    return workerV7.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV7.scheduled === "function") return workerV7.scheduled(event, env, ctx);
  }
};
