import test from "node:test";
import assert from "node:assert/strict";

import { friendlyQueuedReply, retryDelayMinutes } from "../src/worker-v30.js";

test("general AI retry backoff grows and caps at one hour", () => {
  assert.equal(retryDelayMinutes(0), 1);
  assert.equal(retryDelayMinutes(1), 2);
  assert.equal(retryDelayMinutes(2), 5);
  assert.equal(retryDelayMinutes(5), 30);
  assert.equal(retryDelayMinutes(6), 60);
  assert.equal(retryDelayMinutes(99), 60);
});

test("queued reply is user friendly and hides provider internals", () => {
  const reply = friendlyQueuedReply();
  assert.match(reply, /đợi em chút/i);
  assert.match(reply, /hàng chờ/i);
  assert.doesNotMatch(reply, /gemini|grok|provider|quota|timeout/i);
});
