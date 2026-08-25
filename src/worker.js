const API_BASE_URL = "https://bot-api.zaloplatforms.com";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_GEMINI_SEARCH_MODEL = "gemini-3.5-flash-lite";
const MAX_ZALO_TEXT_LENGTH = 1900;
const DEFAULT_BOT_DISPLAY_NAME = "Bot Thu Thap atess";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getDashboardCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token, X-Bot-Api-Secret-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function dashboardJson(request, data, status = 200) {
  return json(data, status, getDashboardCorsHeaders(request));
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

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GEMINI_KEY]")
    .replace(/\b\d{8,}:[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_ZALO_TOKEN]")
    .replace(/(token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function limitText(text, maxLength = MAX_ZALO_TEXT_LENGTH) {
  const value = String(text || "").trim();

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 20).trim()}...`;
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function truncateForDb(value, maxLength = 1200) {
  const text = String(value || "");

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
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

function getMessageText(message) {
  return String(message?.text || message?.caption || "").trim();
}

function getCleanQuestion(text, botName = "") {
  let cleanText = String(text || "").trim();
  const names = [botName, DEFAULT_BOT_DISPLAY_NAME, "Bot Thu Thập atess"].filter(Boolean);

  for (const name of names) {
    cleanText = cleanText.replaceAll(`@${name}`, "");
  }

  return cleanText.replace(/^@\S+\s*/, "").trim();
}

function isWeatherQuestion(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("thoi tiet") ||
    normalized.includes("du bao") ||
    normalized.includes("mua khong") ||
    normalized.includes("nong khong")
  );
}

function isRentalQuestion(text) {
  const normalized = normalizeText(text);

  if (isWeatherQuestion(text)) {
    return false;
  }

  const hasRentalIntent =
    normalized.includes("nha") ||
    normalized.includes("phong") ||
    normalized.includes("thue") ||
    normalized.includes("tro") ||
    normalized.includes("can ho") ||
    normalized.includes("chung cu") ||
    normalized.includes("tim nha") ||
    normalized.includes("tim phong");

  return (
    hasRentalIntent ||
    normalized.includes("link") ||
    normalized.includes("loi") ||
    normalized.includes("help") ||
    (hasRentalIntent && normalized.includes("search")) ||
    (hasRentalIntent && normalized.includes("google")) ||
    (hasRentalIntent && normalized.includes("gg")) ||
    (hasRentalIntent && normalized.includes("gia")) ||
    (hasRentalIntent && normalized.includes("quan")) ||
    (hasRentalIntent && normalized.includes("hom nay")) ||
    (hasRentalIntent && normalized.includes("tim")) ||
    (hasRentalIntent && normalized.includes("duoi")) ||
    (hasRentalIntent && normalized.includes("ban kinh")) ||
    (hasRentalIntent && normalized.includes("gan")) ||
    (hasRentalIntent && normalized.includes("trieu")) ||
    (hasRentalIntent && normalized.includes("10tr")) ||
    /\b\d+\s*tr\b/.test(normalized)
  );
}

function isContextQuestion(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("thong tin") ||
    normalized.includes("du lieu") ||
    normalized.includes("metadata") ||
    normalized.includes("meta data") ||
    normalized.includes("nhom") ||
    normalized.includes("group") ||
    normalized.includes("thu thap") ||
    normalized.includes("da luu") ||
    normalized.includes("co gi") ||
    normalized.includes("tong hop") ||
    normalized.includes("bao cao") ||
    normalized.includes("bao nhieu") ||
    normalized.includes("bao nhiu") ||
    normalized.includes("so luong") ||
    normalized.includes("dashboard") ||
    normalized.includes("bot biet gi") ||
    normalized.includes("hien tai")
  );
}

function isPrivateChat(message) {
  return normalizeText(message.chat?.chat_type || "").includes("private");
}

function getOwnerUserIds(env) {
  return String(env.OWNER_ZALO_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isOwnerMessage(env, message) {
  const ownerIds = getOwnerUserIds(env);

  return ownerIds.includes(String(message.from?.id || ""));
}

function wantsDashboardKey(text) {
  return normalizeText(text).replace(/[\s-]+/g, "_").includes("key_dashboard");
}

function answerDashboardKey(env, message) {
  if (!wantsDashboardKey(getMessageText(message))) {
    return null;
  }

  if (!isPrivateChat(message)) {
    return "Lenh KEY_Dashboard chi dung trong tin nhan rieng voi bot, khong gui key trong group.";
  }

  if (!isOwnerMessage(env, message)) {
    return "Tai khoan nay khong co quyen lay dashboard key.";
  }

  if (!env.DASHBOARD_TOKEN) {
    return "Worker chua co DASHBOARD_TOKEN.";
  }

  return [
    "Dashboard key:",
    env.DASHBOARD_TOKEN,
    "",
    "Mo dashboard:",
    "https://dashboard.jean1331.io.vn",
    "Neu domain chua vao duoc, dung:",
    "https://hehehe1341221-dashboard.vuthien616.workers.dev"
  ].join("\n");
}

function buildMessageMetadata(message, eventName = "message.received") {
  const text = redactSensitiveText(getMessageText(message));
  const urls = extractUrls(text);

  return {
    event_name: eventName,
    chat: {
      id: message.chat?.id || "",
      type: message.chat?.chat_type || "",
      title: message.chat?.title || ""
    },
    sender: {
      id: message.from?.id || "",
      name: message.from?.display_name || ""
    },
    message: {
      id: message.message_id || "",
      date: message.date || null,
      has_text: Boolean(message.text),
      has_caption: Boolean(message.caption),
      has_photo: Boolean(message.photo),
      url_count: urls.length,
      text_length: text.length
    },
    extracted: {
      urls
    },
    captured_at: new Date().toISOString()
  };
}

function getUsageMetadata(data = {}) {
  const usage = data.usageMetadata || data.usage_metadata || {};

  return {
    promptTokens: usage.promptTokenCount || usage.prompt_token_count || usage.inputTokenCount || usage.input_token_count || 0,
    outputTokens:
      usage.candidatesTokenCount ||
      usage.candidates_token_count ||
      usage.outputTokenCount ||
      usage.output_token_count ||
      0,
    totalTokens: usage.totalTokenCount || usage.total_token_count || 0
  };
}

function getAiErrorInfo(data = {}, httpStatus = null, error = null) {
  const apiError = data.error || {};

  return {
    code: String(apiError.status || apiError.code || error?.name || httpStatus || ""),
    message: truncateForDb(apiError.message || error?.message || error || "", 1200)
  };
}

async function logAiUsage(env, usage) {
  if (!env.DB) {
    return;
  }

  try {
    const message = usage.message || {};
    await env.DB.prepare(
      `INSERT INTO ai_usage
        (provider, model, feature, chat_id, chat_type, user_id, user_name, message_id,
         ok, http_status, error_code, error_message, prompt_tokens, output_tokens, total_tokens, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        usage.provider || "gemini",
        usage.model || "",
        usage.feature || "",
        message.chat?.id || usage.chatId || "",
        message.chat?.chat_type || usage.chatType || "",
        message.from?.id || usage.userId || "",
        message.from?.display_name || usage.userName || "",
        message.message_id || usage.messageId || null,
        usage.ok ? 1 : 0,
        usage.httpStatus || null,
        usage.errorCode || "",
        truncateForDb(usage.errorMessage || "", 1200),
        usage.promptTokens || 0,
        usage.outputTokens || 0,
        usage.totalTokens || 0,
        truncateForDb(
          JSON.stringify({
            duration_ms: usage.durationMs || 0,
            endpoint: usage.endpoint || "",
            input_type: usage.inputType || "",
            quota_related: usage.httpStatus === 429 || /quota|rate|resource_exhausted/i.test(usage.errorMessage || ""),
            captured_at: new Date().toISOString()
          }),
          4000
        )
      )
      .run();
  } catch (error) {
    console.error("Failed to log AI usage:", error);
  }
}

