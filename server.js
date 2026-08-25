import crypto from "node:crypto";
import "dotenv/config";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 3000);
const webhookSecretToken = process.env.WEBHOOK_SECRET_TOKEN || "";
const botToken = process.env.ZALO_BOT_TOKEN || "";
const apiBaseUrl = "https://bot-api.zaloplatforms.com";

app.use(express.json({ limit: "1mb" }));

function isValidSecretToken(receivedToken) {
  if (!webhookSecretToken) {
    return false;
  }

  const expected = Buffer.from(webhookSecretToken);
  const received = Buffer.from(String(receivedToken || ""));

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function callZaloApi(methodName, payload = {}) {
  if (!botToken) {
    throw new Error("Missing ZALO_BOT_TOKEN");
  }

  const response = await fetch(`${apiBaseUrl}/bot${botToken}/${methodName}`, {
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

async function sendMessage(chatId, text) {
  return callZaloApi("sendMessage", {
    chat_id: chatId,
    text
  });
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

async function handleWebhook(req, res) {
  const secretToken = req.get("x-bot-api-secret-token");

  if (!isValidSecretToken(secretToken)) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const event = req.body?.result || req.body;
  const eventName = event?.event_name;
  const message = event?.message;

  console.log("Received Zalo event:", JSON.stringify(req.body));

  if (eventName === "message.text.received" && message?.chat?.id) {
    try {
      await sendMessage(message.chat.id, getReplyText(message));
    } catch (error) {
      console.error(error);
    }
  }

  return res.json({ message: "Success" });
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "hehehe1341221-zalo-webhook",
    webhook_paths: ["/webhook", "/webhooks"]
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/webhook", handleWebhook);
app.post("/webhooks", handleWebhook);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
