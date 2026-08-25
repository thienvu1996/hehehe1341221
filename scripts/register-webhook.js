import "dotenv/config";

const botToken = process.env.ZALO_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const secretToken = process.env.WEBHOOK_SECRET_TOKEN;

const missingEnv = [
  ["ZALO_BOT_TOKEN", botToken],
  ["WEBHOOK_URL", webhookUrl],
  ["WEBHOOK_SECRET_TOKEN", secretToken]
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingEnv.length > 0) {
  console.error(`Missing required env: ${missingEnv.join(", ")}`);
  process.exit(1);
}

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
