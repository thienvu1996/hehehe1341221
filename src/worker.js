const API_BASE_URL = "https://bot-api.zaloplatforms.com";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_ZALO_TEXT_LENGTH = 1900;
const DEFAULT_BOT_DISPLAY_NAME = "Bot Thu Thap atess";

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

function limitText(text, maxLength = MAX_ZALO_TEXT_LENGTH) {
  const value = String(text || "").trim();

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 20).trim()}...`;
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0].replace(/[),.;!?]+$/g, ""))
    .filter(Boolean);
}

function getCleanQuestion(text, botName = "") {
  let cleanText = String(text || "").trim();
  const names = [botName, DEFAULT_BOT_DISPLAY_NAME, "Bot Thu Thập atess"].filter(Boolean);

  for (const name of names) {
    cleanText = cleanText.replaceAll(`@${name}`, "");
  }

  return cleanText.replace(/^@\S+\s*/, "").trim();
}

function isRentalQuestion(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("link") ||
    normalized.includes("nha") ||
    normalized.includes("phong") ||
    normalized.includes("thue") ||
    normalized.includes("gia") ||
    normalized.includes("quan") ||
    normalized.includes("hom nay") ||
    normalized.includes("loi") ||
    normalized.includes("help") ||
    normalized.includes("tim") ||
    normalized.includes("duoi") ||
    normalized.includes("trieu") ||
    /\b\d+\s*tr\b/.test(normalized)
  );
}

function extractHtmlMeta(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    "";
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title.replace(/\s+/g, " ").trim(),
    description: description.replace(/\s+/g, " ").trim(),
    plainText: plainText.slice(0, 6000)
  };
}

async function fetchUrlInfo(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 ZaloRentalBot/1.0"
      },
      signal: AbortSignal.timeout(8000)
    });
    const contentType = response.headers.get("content-type") || "";
    let title = "";
    let description = "";
    let plainText = "";

    if (contentType.includes("text/html")) {
      const html = await response.text();
      const meta = extractHtmlMeta(html.slice(0, 120000));
      title = meta.title;
      description = meta.description;
      plainText = meta.plainText;
    }

    return {
      ok: response.ok,
      status: response.ok ? "ok" : "error",
      httpStatus: response.status,
      title,
      description,
      plainText
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      httpStatus: null,
      title: "",
      description: "",
      plainText: String(error?.message || error)
    };
  }
}

async function askGemini(env, prompt) {
  if (!env.GEMINI_API_KEY) {
    return "";
  }

  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const response = await fetch(`${GEMINI_API_BASE_URL}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2
      }
    }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Gemini API failed: ${JSON.stringify(data)}`);
  }

  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}

async function summarizeRentalLink(env, url, sourceText, urlInfo) {
  if (!env.GEMINI_API_KEY) {
    return {
      summary: urlInfo.title || urlInfo.description || "Da luu link. Chua co GEMINI_API_KEY de tom tat.",
      priceText: "",
      areaText: ""
    };
  }

  const prompt = `
Ban la tro ly thu thap link thue nha trong nhom Zalo.
Hay tom tat ngan gon bang tieng Viet khong dau, chi dung thong tin co trong input.
Neu khong thay gia/khu vuc thi ghi "chua ro".

Tra ve JSON hop le voi cac key:
summary: tom tat 1-2 cau
price_text: gia thue neu co
area_text: khu vuc/dia chi neu co

URL: ${url}
Tin nhan nguoi dung: ${sourceText}
Tieu de: ${urlInfo.title}
Mo ta: ${urlInfo.description}
Noi dung trang: ${urlInfo.plainText}
`;
  const text = await askGemini(env, prompt);

  try {
    const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());

    return {
      summary: String(parsed.summary || "").trim(),
      priceText: String(parsed.price_text || "").trim(),
      areaText: String(parsed.area_text || "").trim()
    };
  } catch {
    return {
      summary: text,
      priceText: "",
      areaText: ""
    };
  }
}

async function saveMessage(env, message) {
  if (!env.DB) {
    return;
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      message.chat?.id || "",
      message.chat?.chat_type || "",
      message.from?.id || "",
      message.from?.display_name || "",
      message.message_id || null,
      message.text || "",
      message.date || null
    )
    .run();
}

async function saveLink(env, message, url, urlInfo, summaryInfo) {
  await env.DB.prepare(
    `INSERT INTO links
      (chat_id, chat_type, user_id, user_name, message_id, url, source_text, title, description,
       summary, price_text, area_text, status, http_status, last_checked_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id, url) DO UPDATE SET
       source_text = excluded.source_text,
       title = excluded.title,
       description = excluded.description,
       summary = excluded.summary,
       price_text = excluded.price_text,
       area_text = excluded.area_text,
       status = excluded.status,
       http_status = excluded.http_status,
       last_checked_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      message.chat?.id || "",
      message.chat?.chat_type || "",
      message.from?.id || "",
      message.from?.display_name || "",
      message.message_id || null,
      url,
      message.text || "",
      urlInfo.title || "",
      urlInfo.description || "",
      summaryInfo.summary || "",
      summaryInfo.priceText || "",
      summaryInfo.areaText || "",
      urlInfo.status,
      urlInfo.httpStatus
    )
    .run();
}

