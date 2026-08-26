import test from "node:test";
import assert from "node:assert/strict";

import {
  createScopedZaloEnv,
  getConnectionBindingNames,
  getZaloConnection,
  parseZaloWebhookPath
} from "../src/zalo-connections.js";

test("main connection keeps legacy secret names", () => {
  assert.deepEqual(getConnectionBindingNames("main"), {
    tokenEnv: "ZALO_BOT_TOKEN",
    secretEnv: "WEBHOOK_SECRET_TOKEN",
    ownersEnv: "OWNER_ZALO_USER_IDS"
  });
});

test("named connection maps to isolated secret names", () => {
  assert.deepEqual(getConnectionBindingNames("sales-bot"), {
    tokenEnv: "ZALO_BOT_TOKEN_SALES_BOT",
    secretEnv: "WEBHOOK_SECRET_TOKEN_SALES_BOT",
    ownersEnv: "OWNER_ZALO_USER_IDS_SALES_BOT"
  });
});

test("webhook path selects connection id", () => {
  assert.deepEqual(parseZaloWebhookPath("/webhook"), {
    connectionId: "main",
    canonicalPath: "/webhook"
  });
  assert.deepEqual(parseZaloWebhookPath("/webhook/bot2"), {
    connectionId: "bot2",
    canonicalPath: "/webhook"
  });
  assert.equal(parseZaloWebhookPath("/health"), null);
});

test("scoped env swaps only Zalo connection secrets", () => {
  const base = {
    DB: { name: "db" },
    Grok: "grok-secret",
    ZALO_BOT_TOKEN_BOT2: "token-2",
    WEBHOOK_SECRET_TOKEN_BOT2: "secret-2",
    OWNER_ZALO_USER_IDS_BOT2: "owner-2"
  };

  const scoped = createScopedZaloEnv(base, "bot2");
  assert.equal(scoped.env.ZALO_BOT_TOKEN, "token-2");
  assert.equal(scoped.env.WEBHOOK_SECRET_TOKEN, "secret-2");
  assert.equal(scoped.env.OWNER_ZALO_USER_IDS, "owner-2");
  assert.equal(scoped.env.Grok, "grok-secret");
  assert.equal(scoped.env.DB, base.DB);
  assert.equal(scoped.env.ZALO_CONNECTION_ID, "bot2");
});

test("connection reports missing bot2 without affecting main", () => {
  const env = {
    ZALO_BOT_TOKEN: "main-token",
    WEBHOOK_SECRET_TOKEN: "main-secret"
  };
  assert.equal(getZaloConnection(env, "main").token, "main-token");
  assert.equal(getZaloConnection(env, "bot2").token, "");
});
