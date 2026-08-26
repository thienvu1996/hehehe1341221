import "dotenv/config";

function normalizeConnectionId(value = "main") {
  const normalized = String(value || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "main";
}

function suffixFor(connectionId) {
  return normalizeConnectionId(connectionId)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const connectionId = normalizeConnectionId(process.env.ZALO_CONNECTION_ID || "main");
const suffix = suffixFor(connectionId);
const isMain = connectionId === "main";

const tokenEnv = isMain ? "ZALO_BOT_TOKEN" : `ZALO_BOT_TOKEN_${suffix}`;
const secretEnv = isMain ? "WEBHOOK_SECRET_TOKEN" : `WEBHOOK_SECRET_TOKEN_${suffix}`;

const botToken = process.env[tokenEnv];
const secretToken = process.env[secretEnv];
const webhookBaseUrl = String(process.env.WEBHOOK_BASE_URL || "https://bot.jean1331.io.vn").replace(/\/$/, "");
const webhookUrl = process.env.WEBHOOK_URL || `${webhookBaseUrl}${isMain ? "/webhook" : `/webhook/${connectionId}`}`;

const missingEnv = [
  [tokenEnv, botToken],
  [secretEnv, secretToken]
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingEnv.length > 0) {
  console.error(`Missing required env: ${missingEnv.join(", ")}`);
  process.exit(1);
}

console.log(`Registering Zalo connection '${connectionId}' -> ${webhookUrl}`);

const response = await fetch(`https://bot-api.zaloplatforms.com/bot${botToken}/setWebhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken
  })
});

const data = await response.json().catch(() => ({}));
console.log(JSON.stringify(data, null, 2));

if (!response.ok || data.ok === false) {
  process.exit(1);
}