function wantsWebSearch(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("/search") ||
    normalized.includes("search") ||
    normalized.includes("google") ||
    normalized.includes(" tren gg") ||
    normalized.includes(" gg ") ||
    normalized.includes("tim tren mang") ||
    normalized.includes("tim tren web") ||
    normalized.includes("tim nha") ||
    normalized.includes("tim phong") ||
    isWeatherQuestion(text) ||
    normalized.includes("tin moi") ||
    normalized.includes("hom nay co gi") ||
    normalized.includes("gia vang") ||
    normalized.includes("ty gia")
  );
}

function isLikelyQuestion(text) {
  const normalized = normalizeText(text).trim();

  return (
    normalized.endsWith("?") ||
    normalized.includes(" sao") ||
    normalized.includes(" nhu nao") ||
    normalized.includes(" la gi") ||
    normalized.includes(" co ") ||
    normalized.startsWith("co ") ||
    normalized.startsWith("hoi ") ||
    normalized.startsWith("tim ") ||
    normalized.startsWith("kiem ") ||
    normalized.startsWith("thu thap ") ||
    normalized.startsWith("tom tat ") ||
    normalized.startsWith("giai thich ") ||
    normalized.startsWith("check ") ||
    normalized.startsWith("xem ")
  );
}

function isLikelyLocationText(text) {
  const normalized = normalizeText(text).trim();

  return (
    normalized.length >= 3 &&
    normalized.length <= 90 &&
    !normalized.includes("?") &&
    !isRentalQuestion(text) &&
    (normalized.includes("quan") ||
      normalized.includes("phuong") ||
      normalized.includes("huyen") ||
      normalized.includes("xa ") ||
      normalized.includes("thi tran") ||
      normalized.includes("thanh pho") ||
      normalized.includes("tp ") ||
      normalized.includes("duong") ||
      normalized.includes("an thoi dong"))
  );
}

function isLiveInfoQuestion(text) {
  const normalized = normalizeText(text);

  return (
    wantsWebSearch(text) ||
    normalized.includes("bay gio") ||
    normalized.includes("hien gio") ||
    normalized.includes("luc nay") ||
    normalized.includes("dang co") ||
    normalized.includes("sap toi")
  );
}

