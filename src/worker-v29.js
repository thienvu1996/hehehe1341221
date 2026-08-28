import workerV28 from "./worker-v28.js";
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

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value = "") {
  return normalizeText(value).replace(/^@+/, "").replace(/\s+/g, " ").trim();
}

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function isGroupChat(message = {}) {
  const type = normalizeText(message?.chat?.chat_type || "");
  return Boolean(message?.chat?.id) && !type.includes("private");
}

function hasBotAddressing(text = "") {
  return /(^|\s)@bot\b/iu.test(String(text || ""));
}

function isReminderCreateText(message = {}, text = "") {
  if (!isGroupChat(message) || !hasBotAddressing(text)) return false;
  const n = normalizeText(text);
  const hasVerb = /\b(nhac|thong bao|bao|tag|mention|hen gio|len lich|dat lich)\b/.test(n);
  const hasTarget = /@all\b/i.test(text)
    || /\b(tat ca moi nguoi|tat ca|moi nguoi|ca nhom|toan bo nhom)\b/.test(n)
    || extractVisibleTargetName(text) !== "";
  return hasVerb && hasTarget;
}

function reminderVerbEnd(text = "") {
  const n = normalizeText(text);
  const match = n.match(/\b(nhac|thong bao|bao|tag|mention|hen gio|len lich|dat lich)\b/);
  if (!match) return 0;

  const raw = String(text || "");
  const target = match[0];
  let normalizedOffset = match.index || 0;
  let rawOffset = 0;
  let seen = 0;
  for (const ch of raw) {
    if (seen >= normalizedOffset) break;
    const folded = normalizeText(ch);
    seen += folded.length;
    rawOffset += ch.length;
  }
  const tail = raw.slice(rawOffset);
  const rawVerb = tail.match(/(nhắc|nhac|thông\s*báo|thong\s*bao|báo|bao|tag|mention|hẹn\s*giờ|hen\s*gio|lên\s*lịch|len\s*lich|đặt\s*lịch|dat\s*lich)/iu);
  return rawOffset + (rawVerb?.index || 0) + (rawVerb?.[0]?.length || target.length);
}

function extractVisibleTargetName(text = "") {
  const raw = String(text || "");
  const n = normalizeText(raw);
  if (/(^|\s)@all\b/i.test(raw) || /\b(tat ca moi nguoi|tat ca|moi nguoi|ca nhom|toan bo nhom)\b/.test(n)) {
    return "all";
  }

  const start = reminderVerbEnd(raw);
  const segment = raw.slice(start);
  const match = segment.match(
    /@([^@\n,;:]{1,60}?)(?=\s+(?:nay|hôm|hom|mai|lúc|luc|vào|vao|đi|di|gửi|gui|họp|hop|nộp|nop|nhớ|nho|làm|lam|ăn|an|trong|sau|đến|den|tới|toi|ở|o)\b|\s+\d{1,2}(?::\d{2}|\s*h\b)|$)/iu
  );
  const name = String(match?.[1] || "").trim();
  if (!name || /^bot(?:\s|$)/iu.test(name)) return "";
  return name;
}

function mentionContainers(message = {}) {
  return [message.mentions, message.mention, message.entities, message.message_entities].filter(Boolean);
}

