import workerV31 from "./worker-v31.js";
import { buildProviderGroups, getPayload, orderGroupsByRoute } from "./worker-v15.js";
import { evaluateAiPermission } from "./ai-permissions.js";
import { markApiKeyResult } from "./config-manager.js";
import { getAiWebRoute } from "./web-routing.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { resolveZaloConnection } from "./worker-v8.js";
import { verifyDashboardSessionToken } from "./worker-v3.js";

const ZALO_API_BASE_URL = "https://bot-api.zaloplatforms.com";
const MEDIA_TIMEOUT_MS = 55000;
const ADMIN_PREFIXES = ["/admin/characters", "/admin/media-generate", "/admin/media-generations"];

function json(data, status = 200, request = null) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request) {
    headers["Access-Control-Allow-Origin"] = request.headers.get("Origin") || "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Dashboard-Token";
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(data), { status, headers });
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

function isAdminPath(pathname) {
  return ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function requireDashboardSession(request, env) {
  const token = request.headers.get("x-dashboard-token") || "";
  if (!token.startsWith("v1.") || !(await verifyDashboardSessionToken(env, token))) {
    return json({ ok: false, message: "Session expired" }, 403, request);
  }
  return null;
}

function cleanId(value = "") {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function boolInt(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  return value === true || Number(value) === 1 || String(value).toLowerCase() === "true" ? 1 : 0;
}

async function listCharacters(env, connectionId = "main") {
  const profiles = (await env.DB.prepare(
    `SELECT * FROM character_profiles WHERE connection_id = ? ORDER BY is_default DESC, is_active DESC, datetime(updated_at) DESC`
  ).bind(connectionId).all()).results || [];
  const images = (await env.DB.prepare(
    `SELECT * FROM character_reference_images WHERE connection_id = ? ORDER BY character_id, sort_order, datetime(created_at)`
  ).bind(connectionId).all()).results || [];
  const byCharacter = new Map();
  for (const image of images) {
    const rows = byCharacter.get(image.character_id) || [];
    rows.push(image);
    byCharacter.set(image.character_id, rows);
  }
  return profiles.map((row) => ({ ...row, images: byCharacter.get(row.id) || [] }));
}

async function getCharacter(env, characterId, connectionId = "") {
  let stmt = env.DB.prepare(`SELECT * FROM character_profiles WHERE id = ?`);
  if (connectionId) stmt = env.DB.prepare(`SELECT * FROM character_profiles WHERE id = ? AND connection_id = ?`).bind(characterId, connectionId);
  else stmt = stmt.bind(characterId);
  const profile = await stmt.first();
  if (!profile) return null;
  const images = (await env.DB.prepare(
    `SELECT * FROM character_reference_images WHERE character_id = ? ORDER BY sort_order, datetime(created_at)`
  ).bind(characterId).all()).results || [];
  return { ...profile, images };
}

async function getDefaultCharacter(env, connectionId) {
  const row = await env.DB.prepare(
    `SELECT id FROM character_profiles WHERE connection_id = ? AND is_active = 1 ORDER BY is_default DESC, datetime(updated_at) DESC LIMIT 1`
  ).bind(connectionId).first();
  return row?.id ? getCharacter(env, row.id, connectionId) : null;
}

async function saveCharacter(env, payload = {}) {
  const id = cleanId(payload.id) || `char_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const connectionId = cleanId(payload.connection_id) || "main";
  const exists = await env.DB.prepare(`SELECT id FROM character_profiles WHERE id = ?`).bind(id).first();
  if (boolInt(payload.is_default)) {
    await env.DB.prepare(`UPDATE character_profiles SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE connection_id = ?`).bind(connectionId).run();
  }
  if (exists) {
    await env.DB.prepare(
      `UPDATE character_profiles SET
        connection_id = ?, name = ?, description = ?, gender = ?, age_range = ?, style_tags = ?,
        base_prompt = ?, negative_prompt = ?, seed = ?, source_model = ?, is_default = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      connectionId,
      String(payload.name || "Nhân vật").slice(0, 120),
      String(payload.description || "").slice(0, 1500),
      String(payload.gender || "").slice(0, 80),
      String(payload.age_range || "").slice(0, 80),
      String(payload.style_tags || "").slice(0, 500),
      String(payload.base_prompt || "").slice(0, 3000),
      String(payload.negative_prompt || "").slice(0, 2000),
      String(payload.seed || "").slice(0, 120),
      String(payload.source_model || "").slice(0, 160),
      boolInt(payload.is_default),
      boolInt(payload.is_active, 1),
      id
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO character_profiles
        (id, connection_id, name, description, gender, age_range, style_tags, base_prompt, negative_prompt, seed, source_model, is_default, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      id,
      connectionId,
      String(payload.name || "Nhân vật").slice(0, 120),
      String(payload.description || "").slice(0, 1500),
      String(payload.gender || "").slice(0, 80),
      String(payload.age_range || "").slice(0, 80),
      String(payload.style_tags || "").slice(0, 500),
      String(payload.base_prompt || "").slice(0, 3000),
      String(payload.negative_prompt || "").slice(0, 2000),
      String(payload.seed || "").slice(0, 120),
      String(payload.source_model || "").slice(0, 160),
      boolInt(payload.is_default),
      boolInt(payload.is_active, 1)
    ).run();
  }
  return getCharacter(env, id, connectionId);
}

async function addReferenceImage(env, character, payload = {}) {
  const id = cleanId(payload.id) || `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const url = String(payload.file_url || payload.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Ảnh mẫu cần URL http/https hợp lệ");
  if (boolInt(payload.is_cover)) {
    await env.DB.prepare(`UPDATE character_reference_images SET is_cover = 0, updated_at = CURRENT_TIMESTAMP WHERE character_id = ?`).bind(character.id).run();
  }
  await env.DB.prepare(
    `INSERT INTO character_reference_images
      (id, character_id, connection_id, angle_type, title, tags, file_key, file_url, mime_type, width, height, sort_order,
       is_cover, is_image_seed, is_video_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    character.id,
    character.connection_id,
    String(payload.angle_type || "other").slice(0, 60),
    String(payload.title || "").slice(0, 160),
    String(payload.tags || "").slice(0, 500),
    url,
    String(payload.mime_type || "image/jpeg").slice(0, 80),
    Number(payload.width || 0),
    Number(payload.height || 0),
    Number(payload.sort_order || 0),
    boolInt(payload.is_cover),
    boolInt(payload.is_image_seed, 1),
    boolInt(payload.is_video_seed, 1)
  ).run();
  return env.DB.prepare(`SELECT * FROM character_reference_images WHERE id = ?`).bind(id).first();
}

async function uploadReferenceImage(request, env, character) {
  if (!env.MEDIA_BUCKET?.put) throw new Error("Chưa cấu hình R2 binding MEDIA_BUCKET. Có thể dán URL ảnh trước, hoặc thêm R2 rồi upload file.");
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Thiếu file ảnh");
  const maxBytes = 12 * 1024 * 1024;
  if (Number(file.size || 0) > maxBytes) throw new Error("Ảnh tối đa 12MB");
  const imageId = `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const ext = String(file.name || "image.jpg").split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  const key = `characters/${character.connection_id}/${character.id}/${imageId}.${ext}`;
  await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "image/jpeg" } });
  const angle = String(form.get("angle_type") || "other");
  const title = String(form.get("title") || file.name || "");
  const isCover = boolInt(form.get("is_cover"));
  if (isCover) await env.DB.prepare(`UPDATE character_reference_images SET is_cover = 0 WHERE character_id = ?`).bind(character.id).run();
  const fileUrl = `https://bot.jean1331.io.vn/media/reference/${encodeURIComponent(imageId)}`;
  await env.DB.prepare(
    `INSERT INTO character_reference_images
      (id, character_id, connection_id, angle_type, title, tags, file_key, file_url, mime_type, sort_order,
       is_cover, is_image_seed, is_video_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    imageId, character.id, character.connection_id, angle.slice(0, 60), title.slice(0, 160), key, fileUrl,
    String(file.type || "image/jpeg").slice(0, 80), Number(form.get("sort_order") || 0), isCover
  ).run();
  return env.DB.prepare(`SELECT * FROM character_reference_images WHERE id = ?`).bind(imageId).first();
}

async function serveReferenceImage(request, env) {
  const match = new URL(request.url).pathname.match(/^\/media\/reference\/([^/]+)$/);
  if (!match || request.method !== "GET") return null;
  const imageId = decodeURIComponent(match[1]);
  const row = await env.DB.prepare(`SELECT file_key, file_url, mime_type FROM character_reference_images WHERE id = ?`).bind(imageId).first();
  if (!row) return new Response("Not Found", { status: 404 });
  if (!row.file_key) return Response.redirect(row.file_url, 302);
  if (!env.MEDIA_BUCKET?.get) return new Response("R2 unavailable", { status: 503 });
  const object = await env.MEDIA_BUCKET.get(row.file_key);
  if (!object) return new Response("Not Found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("Cache-Control", "public, max-age=86400");
  if (!headers.has("Content-Type")) headers.set("Content-Type", row.mime_type || "image/jpeg");
  return new Response(object.body, { headers });
}

function imageRefs(character, type = "image") {
  const flag = type === "video" ? "is_video_seed" : "is_image_seed";
  return (character?.images || []).filter((row) => Number(row?.[flag] ?? 1) === 1 && /^https?:\/\//i.test(String(row.file_url || "")));
}

function unique(values = []) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function modelsFor(group, key, type) {
  const allowlist = Array.isArray(key?.modelAllowlist) ? key.modelAllowlist : [];
  const configured = [group?.imageModel, group?.videoModel, group?.chatModel, group?.reasoningModel, group?.searchModel];
  const pattern = type === "video" ? /video|imagine-video/i : /image|imagine(?!-video)/i;
  const values = unique([...allowlist, ...configured]).filter((model) => pattern.test(model));
  const identity = `${group?.id || ""} ${group?.label || ""} ${group?.baseUrl || ""}`.toLowerCase();
  if (/grok|nexus|x\.ai/.test(identity)) {
    if (type === "video") values.push("nexus/grok-imagine-video-1.5", "nexus/grok-imagine-video", "grok-imagine-video-1.5", "grok-imagine-video");
    else values.push("grok-imagine-image-2.0", "grok-imagine-image", "nexus/grok-imagine-image-2.0", "nexus/grok-imagine-image");
  }
  return unique(values);
}

async function mediaCandidates(env, connectionId, policy, type) {
  const [route, groups] = await Promise.all([
    getAiWebRoute(env, connectionId).catch(() => ({ answer_provider_ids: [] })),
    buildProviderGroups(env, connectionId, policy || {}).catch(() => [])
  ]);
  const ordered = orderGroupsByRoute(groups, route.answer_provider_ids || [], false);
  const out = [];
  for (const group of ordered) {
    if (group.type === "gemini") continue;
    for (const key of group.keys || []) {
      if (!key?.apiKey) continue;
      for (const model of modelsFor(group, key, type)) {
        out.push({
          providerId: group.id,
          baseUrl: String(group.baseUrl || "").replace(/\/$/, ""),
          apiKey: key.apiKey,
          keyId: key.id || "",
          managed: Boolean(key.managed),
          model
        });
      }
    }
  }
  return out;
}

function outputFromPayload(data = {}) {
  const url = [
    data?.data?.[0]?.url,
    data?.images?.[0]?.url,
    data?.videos?.[0]?.url,
    data?.output?.[0]?.url,
    data?.result?.url,
    data?.url
  ].find((value) => /^https?:\/\//i.test(String(value || "")));
  const jobId = data?.id || data?.job_id || data?.task_id || data?.request_id || "";
  return { url: String(url || ""), jobId: String(jobId || "") };
}

async function callMedia(candidate, type, prompt, refs = []) {
  const paths = type === "video" ? ["/videos/generations", "/video/generations"] : ["/images/generations"];
  let lastError = null;
  for (const path of paths) {
    try {
      const urls = refs.map((row) => row.file_url).filter(Boolean);
      const body = {
        model: candidate.model,
        prompt,
        n: 1,
        ...(urls.length ? { reference_images: urls, image_urls: urls, image_url: urls[0] } : {})
      };
      const response = await fetch(`${candidate.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${candidate.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS)
      });
      const data = await response.json().catch(() => ({}));
      const output = outputFromPayload(data);
      if (!response.ok || (!output.url && !output.jobId)) {
        throw new Error(data?.error?.message || data?.message || `${type} HTTP ${response.status}`);
      }
      return { ...output, status: response.status, raw: data };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`${type} provider unavailable`);
}

