const API_BASE_URL = "https://bot-api.zaloplatforms.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
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

function getReplyText(message) {
  const text = String(message?.text || "").trim();

  if (!text) {
    return "Bot da nhan duoc tin nhan cua ban.";
  }

  if (/^(hi|hello|chao|xin chao|\/start)$/i.test(text)) {
    return "Xin chao! Webhook Zalo Bot da hoat dong.";
  }

  return `Ban vua gui: ${text}`;
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
    body: JSON.stringify(payload)
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

async function handleWebhook(request, env) {
  if (!env.WEBHOOK_SECRET_TOKEN) {
    return json({ message: "Server is missing WEBHOOK_SECRET_TOKEN" }, 500);
  }

  const secretToken = request.headers.get("x-bot-api-secret-token") || "";

  if (!constantTimeEqual(secretToken, env.WEBHOOK_SECRET_TOKEN)) {
    return json({ message: "Unauthorized" }, 403);
  }

  const body = await request.json().catch(() => null);
  const event = body?.result;
  const eventName = event?.event_name;
  const message = event?.message;

  console.log("Received Zalo event:", JSON.stringify(body));

  if (eventName === "message.text.received" && message?.chat?.id) {
    try {
      await sendMessage(env, message.chat.id, getReplyText(message));
    } catch (error) {
      console.error(error);
    }
  }

  return json({ message: "Success" });
}

function authorizeAdminRequest(request, env) {
  if (!env.WEBHOOK_SECRET_TOKEN) {
    return json({ message: "Server is missing WEBHOOK_SECRET_TOKEN" }, 500);
  }

  const secretToken = request.headers.get("x-bot-api-secret-token") || "";

  if (!constantTimeEqual(secretToken, env.WEBHOOK_SECRET_TOKEN)) {
    return json({ message: "Unauthorized" }, 403);
  }

  return null;
}

async function handleRegisterWebhook(request, env) {
  const unauthorizedResponse = authorizeAdminRequest(request, env);

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/webhook`;
  const data = await callZaloApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.WEBHOOK_SECRET_TOKEN
  });

  return json(data);
}

async function handleTestWebhook(request, env) {
  const unauthorizedResponse = authorizeAdminRequest(request, env);

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const data = await callZaloApi(env, "testWebhook");

  return json(data);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "hehehe1341221-zalo-webhook",
        webhook_paths: ["/webhook", "/webhooks"]
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    if (request.method === "POST" && ["/webhook", "/webhooks"].includes(url.pathname)) {
      return handleWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/register-webhook") {
      return handleRegisterWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/test-webhook") {
      return handleTestWebhook(request, env);
    }

    return json({ message: "Not Found" }, 404);
  }
};
