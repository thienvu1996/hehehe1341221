const BOT_SCOPE_PREFIX = "@bot:";

function normalizeConnectionId(value = "main") {
  const clean = String(value || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return clean || "main";
}

function connectionPrefix(connectionId = "main") {
  const id = normalizeConnectionId(connectionId);
  return id === "main" ? "" : `${BOT_SCOPE_PREFIX}${id}:`;
}

function scopeIdentity(value, connectionId, identities = []) {
  const prefix = connectionPrefix(connectionId);
  if (!prefix || typeof value !== "string" || value.startsWith(BOT_SCOPE_PREFIX)) return value;
  const wanted = identities.filter(Boolean).map((item) => String(item));
  return wanted.includes(value) ? `${prefix}${value}` : value;
}

function unscopeValue(value, connectionId) {
  const prefix = connectionPrefix(connectionId);
  if (!prefix || typeof value !== "string") return value;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function unscopeRow(row, connectionId) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const output = { ...row };
  for (const key of ["chat_id", "user_id", "message_id", "source_message_id"]) {
    if (typeof output[key] === "string") output[key] = unscopeValue(output[key], connectionId);
  }
  return output;
}

function quoteSqlLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function rewriteProfileSql(sql, connectionId) {
  const id = normalizeConnectionId(connectionId);
  if (id === "main") return String(sql || "");
  const literal = quoteSqlLiteral(id);
  return String(sql || "")
    .replace(/\bid\s*=\s*'default'/gi, `id = ${literal}`)
    .replace(/VALUES\s*\(\s*'default'\s*,/gi, `VALUES (${literal},`);
}

function scopePredicate(column, connectionId) {
  const id = normalizeConnectionId(connectionId);
  if (id === "main") return `(${column} NOT LIKE '${BOT_SCOPE_PREFIX}%')`;
  return `(${column} LIKE ${quoteSqlLiteral(`${connectionPrefix(id)}%`)})`;
}

function memoryScopePredicate(connectionId, alias = "memories") {
  return `(${scopePredicate(`${alias}.chat_id`, connectionId)} OR ${scopePredicate(`${alias}.user_id`, connectionId)})`;
}

function rewriteGlobalMemorySql(sql, connectionId) {
  if (!/chat_memories/i.test(String(sql || ""))) return String(sql || "");
  const predicate = memoryScopePredicate(connectionId, "chat_memories");
  return String(sql || "").replace(/\bscope\s*=\s*'global'/gi, `(scope = 'global' AND ${predicate})`);
}

function rewriteRuntimeProviderSql(sql, allowedProviderIds) {
  if (allowedProviderIds == null || allowedProviderIds === "*") return String(sql || "");
  const ids = Array.isArray(allowedProviderIds) ? allowedProviderIds.filter(Boolean).map(String) : [];
  const clause = ids.length
    ? `AND id IN (${ids.map(quoteSqlLiteral).join(",")})`
    : "AND 1 = 0";
  return String(sql || "").replace(
    /FROM ai_providers WHERE enabled = 1/gi,
    `FROM ai_providers WHERE enabled = 1 ${clause}`
  );
}

function rewriteScheduledSql(sql, connectionId) {
  let text = rewriteProfileSql(sql, connectionId);
  const reminderPredicate = scopePredicate("chat_id", connectionId);
  const settingsPredicate = scopePredicate("chat_id", connectionId);

  text = text.replace(
    /FROM reminders\s+WHERE status = 'pending' AND due_at_utc <= \?/gi,
    `FROM reminders\n       WHERE status = 'pending' AND due_at_utc <= ? AND ${reminderPredicate}`
  );
  text = text.replace(
    /FROM chat_settings\s+WHERE weather_enabled = 1/gi,
    `FROM chat_settings\n       WHERE weather_enabled = 1 AND ${settingsPredicate}`
  );
  return text;
}

function rewriteDashboardSql(sql, connectionId) {
  let text = rewriteProfileSql(sql, connectionId);
  const simpleTables = ["messages", "links", "searches", "images"];

  for (const table of simpleTables) {
    const pred = scopePredicate("chat_id", connectionId);
    const countPattern = new RegExp(`SELECT COUNT\\(\\*\\) AS total FROM ${table}(?!\\s+WHERE)`, "gi");
    text = text.replace(countPattern, `SELECT COUNT(*) AS total FROM ${table} WHERE ${pred}`);
    const recentPattern = new RegExp(`FROM ${table}(\\s+)ORDER BY`, "gi");
    text = text.replace(recentPattern, `FROM ${table}\n       WHERE ${pred}$1ORDER BY`);
  }

  const aiPred = scopePredicate("chat_id", connectionId);
  text = text.replace(
    /SELECT COUNT\(\*\) AS total FROM ai_usage(?!\s+WHERE)/gi,
    `SELECT COUNT(*) AS total FROM ai_usage WHERE ${aiPred}`
  );
  text = text.replace(/FROM ai_usage(\s+)ORDER BY/gi, `FROM ai_usage\n       WHERE ${aiPred}$1ORDER BY`);
  if (/FROM ai_usage\s*$/i.test(text) && !/FROM ai_usage\s+WHERE/i.test(text)) {
    text = text.replace(/FROM ai_usage\s*$/i, `FROM ai_usage\n       WHERE ${aiPred}`);
  }

  const settingsPred = scopePredicate("settings.chat_id", connectionId);
  text = text.replace(
    /(LEFT JOIN chat_aliases AS alias ON alias\.chat_id = settings\.chat_id)(\s+ORDER BY)/gi,
    `$1\n       WHERE ${settingsPred}$2`
  );
  text = text.replace(
    /SELECT COUNT\(\*\) AS total FROM chat_settings(?!\s+WHERE)/gi,
    `SELECT COUNT(*) AS total FROM chat_settings WHERE ${scopePredicate("chat_id", connectionId)}`
  );

  const remindersPred = scopePredicate("reminders.chat_id", connectionId);
  text = text.replace(
    /(LEFT JOIN chat_aliases AS alias ON alias\.chat_id = reminders\.chat_id)(\s+ORDER BY)/gi,
    `$1\n       WHERE ${remindersPred}$2`
  );
  text = text.replace(
    /SELECT COUNT\(\*\) AS total FROM reminders(?!\s+WHERE)/gi,
    `SELECT COUNT(*) AS total FROM reminders WHERE ${scopePredicate("chat_id", connectionId)}`
  );

  const memoriesPred = memoryScopePredicate(connectionId, "memories");
  text = text.replace(
    /WHERE memories\.expires_at IS NULL OR datetime\(memories\.expires_at\) > datetime\('now'\)/gi,
    `WHERE ${memoriesPred} AND (memories.expires_at IS NULL OR datetime(memories.expires_at) > datetime('now'))`
  );
  text = text.replace(
    /SELECT COUNT\(\*\) AS total FROM chat_memories(?!\s+WHERE)/gi,
    `SELECT COUNT(*) AS total FROM chat_memories WHERE ${memoryScopePredicate(connectionId, "chat_memories")}`
  );

  return text;
}

function scopeChatMemoryBindValues(values, sql, connectionId, identities) {
  if (normalizeConnectionId(connectionId) === "main" || !/INSERT\s+INTO\s+chat_memories/i.test(sql)) return values;
  const output = [...values];
  const prefix = connectionPrefix(connectionId);
  if (output.length > 2) {
    output[2] = output[2]
      ? scopeIdentity(output[2], connectionId, identities)
      : `${prefix}__global__`;
  }
  if (output.length > 5) {
    output[5] = output[5]
      ? scopeIdentity(output[5], connectionId, identities)
      : `${prefix}__global__`;
  }
  if (output.length > 14 && typeof output[14] === "string") {
    output[14] = scopeIdentity(output[14], connectionId, identities);
  }
  return output;
}

function wrapStatement(statement, context) {
  const { connectionId, identities, sql } = context;
  return {
    bind(...values) {
      let scoped = values.map((value) => scopeIdentity(value, connectionId, identities));
      scoped = scopeChatMemoryBindValues(scoped, sql, connectionId, identities);
      return wrapStatement(statement.bind(...scoped), context);
    },
    async all(...args) {
      const result = await statement.all(...args);
      if (!result || !Array.isArray(result.results)) return result;
      return { ...result, results: result.results.map((row) => unscopeRow(row, connectionId)) };
    },
    async first(...args) {
      const result = await statement.first(...args);
      return result && typeof result === "object" ? unscopeRow(result, connectionId) : result;
    },
    async run(...args) {
      return statement.run(...args);
    },
    async raw(...args) {
      return statement.raw(...args);
    }
  };
}

function createScopedDb(db, {
  connectionId = "main",
  chatId = "",
  userId = "",
  messageId = "",
  mode = "request",
  allowedProviderIds = null
} = {}) {
  if (!db?.prepare) return db;
  const id = normalizeConnectionId(connectionId);
  const identities = [chatId, userId, messageId].filter(Boolean).map(String);

  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql) => {
          let rewritten = rewriteProfileSql(sql, id);
          rewritten = rewriteGlobalMemorySql(rewritten, id);
          rewritten = rewriteRuntimeProviderSql(rewritten, allowedProviderIds);
          if (mode === "dashboard") rewritten = rewriteDashboardSql(rewritten, id);
          if (mode === "scheduled") rewritten = rewriteScheduledSql(rewritten, id);
          return wrapStatement(target.prepare(rewritten), { connectionId: id, identities, sql: rewritten });
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export {
  BOT_SCOPE_PREFIX,
  connectionPrefix,
  createScopedDb,
  normalizeConnectionId,
  rewriteDashboardSql,
  rewriteGlobalMemorySql,
  rewriteProfileSql,
  rewriteRuntimeProviderSql,
  rewriteScheduledSql,
  scopeIdentity,
  scopePredicate,
  unscopeRow,
  unscopeValue
};
