function normalizeId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function getConfigMasterSecret(env) {
  return String(env.CONFIG_ENCRYPTION_KEY || env.DASHBOARD_TOKEN || env.WEBHOOK_SECRET_TOKEN || "").trim();
}

async function getAesKey(env) {
  const secret = getConfigMasterSecret(env);
  if (!secret) throw new Error("Missing CONFIG_ENCRYPTION_KEY/DASHBOARD_TOKEN");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bot-config-v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env, plaintext) {
  const clean = String(plaintext || "");
  if (!clean) return "";
  const key = await getAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(clean)
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptSecret(env, cipherText) {
  const value = String(cipherText || "").trim();
  if (!value) return "";
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported encrypted secret format");
  const key = await getAesKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(parts[1]) },
    key,
    base64UrlToBytes(parts[2])
  );
  return new TextDecoder().decode(decrypted);
}

function safeJson(value, fallback = []) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

async function listZaloConnections(env) {
  const rows = env.DB?.prepare
    ? (await env.DB.prepare(
        `SELECT id, display_name, enabled, owner_ids, webhook_path, source,
                CASE WHEN token_cipher != '' THEN 1 ELSE 0 END AS token_configured,
                CASE WHEN webhook_secret_cipher != '' THEN 1 ELSE 0 END AS webhook_secret_configured,
                created_at, updated_at
         FROM zalo_connections
         ORDER BY CASE WHEN id = 'main' THEN 0 ELSE 1 END, datetime(updated_at) DESC`
      ).all()).results || []
    : [];

  const hasMain = rows.some((row) => row.id === "main");
  if (!hasMain) {
    rows.unshift({
      id: "main",
      display_name: "Bot chính",
      enabled: 1,
      owner_ids: String(env.OWNER_ZALO_USER_IDS || ""),
      webhook_path: "/webhook",
      source: "cloudflare-env",
      token_configured: env.ZALO_BOT_TOKEN ? 1 : 0,
      webhook_secret_configured: env.WEBHOOK_SECRET_TOKEN ? 1 : 0,
      created_at: null,
      updated_at: null
    });
  }
  return rows;
}

async function getManagedZaloConnection(env, id) {
  if (!env.DB?.prepare) return null;
  const row = await env.DB.prepare(
    `SELECT id, display_name, enabled, token_cipher, webhook_secret_cipher, owner_ids, webhook_path, source
     FROM zalo_connections WHERE id = ? LIMIT 1`
  ).bind(normalizeId(id)).first();
  if (!row || !Number(row.enabled)) return null;
  return {
    id: row.id,
    displayName: row.display_name || row.id,
    token: await decryptSecret(env, row.token_cipher),
    webhookSecret: await decryptSecret(env, row.webhook_secret_cipher),
    ownerIds: row.owner_ids || "",
    webhookPath: row.webhook_path || `/webhook/${row.id}`,
    source: row.source || "dashboard"
  };
}