function collectMentionObjects(value, output = [], depth = 0) {
  if (!value || depth > 4) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectMentionObjects(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;

  const keys = Object.keys(value);
  if (keys.some((key) => /^(uid|user_id|userId|id|target_id|targetId|mention_id|mentionId|display_name|displayName|name|text|label|pos|position|offset|start|len|length)$/i.test(key))) {
    output.push(value);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectMentionObjects(child, output, depth + 1);
  }
  return output;
}

function numericField(item = {}, names = []) {
  for (const name of names) {
    const value = Number(item?.[name]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return -1;
}

function extractMentionUid(item = {}) {
  const candidates = [
    item.uid,
    item.user_id,
    item.userId,
    item.target_id,
    item.targetId,
    item.mention_id,
    item.mentionId,
    item.user?.id,
    item.user?.user_id,
    item.user?.uid,
    item.member?.id,
    item.member?.user_id,
    item.id
  ];
  return String(candidates.find((value) => value !== undefined && value !== null && String(value).trim()) || "").trim();
}

function extractMentionName(item = {}, text = "") {
  const pos = numericField(item, ["pos", "position", "offset", "start", "start_pos"]);
  const len = numericField(item, ["len", "length", "size"]);
  if (pos >= 0 && len > 0 && pos < String(text).length) {
    const span = String(text).slice(pos, pos + len).replace(/^@+/, "").trim();
    if (span) return span;
  }

  const explicit = item.display_name ?? item.displayName ?? item.name ?? item.text ?? item.label ?? item.title
    ?? item.user?.display_name ?? item.user?.name ?? item.member?.display_name ?? item.member?.name ?? "";
  return String(explicit || "").replace(/^@+/, "").trim();
}

function resolveUidFromCurrentPayload(message = {}, text = "", visibleName = "") {
  const wanted = normalizeName(visibleName);
  if (!wanted) return "";
  const objects = [];
  for (const container of mentionContainers(message)) collectMentionObjects(container, objects);

  for (const item of objects) {
    const name = extractMentionName(item, text);
    if (normalizeName(name) !== wanted) continue;
    const uid = extractMentionUid(item);
    if (uid && uid !== "-1") return uid;
  }
  return "";
}

async function resolveUidFromHistory(env, chatId, visibleName) {
  if (!env.DB?.prepare || !chatId || !visibleName) return "";
  const wanted = normalizeName(visibleName);

  try {
    const rows = (await env.DB.prepare(
      `SELECT user_id, user_name
       FROM messages
       WHERE chat_id = ? AND COALESCE(user_id, '') <> '' AND COALESCE(user_name, '') <> ''
       ORDER BY id DESC LIMIT 500`
    ).bind(String(chatId)).all()).results || [];
    for (const row of rows) {
      if (normalizeName(row.user_name) === wanted) return String(row.user_id || "").trim();
    }
  } catch (error) {
    console.warn("V29 message identity lookup failed:", error?.message || error);
  }

  try {
    const rows = (await env.DB.prepare(
      `SELECT target_user_id, target_display_name
       FROM mention_reminders
       WHERE chat_id = ? AND COALESCE(target_user_id, '') <> ''
       ORDER BY datetime(created_at) DESC LIMIT 200`
    ).bind(String(chatId)).all()).results || [];
    for (const row of rows) {
      if (normalizeName(row.target_display_name) === wanted) return String(row.target_user_id || "").trim();
    }
  } catch (error) {
    console.warn("V29 reminder identity lookup failed:", error?.message || error);
  }

  return "";
}

async function resolveTarget(env, message, text) {
  const visible = extractVisibleTargetName(text);
  if (!visible) return null;
  if (visible === "all") return { mode: "all", uid: "-1", name: "all", identitySource: "all" };

  const chatId = String(message?.chat?.id || "");
  let uid = resolveUidFromCurrentPayload(message, text, visible);
  let identitySource = uid ? "payload" : "";
  if (!uid) {
    uid = await resolveUidFromHistory(env, chatId, visible);
    if (uid) identitySource = "history";
  }

  return { mode: "user", uid, name: visible, identitySource: identitySource || "name_only" };
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

function localPartsFromDate(date) {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
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
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function localToUtc(parts, hour, minute) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 7, minute, 0));
}

function dueResultFromDate(dueAt) {
  const p = localPartsFromDate(dueAt);
  return {
    ok: true,
    dueAt,
    localDate: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    localTime: `${pad2(p.hour)}:${pad2(p.minute)}`,
    displayDate: `${pad2(p.day)}/${pad2(p.month)}/${p.year}`,
    timezone: TIMEZONE
  };
}

function parseRelativeDueAt(text = "", now = new Date()) {
  const n = normalizeText(text);
  let match = n.match(/\b(?:trong|sau)\s+(\d{1,4})\s*(p|phut|m|min|minute|minutes)\s*(?:nua)?\b/);
  if (!match) match = n.match(/\b(\d{1,4})\s*(p|phut|m|min|minute|minutes)\s+nua\b/);
  if (match) {
    const minutes = Number(match[1]);
    if (minutes > 0 && minutes <= 10080) return dueResultFromDate(new Date(now.getTime() + minutes * 60000));
  }

  match = n.match(/\b(?:trong|sau)\s+(\d{1,3})\s*(h|gio|hour|hours)\s*(?:nua)?\b/);
  if (!match) match = n.match(/\b(\d{1,3})\s*(h|gio|hour|hours)\s+nua\b/);
  if (match) {
    const hours = Number(match[1]);
    if (hours > 0 && hours <= 168) return dueResultFromDate(new Date(now.getTime() + hours * 3600000));
  }
  return null;
}

function parseVietnamDueAtV29(text = "", now = new Date()) {
  const relative = parseRelativeDueAt(text, now);
  if (relative) return relative;

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

  return dueResultFromDate(dueAt);
}

function cleanReminderTitle(text = "", target = null) {
  let value = String(text || "");
  const start = reminderVerbEnd(value);
  if (start > 0) value = value.slice(start);

  if (target?.name && target.name !== "all") {
    const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`@${escaped}(?=\\s|$|[,;:])`, "iu"), " ");
  }

  value = value
    .replace(/@all\b/giu, " ")
    .replace(/\b(tất cả mọi người|tat ca moi nguoi|mọi người|moi nguoi|cả nhóm|ca nhom|toàn bộ nhóm|toan bo nhom)\b/giu, " ")
    .replace(/\b(?:trong|sau)\s+\d{1,4}\s*(?:p|phút|phut|m|min|minute|minutes|h|giờ|gio|hour|hours)\s*(?:nữa|nua)?\b/giu, " ")
    .replace(/\b\d{1,4}\s*(?:p|phút|phut|m|min|minute|minutes|h|giờ|gio|hour|hours)\s*(?:nữa|nua)\b/giu, " ")
    .replace(/\b(hôm nay|hom nay|tối nay|toi nay|ngày mai|ngay mai|mai|nay)\b/giu, " ")
    .replace(/\b(lúc|luc|vào|vao|đến giờ|den gio|tới giờ|toi gio)\b/giu, " ")
    .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, " ")
    .replace(/\b([01]?\d|2[0-3])\s*h(?:\s*[0-5]?\d)?\b/gi, " ")
    .replace(/\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-]\d{4})?\b/g, " ")
    .replace(/[,:;\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value || "Sự kiện đã hẹn";
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
      console.warn("V29 native mention rejected; retrying text-only:", error?.message || error);
    }
  }
  return attempt(base);
}

