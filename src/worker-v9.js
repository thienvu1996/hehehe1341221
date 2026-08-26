import workerV8, { resolveZaloConnection } from "./worker-v8.js";
import { getRuntimeProviders } from "./config-manager.js";
import { isAiRuntimeQuestion } from "./worker-v6.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
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

async function latestUsage(env, chatId) {
  if (!env.DB?.prepare) return null;
  try {
    return await env.DB.prepare(
      `SELECT provider, model, feature, created_at
       FROM ai_usage
       WHERE ok = 1 AND COALESCE(model, '') != ''
       ORDER BY CASE WHEN chat_id = ? THEN 0 ELSE 1 END, datetime(created_at) DESC
       LIMIT 1`
    ).bind(chatId || "").first();
  } catch {
    return null;
  }
}

async function formatRuntime(env, connectionId, chatId) {
  const providers = await getRuntimeProviders(env).catch(() => []);
  const latest = await latestUsage(env, chatId);
  const lines = [
    `AI router của bot '${connectionId}':`
  ];

  if (providers.length) {
    lines.push("- Managed providers (theo priority):");
    for (const provider of providers.slice(0, 5)) {
      lines.push(`  P${provider.priority}: ${provider.label || provider.id} → chat ${provider.chat_model || "-"} / reasoning ${provider.reasoning_model || "-"} / code ${provider.code_model || "-"} (${provider.keys.length} key)`);
    }
    lines.push("- Khi provider/key lỗi: thử key tiếp theo → provider tiếp theo → Cloudflare Env fallback.");
  } else {
    lines.push("- Chưa có provider quản lý trên dashboard.");
    lines.push("- Đang dùng fallback Cloudflare Env: Grok/Nexus → Gemini.");
  }

  if (latest?.model) {
    lines.push(`- Model vừa chạy thực tế: ${latest.provider || "unknown"} / ${latest.model}`);
    if (latest.feature) lines.push(`- Tác vụ: ${latest.feature}`);
    if (latest.created_at) lines.push(`- Log: ${latest.created_at} UTC`);
  } else {
    lines.push("- Chưa có log AI thành công gần đây.");
  }
  return lines.join("\n");
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health/ai") {
      const providers = await getRuntimeProviders(env).catch(() => []);
      return json({
        ok: true,
        managed: providers.map((provider) => ({
          id: provider.id,
          label: provider.label,
          type: provider.provider_type,
          priority: provider.priority,
          chat_model: provider.chat_model,
          reasoning_model: provider.reasoning_model,
          code_model: provider.code_model,
          keys: provider.keys.length
        })),
        fallback: "Cloudflare Env (Grok/Nexus -> Gemini)"
      });
    }

    const webhook = parseZaloWebhookPath(url.pathname);
    if (request.method === "POST" && webhook) {
      try {
        const connection = await resolveZaloConnection(env, webhook.connectionId);
        const requestSecret = request.headers.get("x-bot-api-secret-token") || "";
        if (connection?.token && connection?.webhookSecret && constantTimeEqual(requestSecret, connection.webhookSecret)) {
          const body = await request.clone().json().catch(() => null);
          const payload = getPayload(body);
          if (payload?.eventName === "message.text.received" && isAiRuntimeQuestion(payload.text)) {
            await sendMessage(connection, payload.message.chat.id, await formatRuntime(env, connection.id, String(payload.message.chat.id || "")));
            return json({ message: "Success", provider: "runtime-status-v9" });
          }
        }
      } catch (error) {
        console.error("Managed runtime status failed:", error);
      }
    }

    return workerV8.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV8.scheduled === "function") return workerV8.scheduled(event, env, ctx);
  }
};
