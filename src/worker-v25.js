import workerV24 from "./worker-v24.js";
import { getPayload } from "./worker-v15.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const TIMEZONE = "Asia/Ho_Chi_Minh";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function normalizeText(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function isGroupChat(message) {
  const type = normalizeText(message?.chat?.chat_type || "");
  return Boolean(message?.chat?.id) && !type.includes("private");
}

function hasBotMentionLike(text = "") {
  return /(^|\s)@bot\b/i.test(String(text || ""));
}

function getMentionContainers(message) {
  const values = [message?.mentions, message?.mention, message?.entities, message?.message_entities];
  const out = [];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value);
    else if (value && typeof value === "object") out.push(value);
  }
  return out;
}

function normalizeMention(item = {}) {
  const uid = String(
    item.uid ?? item.user_id ?? item.userId ?? item.id ?? item.target_id ?? item.targetId ?? ""
  ).trim();
  const name = String(
    item.display_name ?? item.displayName ?? item.name ?? item.text ?? item.label ?? item.title ?? ""
  )
    .replace(/^@+/, "")
    .trim();
  return { uid, name };
}

function isLikelyBotMention(mention) {
  return /^bot(?:\s|$)/i.test(String(mention?.name || "").trim());
}

function extractIndividualTarget(message, text = "") {
  const mentions = getMentionContainers(message)
    .map(normalizeMention)
    .filter((item) => item.uid || item.name)
    .filter((item) => item.uid !== "-1");

  const nonBot = mentions.filter((item) => !isLikelyBotMention(item));
  if (nonBot.length) return nonBot[nonBot.length - 1];
  if (mentions.length >= 2) return mentions[mentions.length - 1];

  const rawMentions = [...String(text || "").matchAll(/@([^@\n,;:]{1,50})/gu)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .filter((name) => !/^bot(?:\s|$)/i.test(name));
  if (rawMentions.length) return { uid: "", name: rawMentions[rawMentions.length - 1] };
  return null;
}

function detectTarget(message, text = "") {
  const normalized = normalizeText(text);
  if (
    /(^|\s)@all\b/.test(normalized) ||
    /\b(tat ca moi nguoi|tat ca|moi nguoi|ca nhom|toan bo nhom|all members)\b/.test(normalized)
  ) {
    return { mode: "all", uid: "-1", name: "all" };
  }

  const user = extractIndividualTarget(message, text);
  if (user) return { mode: "user", uid: user.uid, name: user.name || "bạn" };
  return null;
}

function getVietnamLocal(now = new Date()) {
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes()
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addLocalDays(parts, count) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseVietnamDueAt(text = "", now = new Date()) {
  const normalized = normalizeText(text);
  let hour = null;
  let minute = 0;

  let match = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2]);
  }

  if (hour === null) {
    match = normalized.match(/\b([01]?\d|2[0-3])\s*h(?:\s*([0-5]?\d))?\b/);
    if (match) {
      hour = Number(match[1]);
      minute = match[2] ? Number(match[2]) : 0;
    }
  }

  if (hour === null) {
    match = normalized.match(/\b(?:luc|vao|toi)\s+([01]?\d|2[0-3])\s*(?:gio)?\b/);
    if (match) hour = Number(match[1]);
  }

  if (hour === null) return null;

  const localNow = getVietnamLocal(now);
  let dateParts = { year: localNow.year, month: localNow.month, day: localNow.day };
  let explicitDate = false;

  const dateMatch = normalized.match(/\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-](\d{4}))?\b/);
  if (dateMatch) {
    const year = dateMatch[3] ? Number(dateMatch[3]) : localNow.year;
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[1]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    dateParts = { year, month, day };
    explicitDate = true;
  } else if (/\b(ngay mai|mai)\b/.test(normalized)) {
    dateParts = addLocalDays(localNow, 1);
    explicitDate = true;
  } else if (/\b(hom nay|toi nay)\b/.test(normalized)) {
    explicitDate = true;
  }

  if (!explicitDate && (hour < localNow.hour || (hour === localNow.hour && minute <= localNow.minute))) {
    dateParts = addLocalDays(localNow, 1);
  }

  const dueAt = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour - 7, minute, 0));
  if (!Number.isFinite(dueAt.getTime())) return null;

  return {
    dueAt,
    localDate: `${dateParts.year}-${pad2(dateParts.month)}-${pad2(dateParts.day)}`,
    localTime: `${pad2(hour)}:${pad2(minute)}`,
    displayDate: `${pad2(dateParts.day)}/${pad2(dateParts.month)}/${dateParts.year}`,
    timezone: TIMEZONE
  };
}

function removeKnownMention(text, name) {
  if (!name) return text;
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text).replace(new RegExp(`@${escaped}`, "ig"), " ");
}

