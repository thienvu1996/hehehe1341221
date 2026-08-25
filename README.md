# hehehe1341221

Webhook Node.js cho Zalo Bot Platform.

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
