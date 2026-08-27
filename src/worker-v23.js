import workerV22 from "./worker-v22.js";
import { getPayload } from "./worker-v15.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const TYPING_REFRESH_MS = 3500;

function normalizeText(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

function isPrivateChat(message) {
  return normalizeText(message?.chat?.chat_type || "").includes("private");
}

function hasMention(message, text = "") {
  if (/@\S+/u.test(String(text || ""))) return true;
  const mentions = message?.mentions || message?.mention || message?.entities || message?.message_entities;
  if (Array.isArray(mentions) && mentions.length > 0) return true;
  return Boolean(mentions && typeof mentions === "object" && Object.keys(mentions).length > 0);
}

function shouldEmitTyping(payload) {
  if (!payload || payload.eventName !== "message.text.received") return false;
  if (!payload.message?.chat?.id) return false;
  return isPrivateChat(payload.message) || hasMention(payload.message, payload.text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendChatAction(connection, chatId, action = "typing") {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId),
      action
    }),
    signal: AbortSignal.timeout(7000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data?.message || `Zalo sendChatAction HTTP ${response.status}`);
  }
  return data;
}

async function resolveTypingTarget(request, env) {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!shouldEmitTyping(payload)) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;

  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  return {
    connection,
    chatId: String(payload.message.chat.id)
  };
}

function startTypingHeartbeat(connection, chatId) {
  let stopped = false;

  const task = (async () => {
    while (!stopped) {
      await sendChatAction(connection, chatId, "typing").catch((error) => {
        console.warn("V23 typing action failed:", error?.message || error);
      });
      await sleep(TYPING_REFRESH_MS);
    }
  })();

  return {
    stop() {
      stopped = true;
    },
    task
  };
}

export default {
  async fetch(request, env, ctx) {
    let heartbeat = null;

    try {
      const target = await resolveTypingTarget(request, env);
      if (target) heartbeat = startTypingHeartbeat(target.connection, target.chatId);
    } catch (error) {
      console.warn("V23 typing preflight failed:", error?.message || error);
    }

    try {
      return await workerV22.fetch(request, env, ctx);
    } finally {
      heartbeat?.stop();
    }
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV22.scheduled === "function") return workerV22.scheduled(event, env, ctx);
  }
};

export {
  hasMention,
  isPrivateChat,
  resolveTypingTarget,
  sendChatAction,
  shouldEmitTyping,
  startTypingHeartbeat
};
