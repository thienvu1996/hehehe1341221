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
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put DASHBOARD_TOKEN
```

`GEMINI_API_KEY` la tuy chon. Neu chua set, bot van luu link vao D1 nhung chua tom tat/tra loi thong minh bang Gemini.
`DASHBOARD_TOKEN` dung de bao ve API dashboard doc du lieu tu D1.

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

Hoac dung endpoint admin tren Worker neu token chi duoc luu trong Cloudflare secrets:

```bash
curl -X POST "https://hehehe1341221.<ten-account>.workers.dev/admin/register-webhook" \
  -H "X-Bot-Api-Secret-Token: chuoi-bi-mat-ban-da-set-tren-cloudflare"

curl -X POST "https://hehehe1341221.<ten-account>.workers.dev/admin/test-webhook" \
  -H "X-Bot-Api-Secret-Token: chuoi-bi-mat-ban-da-set-tren-cloudflare"
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

## Luu link thue nha

Bot tu dong luu cac link `http://` va `https://` trong group vao Cloudflare D1.
Neu co `GEMINI_API_KEY`, bot se tom tat link bang model `gemini-3.1-flash-lite`.

Vi du:

```text
@Bot Thu Thap atess https://example.com/can-ho-123 nha nay 5tr quan 7
@Bot Thu Thap atess hom nay co link nao?
@Bot Thu Thap atess link nao loi?
@Bot Thu Thap atess co thong tin trong nhom chua?
@Bot Thu Thap atess tong hop du lieu hien tai
@Bot Thu Thap atess tim phong duoi 5 trieu
@Bot Thu Thap atess tim nha duoi 10tr gan Ga Binh Trieu tren google
@Bot Thu Thap atess help
```

Bot luu them `metadata_json` cho tin nhan, link, search va anh. Metadata gom event Zalo,
chat id/type/title, nguoi gui, message id/date, so URL trich xuat va thoi diem bot ghi nhan.
Khi hoi thong tin tong quat, bot dung metadata va du lieu gan nhat trong group hien tai de tra loi.

Neu muon nhan rieng voi bot de hoi tong du lieu tat ca group/chat, set secret admin:

```bash
npx wrangler secret put OWNER_ZALO_USER_IDS
```

Gia tri la mot hoac nhieu Zalo user id, ngan cach bang dau phay. Trong group, bot van chi tra loi
theo du lieu cua group do. Trong tin nhan rieng cua admin, bot co the tong hop toan bo D1.
Khong nen gui `DASHBOARD_TOKEN` qua Zalo vi day la khoa xem dashboard rieng.
Neu chap nhan gui qua Zalo, admin co the nhan rieng voi bot dung lenh chinh xac:

```text
KEY_Dashboard
```

Lenh nay chi hoat dong trong tin nhan rieng cua user id nam trong `OWNER_ZALO_USER_IDS`.

## Anh ban do va Google Search

Bot co the nhan anh tu Zalo qua event `message.image.received`.
Neu gui anh ban do, nen kem caption ro dieu kien:

```text
Tam Ga Binh Trieu, ban kinh 2km, tim nha duoi 10tr tren google
```

Bot se doc dia danh/vung khoanh trong anh bang Gemini Vision. Neu caption co yeu cau tim kiem, bot se thu dung Gemini Google Search de tim tren web.
Neu Google Search het quota, bot van luu/phan tich anh nhung se bao chua search web duoc.

## Web dashboard Next.js

Dashboard doc du lieu tu endpoint Worker `GET /admin/dashboard-data` va yeu cau `DASHBOARD_TOKEN`.

URL dang deploy:

```text
https://dashboard.jean1331.io.vn
https://hehehe1341221-dashboard.vuthien616.workers.dev
```

Chay local:

```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
```

Deploy dashboard:

```bash
cd dashboard
npm run deploy
```