async function isWeatherLocationFollowUp(env, message, text) {
  if (!env.DB || !isLikelyLocationText(text)) {
    return false;
  }

  try {
    const result = await env.DB.prepare(
      `SELECT text
       FROM messages
       WHERE chat_id = ? AND (message_id IS NULL OR message_id != ?)
       ORDER BY datetime(created_at) DESC
       LIMIT 5`
    )
      .bind(message.chat?.id || "", message.message_id || "")
      .all();

    return (result.results || []).some((row) => isWeatherQuestion(row.text || ""));
  } catch (error) {
    console.error(error);
    return false;
  }
}

function enrichLiveQuery(env, question) {
  const normalized = normalizeText(question);

  if (isWeatherQuestion(question) && !normalized.includes(" o ") && !normalized.includes(" tai ")) {
    return `${question} tai ${env.DEFAULT_WEATHER_LOCATION || "TP Ho Chi Minh, Viet Nam"}`;
  }

  return question;
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

async function askGemini(env, prompt, options = {}) {
  if (!env.GEMINI_API_KEY) {
    return "";
  }

  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const startedAt = Date.now();
  let logged = false;

  try {
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
    const usage = getUsageMetadata(data);
    const errorInfo = getAiErrorInfo(data, response.status);

    await logAiUsage(env, {
      message: options.message,
      model,
      feature: options.feature || "generate_content",
      ok: response.ok,
      httpStatus: response.status,
      errorCode: response.ok ? "" : errorInfo.code,
      errorMessage: response.ok ? "" : errorInfo.message,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs: Date.now() - startedAt,
      endpoint: "generateContent",
      inputType: "text"
    });
    logged = true;

    if (!response.ok) {
      throw new Error(`Gemini API failed: ${JSON.stringify(data)}`);
    }

    return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  } catch (error) {
    if (!logged) {
      const errorInfo = getAiErrorInfo({}, null, error);
      await logAiUsage(env, {
        message: options.message,
        model,
        feature: options.feature || "generate_content",
        ok: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        durationMs: Date.now() - startedAt,
        endpoint: "generateContent",
        inputType: "text"
      });
    }

    throw error;
  }
}

function parseInteractionText(data) {
  if (data?.output_text) {
    return String(data.output_text).trim();
  }

  const blocks = [];

  for (const step of data?.steps || []) {
    if (step.type === "model_output") {
      for (const block of step.content || []) {
        if (block.type === "text" && block.text) {
          blocks.push(block.text);
        }
      }
    }
  }

  return blocks.join("\n").trim();
}

function parseInteractionSources(data) {
  const sources = [];

  for (const step of data?.steps || []) {
    if (step.type !== "model_output") {
      continue;
    }

    for (const block of step.content || []) {
      for (const annotation of block.annotations || []) {
        if (annotation.type === "url_citation" && annotation.url) {
          sources.push({
            title: annotation.title || annotation.url,
            url: annotation.url
          });
        }
      }
    }
  }

  return [...new Map(sources.map((source) => [source.url, source])).values()].slice(0, 3);
}

async function askGeminiInteraction(env, input, options = {}) {
  if (!env.GEMINI_API_KEY) {
    return { text: "", sources: [] };
  }

  const model = options.model || env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_SEARCH_MODEL;
  const startedAt = Date.now();
  let logged = false;
  const payload = {
    model,
    input
  };

  if (options.tools) {
    payload.tools = options.tools;
  }

  if (options.generationConfig) {
    payload.generation_config = options.generationConfig;
  }

  try {
    const response = await fetch(`${GEMINI_API_BASE_URL}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    const usage = getUsageMetadata(data);
    const errorInfo = getAiErrorInfo(data, response.status);

    await logAiUsage(env, {
      message: options.message,
      model,
      feature: options.feature || "interaction",
      ok: response.ok,
      httpStatus: response.status,
      errorCode: response.ok ? "" : errorInfo.code,
      errorMessage: response.ok ? "" : errorInfo.message,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs: Date.now() - startedAt,
      endpoint: "interactions",
      inputType: Array.isArray(input) ? "multimodal" : "text"
    });
    logged = true;

    if (!response.ok) {
      throw new Error(`Gemini interaction failed: ${JSON.stringify(data)}`);
    }

    return {
      text: parseInteractionText(data),
      sources: parseInteractionSources(data)
    };
  } catch (error) {
    if (!logged) {
      const errorInfo = getAiErrorInfo({}, null, error);
      await logAiUsage(env, {
        message: options.message,
        model,
        feature: options.feature || "interaction",
        ok: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        durationMs: Date.now() - startedAt,
        endpoint: "interactions",
        inputType: Array.isArray(input) ? "multimodal" : "text"
      });
    }

    throw error;
  }
}

async function searchWeb(env, query, message = null) {
  const prompt = `
Ban la tro ly trong nhom Zalo.
Hay tim web bang Google Search va tra loi ngan gon bang tieng Viet khong dau.
Uu tien thong tin moi, dung dieu kien trong cau hoi, va co link nguon.
Neu cau hoi ve nha thue, hay uu tien gia, khu vuc, ban kinh, tinh trang link.
Neu cau hoi ve thoi tiet, hay dua nhiet do, mua/nang, va goi y hanh dong ngan gon.

Cau hoi: ${query}
`;
  const result = await askGeminiInteraction(env, prompt, {
    tools: [{ type: "google_search" }],
    model: env.GEMINI_SEARCH_MODEL || DEFAULT_GEMINI_SEARCH_MODEL,
    feature: "web_search",
    message
  });
  const sourceText = result.sources.length
    ? `\n\nNguon:\n${result.sources.map((source, index) => `${index + 1}. ${source.title}: ${source.url}`).join("\n")}`
    : "";

  return {
    answer: limitText(`${result.text}${sourceText}`),
    sources: result.sources
  };
}

async function saveSearch(env, message, query, answer, sources) {
  if (!env.DB) {
    return;
  }

  await env.DB.prepare(
    `INSERT INTO searches (chat_id, user_id, user_name, query, answer, sources_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      message.chat?.id || "",
      message.from?.id || "",
      message.from?.display_name || "",
      redactSensitiveText(query),
      redactSensitiveText(answer),
      JSON.stringify(sources || []),
      JSON.stringify(buildMessageMetadata(message, "search.created"))
    )
    .run();
}

async function summarizeRentalLink(env, message, url, sourceText, urlInfo) {
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
  const text = await askGemini(env, prompt, {
    feature: "link_summary",
    message
  });

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

async function saveMessage(env, message, eventName = "message.text.received") {
  if (!env.DB) {
    return;
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      message.chat?.id || "",
      message.chat?.chat_type || "",
      message.from?.id || "",
      message.from?.display_name || "",
      message.message_id || null,
      redactSensitiveText(message.text || message.caption || ""),
      message.date || null,
      JSON.stringify(buildMessageMetadata(message, eventName))
    )
    .run();
}

async function saveLink(env, message, url, urlInfo, summaryInfo) {
  await env.DB.prepare(
    `INSERT INTO links
      (chat_id, chat_type, user_id, user_name, message_id, url, source_text, title, description,
       summary, price_text, area_text, status, http_status, metadata_json, last_checked_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(chat_id, url) DO UPDATE SET
       source_text = excluded.source_text,
       title = excluded.title,
       description = excluded.description,
       summary = excluded.summary,
       price_text = excluded.price_text,
       area_text = excluded.area_text,
       status = excluded.status,
       http_status = excluded.http_status,
       metadata_json = excluded.metadata_json,
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
      redactSensitiveText(message.text || message.caption || ""),
      urlInfo.title || "",
      urlInfo.description || "",
      redactSensitiveText(summaryInfo.summary || ""),
      redactSensitiveText(summaryInfo.priceText || ""),
      redactSensitiveText(summaryInfo.areaText || ""),
      urlInfo.status,
      urlInfo.httpStatus,
      JSON.stringify({
        ...buildMessageMetadata(message, "link.saved"),
        url_status: urlInfo.status,
        http_status: urlInfo.httpStatus
      })
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

async function getChatContext(env, chatId) {
  const [countsResult, messagesResult, linksResult, searchesResult, imagesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT 'messages' AS name, COUNT(*) AS total FROM messages WHERE chat_id = ?
       UNION ALL SELECT 'links' AS name, COUNT(*) AS total FROM links WHERE chat_id = ?
       UNION ALL SELECT 'searches' AS name, COUNT(*) AS total FROM searches WHERE chat_id = ?
       UNION ALL SELECT 'images' AS name, COUNT(*) AS total FROM images WHERE chat_id = ?`
    )
      .bind(chatId, chatId, chatId, chatId)
      .all(),
    env.DB.prepare(
      `SELECT user_name, text, created_at, metadata_json
       FROM messages
       WHERE chat_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 12`
    )
      .bind(chatId)
      .all(),
    env.DB.prepare(
      `SELECT url, title, summary, price_text, area_text, status, http_status, created_at, updated_at, metadata_json
       FROM links
       WHERE chat_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 12`
    )
      .bind(chatId)
      .all(),
    env.DB.prepare(
      `SELECT query, answer, sources_json, created_at, metadata_json
       FROM searches
       WHERE chat_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    )
      .bind(chatId)
      .all(),
    env.DB.prepare(
      `SELECT caption, analysis, created_at, metadata_json
       FROM images
       WHERE chat_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    )
      .bind(chatId)
      .all()
  ]);
  const counts = Object.fromEntries((countsResult.results || []).map((row) => [row.name, row.total]));

  return {
    counts: {
      messages: counts.messages || 0,
      links: counts.links || 0,
      searches: counts.searches || 0,
      images: counts.images || 0
    },
    messages: messagesResult.results || [],
    links: linksResult.results || [],
    searches: (searchesResult.results || []).map((row) => ({
      ...row,
      sources: safeJsonParse(row.sources_json, [])
    })),
    images: imagesResult.results || []
  };
}

async function getGlobalContext(env) {
  const [countsResult, chatsResult, messagesResult, linksResult, searchesResult, imagesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT 'messages' AS name, COUNT(*) AS total FROM messages
       UNION ALL SELECT 'links' AS name, COUNT(*) AS total FROM links
       UNION ALL SELECT 'searches' AS name, COUNT(*) AS total FROM searches
       UNION ALL SELECT 'images' AS name, COUNT(*) AS total FROM images`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, chat_type, COUNT(*) AS message_count, MAX(created_at) AS last_message_at
       FROM messages
       GROUP BY chat_id, chat_type
       ORDER BY datetime(last_message_at) DESC
       LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, chat_type, user_name, text, created_at, metadata_json
       FROM messages
       ORDER BY datetime(created_at) DESC
       LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, chat_type, url, title, summary, price_text, area_text, status, http_status, created_at, updated_at, metadata_json
       FROM links
       ORDER BY datetime(updated_at) DESC
       LIMIT 12`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, user_name, query, answer, sources_json, created_at, metadata_json
       FROM searches
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    ).all(),
    env.DB.prepare(
      `SELECT chat_id, user_name, caption, analysis, created_at, metadata_json
       FROM images
       ORDER BY datetime(created_at) DESC
       LIMIT 8`
    ).all()
  ]);
  const counts = Object.fromEntries((countsResult.results || []).map((row) => [row.name, row.total]));

  return {
    scope: "global",
    counts: {
      messages: counts.messages || 0,
      links: counts.links || 0,
      searches: counts.searches || 0,
      images: counts.images || 0
    },
    chats: chatsResult.results || [],
    messages: messagesResult.results || [],
    links: linksResult.results || [],
    searches: (searchesResult.results || []).map((row) => ({
      ...row,
      sources: safeJsonParse(row.sources_json, [])
    })),
    images: imagesResult.results || []
  };
}

