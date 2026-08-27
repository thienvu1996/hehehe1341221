import test from "node:test";
import assert from "node:assert/strict";
import {
  expandLiveQuery,
  isEventLiveQuestion,
  isLiveIntelQuestion,
  isSportsLiveQuestion,
  shouldHandleLiveMessage
} from "../src/live-intel.js";

test("detects shorthand realtime events and Vietnam football", () => {
  assert.equal(isLiveIntelQuestion("tối nay có sk j hay vn đá"), true);
  assert.equal(isEventLiveQuestion("tối nay có sk j"), true);
  assert.equal(isSportsLiveQuestion("vn đá tối nay không"), true);
});

test("does not route ordinary small talk as realtime search", () => {
  assert.equal(isLiveIntelQuestion("ê nay ăn gì"), false);
  assert.equal(isLiveIntelQuestion("mày nhớ tao thích ăn gì không"), false);
});

test("group realtime queries require mention but private chat does not", () => {
  const group = { chat: { chat_type: "GROUP" }, text: "tối nay có sự kiện gì" };
  const mentioned = { chat: { chat_type: "GROUP" }, text: "@Bot tối nay có sự kiện gì" };
  const privateMessage = { chat: { chat_type: "PRIVATE" }, text: "vn đá tối nay không" };
  assert.equal(shouldHandleLiveMessage(group, group.text), false);
  assert.equal(shouldHandleLiveMessage(mentioned, mentioned.text), true);
  assert.equal(shouldHandleLiveMessage(privateMessage, privateMessage.text), true);
});

test("expands Vietnamese shorthand and pins realtime lookup to Vietnam time", () => {
  const result = expandLiveQuery(
    "tối nay có sk j hay vn đá",
    { DEFAULT_EVENT_LOCATION: "TP Hồ Chí Minh" },
    new Date("2026-08-27T04:00:00Z")
  );
  assert.match(result, /sự kiện/i);
  assert.match(result, /Việt Nam/i);
  assert.match(result, /Asia\/Ho_Chi_Minh/);
  assert.match(result, /TP Hồ Chí Minh/);
});
