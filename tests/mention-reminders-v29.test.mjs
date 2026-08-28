import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanReminderTitle,
  extractVisibleTargetName,
  isReminderCreateText,
  parseVietnamDueAtV29,
  resolveUidFromCurrentPayload
} from "../src/worker-v29.js";

test("uses visible target after reminder verb instead of stale mention name", () => {
  const text = "@Bot Thu Thập atess nhắc @Chị 3 đi ê tiếp lúc 13h50";
  assert.equal(extractVisibleTargetName(text), "Chị 3");
});

test("matches UID only when structured mention belongs to visible person", () => {
  const text = "@Bot Thu Thập atess nhắc @Chị 3 đi ê tiếp lúc 13h50";
  const userPos = text.indexOf("@Chị 3");
  const message = {
    mentions: [
      { user_id: "stale-nhat-ha", display_name: "Nhật Hạ" },
      { user_id: "chi3-id", pos: userPos, len: "@Chị 3".length }
    ]
  };
  assert.equal(resolveUidFromCurrentPayload(message, text, "Chị 3"), "chi3-id");
});

test("does not reuse stale UID for another visible person", () => {
  const text = "@Bot Thu Thập atess nhắc @Chị 3 đi ê tiếp lúc 13h50";
  const message = { mentions: [{ user_id: "stale-nhat-ha", display_name: "Nhật Hạ" }] };
  assert.equal(resolveUidFromCurrentPayload(message, text, "Chị 3"), "");
});

test("parses relative five minute reminder", () => {
  const now = new Date("2026-08-28T07:25:00.000Z"); // 14:25 VN
  const due = parseVietnamDueAtV29("@Bot nhắc @Chị 3 đi trong 5p nữa", now);
  assert.equal(due.ok, true);
  assert.equal(due.localTime, "14:30");
  assert.equal(due.dueAt.toISOString(), "2026-08-28T07:30:00.000Z");
});

test("rejects explicit today past time instead of silently moving to tomorrow", () => {
  const now = new Date("2026-08-28T06:00:00.000Z"); // 13:00 VN
  const due = parseVietnamDueAtV29("@Bot nhắc @Chị 3 lúc 12h hôm nay", now);
  assert.equal(due.ok, false);
  assert.equal(due.reason, "past_time");
  assert.equal(due.localTime, "12:00");
  assert.equal(due.nowLocalTime, "13:00");
});

test("keeps event content but removes target and relative time", () => {
  const title = cleanReminderTitle("@Bot Thu Thập atess nhắc @Chị 3 đi ăn trong 5p nữa", {
    mode: "user",
    name: "Chị 3"
  });
  assert.equal(title.toLowerCase(), "đi ăn");
});

test("recognizes reminder create with visible user", () => {
  const message = { chat: { id: "g1", chat_type: "GROUP" } };
  assert.equal(isReminderCreateText(message, "@Bot Thu Thập atess nhắc @Chị 3 đi trong 5p nữa"), true);
});
