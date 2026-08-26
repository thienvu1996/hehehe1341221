import baseWorker from "./worker.js";

const MEMORY_V2_RECENT_LIMIT = 30;
const MEMORY_V2_ENTITY_LIMIT = 20;
const MEMORY_V2_ENTITY_TTL_HOURS = 2;

const VIETNAMESE_CHAT_REPLACEMENTS = new Map([
  ["k", "khong"],
  ["ko", "khong"],
  ["kh", "khong"],
  ["dc", "duoc"],
  ["dk", "duoc"],
  ["r", "roi"],
  ["roi", "roi"],
  ["hqua", "hom qua"],
  ["hnay", "hom nay"],
  ["bjo", "bay gio"],
  ["bh", "bay gio"],
  ["trl", "tra loi"],
  ["ktra", "kiem tra"],
  ["mng", "moi nguoi"],
  ["mn", "moi nguoi"]
]);

function redactForMemory(text) {
  return String(text || "")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GEMINI_KEY]")
    .replace(/\b\d{8,}:[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_ZALO_TOKEN]")
    .replace(/(token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function truncateMemoryText(value, maxLength = 220) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function normalizeMemoryText(text) {
  const ascii = String(text || "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = ascii.split(/\s+/).filter(Boolean);

  return tokens
    .map((token) => VIETNAMESE_CHAT_REPLACEMENTS.get(token) || token)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAlias(value) {
  return normalizeMemoryText(value).replace(/\s+/g, " ").trim();
}

function hasPhrase(haystack, phrase) {
  const left = ` ${normalizeAlias(haystack)} `;
  const right = ` ${normalizeAlias(phrase)} `;
  return right.trim().length > 1 && left.includes(right);
}

function sanitizeUrl(rawUrl) {
  const value = String(rawUrl || "").trim();

  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|key|auth|signature|sig|password|pwd)/i.test(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString();
  } catch {
    return redactForMemory(value);
  }
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0].replace(/[),.;!?]+$/g, ""))
    .filter(Boolean);
}

function getWebhookPayload(body) {
  const event = body?.result || body;
  const message = event?.message;

  if (!event || !message?.chat?.id) {
    return null;
  }

  return {
    eventName: event.event_name || "",
    message,
    text: String(message.text || message.caption || "").trim()
  };
}

function getDistrictAliases(text) {
  const normalized = normalizeMemoryText(text);
  const aliases = new Set();

  for (const match of normalized.matchAll(/\b(?:q|quan)\s*(1[0-2]|[1-9])\b/g)) {
    aliases.add(`q${match[1]}`);
    aliases.add(`quan ${match[1]}`);
  }

  for (const name of ["go vap", "binh thanh", "thu duc", "tan binh", "tan phu", "phu nhuan", "nha be", "binh chanh"]) {
    if (hasPhrase(normalized, name)) {
      aliases.add(name);
    }
  }

  return [...aliases];
}

function buildLinkAliases(link, index) {
  const position = index + 1;
  const aliases = new Set([
    `link ${position}`,
    `cai ${position}`,
    `can ${position}`,
    `con ${position}`,
    `cai thu ${position}`,
    `can thu ${position}`,
    `link thu ${position}`
  ]);

  if (position === 1) {
    [
      "cai dau",
      "can dau",
      "con dau",
      "link dau",
      "cai moi nhat",
      "can moi nhat",
      "link moi nhat",
      "cai vua gui",
      "can vua gui",
      "link vua gui",
      "cai hoi nay",
      "can hoi nay",
      "con hoi nay",
      "cai nay",
      "cai do",
      "con do",
      "no"
    ].forEach((alias) => aliases.add(alias));
  }

  const areaSource = `${link.area_text || ""} ${link.source_text || ""} ${link.summary || ""} ${link.title || ""}`;
  for (const district of getDistrictAliases(areaSource)) {
    aliases.add(`cai ${district}`);
    aliases.add(`can ${district}`);
    aliases.add(`link ${district}`);
  }

  return [...aliases];
}

function detectEntityReference(text) {
  const normalized = normalizeMemoryText(text);

  if (!normalized || normalized.length > 220) {
    return false;
  }

  return (
    /\b(?:cai|can|con|link)\s+(?:thu\s+)?\d{1,2}\b/.test(normalized) ||
    /\b(?:cai|can|con|link)\s+dau\b/.test(normalized) ||
    /\b(?:cai|can|con|link)\s+(?:q\d{1,2}|quan\s+\d{1,2})\b/.test(normalized) ||
    /\b(?:cai|can|con|link)\s+(?:hoi nay|vua gui|moi nhat|nay|do)\b/.test(normalized) ||
    /\bno\b/.test(normalized)
  );
}

function getExplicitPosition(text) {
  const normalized = normalizeMemoryText(text);
  const numeric = normalized.match(/\b(?:cai|can|con|link)\s+(?:thu\s+)?(\d{1,2})\b/);

  if (numeric) {
    return Number(numeric[1]);
  }

  if (/\b(?:cai|can|con|link)\s+dau\b/.test(normalized)) {
    return 1;
  }

  return null;
}

function getExplicitDistrict(text) {
  const normalized = normalizeMemoryText(text);
  const numeric = normalized.match(/\b(?:cai|can|con|link)\s+(?:q|quan)\s*(1[0-2]|[1-9])\b/);

  if (numeric) {
    return [`q${numeric[1]}`, `quan ${numeric[1]}`];
  }

  for (const name of ["go vap", "binh thanh", "thu duc", "tan binh", "tan phu", "phu nhuan", "nha be", "binh chanh"]) {
    if (new RegExp(`\\b(?:cai|can|con|link)\\s+${name.replace(/ /g, "\\s+")}\\b`).test(normalized)) {
      return [name];
    }
  }

  return [];
}

async function deleteCurrentEntityResolution(env, chatId) {
  if (!env.DB || !chatId) {
    return;
  }

  try {
    await env.DB.prepare(
      `DELETE FROM chat_memories
       WHERE scope = 'chat' AND chat_id = ? AND topic = 'entity_resolution'`
    )
      .bind(chatId)
      .run();
  } catch (error) {
    console.error("Memory V2: failed to clear entity resolution:", error);
  }
}

async function upsertChatMemory(env, message, entry) {
  if (!env.DB || !message?.chat?.id) {
    return;
  }

  const chatId = String(message.chat.id);
  const expiresAt = entry.ttlHours
    ? new Date(Date.now() + Number(entry.ttlHours) * 60 * 60 * 1000).toISOString()
    : null;

  await env.DB.prepare(
    `INSERT INTO chat_memories
      (id, scope, chat_id, chat_type, chat_title, user_id, user_name, memory_type, topic, memory_key,
       summary, value_json, confidence, importance, source_message_id, expires_at, updated_at, last_seen_at)
     VALUES (?, 'chat', ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(scope, chat_id, user_id, topic, memory_key) DO UPDATE SET
       chat_type = excluded.chat_type,
       chat_title = excluded.chat_title,
       user_name = excluded.user_name,
       memory_type = excluded.memory_type,
       summary = excluded.summary,
       value_json = excluded.value_json,
       confidence = excluded.confidence,
       importance = excluded.importance,
       source_message_id = excluded.source_message_id,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP,
       last_seen_at = CURRENT_TIMESTAMP`
  )
    .bind(
      crypto.randomUUID(),
      chatId,
      message.chat?.chat_type || "",
      message.chat?.title || "",
      message.from?.display_name || "",
      entry.memoryType,
      entry.topic,
      entry.key,
      truncateMemoryText(redactForMemory(entry.summary), 500),
      JSON.stringify(entry.value || {}),
      Number(entry.confidence ?? 0.9),
      Math.max(1, Math.min(5, Number(entry.importance ?? 4))),
      message.message_id || "",
      expiresAt
    )
    .run();
}

async function ensureVietnameseRulesMemory(env, message) {
  await upsertChatMemory(env, message, {
    memoryType: "language_rules",
    topic: "vietnamese_chat",
    key: "vi_chat_rules_v2",
    summary: "Quy ước chat Việt: k/ko/kh=không, dc/đc=được, r=rồi, hqua=hôm qua, hnay=hôm nay; câu cụt như 'cái đó', 'căn đầu', 'hồi nãy' phải bám context/entity gần nhất và không được bịa khi không resolve được.",
    value: {
      abbreviations: {
        k: "không",
        ko: "không",
        kh: "không",
        dc: "được",
        "đc": "được",
        r: "rồi",
        hqua: "hôm qua",
        hnay: "hôm nay",
        ktra: "kiểm tra",
        trl: "trả lời"
      },
      reference_rule: "Ưu tiên entity cùng chat; ordinal > khu vực > entity mới nhất. Không lấy entity từ chat/group khác."
    },
    confidence: 1,
    importance: 4
  });
}

async function refreshRecentChatMemory(env, message, currentText) {
  if (!env.DB || !message?.chat?.id) {
    return;
  }

  const chatId = String(message.chat.id);
  const result = await env.DB.prepare(
    `SELECT user_id, user_name, message_id, text, created_at
     FROM messages
     WHERE chat_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  )
    .bind(chatId, MEMORY_V2_RECENT_LIMIT)
    .all();
  const rows = (result.results || []).filter(
    (row) => !message.message_id || String(row.message_id || "") !== String(message.message_id)
  );
  const latest = [
    {
      user_id: message.from?.id || "",
      user_name: message.from?.display_name || "",
      message_id: message.message_id || "",
      text: currentText,
      created_at: new Date().toISOString()
    },
    ...rows
  ]
    .slice(0, MEMORY_V2_RECENT_LIMIT)
    .reverse()
    .map((row) => ({
      user_id: row.user_id || "",
      user: row.user_name || "Người dùng",
      message_id: row.message_id || "",
      text: truncateMemoryText(redactForMemory(row.text), 180),
      at: row.created_at || ""
    }));

  await upsertChatMemory(env, message, {
    memoryType: "recent_context",
    topic: "conversation",
    key: "recent_30_messages",
    summary: `Context hội thoại ${latest.length} tin gần nhất trong đúng chat/group này để hiểu câu cụt và tham chiếu hồi nãy.`,
    value: { messages: latest },
    confidence: 1,
    importance: 5,
    ttlHours: 48
  });
}

async function refreshLinkEntities(env, message) {
  if (!env.DB || !message?.chat?.id) {
    return [];
  }

  const chatId = String(message.chat.id);
  const result = await env.DB.prepare(
    `SELECT id, url, source_text, title, summary, price_text, area_text, status, created_at, updated_at
     FROM links
     WHERE chat_id = ?
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ?`
  )
    .bind(chatId, MEMORY_V2_ENTITY_LIMIT)
    .all();
  const links = result.results || [];
  const statements = [
    env.DB.prepare(`DELETE FROM chat_entities WHERE chat_id = ? AND entity_type = 'link'`).bind(chatId)
  ];

  links.forEach((link, index) => {
    const aliases = buildLinkAliases(link, index);
    const position = index + 1;
    const displayName = truncateMemoryText(link.summary || link.title || `Link thuê nhà #${position}`, 240);
    const value = {
      position,
      url: sanitizeUrl(link.url),
      title: truncateMemoryText(link.title, 220),
      summary: truncateMemoryText(link.summary, 320),
      price: truncateMemoryText(link.price_text, 100),
      area: truncateMemoryText(link.area_text, 160),
      status: link.status || "",
      created_at: link.created_at || "",
      updated_at: link.updated_at || ""
    };

    statements.push(
      env.DB.prepare(
        `INSERT INTO chat_entities
          (id, chat_id, chat_type, user_id, user_name, entity_type, entity_key, display_name,
           aliases_json, value_json, source_message_id, source_url, created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, '', '', 'link', ?, ?, ?, ?, '', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        crypto.randomUUID(),
        chatId,
        message.chat?.chat_type || "",
        `link:${link.id}`,
        displayName,
        JSON.stringify(aliases),
        JSON.stringify(value),
        sanitizeUrl(link.url)
      )
    );
  });

  await env.DB.batch(statements);
  return links;
}

function scoreEntityMatch(question, entity) {
  const normalized = normalizeMemoryText(question);
  const aliases = Array.isArray(entity.aliases) ? entity.aliases : [];
  let score = 0;
  const explicitPosition = getExplicitPosition(question);
  const valuePosition = Number(entity.value?.position || 0);

  if (explicitPosition !== null) {
    if (valuePosition === explicitPosition) {
      score += 1000;
    } else {
      return -1;
    }
  }

  const districts = getExplicitDistrict(question);
  if (districts.length > 0) {
    const area = normalizeMemoryText(`${entity.value?.area || ""} ${entity.value?.summary || ""} ${aliases.join(" ")}`);
    if (districts.some((district) => hasPhrase(area, district))) {
      score += 700;
    } else if (explicitPosition === null) {
      return -1;
    }
  }

  for (const alias of aliases) {
    if (hasPhrase(normalized, alias)) {
      score = Math.max(score, 300 + normalizeAlias(alias).length);
    }
  }

  if (score === 0 && /\b(?:cai do|con do|cai nay|no|cai hoi nay|can hoi nay)\b/.test(normalized) && valuePosition === 1) {
    score = 250;
  }

  return score;
}

async function resolveEntityReferences(env, message, question) {
  if (!env.DB || !message?.chat?.id || !detectEntityReference(question)) {
    return [];
  }

  const chatId = String(message.chat.id);
  const result = await env.DB.prepare(
    `SELECT id, entity_type, entity_key, display_name, aliases_json, value_json, updated_at
     FROM chat_entities
     WHERE chat_id = ?
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`
  )
    .bind(chatId, MEMORY_V2_ENTITY_LIMIT)
    .all();
  const entities = (result.results || []).map((row) => ({
    ...row,
    aliases: (() => {
      try {
        return JSON.parse(row.aliases_json || "[]");
      } catch {
        return [];
      }
    })(),
    value: (() => {
      try {
        return JSON.parse(row.value_json || "{}");
      } catch {
        return {};
      }
    })()
  }));

  const ranked = entities
    .map((entity) => ({ entity, score: scoreEntityMatch(question, entity) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.entity.value?.position || 999) - Number(b.entity.value?.position || 999));

  if (ranked.length === 0) {
    return [];
  }

  const bestScore = ranked[0].score;
  return ranked
    .filter((item) => item.score === bestScore)
    .slice(0, 2)
    .map((item) => item.entity);
}

async function saveEntityResolutionMemory(env, message, question, entities) {
  if (!entities.length) {
    return;
  }

  const resolved = entities.map((entity) => ({
    entity_key: entity.entity_key,
    display_name: entity.display_name,
    position: entity.value?.position || null,
    url: sanitizeUrl(entity.value?.url || ""),
    title: entity.value?.title || "",
    summary: entity.value?.summary || "",
    price: entity.value?.price || "",
    area: entity.value?.area || "",
    status: entity.value?.status || ""
  }));
  const descriptions = resolved.map((item) => {
    const details = [item.price, item.area].filter(Boolean).join(" | ");
    return `${item.display_name}${details ? ` (${details})` : ""}`;
  });

  await upsertChatMemory(env, message, {
    memoryType: "entity_resolution",
    topic: "entity_resolution",
    key: "current_reference",
    summary: `Câu "${truncateMemoryText(question, 160)}" đang tham chiếu tới: ${descriptions.join("; ")}. Chỉ dùng entity này cho câu hỏi hiện tại.`,
    value: {
      original_question: redactForMemory(question),
      normalized_question: normalizeMemoryText(question),
      resolved
    },
    confidence: 0.97,
    importance: 5,
    ttlHours: MEMORY_V2_ENTITY_TTL_HOURS
  });

  try {
    const ids = entities.map((entity) => entity.id).filter(Boolean);
    for (const id of ids) {
      await env.DB.prepare(`UPDATE chat_entities SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
    }
  } catch (error) {
    console.error("Memory V2: failed to mark entity seen:", error);
  }
}

async function prepareMemoryV2(env, payload) {
  if (!env.DB || !payload?.message?.chat?.id || !payload.text) {
    return;
  }

  const { message, text } = payload;
  await deleteCurrentEntityResolution(env, message.chat.id);

  try {
    await Promise.all([
      ensureVietnameseRulesMemory(env, message),
      refreshRecentChatMemory(env, message, text)
    ]);
  } catch (error) {
    console.error("Memory V2: failed to refresh context:", error);
  }

  if (!detectEntityReference(text)) {
    return;
  }

  try {
    await refreshLinkEntities(env, message);
    const entities = await resolveEntityReferences(env, message, text);
    await saveEntityResolutionMemory(env, message, text, entities);
  } catch (error) {
    console.error("Memory V2: entity resolution failed:", error);
  }
}

async function finalizeMemoryV2(env, payload) {
  if (!env.DB || !payload?.message?.chat?.id) {
    return;
  }

  const urls = extractUrls(payload.text);
  if (urls.length === 0) {
    return;
  }

  try {
    await refreshLinkEntities(env, payload.message);
  } catch (error) {
    console.error("Memory V2: failed to refresh entities after link save:", error);
  }
}

export { buildLinkAliases, detectEntityReference, normalizeMemoryText };

export default {
  async fetch(request, env, ctx) {
    let payload = null;

    try {
      const url = new URL(request.url);
      if (request.method === "POST" && ["/webhook", "/webhooks"].includes(url.pathname)) {
        const body = await request.clone().json().catch(() => null);
        payload = getWebhookPayload(body);

        if (payload && ["message.text.received", "message.image.received"].includes(payload.eventName)) {
          await prepareMemoryV2(env, payload);
        }
      }
    } catch (error) {
      console.error("Memory V2 preprocessor failed:", error);
    }

    const response = await baseWorker.fetch(request, env, ctx);

    if (payload) {
      const task = finalizeMemoryV2(env, payload);
      if (ctx?.waitUntil) {
        ctx.waitUntil(task);
      } else {
        await task;
      }
    }

    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === "function") {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
