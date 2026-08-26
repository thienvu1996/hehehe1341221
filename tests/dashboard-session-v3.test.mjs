import test from "node:test";
import assert from "node:assert/strict";
import {
  createDashboardSessionToken,
  verifyDashboardSessionToken,
  wantsDashboardKey
} from "../src/worker-v3.js";

test("detects dashboard key command", () => {
  assert.equal(wantsDashboardKey("KEY_Dashboard"), true);
  assert.equal(wantsDashboardKey("key dashboard"), true);
  assert.equal(wantsDashboardKey("hello"), false);
});

test("creates and verifies temporary dashboard session", async () => {
  const env = { WEBHOOK_SECRET_TOKEN: "test-webhook-secret" };
  const session = await createDashboardSessionToken(env);

  assert.ok(session?.token?.startsWith("v1."));
  assert.equal(await verifyDashboardSessionToken(env, session.token), true);
  assert.equal(
    await verifyDashboardSessionToken({ WEBHOOK_SECRET_TOKEN: "wrong-secret" }, session.token),
    false
  );
});
