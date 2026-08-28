import workerV30 from "./worker-v30.js";
import { buildProviderGroups, getPayload, orderGroupsByRoute } from "./worker-v15.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { markApiKeyResult } from "./config-manager.js";
import { getAiWebRoute } from "./web-routing.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const IMAGE_TIMEOUT_MS = 45000;
const MEDIA_EXPIRE_MS = 24 * 60 * 60 * 1000;

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

function constantTimeEqual(a = "", b = "") {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function isPrivateChat(message) {
  return normalizeText(message?.chat?.chat_type || "").includes("private");
}

function hasMention(message, text = "") {
  if (String(text || "").includes("@")) return true;
  const mentions = message?.mentions || message?.mention || message?.entities || message?.message_entities;
  if (Array.isArray(mentions)) return mentions.length > 0;
  return Boolean(mentions && typeof mentions === "object");
}

function isImageGenerationIntent(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return (
    /\b(tao|gen|generate|ve|sinh)\b.{0,28}\b(anh|hinh|image|photo)\b/.test(normalized) ||
    /\b(anh|hinh|image|photo)\b.{0,28}\b(tao|gen|generate|ve|sinh)\b/.test(normalized) ||
    /\b(grok imagine|imagine image)\b/.test(normalized)
  );
}

function cleanPrompt(text = "") {
  const value = String(text || "")
    .replace(/@\S+(?:\s+\S+){0,4}/gu, " ")
    .replace(/^\s*(?:tạo|tao|gen|generate|vẽ|ve|sinh)\s+(?:ảnh|anh|hình|hinh|image|photo)\s*/iu, "")
    .replace(/^\s*(?:ảnh|anh|hình|hinh|image|photo)\s+(?:tạo|tao|gen|generate|vẽ|ve|sinh)\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  return value || String(text || "").trim() || "một hình ảnh đẹp";
}

function unique(values = []) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function imageModelsFor(group, key) {
  const allowlist = Array.isArray(key?.modelAllowlist) ? key.modelAllowlist : [];
  const configured = [group?.imageModel, group?.chatModel, group?.reasoningModel, group?.searchModel];
  const hinted = unique([...allowlist, ...configured]).filter((model) => /image|imagine/i.test(model) && !/video/i.test(model));
  const identity = `${group?.id || ""} ${group?.label || ""} ${group?.baseUrl || ""}`.toLowerCase();

  if (/x\.ai|grok|nexus/.test(identity)) {
    hinted.push(
      "grok-imagine-image-2.0",
      "grok-imagine-image",
      "nexus/grok-imagine-image-2.0",
      "nexus/grok-imagine-image"
    );
  }

  return unique(hinted);
}

function imageUrlFromData(data = {}) {
  const candidates = [
    data?.data?.[0]?.url,
    data?.images?.[0]?.url,
    data?.output?.[0]?.url,
    data?.result?.url,
    data?.url
  ];
  return String(candidates.find((value) => /^https?:\/\//i.test(String(value || ""))) || "");
}

async function callImageGeneration(candidate, prompt) {
  const response = await fetch(`${String(candidate.baseUrl || "").replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${candidate.apiKey}`
    },
    body: JSON.stringify({
      model: candidate.model,
      prompt,
      n: 1
    }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  const url = imageUrlFromData(data);
  if (!response.ok || !url) {
    const message = data?.error?.message || data?.message || `Image HTTP ${response.status}`;
    const error = new Error(message);
    error.httpStatus = response.status;
    throw error;
  }
  return { url, status: response.status };
}

async function sendMessage(connection, chatId, text) {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text: String(text || "").slice(0, 1900) }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo HTTP ${response.status}`);
}

async function sendPhoto(connection, chatId, photo, caption = "") {
  const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId),
      photo,
      ...(caption ? { caption: String(caption).slice(0, 1900) } : {})
    }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo sendPhoto HTTP ${response.status}`);
}

function queuedReply(originalText) {
  const original = String(originalText || "").trim().slice(0, 500);
  return [
    "↪️ Yêu cầu đang chờ:",
    `“${original}”`,
    "",
    "Anh/chị đợi em chút nha, phần tạo ảnh đang bận. Em đã giữ đúng yêu cầu này trong hàng chờ; khi tạo được em gửi ảnh vào đây luôn, không cần nhắn lại ạ."
  ].join("\n");
}

function completedCaption(originalText) {
  const original = String(originalText || "").trim().slice(0, 500);
  return `↪️ Xong yêu cầu: “${original}”\n🎨 Ảnh đã tạo`;
}

function retryDelayMinutes(attempts = 0) {
  const schedule = [1, 2, 5, 10, 20, 30, 60];
  return schedule[Math.min(Math.max(0, Number(attempts) || 0), schedule.length - 1)];
}

async function getImageCandidates(env, connectionId, policy) {
  const [route, groups] = await Promise.all([
    getAiWebRoute(env, connectionId).catch(() => ({ answer_provider_ids: [] })),
    buildProviderGroups(env, connectionId, policy || {}).catch(() => [])
  ]);
  const ordered = orderGroupsByRoute(groups, route.answer_provider_ids || [], false);
  const candidates = [];

  for (const group of ordered) {
    for (const key of group.keys || []) {
      if (!key?.apiKey) continue;
      for (const model of imageModelsFor(group, key)) {
        candidates.push({
          providerId: group.id,
          baseUrl: group.baseUrl,
          apiKey: key.apiKey,
          keyId: key.id || "",
          managed: Boolean(key.managed),
          model
        });
      }
    }
  }
  return candidates;
}

async function tryGenerateImage(env, connectionId, policy, prompt) {
  const candidates = await getImageCandidates(env, connectionId, policy);
  let lastError = null;
  let lastCandidate = null;

  for (const candidate of candidates) {
    lastCandidate = candidate;
    try {
      const result = await callImageGeneration(candidate, prompt);
      if (candidate.managed && candidate.keyId) {
        await markApiKeyResult(env, candidate.keyId, true).catch(() => {});
      }
      return { ok: true, result, candidate };
    } catch (error) {
      lastError = error;
      if (candidate.managed && candidate.keyId) {
        await markApiKeyResult(env, candidate.keyId, false, String(error?.message || error)).catch(() => {});
      }
    }
  }

  return { ok: false, lastError, lastCandidate };
}

async function enqueueMedia(env, connection, payload, prompt, errorMessage = "") {
  if (!env.DB?.prepare) return "";
  const message = payload.message;
  const id = crypto.randomUUID();
  const messageId = String(message.message_id || `synthetic:${message.chat?.id || ""}:${Date.now()}`);
  await env.DB.prepare(
    `INSERT INTO media_generation_queue
      (id, connection_id, chat_id, chat_type, user_id, user_name, message_id, media_type, prompt,
       status, attempts, next_attempt_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'image', ?, 'pending', 0, datetime('now', '+1 minute'), ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    connection.id || "main",
    String(message.chat?.id || ""),
    String(message.chat?.chat_type || ""),
    String(message.from?.id || ""),
    String(message.from?.display_name || ""),
    messageId,
    String(prompt || "").slice(0, 4000),
    String(errorMessage || "").slice(0, 1000)
  ).run();
  return id;
}

async function handleImageGeneration(request, env) {
  if (request.method !== "POST") return null;
  const webhook = parseZaloWebhookPath(new URL(request.url).pathname);
  if (!webhook) return null;

  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received" || !isImageGenerationIntent(payload.text)) return null;
  if (!(isPrivateChat(payload.message) || hasMention(payload.message, payload.text))) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;

  const policy = await evaluateAiPermission(env, connection.id).catch(() => null);
  if (connection.id !== "main" && (!policy?.allowed || !policy?.allowChat)) return null;

  const prompt = cleanPrompt(payload.text);
  const attempt = await tryGenerateImage(env, connection.id, policy || {}, prompt);
  if (attempt.ok) {
    await sendPhoto(connection, payload.message.chat.id, attempt.result.url, completedCaption(payload.text));
    return json({
      message: "Success",
      feature: "image_generation_v31",
      provider: attempt.candidate.providerId,
      model: attempt.candidate.model
    });
  }

  const queueId = await enqueueMedia(
    env,
    connection,
    payload,
    prompt,
    String(attempt.lastError?.message || attempt.lastError || "image provider unavailable")
  ).catch(() => "");

  await sendMessage(connection, payload.message.chat.id, queuedReply(payload.text));
  return json({ message: "Success", feature: "image_generation_v31", queued: true, queue_id: queueId });
}

async function rescheduleMedia(env, row, errorMessage) {
  const attempts = Number(row.attempts || 0) + 1;
  const delay = retryDelayMinutes(attempts);
  await env.DB.prepare(
    `UPDATE media_generation_queue
     SET status = 'pending', attempts = ?, next_attempt_at = datetime('now', ?), last_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(attempts, `+${delay} minutes`, String(errorMessage || "").slice(0, 1000), row.id).run();
}

async function processMediaQueue(env) {
  if (!env.DB?.prepare) return [];
  const rows = (await env.DB.prepare(
    `SELECT * FROM media_generation_queue
     WHERE status = 'pending' AND datetime(next_attempt_at) <= datetime('now')
     ORDER BY datetime(next_attempt_at) ASC LIMIT 8`
  ).all()).results || [];
  const results = [];

  for (const row of rows) {
    const createdAt = new Date(`${String(row.created_at || "").replace(" ", "T")}Z`).getTime();
    if (Number.isFinite(createdAt) && Date.now() - createdAt > MEDIA_EXPIRE_MS) {
      await env.DB.prepare(
        `UPDATE media_generation_queue SET status = 'expired', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(row.id).run().catch(() => {});
      const connection = await resolveZaloConnection(env, row.connection_id || "main").catch(() => null);
      if (connection?.token) {
        await sendMessage(
          connection,
          row.chat_id,
          `↪️ Yêu cầu: “${String(row.prompt || "").slice(0, 500)}”\n\nEm vẫn chưa tạo được ảnh này. Nếu anh/chị còn cần thì nhắn em lại nha.`
        ).catch(() => {});
      }
      results.push({ id: row.id, status: "expired" });
      continue;
    }

    const claimed = await env.DB.prepare(
      `UPDATE media_generation_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
    ).bind(row.id).run();
    if (!Number(claimed?.meta?.changes || 0)) continue;

    try {
      const connection = await resolveZaloConnection(env, row.connection_id || "main");
      if (!connection?.token) throw new Error("connection unavailable");
      const policy = await evaluateAiPermission(env, connection.id).catch(() => null);
      if (connection.id !== "main" && (!policy?.allowed || !policy?.allowChat)) throw new Error("AI permission unavailable");

      const attempt = await tryGenerateImage(env, connection.id, policy || {}, row.prompt);
      if (!attempt.ok) throw attempt.lastError || new Error("image provider unavailable");

      await sendPhoto(connection, row.chat_id, attempt.result.url, completedCaption(row.prompt));
      await env.DB.prepare(
        `UPDATE media_generation_queue
         SET status = 'done', attempts = attempts + 1, provider_id = ?, model = ?, output_url = ?, last_error = '',
             completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(
        attempt.candidate.providerId,
        attempt.candidate.model,
        attempt.result.url,
        row.id
      ).run();
      results.push({ id: row.id, status: "done" });
    } catch (error) {
      await rescheduleMedia(env, row, String(error?.message || error)).catch(() => {});
      results.push({ id: row.id, status: "pending" });
    }
  }

  return results;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const image = await handleImageGeneration(request, env);
      if (image) return image;
    } catch (error) {
      console.warn("V31 image generation router failed:", error?.message || error);
    }
    return workerV30.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const mediaJob = processMediaQueue(env).catch((error) => {
      console.warn("V31 media queue failed:", error?.message || error);
      return [];
    });
    if (ctx?.waitUntil) ctx.waitUntil(mediaJob);
    else await mediaJob;

    if (typeof workerV30.scheduled === "function") {
      return workerV30.scheduled(event, env, ctx);
    }
  }
};

export {
  cleanPrompt,
  completedCaption,
  isImageGenerationIntent,
  processMediaQueue,
  queuedReply
};
