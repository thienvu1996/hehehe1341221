import workerV26, {
  detectTarget,
  extractReminderTitle,
  isMentionReminderCreateIntent
} from "./worker-v26.js";
import workerV24 from "./worker-v24.js";
import { getPayload } from "./worker-v15.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { shouldRunLegacyScheduled } from "./worker-v25.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const TIMEZONE = "Asia/Ho_Chi_Minh";
const STALE_GRACE_MS = 2 * 60 * 1000;

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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getVietnamParts(now = new Date()) {
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes()
  };
}

function addLocalDays(parts, count) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function localToUtc(parts, hour, minute) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 7, minute, 0));
}

function parseVietnamDueAtStrict(text = "", now = new Date()) {
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

  if (hour === null) return { ok: false, reason: "missing_time" };

  const localNow = getVietnamParts(now);
  let dateParts = { year: localNow.year, month: localNow.month, day: localNow.day };
  let explicitDate = false;

  const dateMatch = normalized.match(/\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-](\d{4}))?\b/);
  if (dateMatch) {
    const year = dateMatch[3] ? Number(dateMatch[3]) : localNow.year;
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[1]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      return { ok: false, reason: "invalid_date" };
    }
    dateParts = { year, month, day };
    explicitDate = true;
  } else if (/\b(ngay mai|mai)\b/.test(normalized)) {
    dateParts = addLocalDays(localNow, 1);
    explicitDate = true;
  } else if (/\b(hom nay|toi nay|nay)\b/.test(normalized)) {
    explicitDate = true;
  }

  let dueAt = localToUtc(dateParts, hour, minute);
  if (!Number.isFinite(dueAt.getTime())) return { ok: false, reason: "invalid_time" };

  if (dueAt.getTime() <= now.getTime()) {
    if (explicitDate) {
      return {
        ok: false,
        reason: "past_time",
        localTime: `${pad2(hour)}:${pad2(minute)}`,
        nowLocalTime: `${pad2(localNow.hour)}:${pad2(localNow.minute)}`
      };
    }
    dateParts = addLocalDays(localNow, 1);
    dueAt = localToUtc(dateParts, hour, minute);
  }

  return {
    ok: true,
    dueAt,
    localDate: `${dateParts.year}-${pad2(dateParts.month)}-${pad2(dateParts.day)}`,
    localTime: `${pad2(hour)}:${pad2(minute)}`,
    displayDate: `${pad2(dateParts.day)}/${pad2(dateParts.month)}/${dateParts.year}`,
    timezone: TIMEZONE
  };
}

function isVisibleTarget(text = "", target = null) {
  if (!target) return false;
  if (target.mode === "all") return /@all\b/i.test(text) || /\b(tất cả|mọi người|cả nhóm|toàn bộ nhóm)\b/iu.test(text);
  if (!target.name) return false;
  return String(text).toLocaleLowerCase("vi").includes(`@${target.name}`.toLocaleLowerCase("vi"));
}

function buildMentionForText(text, target) {
  if (!target) return [];
  const label = target.mode === "all" ? "@all" : `@${target.name || ""}`;
  const pos = String(text).indexOf(label);
  if (pos < 0) return [];
  if (target.mode === "all") return [{ pos, len: label.length, uid: "-1", type: 0 }];
  if (!target.uid) return [];
  return [{ pos, len: label.length, uid: String(target.uid), type: 0 }];
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
      console.warn("V27 mention payload rejected; retrying as text:", error?.message || error);
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
    JSON.stringify({
      source: "group-mention-v27",
      original_text: String(payload.text || "").slice(0, 1800),
      target_uid: target.uid || "",
      target_name: target.name || ""
    })
  ).run();
  return id;
}

