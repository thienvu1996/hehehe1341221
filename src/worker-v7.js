import workerV6 from "./worker-v6.js";
import {
  createScopedZaloEnv,
  getZaloConnection,
  isZaloConnectionConfigured,
  parseZaloWebhookPath
} from "./zalo-connections.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function rewriteWebhookRequest(request, canonicalPath) {
  const url = new URL(request.url);
  url.pathname = canonicalPath;
  return new Request(url.toString(), request);
}

function connectionHealth(env, connectionId) {
  const connection = getZaloConnection(env, connectionId);
  return {
    ok: true,
    connection_id: connection.id,
    configured: isZaloConnectionConfigured(connection),
    token_configured: Boolean(connection.token),
    webhook_secret_configured: Boolean(connection.webhookSecret),
    owners_configured: Boolean(connection.ownerIds)
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health/zalo-connection") {
      const connectionId = url.searchParams.get("id") || "main";
      return json(connectionHealth(env, connectionId));
    }

    const webhook = parseZaloWebhookPath(url.pathname);

    if (request.method === "POST" && webhook) {
      const scoped = createScopedZaloEnv(env, webhook.connectionId);

      if (!isZaloConnectionConfigured(scoped.connection)) {
        return json(
          {
            ok: false,
            message: `Zalo connection '${scoped.connection.id}' is not configured`
          },
          503
        );
      }

      const rewrittenRequest = rewriteWebhookRequest(request, webhook.canonicalPath);
      return workerV6.fetch(rewrittenRequest, scoped.env, ctx);
    }

    return workerV6.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV6.scheduled === "function") {
      return workerV6.scheduled(event, env, ctx);
    }
  }
};

export { connectionHealth, rewriteWebhookRequest };