async function generateMedia(env, connectionId, character, type, prompt) {
  const policy = await evaluateAiPermission(env, connectionId).catch(() => null);
  if (connectionId !== "main" && (!policy?.allowed || !policy?.allowChat)) throw new Error("Bot chưa được cấp quyền AI");
  const refs = imageRefs(character, type).slice(0, 12);
  const fullPrompt = [
    character?.base_prompt ? `Giữ đúng nhận diện nhân vật: ${character.base_prompt}` : "",
    character?.description ? `Mô tả nhân vật: ${character.description}` : "",
    character?.style_tags ? `Phong cách: ${character.style_tags}` : "",
    prompt
  ].filter(Boolean).join("\n");
  const candidates = await mediaCandidates(env, connectionId, policy || {}, type);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const result = await callMedia(candidate, type, fullPrompt, refs);
      if (candidate.managed && candidate.keyId) await markApiKeyResult(env, candidate.keyId, true).catch(() => {});
      return { ok: true, result, candidate, refs };
    } catch (error) {
      lastError = error;
      if (candidate.managed && candidate.keyId) await markApiKeyResult(env, candidate.keyId, false, String(error?.message || error)).catch(() => {});
    }
  }
  return { ok: false, lastError, refs };
}

async function logGeneration(env, { connectionId, characterId, type, prompt, refs, attempt }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO media_generations
      (id, connection_id, character_id, media_type, provider_id, model, prompt, reference_image_ids,
       output_url, provider_job_id, status, error_message, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    connectionId,
    characterId || "",
    type,
    attempt?.candidate?.providerId || "",
    attempt?.candidate?.model || "",
    String(prompt || "").slice(0, 4000),
    JSON.stringify((refs || []).map((row) => row.id)),
    attempt?.result?.url || "",
    attempt?.result?.jobId || "",
    attempt?.ok ? (attempt?.result?.url ? "done" : "submitted") : "error",
    attempt?.ok ? "" : String(attempt?.lastError?.message || attempt?.lastError || "").slice(0, 1000)
  ).run();
  return id;
}

