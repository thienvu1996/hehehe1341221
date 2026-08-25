import "dotenv/config";

const botToken = process.env.ZALO_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const secretToken = process.env.WEBHOOK_SECRET_TOKEN;

if (!botToken || !webhookUrl || !secretToken) {
  console.error("Missing required env: ZALO_BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET_TOKEN");
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