async function saveReminder(env, connection, payload, target, due, title) {
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
      source: "group-mention-v29",
      identity_source: target.identitySource || "",
      original_text: String(payload.text || "").slice(0, 1800),
      target_uid: target.uid || "",
      target_name: target.name || ""
    })
  ).run();
  return id;
}

async function handleReminderCreate(request, env) {
  if (request.method !== "POST" || !env.DB?.prepare) return null;
  const url = new URL(request.url);
  const webhook = parseZaloWebhookPath(url.pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received") return null;
  if (!isReminderCreateText(payload.message, payload.text)) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const chatId = String(payload.message.chat?.id || "");
  const target = await resolveTarget(env, payload.message, payload.text);
  if (!target) {
    await sendZaloMessage(connection, chatId, "Em chưa thấy người cần nhắc. Anh/chị @ đúng người hoặc dùng @all rồi gửi lại giúp em nha.");
    return json({ message: "Success", provider: "group-mention-v29", action: "target_missing" });
  }

  const due = parseVietnamDueAtV29(payload.text, new Date());
  if (!due.ok) {
    if (due.reason === "past_time") {
      await sendZaloMessage(
        connection,
        chatId,
        `${due.localTime} hôm nay qua rồi anh/chị. Em không tự đẩy sang ngày mai để tránh nhắc sai. Chọn một giờ phía trước hôm nay, hoặc ghi rõ ${due.localTime} ngày mai giúp em nha.`
      );
    } else {
      await sendZaloMessage(connection, chatId, "Em chưa đọc được giờ rõ. Có thể ghi kiểu “lúc 14:30”, “14h30 hôm nay” hoặc “trong 5p nữa” nha.");
    }
    return json({ message: "Success", provider: "group-mention-v29", action: due.reason });
  }

  const title = cleanReminderTitle(payload.text, target);
  const id = await saveReminder(env, connection, payload, target, due, title);
  const targetLabel = target.mode === "all" ? "@all" : `@${target.name}`;
  const confirmation = `Đã đặt lịch #${id.slice(0, 8)} ✅\n${due.localTime} ${due.displayDate} → ${targetLabel}\n${title}\n\nXem lịch: @Bot lịch thông báo hôm nay\nHủy: @Bot hủy thông báo ${id.slice(0, 8)}`;
  await sendZaloMessage(connection, chatId, confirmation, buildMentionForText(confirmation, target));

  return json({
    message: "Success",
    provider: "group-mention-v29",
    action: "create",
    id,
    target_mode: target.mode,
    target_user_id: target.uid || "",
    target_name: target.name || "",
    identity_source: target.identitySource || "",
    due_local_time: due.localTime,
    due_local_date: due.localDate
  });
}

async function backfillPendingMentionIds(env) {
  if (!env.DB?.prepare) return 0;
  let updated = 0;
  const rows = (await env.DB.prepare(
    `SELECT id, chat_id, target_display_name
     FROM mention_reminders
     WHERE status = 'pending' AND target_mode = 'user' AND COALESCE(target_user_id, '') = ''
     ORDER BY datetime(created_at) DESC LIMIT 100`
  ).all()).results || [];

  for (const row of rows) {
    const uid = await resolveUidFromHistory(env, row.chat_id, row.target_display_name);
    if (!uid) continue;
    await env.DB.prepare(
      `UPDATE mention_reminders
       SET target_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND COALESCE(target_user_id, '') = ''`
    ).bind(uid, row.id).run();
    updated += 1;
  }
  return updated;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const reminder = await handleReminderCreate(request, env);
      if (reminder) return reminder;
    } catch (error) {
      console.error("V29 reminder create failed:", error);
    }
    return workerV28.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    try {
      await backfillPendingMentionIds(env);
    } catch (error) {
      console.error("V29 mention backfill failed:", error);
    }
    if (typeof workerV28.scheduled === "function") return workerV28.scheduled(event, env, ctx);
  }
};

export {
  cleanReminderTitle,
  extractVisibleTargetName,
  isReminderCreateText,
  parseVietnamDueAtV29,
  resolveUidFromCurrentPayload
};