async function getRecentLinks(env, chatId, limit = 10) {
  const result = await env.DB.prepare(
    `SELECT id, url, title, summary, price_text, area_text, status, http_status, created_at, updated_at
     FROM links
     WHERE chat_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  )
    .bind(chatId, limit)
    .all();

  return result.results || [];
}

async function getBrokenLinks(env, chatId, limit = 10) {
  const result = await env.DB.prepare(
    `SELECT id, url, title, summary, status, http_status, updated_at
     FROM links
     WHERE chat_id = ? AND status != 'ok'
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`
  )
    .bind(chatId, limit)
    .all();

  return result.results || [];
}

function formatLinkList(links) {
  if (links.length === 0) {
    return "Chua co link nao duoc luu trong chat nay.";
  }

  return links
    .map((link, index) => {
      const details = [link.price_text, link.area_text].filter(Boolean).join(" | ");
      return `${index + 1}. ${link.summary || link.title || "Link thue nha"}${details ? ` (${details})` : ""}\n${link.url}`;
    })
    .join("\n\n");
}

async function answerQuestion(env, message, question) {
  const chatId = message.chat?.id;
  const normalized = normalizeText(question);

  if (!env.DB) {
    return "Chua cau hinh database Cloudflare D1.";
  }

  if (normalized.includes("help") || normalized.includes("huong dan")) {
    return [
      "Lenh bot:",
      "- Gui link thue nha: bot tu luu va tom tat.",
      "- Hoi: hom nay co link nao?",
      "- Hoi: link nao loi?",
      "- Hoi: tim phong duoi 5 trieu / quan 7 / gan truong..."
    ].join("\n");
  }

  if (normalized.includes("loi") || normalized.includes("hong") || normalized.includes("die")) {
    return `Cac link dang loi:\n${formatLinkList(await getBrokenLinks(env, chatId))}`;
  }

  const links = await getRecentLinks(env, chatId, 20);

  if (!env.GEMINI_API_KEY) {
    return `Da co ${links.length} link gan nhat.\n${formatLinkList(links.slice(0, 8))}\n\nChua co GEMINI_API_KEY nen bot chua tra loi thong minh duoc.`;
  }

  if (links.length === 0) {
    return "Chua co link nao de tra loi. Hay gui link thue nha vao nhom truoc.";
  }

  const context = links
    .map((link, index) => {
      return [
        `#${index + 1}`,
        `url: ${link.url}`,
        `title: ${link.title || ""}`,
        `summary: ${link.summary || ""}`,
        `price: ${link.price_text || ""}`,
        `area: ${link.area_text || ""}`,
        `status: ${link.status || ""}`,
        `created_at: ${link.created_at || ""}`
      ].join("\n");
    })
    .join("\n\n");
  const prompt = `
Ban la tro ly quan ly link thue nha trong nhom Zalo.
Tra loi ngan gon, thuc dung, bang tieng Viet khong dau.
Chi dua vao danh sach link da luu ben duoi. Neu khong du thong tin thi noi chua ro.

Cau hoi: ${question}

Danh sach link:
${context}
`;

  return limitText(await askGemini(env, prompt));
}

async function processTextMessage(env, message) {
  const text = String(message.text || "").trim();
  const urls = extractUrls(text);

  await saveMessage(env, message);

  if (!env.DB) {
    return getReplyText(message);
  }

  if (urls.length > 0) {
    const savedLinks = [];

    for (const url of urls.slice(0, 5)) {
      const urlInfo = await fetchUrlInfo(url);
      const summaryInfo = await summarizeRentalLink(env, url, text, urlInfo).catch((error) => {
        console.error(error);
        return {
          summary: urlInfo.title || urlInfo.description || "Da luu link, nhung chua tom tat duoc.",
          priceText: "",
          areaText: ""
        };
      });
      await saveLink(env, message, url, urlInfo, summaryInfo);
      savedLinks.push({ url, ...urlInfo, ...summaryInfo });
    }

    const lines = savedLinks.map((link, index) => {
      const status = link.status === "ok" ? "OK" : `LOI${link.httpStatus ? ` ${link.httpStatus}` : ""}`;
      return `${index + 1}. ${status}: ${link.summary || link.title || link.url}`;
    });

    return limitText(`Da luu ${savedLinks.length} link.\n${lines.join("\n")}`);
  }

  const cleanQuestion = getCleanQuestion(text, message.chat?.title || "");
  if (isRentalQuestion(text) || isRentalQuestion(cleanQuestion)) {
    return answerQuestion(env, message, cleanQuestion || text);
  }

  return getReplyText(message);
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
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
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
  const event = body?.result || body;
  const eventName = event?.event_name;
  const message = event?.message;

  console.log("Received Zalo event:", JSON.stringify(body));

  if (eventName === "message.text.received" && message?.chat?.id) {
    try {
      await sendMessage(env, message.chat.id, await processTextMessage(env, message));
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
