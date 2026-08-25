import "dotenv/config";

const botToken = process.env.ZALO_BOT_TOKEN;

if (!botToken) {
  console.error("Missing required env: ZALO_BOT_TOKEN");
  process.exit(1);
}

const response = await fetch(`https://bot-api.zaloplatforms.com/bot${botToken}/testWebhook`, {
  method: "POST"
});

const data = await response.json().catch(() => ({}));
console.log(JSON.stringify(data, null, 2));

if (!response.ok || data.ok === false) {
  process.exit(1);
}
