import test from "node:test";
import assert from "node:assert/strict";
import workerV10 from "../src/worker-v10.js";
import {
  connectionPrefix,
  rewriteDashboardSql,
  rewriteProfileSql,
  rewriteRuntimeProviderSql,
  scopeIdentity,
  unscopeValue
} from "../src/scoped-db.js";

test("worker v10 exposes fetch and scheduled handlers", () => {
  assert.equal(typeof workerV10.fetch, "function");
  assert.equal(typeof workerV10.scheduled, "function");
});

test("secondary bot identities are namespaced and reversible", () => {
  const scoped = scopeIdentity("chat-1", "sale", ["chat-1"]);
  assert.equal(scoped, "@bot:sale:chat-1");
  assert.equal(unscopeValue(scoped, "sale"), "chat-1");
  assert.equal(connectionPrefix("main"), "");
});

test("bot profile default row is rewritten per connection", () => {
  const sql = "SELECT * FROM bot_profile WHERE id = 'default' LIMIT 1";
  assert.match(rewriteProfileSql(sql, "bot2"), /id = 'bot2'/);
  assert.equal(rewriteProfileSql(sql, "main"), sql);
});

test("dashboard queries receive bot scope predicates", () => {
  const sql = "SELECT id, chat_id FROM messages ORDER BY datetime(created_at) DESC LIMIT 40";
  const scoped = rewriteDashboardSql(sql, "bot2");
  assert.match(scoped, /chat_id LIKE '@bot:bot2:%'/);
});

test("managed AI provider query can be restricted per bot", () => {
  const sql = "SELECT id FROM ai_providers WHERE enabled = 1 ORDER BY priority ASC";
  const scoped = rewriteRuntimeProviderSql(sql, ["nexus-grok"]);
  assert.match(scoped, /id IN \('nexus-grok'\)/);
  const blocked = rewriteRuntimeProviderSql(sql, []);
  assert.match(blocked, /AND 1 = 0/);
});
