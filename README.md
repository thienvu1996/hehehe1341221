# hehehe1341221

Webhook cho Zalo Bot Platform. Repo nay ho tro 2 cach chay:

- Cloudflare Workers: nen dung de deploy free lau dai.
- Node.js Express: dung test local hoac deploy len VPS/Render/Railway.

## Deploy Cloudflare Workers

Dang nhap Cloudflare:

```bash
npx wrangler login
```

Set secrets cho Worker:

```bash
npx wrangler secret put ZALO_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET_TOKEN
```

Deploy:

```bash
npm run deploy
```

Sau khi deploy xong, Cloudflare se hien URL dang:

```text
https://hehehe1341221.<ten-account>.workers.dev
```

Webhook URL de dang ky voi Zalo:

```text
https://hehehe1341221.<ten-account>.workers.dev/webhook
```

Cap nhat `.env` o may local de dang ky webhook:

```env
ZALO_BOT_TOKEN=token-bot-cua-ban
WEBHOOK_SECRET_TOKEN=chuoi-bi-mat-ban-da-set-tren-cloudflare
WEBHOOK_URL=https://hehehe1341221.<ten-account>.workers.dev/webhook
```

Dang ky va test webhook:

```bash
npm run register-webhook
npm run test-webhook
```

## Chay local

```bash
npm install
cp .env.example .env
npm run dev
```

Sua `.env`:

```env
PORT=3000
ZALO_BOT_TOKEN=token-bot-cua-ban
WEBHOOK_SECRET_TOKEN=chuoi-bi-mat-8-den-256-ky-tu
WEBHOOK_URL=https://your-public-domain.com/webhook
```

Webhook endpoint:

- `POST /webhook`
- `POST /webhooks`
- `GET /health`

## Dang ky webhook voi Zalo

Zalo yeu cau webhook phai la URL HTTPS cong khai, khong dung `localhost`.
Neu dang chay local, hay dung ngrok hoac Cloudflare Tunnel de lay public URL.

Sau khi co URL cong khai, cap nhat `WEBHOOK_URL` trong `.env`, roi chay:

```bash
npm run register-webhook
npm run test-webhook
```

Server se xac thuc header `X-Bot-Api-Secret-Token` bang `WEBHOOK_SECRET_TOKEN`
va tu dong phan hoi lai tin nhan text dau vao.