async function handleAdmin(request, env) {
  const url = new URL(request.url);
  if (!isAdminPath(url.pathname)) return null;
  if (request.method === "OPTIONS") return json({ ok: true }, 200, request);
  const denied = await requireDashboardSession(request, env);
  if (denied) return denied;

  try {
    const connectionId = cleanId(url.searchParams.get("connection_id") || "main") || "main";
    if (request.method === "GET" && url.pathname === "/admin/characters") {
      return json({ ok: true, connection_id: connectionId, characters: await listCharacters(env, connectionId), r2_ready: Boolean(env.MEDIA_BUCKET?.put) }, 200, request);
    }
    if (request.method === "POST" && url.pathname === "/admin/characters") {
      const body = await request.json();
      return json({ ok: true, character: await saveCharacter(env, { ...body, connection_id: body.connection_id || connectionId }) }, 200, request);
    }
    const charMatch = url.pathname.match(/^\/admin\/characters\/([^/]+)$/);
    if (charMatch && request.method === "PATCH") {
      const body = await request.json();
      const current = await getCharacter(env, cleanId(charMatch[1]), connectionId);
      if (!current) return json({ ok: false, message: "Không tìm thấy nhân vật" }, 404, request);
      return json({ ok: true, character: await saveCharacter(env, { ...current, ...body, id: current.id, connection_id: current.connection_id }) }, 200, request);
    }
    if (charMatch && request.method === "DELETE") {
      const characterId = cleanId(charMatch[1]);
      const current = await getCharacter(env, characterId, connectionId);
      if (!current) return json({ ok: false, message: "Không tìm thấy nhân vật" }, 404, request);
      if (env.MEDIA_BUCKET?.delete) {
        for (const image of current.images || []) if (image.file_key) await env.MEDIA_BUCKET.delete(image.file_key).catch(() => {});
      }
      await env.DB.prepare(`DELETE FROM character_profiles WHERE id = ? AND connection_id = ?`).bind(characterId, connectionId).run();
      return json({ ok: true }, 200, request);
    }
    const imageListMatch = url.pathname.match(/^\/admin\/characters\/([^/]+)\/images$/);
    if (imageListMatch && request.method === "POST") {
      const character = await getCharacter(env, cleanId(imageListMatch[1]), connectionId);
      if (!character) return json({ ok: false, message: "Không tìm thấy nhân vật" }, 404, request);
      const contentType = request.headers.get("content-type") || "";
      const image = contentType.includes("multipart/form-data")
        ? await uploadReferenceImage(request, env, character)
        : await addReferenceImage(env, character, await request.json());
      return json({ ok: true, image }, 200, request);
    }
    const imageMatch = url.pathname.match(/^\/admin\/characters\/([^/]+)\/images\/([^/]+)$/);
    if (imageMatch && request.method === "DELETE") {
      const character = await getCharacter(env, cleanId(imageMatch[1]), connectionId);
      if (!character) return json({ ok: false, message: "Không tìm thấy nhân vật" }, 404, request);
      const imageId = cleanId(imageMatch[2]);
      const row = await env.DB.prepare(`SELECT * FROM character_reference_images WHERE id = ? AND character_id = ?`).bind(imageId, character.id).first();
      if (row?.file_key && env.MEDIA_BUCKET?.delete) await env.MEDIA_BUCKET.delete(row.file_key).catch(() => {});
      await env.DB.prepare(`DELETE FROM character_reference_images WHERE id = ? AND character_id = ?`).bind(imageId, character.id).run();
      return json({ ok: true }, 200, request);
    }
    if (request.method === "POST" && url.pathname === "/admin/media-generate") {
      const body = await request.json();
      const type = body.type === "video" ? "video" : "image";
      const cid = cleanId(body.connection_id || connectionId) || "main";
      const character = body.character_id ? await getCharacter(env, cleanId(body.character_id), cid) : await getDefaultCharacter(env, cid);
      if (!character) return json({ ok: false, message: "Chưa có nhân vật mẫu cho bot này" }, 400, request);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return json({ ok: false, message: "Thiếu prompt" }, 400, request);
      const attempt = await generateMedia(env, cid, character, type, prompt);
      const generationId = await logGeneration(env, { connectionId: cid, characterId: character.id, type, prompt, refs: attempt.refs, attempt });
      if (!attempt.ok) return json({ ok: false, generation_id: generationId, message: String(attempt.lastError?.message || "Không gọi được model media") }, 502, request);
      return json({ ok: true, generation_id: generationId, type, provider: attempt.candidate.providerId, model: attempt.candidate.model, output_url: attempt.result.url, provider_job_id: attempt.result.jobId, reference_count: attempt.refs.length }, 200, request);
    }
    if (request.method === "GET" && url.pathname === "/admin/media-generations") {
      const rows = (await env.DB.prepare(`SELECT * FROM media_generations WHERE connection_id = ? ORDER BY datetime(created_at) DESC LIMIT 60`).bind(connectionId).all()).results || [];
      return json({ ok: true, generations: rows }, 200, request);
    }
  } catch (error) {
    return json({ ok: false, message: String(error?.message || error) }, 500, request);
  }
  return json({ ok: false, message: "Not Found" }, 404, request);
}

