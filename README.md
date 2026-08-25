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
`DASHBOARD_TOKEN` la key chinh de dang nhap dashboard. Web khong luu key nay dai han; sau khi dang nhap,
Worker cap session token tam thoi het han sau 30 phut.

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
@Bot Thu Thap atess thoi tiet hom nay sao?
@Bot Thu Thap atess cai nay la gi?
@Bot Thu Thap atess nen lam sao tiep?
@Bot Thu Thap atess tim phong duoi 5 trieu
@Bot Thu Thap atess tim nha duoi 10tr gan Ga Binh Trieu tren google
@Bot Thu Thap atess help
```

Bot luu them `metadata_json` cho tin nhan, link, search va anh. Metadata gom event Zalo,
chat id/type/title, nguoi gui, message id/date, so URL trich xuat va thoi diem bot ghi nhan.
Khi hoi thong tin tong quat, bot dung metadata va du lieu gan nhat trong group hien tai de tra loi.
Ngoai cac lenh co san, bot se xu ly cau hoi tu nhien bang Gemini. Cau hoi can du lieu moi
nhu tin moi, ty gia, gia vang se thu dung web search. Rieng thoi tiet dung Open-Meteo free API
khong can Gemini; neu khong ghi dia diem, thoi tiet mac dinh la TP Ho Chi Minh.
Neu vua hoi thoi tiet roi gui tiep ten dia diem, bot se hieu do la dia diem can tra cuu thoi tiet.
Moi lan bot goi Gemini, Worker se ghi usage vao D1 de dashboard xem so call, token va loi quota/429.
Bot co them intent router: voi moi tin nhan khong phai link/lenh bao mat, bot doc tin moi,
state cu va cac tin gan nhat de doan y dinh nhu weather, rental_search, context_summary,
broken_links, help hoac general_chat. State nay duoc luu trong bang `conversation_state`
de cac cau noi cut nhu "cai do sao", "roi sao", "o dau" van bam theo ngu canh chat hien tai.

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
Webhook thuong gui URL anh (`photo_url`) chu khong gui binary/base64 truc tiep. Worker se tai URL anh,
doi sang base64 tam thoi de gui Gemini Vision, nhung D1 chi luu URL, caption, analysis va metadata.
Neu can luu file anh lau dai, nen them Cloudflare R2 thay vi nhet base64 vao D1.
Neu gui anh ban do, nen kem caption ro dieu kien:

```text
Tam Ga Binh Trieu, ban kinh 2km, tim nha duoi 10tr tren google
```

Bot se doc dia danh/vung khoanh trong anh bang Gemini Vision. Neu caption co yeu cau tim kiem, bot se thu dung Gemini Google Search de tim tren web.
Neu Google Search het quota, bot van luu/phan tich anh nhung se bao chua search web duoc.

## Web dashboard Next.js

Dashboard dang nhap qua endpoint Worker `POST /admin/dashboard-session`, roi doc du lieu tu
`GET /admin/dashboard-data` bang session token 30 phut.
Dashboard co tab `AI quota` de xem usage bot da ghi nhan. Gemini API khong tra ve so quota con lai
truc tiep, nen dashboard hien so call/token da dung va cac loi quota/rate limit neu co.
Moi tab du lieu tu dong phan trang 10 dong/trang khi ket qua dai.

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
