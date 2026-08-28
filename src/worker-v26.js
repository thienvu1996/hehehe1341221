import workerV25, { parseVietnamDueAt } from "./worker-v25.js";
import { getPayload } from "./worker-v15.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

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

function normalizeReminderText(text = "") {
  return normalizeText(text)
    .replace(/\bthong\s+tbaos?\b/g, "thong bao")
    .replace(/\bthong\s+baos\b/g, "thong bao")
    .replace(/\btbaos?\b/g, "thong bao")
    .replace(/\bthongbao\b/g, "thong bao")
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

function getMentionContainers(message) {
  const values = [message?.mentions, message?.mention, message?.entities, message?.message_entities];
  const output = [];
  for (const value of values) {
    if (Array.isArray(value)) output.push(...value);
    else if (value && typeof value === "object") output.push(value);
  }
  return output;
}

function numericField(item, names) {
  for (const name of names) {
    const value = Number(item?.[name]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return -1;
}

function deriveMentionName(item = {}, text = "") {
  const pos = numericField(item, ["pos", "position", "offset", "start", "start_pos"]);
  const len = numericField(item, ["len", "length", "size"]);
  let fromSpan = "";
  if (pos >= 0 && len > 0 && pos < String(text).length) {
    fromSpan = String(text).slice(pos, pos + len).replace(/^@+/, "").trim();
  }

  const explicit = String(
    item.display_name ?? item.displayName ?? item.name ?? item.text ?? item.label ?? item.title ?? ""
  ).replace(/^@+/, "").trim();

  const suspicious = (value) => {
    const normalized = normalizeText(value);
    return !value || value.length > 50 || /\b(nhac|luc|hom nay|mai|thong bao|12:|\d+h)\b/.test(normalized);
  };

  if (fromSpan && !suspicious(fromSpan)) return { name: fromSpan, pos, len, source: "span" };
  if (explicit && !suspicious(explicit)) return { name: explicit, pos, len, source: "field" };
  if (fromSpan) return { name: fromSpan, pos, len, source: "span-suspicious" };
  return { name: explicit, pos, len, source: "field-suspicious" };
}

function normalizeMention(item = {}, text = "") {
  const uid = String(
    item.uid ?? item.user_id ?? item.userId ?? item.id ?? item.target_id ?? item.targetId ?? ""
  ).trim();
  const derived = deriveMentionName(item, text);
  return { uid, ...derived };
}

function isLikelyBotMention(mention) {
  return /^bot(?:\s|$)/i.test(String(mention?.name || "").trim());
}

function structuredMentions(message, text = "") {
  return getMentionContainers(message)
    .map((item) => normalizeMention(item, text))
    .filter((item) => item.uid || item.name);
}

function hasBotAddressing(message, text = "") {
  if (/(^|\s)@bot\b/i.test(String(text || ""))) return true;
  return structuredMentions(message, text).some(isLikelyBotMention);
}

function reminderVerbIndex(text = "") {
  const normalized = normalizeReminderText(text);
  const match = normalized.match(/\b(nhac|thong bao|bao|tag|mention|hen gio|len lich)\b/);
  if (!match) return -1;
  return match.index ?? -1;
}

function scoreMentionCandidate(candidate, text = "") {
  if (!candidate || candidate.uid === "-1" || isLikelyBotMention(candidate)) return -1000;
  let score = 0;
  const raw = String(text || "");
  const exactIndex = candidate.name ? raw.toLowerCase().indexOf(`@${candidate.name}`.toLowerCase()) : -1;
  if (candidate.source === "span") score += 30;
  if (candidate.pos >= 0) score += 15;
  if (exactIndex >= 0) score += 25;
  const verbIndex = reminderVerbIndex(text);
  const visibleIndex = candidate.pos >= 0 ? candidate.pos : exactIndex;
  if (verbIndex >= 0 && visibleIndex > verbIndex) score += 20;
  if (candidate.name && candidate.name.length <= 30) score += 5;
  if (/\b(nhac|luc|hom nay|mai|thong bao)\b/.test(normalizeText(candidate.name))) score -= 40;
  return score;
}

function extractRawTargetName(text = "") {
  const raw = String(text || "");
  const normalized = normalizeReminderText(raw);
  const verbMatch = normalized.match(/\b(nhac|thong bao|bao|tag|mention|hen gio|len lich)\b/);
  const start = verbMatch ? (verbMatch.index ?? 0) + verbMatch[0].length : 0;
  const segment = raw.slice(start);
  const match = segment.match(/@([^@\n,;:]{1,50}?)(?=\s+(?:nay|hôm|hom|mai|lúc|luc|vào|vao|đi|di|gửi|gui|họp|hop|nộp|nop|nhớ|nho|đến|den|tới|toi|làm|lam|ăn|an)\b|$)/iu);
  const name = String(match?.[1] || "").trim();
  if (!name || /^bot(?:\s|$)/i.test(name) || name.length > 40) return "";
  return name;
}

function extractIndividualTarget(message, text = "") {
  const candidates = structuredMentions(message, text).filter((item) => item.uid !== "-1" && !isLikelyBotMention(item));
  const ranked = candidates
    .map((item) => ({ item, score: scoreMentionCandidate(item, text) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score >= 20) {
    return { uid: ranked[0].item.uid, name: ranked[0].item.name };
  }

  const rawName = extractRawTargetName(text);
  if (rawName) {
    const matching = candidates.find((item) => normalizeText(item.name) === normalizeText(rawName));
    return { uid: matching?.uid || "", name: rawName };
  }

  if (ranked[0]?.item?.name && ranked[0].score >= 0) {
    return { uid: ranked[0].item.uid, name: ranked[0].item.name };
  }
  return null;
}

function detectTarget(message, text = "") {
  const normalized = normalizeReminderText(text);
  if (
    /(^|\s)@all\b/.test(normalized) ||
    /\b(tat ca moi nguoi|tat ca|moi nguoi|ca nhom|toan bo nhom|all members)\b/.test(normalized)
  ) {
    return { mode: "all", uid: "-1", name: "all" };
  }
  const user = extractIndividualTarget(message, text);
  return user ? { mode: "user", uid: user.uid, name: user.name || "bạn" } : null;
}

function removeExactMention(text, name) {
  if (!name) return String(text || "");
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text || "").replace(new RegExp(`@${escaped}(?=\\s|$|[,;:])`, "igu"), " ");
}

function extractReminderTitle(text = "", target = null, message = null) {
  let value = String(text || "");

  for (const mention of structuredMentions(message || {}, text)) {
    if (isLikelyBotMention(mention)) value = removeExactMention(value, mention.name);
  }

  value = value.replace(/^\s*@Bot\b[\s\S]*?\b(?:nhắc|nhac|thông\s*báo|thong\s*bao|báo|bao|tag|mention|hẹn\s*giờ|hen\s*gio|lên\s*lịch|len\s*lich)\b/iu, " ");
  value = removeExactMention(value, target?.name);

  value = value
    .replace(/@all\b/giu, " ")
    .replace(/\b(tất cả mọi người|tat ca moi nguoi|mọi người|moi nguoi|cả nhóm|ca nhom|toàn bộ nhóm|toan bo nhom)\b/giu, " ")
    .replace(/^\s*@[^\n,:;]{1,50}?(?=\s+(?:nay|hôm|hom|mai|lúc|luc|vào|vao|đi|di|gửi|gui|họp|hop|nộp|nop|nhớ|nho|làm|lam)\b)/iu, " ")
    .replace(/\b(nhắc|nhac|thông báo|thong bao|thong tbao|tbaos?|báo|bao|tag|mention|đến giờ|den gio|tới giờ|toi gio|lúc|luc|vào|vao)\b/giu, " ")
    .replace(/\b(hôm nay|hom nay|tối nay|toi nay|ngày mai|ngay mai|mai|nay)\b/giu, " ")
    .replace(/\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-]\d{4})?\b/g, " ")
    .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, " ")
    .replace(/\b([01]?\d|2[0-3])\s*h(?:\s*[0-5]?\d)?\b/gi, " ")
    .replace(/[,:;\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value || "Sự kiện đã hẹn";
}

function isMentionReminderCreateIntent(message, text = "") {
  if (!isGroupChat(message) || !hasBotAddressing(message, text)) return false;
  const normalized = normalizeReminderText(text);
  const target = detectTarget(message, text);
  if (!target) return false;
  return /\b(nhac|thong bao|bao|tag|mention|hen gio|len lich|den gio|toi gio)\b/.test(normalized);
}

function isMentionReminderListIntent(message, text = "") {
  if (!isGroupChat(message) || !hasBotAddressing(message, text)) return false;
  const normalized = normalizeReminderText(text);
  const hasListShape = /\b(?:xem\s+)?lich\s+(?:tag|mention|thong bao)\b/.test(normalized)
    || /\bdanh sach\s+(?:tag|mention|thong bao)\b/.test(normalized);
  const hasCreateWords = /\b(nhac|hen gio|len lich|dat lich)\b/.test(normalized);
  return hasListShape && !hasCreateWords;
}

function getCancelPrefix(text = "") {
  const normalized = normalizeReminderText(text);
  const match = normalized.match(/\b(?:huy tag|huy mention|huy thong bao)\s+#?([a-z0-9-]{4,36})\b/);
  return match ? match[1] : "";
}

function getVietnamDateKey(offsetDays = 0, now = new Date()) {
  const local = new Date(now.getTime() + VN_OFFSET_MS + offsetDays * 86400000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function getListDateFilter(text = "", now = new Date()) {
  const normalized = normalizeReminderText(text);
  if (/\b(ngay mai|mai)\b/.test(normalized)) return getVietnamDateKey(1, now);
  if (/\b(hom nay|toi nay|nay)\b/.test(normalized)) return getVietnamDateKey(0, now);
  return "";
}

async function sendZaloMessage(connection, chatId, text) {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text: String(text || "").slice(0, 1900) }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo HTTP ${response.status}`);
  return data;
}

async function listMentionReminders(env, connectionId, chatId, dueDate = "") {
  const sql = dueDate
    ? `SELECT id, target_mode, target_display_name, title, due_local_date, due_local_time
       FROM mention_reminders
       WHERE connection_id = ? AND chat_id = ? AND status = 'pending' AND due_local_date = ?
       ORDER BY due_at_utc ASC LIMIT 30`
    : `SELECT id, target_mode, target_display_name, title, due_local_date, due_local_time
       FROM mention_reminders
       WHERE connection_id = ? AND chat_id = ? AND status = 'pending'
       ORDER BY due_at_utc ASC LIMIT 30`;
  const stmt = dueDate
    ? env.DB.prepare(sql).bind(connectionId, chatId, dueDate)
    : env.DB.prepare(sql).bind(connectionId, chatId);
  return (await stmt.all()).results || [];
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
    JSON.stringify({ source: "group-mention-v26", original_text: payload.text.slice(0, 1800) })
  ).run();
  return id;
}

function formatPendingRows(rows, dueDate = "") {
  if (!rows.length) return dueDate
    ? "Không có lịch @ thông báo nào đang chờ trong ngày này."
    : "Nhóm này chưa có lịch @ thông báo nào đang chờ.";
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
  const cancelPrefix = hasBotAddressing(payload.message, payload.text) ? getCancelPrefix(payload.text) : "";
  const isCreate = isMentionReminderCreateIntent(payload.message, payload.text);
  if (!isList && !cancelPrefix && !isCreate) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const chatId = String(payload.message.chat.id);

  if (isList) {
    const dueDate = getListDateFilter(payload.text);
    const rows = await listMentionReminders(env, connection.id || "main", chatId, dueDate);
    await sendZaloMessage(connection, chatId, formatPendingRows(rows, dueDate));
    return json({ message: "Success", provider: "group-mention-v26", action: "list", due_date: dueDate || null });
  }

  if (cancelPrefix) {
    const ok = await cancelMentionReminder(env, connection.id || "main", chatId, cancelPrefix);
    await sendZaloMessage(connection, chatId, ok ? `Đã hủy lịch #${cancelPrefix}.` : `Không tìm thấy lịch #${cancelPrefix} đang chờ.`);
    return json({ message: "Success", provider: "group-mention-v26", action: "cancel", ok });
  }

  const target = detectTarget(payload.message, payload.text);
  const due = parseVietnamDueAt(payload.text);
  if (!target) return null;
  if (!due) {
    await sendZaloMessage(connection, chatId, "Mình đã hiểu người cần @ nhưng chưa thấy giờ rõ. Ví dụ: @Bot nhắc @Chị 3 đi ăn lúc 12:10, hoặc @Bot 18h hôm nay nhắc @all họp team.");
    return json({ message: "Success", provider: "group-mention-v26", action: "ask_time" });
  }

  const title = extractReminderTitle(payload.text, target, payload.message);
  const id = await saveMentionReminder(env, connection, payload, target, due, title);
  const targetLabel = target.mode === "all" ? "@all" : `@${target.name || "cá nhân"}`;
  await sendZaloMessage(
    connection,
    chatId,
    `Đã đặt lịch #${id.slice(0, 8)} ✅\n${due.localTime} ${due.displayDate} → ${targetLabel}\n${title}\n\nXem lịch: @Bot lịch thông báo hôm nay\nHủy: @Bot hủy thông báo ${id.slice(0, 8)}`
  );
  return json({ message: "Success", provider: "group-mention-v26", action: "create", id, target: targetLabel, title });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await handleMentionReminderCommand(request, env);
      if (response) return response;
    } catch (error) {
      console.error("V26 mention reminder command failed:", error);
    }
    return workerV25.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV25.scheduled === "function") return workerV25.scheduled(event, env, ctx);
  }
};

export {
  detectTarget,
  extractIndividualTarget,
  extractReminderTitle,
  getListDateFilter,
  getCancelPrefix,
  isMentionReminderCreateIntent,
  isMentionReminderListIntent,
  normalizeReminderText
};