function extractReminderTitle(text = "", target = null) {
  let value = String(text || "");
  value = removeKnownMention(value, target?.name);
  value = value
    .replace(/@all\b/gi, " ")
    .replace(/@Bot[^,:;\n]*?(?=\b(?:nhắc|nhac|lúc|luc|hôm|hom|mai|\d{1,2}(?::\d{2}|h))\b)/giu, " ")
    .replace(/\b(tất cả mọi người|tat ca moi nguoi|mọi người|moi nguoi|cả nhóm|ca nhom|toàn bộ nhóm|toan bo nhom)\b/giu, " ")
    .replace(/\b(nhắc|nhac|thông báo|thong bao|báo|bao|tag|mention|đến giờ|den gio|tới giờ|toi gio|lúc|luc|vào|vao)\b/giu, " ")
    .replace(/\b(hôm nay|hom nay|tối nay|toi nay|ngày mai|ngay mai|mai)\b/giu, " ")
    .replace(/\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-]\d{4})?\b/g, " ")
    .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, " ")
    .replace(/\b([01]?\d|2[0-3])\s*h(?:\s*[0-5]?\d)?\b/gi, " ")
    .replace(/[,:;\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value || "Sự kiện đã hẹn";
}

function isMentionReminderIntent(message, text = "") {
  if (!isGroupChat(message)) return false;
  const normalized = normalizeText(text);
  const target = detectTarget(message, text);
  if (!target) return false;
  const reminderWords = /\b(nhac|thong bao|bao|tag|mention|den gio|toi gio|hen gio|len lich)\b/.test(normalized);
  const botMention = hasBotMentionLike(text) || getMentionContainers(message).some((item) => isLikelyBotMention(normalizeMention(item)));
  return reminderWords && botMention;
}

function isMentionReminderListIntent(message, text = "") {
  if (!isGroupChat(message) || !hasBotMentionLike(text)) return false;
  const normalized = normalizeText(text);
  return /\b(lich tag|lich mention|lich thong bao|danh sach thong bao|danh sach tag)\b/.test(normalized);
}

function getCancelPrefix(text = "") {
  const normalized = normalizeText(text);
  const match = normalized.match(/\b(?:huy tag|huy mention|huy thong bao)\s+#?([a-z0-9-]{4,36})\b/);
  return match ? match[1] : "";
}

async function sendZaloMessage(connection, chatId, text, mentions = []) {
  const endpoint = `${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`;
  const base = { chat_id: String(chatId), text: String(text || "").slice(0, 1900) };

  const attempt = async (body) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo HTTP ${response.status}`);
    return data;
  };

  if (mentions.length) {
    try {
      return await attempt({ ...base, mentions });
    } catch (error) {
      console.warn("V25 Bot API mention payload failed, falling back to text tag:", error?.message || error);
    }
  }
  return attempt(base);
}

async function saveMentionReminder(env, connection, payload, target, due, title) {
  const id = crypto.randomUUID();
  const message = payload.message;
  await env.DB.prepare(
    `INSERT INTO mention_reminders
      (id, connection_id, chat_id, chat_type, chat_title, creator_user_id, creator_user_name,
       target_mode, target_user_id, target_display_name, title, due_at_utc, due_local_date,
       due_local_time, timezone, status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    connection.id || "main",
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.chat?.title || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    target.mode,
    target.uid || "",
    target.name || "",
    title.slice(0, 1500),
    due.dueAt.toISOString(),
    due.localDate,
    due.localTime,
    due.timezone,
    JSON.stringify({ source: "group-mention-v25", original_text: payload.text.slice(0, 1800) })
  ).run();
  return id;
}

async function listMentionReminders(env, connectionId, chatId) {
  const result = await env.DB.prepare(
    `SELECT id, target_mode, target_display_name, title, due_local_date, due_local_time
     FROM mention_reminders
     WHERE connection_id = ? AND chat_id = ? AND status = 'pending'
     ORDER BY due_at_utc ASC LIMIT 15`
  ).bind(connectionId, chatId).all();
  return result.results || [];
}

async function cancelMentionReminder(env, connectionId, chatId, prefix) {
  const row = await env.DB.prepare(
    `SELECT id FROM mention_reminders
     WHERE connection_id = ? AND chat_id = ? AND status = 'pending' AND id LIKE ?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(connectionId, chatId, `${prefix}%`).first();
  if (!row?.id) return false;
  await env.DB.prepare(
    `UPDATE mention_reminders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(row.id).run();
  return true;
}

function formatPendingRows(rows) {
  if (!rows.length) return "Nhóm này chưa có lịch @ thông báo nào đang chờ.";
  const lines = rows.map((row, index) => {
    const parts = String(row.due_local_date || "").split("-");
    const date = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : row.due_local_date;
    const target = row.target_mode === "all" ? "@all" : `@${row.target_display_name || "cá nhân"}`;
    return `${index + 1}. #${String(row.id).slice(0, 8)} · ${row.due_local_time} ${date} · ${target} · ${row.title}`;
  });
  return `Lịch @ thông báo đang chờ:\n${lines.join("\n")}`;
}

async function handleMentionReminderCommand(request, env) {
  if (request.method !== "POST" || !env.DB?.prepare) return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received" || !isGroupChat(payload.message)) return null;

  const isList = isMentionReminderListIntent(payload.message, payload.text);
  const cancelPrefix = getCancelPrefix(payload.text);
  const isCreate = isMentionReminderIntent(payload.message, payload.text);
  if (!isList && !cancelPrefix && !isCreate) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const chatId = String(payload.message.chat.id);

  if (isList) {
    const rows = await listMentionReminders(env, connection.id || "main", chatId);
    await sendZaloMessage(connection, chatId, formatPendingRows(rows));
    return json({ message: "Success", provider: "group-mention-v25", action: "list" });
  }

  if (cancelPrefix) {
    const ok = await cancelMentionReminder(env, connection.id || "main", chatId, cancelPrefix);
    await sendZaloMessage(connection, chatId, ok ? `Đã hủy lịch #${cancelPrefix}.` : `Không tìm thấy lịch #${cancelPrefix} đang chờ.`);
    return json({ message: "Success", provider: "group-mention-v25", action: "cancel", ok });
  }

  const target = detectTarget(payload.message, payload.text);
  const due = parseVietnamDueAt(payload.text);
  if (!target) return null;

  if (!due) {
    await sendZaloMessage(
      connection,
      chatId,
      "Mình hiểu bạn muốn @ nhắc nhóm/cá nhân nhưng chưa thấy giờ rõ. Ví dụ: @Bot 18h hôm nay nhắc @all họp team, hoặc @Bot mai 8h nhắc @Lan gửi báo cáo."
    );
    return json({ message: "Success", provider: "group-mention-v25", action: "ask_time" });
  }

  const title = extractReminderTitle(payload.text, target);
  const id = await saveMentionReminder(env, connection, payload, target, due, title);
  const targetLabel = target.mode === "all" ? "@all" : `@${target.name || "cá nhân"}`;
  await sendZaloMessage(
    connection,
    chatId,
    `Đã đặt lịch #${id.slice(0, 8)} ✅\n${due.localTime} ${due.displayDate} → ${targetLabel}\n${title}\n\nXem lịch: @Bot lịch thông báo\nHủy: @Bot hủy thông báo ${id.slice(0, 8)}`
  );
  return json({ message: "Success", provider: "group-mention-v25", action: "create", id });
}

function buildNotification(reminder) {
  const parts = String(reminder.due_local_date || "").split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : reminder.due_local_date;
  const prefix = reminder.target_mode === "all" ? "@all" : `@${reminder.target_display_name || "bạn"}`;
  const text = `${prefix} 🔔 Nhắc sự kiện\n🕐 ${reminder.due_local_time || ""} ${displayDate || ""}\n${reminder.title || "Sự kiện đã hẹn"}`;
  const mention = reminder.target_mode === "all"
    ? { pos: 0, len: 4, uid: "-1", type: 0 }
    : reminder.target_user_id
      ? { pos: 0, len: prefix.length, uid: String(reminder.target_user_id), type: 0 }
      : null;
  return { text, mentions: mention ? [mention] : [] };
}

async function getDueMentionReminders(env, now = new Date()) {
  if (!env.DB?.prepare) return [];
  const result = await env.DB.prepare(
    `SELECT * FROM mention_reminders
     WHERE status = 'pending' AND due_at_utc <= ?
     ORDER BY due_at_utc ASC LIMIT 40`
  ).bind(now.toISOString()).all();
  return result.results || [];
}

async function sendDueMentionReminders(env, now = new Date()) {
  const rows = await getDueMentionReminders(env, now);
  const results = [];
  for (const reminder of rows) {
    try {
      await env.DB.prepare(
        `UPDATE mention_reminders SET status = 'sending', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      ).bind(reminder.id).run();

      const connection = await resolveZaloConnection(env, reminder.connection_id || "main");
      if (!connection?.token) throw new Error("Zalo connection is unavailable");
      const notification = buildNotification(reminder);
      await sendZaloMessage(connection, reminder.chat_id, notification.text, notification.mentions);
      await env.DB.prepare(
        `UPDATE mention_reminders
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = '', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(reminder.id).run();
      results.push({ id: reminder.id, ok: true });
    } catch (error) {
      const errorText = String(error?.message || error).slice(0, 500);
      await env.DB.prepare(
        `UPDATE mention_reminders
         SET status = 'pending', last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(errorText, reminder.id).run().catch(() => {});
      console.error("V25 mention reminder send failed:", reminder.id, errorText);
      results.push({ id: reminder.id, ok: false, error: errorText });
    }
  }
  return results;
}

function shouldRunLegacyScheduled(scheduledTime) {
  const date = new Date(scheduledTime || Date.now());
  return date.getUTCMinutes() % 15 === 0;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleMentionReminderCommand(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V25 mention reminder command failed:", error);
    }
    return workerV24.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const now = new Date(event?.scheduledTime || Date.now());
    await sendDueMentionReminders(env, now);
    if (shouldRunLegacyScheduled(event?.scheduledTime) && typeof workerV24.scheduled === "function") {
      return workerV24.scheduled(event, env, ctx);
    }
  }
};

export {
  buildNotification,
  detectTarget,
  extractIndividualTarget,
  extractReminderTitle,
  getCancelPrefix,
  isMentionReminderIntent,
  parseVietnamDueAt,
  sendDueMentionReminders,
  shouldRunLegacyScheduled
};
