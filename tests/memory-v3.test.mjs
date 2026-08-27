import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCommunicationStyle, isHighSignalMemoryText, shouldRunNow } from "../src/memory-v3.js";
import { getMemoryPayload, isMemoryEvent } from "../src/worker-v13.js";

test("Memory V3 detects explicit long-term communication signals", () => {
  assert.equal(isHighSignalMemoryText("Lần sau gọi tôi là anh Thành nha"), true);
  assert.equal(isHighSignalMemoryText("Mình thích trả lời ngắn gọn thôi"), true);
  assert.equal(isHighSignalMemoryText("hello"), false);
});

test("Memory V3 learns lightweight communication style without AI", () => {
  const style = analyzeCommunicationStyle([
    { text: "ok nha" },
    { text: "k dc r" },
    { text: "t gửi r nha 😆" },
    { text: "m check giúp t nha" },
    { text: "oke dc á" },
    { text: "k sao nha" }
  ]);
  assert.ok(style);
  assert.equal(style.observed_messages, 6);
  assert.ok(style.abbreviations.includes("nha"));
  assert.ok(style.abbreviations.includes("k"));
  assert.ok(style.pronouns.includes("t"));
});

test("Memory V3 batches normal chat but immediately handles high-signal memory", () => {
  assert.equal(shouldRunNow({ pending_count: 1, last_extracted_at: null }, "hello bạn"), false);
  assert.equal(shouldRunNow({ pending_count: 1, last_extracted_at: null }, "nhớ giúp tôi lần sau xưng anh em nha"), true);
  assert.equal(shouldRunNow({ pending_count: 8, last_extracted_at: new Date().toISOString() }, "ok"), true);
  assert.equal(shouldRunNow({ pending_count: 3, last_extracted_at: null }, "ok"), true);
});

test("worker v13 accepts text and image events for memory pipeline", () => {
  const payload = getMemoryPayload({
    event_name: "message.text.received",
    message: { chat: { id: "g1" }, text: "xin chao" }
  });
  assert.equal(payload.eventName, "message.text.received");
  assert.equal(isMemoryEvent(payload.eventName), true);
  assert.equal(isMemoryEvent("group.joined"), false);
});
