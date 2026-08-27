import test from "node:test";
import assert from "node:assert/strict";

import { shouldEmitTyping } from "../src/worker-v23.js";

test("private text messages show typing", () => {
  assert.equal(shouldEmitTyping({
    eventName: "message.text.received",
    text: "hello",
    message: { chat: { id: "c1", chat_type: "PRIVATE" } }
  }), true);
});

test("group text only shows typing when bot is mentioned", () => {
  assert.equal(shouldEmitTyping({
    eventName: "message.text.received",
    text: "hello group",
    message: { chat: { id: "g1", chat_type: "GROUP" } }
  }), false);

  assert.equal(shouldEmitTyping({
    eventName: "message.text.received",
    text: "@Bot hello",
    message: { chat: { id: "g1", chat_type: "GROUP" } }
  }), true);
});

test("non-text events do not show typing", () => {
  assert.equal(shouldEmitTyping({
    eventName: "message.image.received",
    message: { chat: { id: "c1", chat_type: "PRIVATE" } }
  }), false);
});