async function upsertZaloConnection(env, input) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  const id = normalizeId(input.id);
  if (!id) throw new Error("Connection ID is required");
  const existing = await env.DB.prepare(
    `SELECT token_cipher, webhook_secret_cipher FROM zalo_connections WHERE id = ? LIMIT 1`
  ).bind(id).first();
  const tokenCipher = input.token
    ? await encryptSecret(env, input.token)
    : String(existing?.token_cipher || "");
  const secretCipher = input.webhook_secret
    ? await encryptSecret(env, input.webhook_secret)
    : String(existing?.webhook_secret_cipher || "");
  const defaultPath = id === "main" ? "/webhook" : `/webhook/${id}`;

  await env.DB.prepare(
    `INSERT INTO zalo_connections
      (id, display_name, enabled, token_cipher, webhook_secret_cipher, owner_ids, webhook_path, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'dashboard', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       enabled = excluded.enabled,
       token_cipher = excluded.token_cipher,
       webhook_secret_cipher = excluded.webhook_secret_cipher,
       owner_ids = excluded.owner_ids,
       webhook_path = excluded.webhook_path,
       source = 'dashboard',
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    id,
    String(input.display_name || id).slice(0, 100),
    input.enabled === false ? 0 : 1,
    tokenCipher,
    secretCipher,
    String(input.owner_ids || "").slice(0, 1000),
    String(input.webhook_path || defaultPath).slice(0, 160)
  ).run();
  return id;
}

async function deleteZaloConnection(env, id) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  await env.DB.prepare("DELETE FROM zalo_connections WHERE id = ?").bind(normalizeId(id)).run();
}

async function listAiProviders(env) {
  const providers = env.DB?.prepare
    ? (await env.DB.prepare(
        `SELECT id, label, provider_type, base_url, chat_model, reasoning_model, code_model,
                enabled, priority, capabilities_json, created_at, updated_at
         FROM ai_providers
         ORDER BY enabled DESC, priority ASC, datetime(updated_at) DESC`
      ).all()).results || []
    : [];
  const keys = env.DB?.prepare
    ? (await env.DB.prepare(
        `SELECT id, provider_id, label, enabled, priority, model_allowlist_json,
                success_count, failure_count, last_used_at, last_error,
                CASE WHEN key_cipher != '' THEN 1 ELSE 0 END AS key_configured,
                created_at, updated_at
         FROM ai_api_keys
         ORDER BY provider_id, enabled DESC, priority ASC, failure_count ASC, datetime(updated_at) DESC`
      ).all()).results || []
    : [];

  const mapped = providers.map((provider) => ({
    ...provider,
    capabilities: safeJson(provider.capabilities_json, ["chat"]),
    keys: keys
      .filter((key) => key.provider_id === provider.id)
      .map((key) => ({ ...key, model_allowlist: safeJson(key.model_allowlist_json, []) }))
  }));

  mapped.push({
    id: "env-grok",
    label: "Grok / Nexus (Cloudflare Env)",
    provider_type: "openai_compatible",
    base_url: String(env.NEXUS_API_BASE_URL || "https://api.nexusapi.co/v1"),
    chat_model: String(env.GROK_MODEL || "grok-4.6"),
    reasoning_model: String(env.GROK_REASONING_MODEL || "grok-4.6-high"),
    code_model: String(env.GROK_CODE_MODEL || "coding-agent"),
    enabled: env.Grok || env.GROK_API_KEY || env.XAI_API_KEY ? 1 : 0,
    priority: 900,
    source: "cloudflare-env",
    capabilities: ["chat"],
    keys: [{ id: "env-grok-key", label: "Cloudflare secret", enabled: 1, key_configured: env.Grok || env.GROK_API_KEY || env.XAI_API_KEY ? 1 : 0 }]
  });
  mapped.push({
    id: "env-gemini",
    label: "Google Gemini (Cloudflare Env)",
    provider_type: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    chat_model: String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
    reasoning_model: String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
    code_model: String(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
    enabled: env.GEMINI_API_KEY ? 1 : 0,
    priority: 1000,
    source: "cloudflare-env",
    capabilities: ["chat", "search", "image"],
    keys: [{ id: "env-gemini-key", label: "Cloudflare secret", enabled: 1, key_configured: env.GEMINI_API_KEY ? 1 : 0 }]
  });
  return mapped;
}

async function upsertAiProvider(env, input) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  const id = normalizeId(input.id);
  if (!id) throw new Error("Provider ID is required");
  const type = ["openai_compatible", "gemini"].includes(input.provider_type) ? input.provider_type : "openai_compatible";
  await env.DB.prepare(
    `INSERT INTO ai_providers
      (id, label, provider_type, base_url, chat_model, reasoning_model, code_model, enabled, priority, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       provider_type = excluded.provider_type,
       base_url = excluded.base_url,
       chat_model = excluded.chat_model,
       reasoning_model = excluded.reasoning_model,
       code_model = excluded.code_model,
       enabled = excluded.enabled,
       priority = excluded.priority,
       capabilities_json = excluded.capabilities_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    id,
    String(input.label || id).slice(0, 100),
    type,
    String(input.base_url || "").replace(/\/$/, "").slice(0, 300),
    String(input.chat_model || "").slice(0, 120),
    String(input.reasoning_model || input.chat_model || "").slice(0, 120),
    String(input.code_model || input.chat_model || "").slice(0, 120),
    input.enabled === false ? 0 : 1,
    Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
    JSON.stringify(Array.isArray(input.capabilities) && input.capabilities.length ? input.capabilities : ["chat"])
  ).run();
  return id;
}

