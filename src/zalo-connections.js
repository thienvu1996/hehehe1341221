function normalizeConnectionId(value = "main") {
  const normalized = String(value || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "main";
}

function connectionSuffix(connectionId) {
  return normalizeConnectionId(connectionId)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getConnectionBindingNames(connectionId = "main") {
  const id = normalizeConnectionId(connectionId);

  if (id === "main") {
    return {
      tokenEnv: "ZALO_BOT_TOKEN",
      secretEnv: "WEBHOOK_SECRET_TOKEN",
      ownersEnv: "OWNER_ZALO_USER_IDS"
    };
  }

  const suffix = connectionSuffix(id);
  return {
    tokenEnv: `ZALO_BOT_TOKEN_${suffix}`,
    secretEnv: `WEBHOOK_SECRET_TOKEN_${suffix}`,
    ownersEnv: `OWNER_ZALO_USER_IDS_${suffix}`
  };
}

function getZaloConnection(env, connectionId = "main") {
  const id = normalizeConnectionId(connectionId);
  const names = getConnectionBindingNames(id);

  return {
    id,
    names,
    token: String(env?.[names.tokenEnv] || "").trim(),
    webhookSecret: String(env?.[names.secretEnv] || "").trim(),
    ownerIds: String(env?.[names.ownersEnv] || "").trim()
  };
}

function isZaloConnectionConfigured(connection) {
  return Boolean(connection?.token && connection?.webhookSecret);
}

function createScopedZaloEnv(env, connectionId = "main") {
  const connection = getZaloConnection(env, connectionId);
  const scoped = Object.create(env || null);

  scoped.ZALO_CONNECTION_ID = connection.id;
  scoped.ZALO_BOT_TOKEN = connection.token;
  scoped.WEBHOOK_SECRET_TOKEN = connection.webhookSecret;
  scoped.OWNER_ZALO_USER_IDS = connection.ownerIds;

  return { env: scoped, connection };
}

function parseZaloWebhookPath(pathname = "") {
  const match = String(pathname || "").match(/^\/webhooks?(?:\/([^/]+))?\/?$/i);
  if (!match) return null;

  return {
    connectionId: normalizeConnectionId(match[1] || "main"),
    canonicalPath: "/webhook"
  };
}

export {
  connectionSuffix,
  createScopedZaloEnv,
  getConnectionBindingNames,
  getZaloConnection,
  isZaloConnectionConfigured,
  normalizeConnectionId,
  parseZaloWebhookPath
};