async function handleStrictCreate(request, env) {
  if (request.method !== "POST" || !env.DB?.prepare) return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received") return null;
  if (!isMentionReminderCreateIntent(payload.message, payload.text)) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const chatId = String(payload.message.chat?.id || "");
  const target = detectTarget(payload.message, payload.text);
  if (!target || !isVisibleTarget(payload.text, target)) {
    await sendZaloMessage(connection, chatId, "Mình chưa xác định chắc người cần @. Hãy chọn đúng người bằng tính năng @ của Zalo rồi gửi lại.");
    return json({ message: "Success", provider: "group-mention-v27", action: "target_ambiguous" });
  }

  if (target.mode === "user" && !target.uid) {
    await sendZaloMessage(connection, chatId, `Mình thấy @${target.name}, nhưng Zalo chưa gửi user ID của mention này. Hãy @ lại người đó từ danh sách gợi ý để mình tag đúng người khi đến giờ.`);
    return json({ message: "Success", provider: "group-mention-v27", action: "target_missing_uid" });
  }

  const due = parseVietnamDueAtStrict(payload.text, new Date());
  if (!due.ok) {
    if (due.reason === "past_time") {
      await sendZaloMessage(
        connection,
        chatId,
        `Giờ ${due.localTime} hôm nay đã qua rồi (giờ Việt Nam hiện tại khoảng ${due.nowLocalTime}). Bạn chọn giờ phía trước giúp mình, ví dụ: @Bot nhắc @${target.name || "all"} lúc 14:00 hôm nay.`
      );
    } else {
      await sendZaloMessage(connection, chatId, "Mình chưa đọc được giờ/ngày chính xác. Ví dụ: @Bot nhắc @Chị 3 lúc 14:00 hôm nay.");
    }
    return json({ message: "Success", provider: "group-mention-v27", action: due.reason });
  }

  const title = extractReminderTitle(payload.text, target, payload.message);
  const id = await saveMentionReminder(env, connection, payload, target, due, title);
  const targetLabel = target.mode === "all" ? "@all" : `@${target.name}`;
  const confirmation = `Đã đặt lịch #${id.slice(0, 8)} ✅\n${due.localTime} ${due.displayDate} → ${targetLabel}\n${title}\n\nXem lịch: @Bot lịch thông báo hôm nay\nHủy: @Bot hủy thông báo ${id.slice(0, 8)}`;
  await sendZaloMessage(connection, chatId, confirmation, buildMentionForText(confirmation, target));
  return json({
    message: "Success",
    provider: "group-mention-v27",
    action: "create",
    id,
    target_mode: target.mode,
    target_user_id: target.uid || "",
    target_name: target.name || "",
    due_at_utc: due.dueAt.toISOString(),
    due_local_time: due.localTime,
    due_local_date: due.localDate
  });
}

function buildNotification(reminder) {
  const parts = String(reminder.due_local_date || "").split("-");
  const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : reminder.due_local_date || "";
  const target = reminder.target_mode === "all"
    ? { mode: "all", uid: "-1", name: "all" }
    : { mode: "user", uid: String(reminder.target_user_id || ""), name: String(reminder.target_display_name || "bạn") };
  const label = target.mode === "all" ? "@all" : `@${target.name}`;
  const text = `${label} 🔔 Nhắc sự kiện\n🕐 ${reminder.due_local_time || ""} ${displayDate}\n${reminder.title || "Sự kiện đã hẹn"}`;
  return { text, mentions: buildMentionForText(text, target) };
}

async function markStaleAsMissed(env, now) {
  const cutoff = new Date(now.getTime() - STALE_GRACE_MS).toISOString();
  await env.DB.prepare(
    `UPDATE mention_reminders
     SET status = 'missed', last_error = 'Reminder became stale before scheduler could send it', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending' AND due_at_utc < ?`
  ).bind(cutoff).run();
}

async function sendDueMentionRemindersStrict(env, now = new Date()) {
  if (!env.DB?.prepare) return [];
  await markStaleAsMissed(env, now);
  const lower = new Date(now.getTime() - STALE_GRACE_MS).toISOString();
  const upper = now.toISOString();
  const rows = (await env.DB.prepare(
    `SELECT * FROM mention_reminders
     WHERE status = 'pending' AND due_at_utc >= ? AND due_at_utc <= ?
     ORDER BY due_at_utc ASC LIMIT 40`
  ).bind(lower, upper).all()).results || [];

  const results = [];
  for (const reminder of rows) {
    try {
      const claimed = await env.DB.prepare(
        `UPDATE mention_reminders SET status = 'sending', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      ).bind(reminder.id).run();
      if (!claimed?.meta?.changes) continue;

      const connection = await resolveZaloConnection(env, reminder.connection_id || "main");
      if (!connection?.token) throw new Error("Zalo connection unavailable");
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
      results.push({ id: reminder.id, ok: false, error: errorText });
    }
  }
  return results;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleStrictCreate(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V27 strict reminder create failed:", error);
    }
    return workerV26.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const now = new Date(event?.scheduledTime || Date.now());
    await sendDueMentionRemindersStrict(env, now);
    if (shouldRunLegacyScheduled(event?.scheduledTime) && typeof workerV24.scheduled === "function") {
      return workerV24.scheduled(event, env, ctx);
    }
  }
};

export {
  buildNotification,
  buildMentionForText,
  isVisibleTarget,
  parseVietnamDueAtStrict,
  sendDueMentionRemindersStrict
};