function isPrivateChat(message) {
  return normalizeText(message?.chat?.chat_type || "").includes("private");
}

function hasMention(message, text = "") {
  if (String(text || "").includes("@")) return true;
  const mentions = message?.mentions || message?.mention || message?.entities || message?.message_entities;
  return Array.isArray(mentions) ? mentions.length > 0 : Boolean(mentions && typeof mentions === "object");
}

function mediaIntent(text = "") {
  const normalized = normalizeText(text);
  if (/\b(tao|gen|generate|lam)\b.{0,28}\b(video|clip)\b|\b(video|clip)\b.{0,28}\b(tao|gen|generate|lam)\b/.test(normalized)) return "video";
  if (/\b(tao|gen|generate|ve|sinh)\b.{0,28}\b(anh|hinh|image|photo)\b|\b(anh|hinh|image|photo)\b.{0,28}\b(tao|gen|generate|ve|sinh)\b/.test(normalized)) return "image";
  return "";
}

function cleanMediaPrompt(text = "", type = "image") {
  const kind = type === "video" ? "(?:video|clip)" : "(?:ảnh|anh|hình|hinh|image|photo)";
  return String(text || "")
    .replace(/@\S+(?:\s+\S+){0,4}/gu, " ")
    .replace(new RegExp(`^\\s*(?:tạo|tao|gen|generate|làm|lam|vẽ|ve|sinh)\\s+${kind}\\s*`, "iu"), "")
    .replace(/\s+/g, " ")
    .trim() || (type === "video" ? "chuyển động tự nhiên" : "một hình ảnh đẹp");
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
    body: JSON.stringify({ chat_id: String(chatId), photo, ...(caption ? { caption: String(caption).slice(0, 1900) } : {}) }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data?.message || `Zalo sendPhoto HTTP ${response.status}`);
}