async function deleteAiProvider(env, id) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  const clean = normalizeId(id);
  await env.DB.prepare("DELETE FROM ai_api_keys WHERE provider_id = ?").bind(clean).run();
  await env.DB.prepare("DELETE FROM ai_providers WHERE id = ?").bind(clean).run();
}

async function upsertAiApiKey(env, input) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  const providerId = normalizeId(input.provider_id);
  if (!providerId) throw new Error("Provider ID is required");
  const id = normalizeId(input.id) || crypto.randomUUID();
  const existing = await env.DB.prepare("SELECT key_cipher FROM ai_api_keys WHERE id = ? LIMIT 1").bind(id).first();
  const keyCipher = input.api_key ? await encryptSecret(env, input.api_key) : String(existing?.key_cipher || "");
  if (!keyCipher) throw new Error("API key is required");

  await env.DB.prepare(
    `INSERT INTO ai_api_keys
      (id, provider_id, label, key_cipher, enabled, priority, model_allowlist_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       label = excluded.label,
       key_cipher = excluded.key_cipher,
       enabled = excluded.enabled,
       priority = excluded.priority,
       model_allowlist_json = excluded.model_allowlist_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    id,
    providerId,
    String(input.label || "API key").slice(0, 100),
    keyCipher,
    input.enabled === false ? 0 : 1,
    Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
    JSON.stringify(Array.isArray(input.model_allowlist) ? input.model_allowlist : [])
  ).run();
  return id;
}

async function deleteAiApiKey(env, id) {
  if (!env.DB?.prepare) throw new Error("D1 is not configured");
  await env.DB.prepare("DELETE FROM ai_api_keys WHERE id = ?").bind(String(id || "")).run();
}

async function getRuntimeProviders(env) {
  if (!env.DB?.prepare) return [];
  const providers = (await env.DB.prepare(
    `SELECT id, label, provider_type, base_url, chat_model, reasoning_model, code_model, priority
     FROM ai_providers WHERE enabled = 1
     ORDER BY priority ASC, datetime(updated_at) DESC`
  ).all()).results || [];

  const result = [];
  for (const provider of providers) {
    const rows = (await env.DB.prepare(
      `SELECT id, label, key_cipher, priority, model_allowlist_json
       FROM ai_api_keys
       WHERE provider_id = ? AND enabled = 1 AND key_cipher != ''
       ORDER BY priority ASC, failure_count ASC, datetime(updated_at) DESC`
    ).bind(provider.id).all()).results || [];
    const keys = [];
    for (const row of rows) {
      try {
        keys.push({ ...row, apiKey: await decryptSecret(env, row.key_cipher), modelAllowlist: safeJson(row.model_allowlist_json, []) });
      } catch (error) {
        console.error(`Failed to decrypt AI key ${row.id}:`, error);
      }
    }
    if (keys.length) result.push({ ...provider, keys });
  }
  return result;
}

async function markApiKeyResult(env, keyId, ok, errorMessage = "") {
  if (!env.DB?.prepare || !keyId) return;
  await env.DB.prepare(
    `UPDATE ai_api_keys SET
       success_count = success_count + ?,
       failure_count = failure_count + ?,
       last_used_at = CURRENT_TIMESTAMP,
       last_error = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(ok ? 1 : 0, ok ? 0 : 1, ok ? "" : String(errorMessage || "").slice(0, 500), keyId).run().catch(() => {});
}

export {
  decryptSecret,
  deleteAiApiKey,
  deleteAiProvider,
  deleteZaloConnection,
  encryptSecret,
  getConfigMasterSecret,
  getManagedZaloConnection,
  getRuntimeProviders,
  listAiProviders,
  listZaloConnections,
  markApiKeyResult,
  normalizeId,
  upsertAiApiKey,
  upsertAiProvider,
  upsertZaloConnection
};