function formatChatContextFallback(context, scopeLabel = "nhom nay") {
  const lines = [
    `Trong ${scopeLabel} bot da luu: ${context.counts.messages} tin nhan, ${context.counts.links} link, ${context.counts.searches} cau search, ${context.counts.images} anh.`
  ];

  if (context.chats?.length > 0) {
    lines.push(
      `\nChat co du lieu:\n${context.chats
        .slice(0, 5)
        .map((chat, index) => `${index + 1}. ${chat.chat_type || "CHAT"}: ${chat.message_count} tin nhan`)
        .join("\n")}`
    );
  }

  if (context.links.length > 0) {
    lines.push(`\nLink gan nhat:\n${formatLinkList(context.links.slice(0, 5))}`);
  } else {
    lines.push(`\nChua co link thue nha nao duoc luu trong ${scopeLabel}.`);
  }

  if (context.messages.length > 0) {
    lines.push(
      `\nTin nhan gan nhat:\n${context.messages
        .slice(0, 5)
        .map((message, index) => `${index + 1}. ${message.user_name || "Nguoi dung"}: ${limitText(message.text, 90)}`)
        .join("\n")}`
    );
  }

  if (context.images.length > 0) {
    lines.push(
      `\nAnh gan nhat:\n${context.images
        .slice(0, 3)
        .map((image, index) => `${index + 1}. ${image.caption || image.analysis || "Anh khong co caption"}`)
        .join("\n")}`
    );
  }

  return limitText(lines.join("\n"));
}