async function sendVideoOrLink(connection, chatId, videoUrl, caption = "") {
  try {
    const response = await fetch(`${ZALO_API_BASE_URL}/bot${connection.token}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), video: videoUrl, ...(caption ? { caption: String(caption).slice(0, 1500) } : {}) }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok !== false) return;
  } catch {}
  await sendMessage(connection, chatId, `${caption}\n${videoUrl}`.trim());
}

async function handleBotCharacterMedia(request, env) {
  if (request.method !== "POST") return null;
  const webhook = parseZaloWebhookPath(new URL(request.url).pathname);
  if (!webhook) return null;
  const body = await request.clone().json().catch(() => null);
  const payload = getPayload(body);
  if (!payload || payload.eventName !== "message.text.received") return null;
  const type = mediaIntent(payload.text);
  if (!type || !(isPrivateChat(payload.message) || hasMention(payload.message, payload.text))) return null;

  const connection = await resolveZaloConnection(env, webhook.connectionId).catch(() => null);
  if (!connection?.token || !connection?.webhookSecret) return null;
  const secret = request.headers.get("x-bot-api-secret-token") || "";
  if (!constantTimeEqual(secret, connection.webhookSecret)) return null;
  const character = await getDefaultCharacter(env, connection.id).catch(() => null);
  if (!character) return type === "image" ? null : json({ message: "Success", skipped: true });

  const prompt = cleanMediaPrompt(payload.text, type);
  const attempt = await generateMedia(env, connection.id, character, type, prompt);
  await logGeneration(env, { connectionId: connection.id, characterId: character.id, type, prompt, refs: attempt.refs, attempt }).catch(() => {});
  if (!attempt.ok) {
    await sendMessage(connection, payload.message.chat.id, `Anh/chị đợi em chút nha, phần tạo ${type === "video" ? "video" : "ảnh"} của nhân vật đang bận. Em vẫn giữ đúng bộ ảnh mẫu 360 để thử lại sau.`);
    return json({ message: "Success", feature: `character_${type}_v32`, ok: false });
  }
  const caption = `✨ ${character.name} · ${attempt.refs.length} ảnh tham chiếu`;
  if (attempt.result.url) {
    if (type === "video") await sendVideoOrLink(connection, payload.message.chat.id, attempt.result.url, caption);
    else await sendPhoto(connection, payload.message.chat.id, attempt.result.url, caption);
  } else {
    await sendMessage(connection, payload.message.chat.id, `Em đã gửi job tạo ${type === "video" ? "video" : "ảnh"} cho ${character.name}. Mã job: ${attempt.result.jobId}`);
  }
  return json({ message: "Success", feature: `character_${type}_v32`, provider: attempt.candidate.providerId, model: attempt.candidate.model });
}

export default {
  async fetch(request, env, ctx) {
    const reference = await serveReferenceImage(request, env).catch(() => null);
    if (reference) return reference;
    const admin = await handleAdmin(request, env);
    if (admin) return admin;
    try {
      const media = await handleBotCharacterMedia(request, env);
      if (media) return media;
    } catch (error) {
      console.warn("V32 character media router failed:", error?.message || error);
    }
    return workerV31.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof workerV31.scheduled === "function") return workerV31.scheduled(event, env, ctx);
  }
};

export { generateMedia, getDefaultCharacter, listCharacters, mediaIntent };