async function answerContextQuestion(env, message, question) {
  const chatId = message.chat?.id || "";
  const canViewGlobal = isPrivateChat(message) && isOwnerMessage(env, message);
  const context = canViewGlobal ? await getGlobalContext(env) : await getChatContext(env, chatId);
  const scopeLabel = canViewGlobal ? "tat ca chat/group" : isPrivateChat(message) ? "chat rieng nay" : "nhom nay";

  if (isPrivateChat(message) && !canViewGlobal && getOwnerUserIds(env).length > 0) {
    return "Tin nhan rieng chi cho admin xem tong du lieu. Tai khoan nay chua nam trong OWNER_ZALO_USER_IDS.";
  }

  if (!env.GEMINI_API_KEY) {
    return formatChatContextFallback(context, scopeLabel);
  }

  const compactContext = {
    scope: scopeLabel,
    counts: context.counts,
    chats: context.chats || [],
    recent_messages: context.messages.map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      user: row.user_name,
      text: redactSensitiveText(row.text),
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_links: context.links.map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      url: row.url,
      title: row.title,
      summary: row.summary,
      price: row.price_text,
      area: row.area_text,
      status: row.status,
      updated_at: row.updated_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_searches: context.searches.map((row) => ({
      chat_id: row.chat_id,
      query: row.query,
      answer: row.answer,
      sources: row.sources,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_images: context.images.map((row) => ({
      chat_id: row.chat_id,
      caption: row.caption,
      analysis: row.analysis,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    }))
  };
  const prompt = `
Ban la bot quan ly thong tin trong Zalo.
Tra loi ngan gon bang tieng Viet khong dau.
Hay dua tren context da luu trong D1: messages, links, searches, images va metadata_json.
Neu nguoi dung hoi co thong tin/du lieu chua, hay noi ro pham vi context, so luong va tom tat nhung gi bot dang biet.
Khong lap lai token, secret, api key, hay noi dung nhay cam neu thay trong context.
Neu chua co du lieu, hay huong dan gui link/anh/cau hoi de bot thu thap.

Cau hoi: ${question}

Context JSON:
${JSON.stringify(compactContext).slice(0, 14000)}
`;

  try {
    return limitText(
      await askGemini(env, prompt, {
        feature: "context_answer",
        message
      })
    );
  } catch (error) {
    console.error(error);
    return formatChatContextFallback(context, scopeLabel);
  }
}

function buildConversationContext(context, scopeLabel) {
  return {
    scope: scopeLabel,
    counts: context.counts,
    chats: context.chats || [],
    recent_messages: context.messages.slice(0, 10).map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      user: row.user_name,
      text: redactSensitiveText(row.text),
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_links: context.links.slice(0, 10).map((row) => ({
      chat_id: row.chat_id,
      chat_type: row.chat_type,
      url: row.url,
      title: row.title,
      summary: row.summary,
      price: row.price_text,
      area: row.area_text,
      status: row.status,
      updated_at: row.updated_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_searches: context.searches.slice(0, 6).map((row) => ({
      chat_id: row.chat_id,
      query: row.query,
      answer: row.answer,
      sources: row.sources,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    })),
    recent_images: context.images.slice(0, 6).map((row) => ({
      chat_id: row.chat_id,
      caption: row.caption,
      analysis: row.analysis,
      at: row.created_at,
      metadata: safeJsonParse(row.metadata_json)
    }))
  };
}

async function getVisibleContext(env, message) {
  const canViewGlobal = isPrivateChat(message) && isOwnerMessage(env, message);
  const context = canViewGlobal ? await getGlobalContext(env) : await getChatContext(env, message.chat?.id || "");
  const scopeLabel = canViewGlobal ? "tat ca chat/group" : isPrivateChat(message) ? "chat rieng nay" : "nhom nay";

  return { context, scopeLabel, canViewGlobal };
}

async function answerGeneralQuestion(env, message, question) {
  const { context, scopeLabel } = await getVisibleContext(env, message);

  if (isLiveInfoQuestion(question)) {
    try {
      const query = enrichLiveQuery(env, question);
      const result = await searchWeb(env, query, message);
      await saveSearch(env, message, query, result.answer, result.sources);
      return result.answer || "Chua tim duoc thong tin moi phu hop.";
    } catch (error) {
      console.error(error);
    }
  }

  if (!env.GEMINI_API_KEY) {
    return `${formatChatContextFallback(context, scopeLabel)}\n\nChua co Gemini nen bot chua tra loi hoi dap tu nhien duoc.`;
  }

  const compactContext = buildConversationContext(context, scopeLabel);
  const prompt = `
Ban la tro ly Zalo noi chuyen tu nhien nhu mot nguoi binh thuong, nhung ngan gon va huu ich.
Tra loi bang tieng Viet khong dau.
Neu cau hoi lien quan den du lieu nhom/chat, hay dua vao Context JSON.
Neu cau hoi la kien thuc chung, hay tra loi theo hieu biet cua ban.
Neu cau hoi can du lieu thoi gian thuc ma web search khong co ket qua trong context, hay noi ro can search lai hoac can dia diem/cu the hon.
Khong lap lai token, secret, api key, hay noi dung nhay cam.

Cau hoi: ${question}

Context JSON:
${JSON.stringify(compactContext).slice(0, 14000)}
`;

  try {
    return limitText(
      await askGemini(env, prompt, {
        feature: "general_answer",
        message
      })
    );
  } catch (error) {
    console.error(error);
    return formatChatContextFallback(context, scopeLabel);
  }
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
      "- Hoi: co thong tin trong nhom chua?",
      "- Hoi: thoi tiet hom nay sao?",
      "- Hoi tu nhien nhu: cai nay la gi / nen lam sao / tom tat giup",
      "- Gui anh ban do kem caption: Tam Ga Binh Trieu, ban kinh 2km, tim nha duoi 10tr",
      "- Hoi: tim phong duoi 5 trieu / quan 7 / gan truong..."
    ].join("\n");
  }

  if (isLiveInfoQuestion(question) && !isRentalQuestion(question)) {
    return answerGeneralQuestion(env, message, question);
  }

  if (isContextQuestion(question)) {
    return answerContextQuestion(env, message, question);
  }

  if (normalized.includes("loi") || normalized.includes("hong") || normalized.includes("die")) {
    return `Cac link dang loi:\n${formatLinkList(await getBrokenLinks(env, chatId))}`;
  }

  const links = await getRecentLinks(env, chatId, 20);

  if (!env.GEMINI_API_KEY) {
    return `Da co ${links.length} link gan nhat.\n${formatLinkList(links.slice(0, 8))}\n\nChua co GEMINI_API_KEY nen bot chua tra loi thong minh duoc.`;
  }

  if (links.length === 0) {
    try {
      const result = await searchWeb(env, question, message);
      await saveSearch(env, message, question, result.answer, result.sources);
      return result.answer || "Chua tim duoc ket qua phu hop.";
    } catch (error) {
      console.error(error);
      return "Chua co link nao de tra loi. Gemini Google Search dang loi/het quota, hay gui link thue nha vao nhom truoc.";
    }
  }

  if (wantsWebSearch(question)) {
    try {
      const result = await searchWeb(env, question, message);
      await saveSearch(env, message, question, result.answer, result.sources);
      return result.answer || "Chua tim duoc ket qua phu hop.";
    } catch (error) {
      console.error(error);
    }
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

  return limitText(
    await askGemini(env, prompt, {
      feature: "rental_answer",
      message
    })
  );
}

async function processTextMessage(env, message, eventName = "message.text.received") {
  const text = getMessageText(message);
  const urls = extractUrls(text);

  await saveMessage(env, message, eventName);

  const dashboardKeyReply = answerDashboardKey(env, message);

  if (dashboardKeyReply) {
    return dashboardKeyReply;
  }

  if (!env.DB) {
    return getReplyText(message);
  }

  if (urls.length > 0) {
    const savedLinks = [];

    for (const url of urls.slice(0, 5)) {
      const urlInfo = await fetchUrlInfo(url);
      const summaryInfo = await summarizeRentalLink(env, message, url, text, urlInfo).catch((error) => {
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
  if (await isWeatherLocationFollowUp(env, message, cleanQuestion || text)) {
    return answerGeneralQuestion(env, message, `thoi tiet tai ${cleanQuestion || text}`);
  }

  if (isRentalQuestion(text) || isRentalQuestion(cleanQuestion) || isContextQuestion(text) || isContextQuestion(cleanQuestion)) {
    return answerQuestion(env, message, cleanQuestion || text);
  }

  if (isLikelyQuestion(cleanQuestion || text)) {
    return answerGeneralQuestion(env, message, cleanQuestion || text);
  }

  return getReplyText(message);
}

function getImageMimeType(url = "") {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes(".png")) {
    return "image/png";
  }

  if (lowerUrl.includes(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

async function analyzeImage(env, message, eventName = "message.image.received") {
  const photoUrl = message.photo;
  const caption = getMessageText(message);

  await saveMessage(env, message, eventName);

  if (!photoUrl) {
    return "Khong thay URL anh trong webhook.";
  }

  if (!env.GEMINI_API_KEY) {
    return "Da nhan anh, nhung chua co GEMINI_API_KEY de nhan dien.";
  }

  const prompt = `
Ban la tro ly thu thap thong tin thue nha tu anh nguoi dung gui trong nhom Zalo.
Hay doc anh va caption. Neu la anh ban do, nhan dien cac dia danh thay duoc, vung duoc khoanh, diem trung tam neu co, va uoc luong khu vuc. Khong khang dinh ban kinh km chinh xac neu anh khong co ty le/du lieu toa do.
Neu caption co yeu cau tim nha/phong/gia/ban kinh, hay tao them goi y truy van web ngan gon.
Tra loi bang tieng Viet khong dau, ngan gon.

Caption: ${caption}
`;
  const result = await askGeminiInteraction(
    env,
    [
      { type: "text", text: prompt },
      {
        type: "image",
        uri: photoUrl,
        mime_type: getImageMimeType(photoUrl)
      }
    ],
    {
      model: env.GEMINI_IMAGE_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      feature: "image_analysis",
      message,
      generationConfig: { thinking_level: "minimal" }
    }
  );
  let answer = result.text || "Da nhan anh nhung chua phan tich duoc.";

  if (wantsWebSearch(caption)) {
    try {
      const searchQuery = `${caption}\nKhu vuc/anh: ${answer}`;
      const searchResult = await searchWeb(env, searchQuery, message);
      answer = `${answer}\n\nKet qua web:\n${searchResult.answer}`;
      await saveSearch(env, message, searchQuery, searchResult.answer, searchResult.sources);
    } catch (error) {
      console.error(error);
      answer = `${answer}\n\nChua search web duoc, co the Gemini Google Search dang het quota.`;
    }
  }

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO images (chat_id, chat_type, user_id, user_name, message_id, photo_url, caption, analysis, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, message_id) DO UPDATE SET
         photo_url = excluded.photo_url,
         caption = excluded.caption,
         analysis = excluded.analysis,
         metadata_json = excluded.metadata_json`
    )
      .bind(
        message.chat?.id || "",
        message.chat?.chat_type || "",
        message.from?.id || "",
        message.from?.display_name || "",
        message.message_id || null,
        photoUrl,
        redactSensitiveText(caption),
        redactSensitiveText(answer),
        JSON.stringify(buildMessageMetadata(message, "image.analyzed"))
      )
      .run();
  }

  return limitText(answer);
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

  if (["message.text.received", "message.image.received"].includes(eventName) && message?.chat?.id) {
    try {
      const reply =
        eventName === "message.image.received"
          ? await analyzeImage(env, message, eventName)
          : await processTextMessage(env, message, eventName);
      await sendMessage(env, message.chat.id, reply);
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

function authorizeDashboardRequest(request, env) {
  const expectedToken = env.DASHBOARD_TOKEN || env.WEBHOOK_SECRET_TOKEN;

  if (!expectedToken) {
    return json({ message: "Server is missing DASHBOARD_TOKEN" }, 500);
  }

  const token =
    request.headers.get("x-dashboard-token") || request.headers.get("x-bot-api-secret-token") || "";

  if (!constantTimeEqual(token, expectedToken)) {
    return json({ message: "Unauthorized" }, 403);
  }

  return null;
}

async function handleDashboardData(request, env) {
  const unauthorizedResponse = authorizeDashboardRequest(request, env);

  if (unauthorizedResponse) {
    return dashboardJson(request, await unauthorizedResponse.json(), unauthorizedResponse.status);
  }

  if (!env.DB) {
    return dashboardJson(request, { ok: false, message: "Cloudflare D1 is not configured" }, 500);
  }

  const [countsResult, messagesResult, linksResult, searchesResult, imagesResult, aiStatsResult, aiUsageResult] =
    await Promise.all([
    env.DB.prepare(
      `SELECT 'messages' AS name, COUNT(*) AS total FROM messages
       UNION ALL SELECT 'links' AS name, COUNT(*) AS total FROM links
       UNION ALL SELECT 'searches' AS name, COUNT(*) AS total FROM searches
       UNION ALL SELECT 'images' AS name, COUNT(*) AS total FROM images
       UNION ALL SELECT 'ai_usage' AS name, COUNT(*) AS total FROM ai_usage`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, chat_type, user_id, user_name, message_id, text, message_date, metadata_json, created_at
       FROM messages
       ORDER BY datetime(created_at) DESC
       LIMIT 40`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, chat_type, user_name, message_id, url, source_text, title, description,
              summary, price_text, area_text, status, http_status, metadata_json, last_checked_at, created_at, updated_at
       FROM links
       ORDER BY datetime(updated_at) DESC
       LIMIT 60`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, user_name, query, answer, sources_json, metadata_json, created_at
       FROM searches
       ORDER BY datetime(created_at) DESC
       LIMIT 30`
    ).all(),
    env.DB.prepare(
      `SELECT id, chat_id, user_name, message_id, photo_url, caption, analysis, metadata_json, created_at
       FROM images
       ORDER BY datetime(created_at) DESC
       LIMIT 30`
    ).all(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS calls_total,
         SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS calls_ok,
         SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS calls_error,
         SUM(CASE WHEN http_status = 429 OR error_code LIKE '%RESOURCE_EXHAUSTED%' OR lower(error_message) LIKE '%quota%' THEN 1 ELSE 0 END) AS quota_errors,
         SUM(prompt_tokens) AS prompt_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(total_tokens) AS total_tokens,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS calls_24h,
         SUM(CASE WHEN ok = 0 AND created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS errors_24h,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN total_tokens ELSE 0 END) AS tokens_24h
       FROM ai_usage`
    ).all(),
    env.DB.prepare(
      `SELECT id, provider, model, feature, chat_id, chat_type, user_name, ok, http_status, error_code,
              error_message, prompt_tokens, output_tokens, total_tokens, metadata_json, created_at
       FROM ai_usage
       ORDER BY datetime(created_at) DESC
       LIMIT 60`
    ).all()
  ]);
  const counts = Object.fromEntries((countsResult.results || []).map((row) => [row.name, row.total]));
  const aiStats = aiStatsResult.results?.[0] || {};

  return dashboardJson(request, {
    ok: true,
    generated_at: new Date().toISOString(),
    counts: {
      messages: counts.messages || 0,
      links: counts.links || 0,
      searches: counts.searches || 0,
      images: counts.images || 0,
      ai_usage: counts.ai_usage || 0
    },
    ai_usage: {
      stats: {
        calls_total: aiStats.calls_total || 0,
        calls_ok: aiStats.calls_ok || 0,
        calls_error: aiStats.calls_error || 0,
        quota_errors: aiStats.quota_errors || 0,
        prompt_tokens: aiStats.prompt_tokens || 0,
        output_tokens: aiStats.output_tokens || 0,
        total_tokens: aiStats.total_tokens || 0,
        calls_24h: aiStats.calls_24h || 0,
        errors_24h: aiStats.errors_24h || 0,
        tokens_24h: aiStats.tokens_24h || 0
      },
      recent: (aiUsageResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      }))
    },
    recent: {
      messages: (messagesResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      })),
      links: (linksResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      })),
      searches: (searchesResult.results || []).map((row) => ({
        ...row,
        sources: safeJsonParse(row.sources_json, []),
        metadata: safeJsonParse(row.metadata_json)
      })),
      images: (imagesResult.results || []).map((row) => ({
        ...row,
        metadata: safeJsonParse(row.metadata_json)
      }))
    }
  });
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

    if (request.method === "OPTIONS" && url.pathname === "/admin/dashboard-data") {
      return new Response(null, {
        status: 204,
        headers: getDashboardCorsHeaders(request)
      });
    }

    if (request.method === "GET" && url.pathname === "/admin/dashboard-data") {
      return handleDashboardData(request, env);
    }

    return json({ message: "Not Found" }, 404);
  }
};
