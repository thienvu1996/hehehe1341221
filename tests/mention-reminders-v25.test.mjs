import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNotification,
  detectTarget,
  extractReminderTitle,
  getCancelPrefix,
  parseVietnamDueAt,
  shouldRunLegacyScheduled
} from "../src/worker-v25.js";

test("parses today Vietnam reminder time", () => {
  const now = new Date("2026-08-28T04:00:00.000Z"); // 11:00 VN
  const due = parseVietnamDueAt("@Bot 18h hôm nay nhắc @all họp team", now);
  assert.equal(due.localDate, "2026-08-28");
  assert.equal(due.localTime, "18:00");
  assert.equal(due.dueAt.toISOString(), "2026-08-28T11:00:00.000Z");
});

test("rolls an unspecified past local time to tomorrow", () => {
  const now = new Date("2026-08-28T11:30:00.000Z"); // 18:30 VN
  const due = parseVietnamDueAt("@Bot 18h nhắc @all họp", now);
  assert.equal(due.localDate, "2026-08-29");
  assert.equal(due.localTime, "18:00");
});

test("detects all target", () => {
  const message = { chat: { id: "g1", chat_type: "GROUP" } };
  assert.deepEqual(detectTarget(message, "@Bot mai 8h nhắc tất cả mọi người họp"), {
    mode: "all",
    uid: "-1",
    name: "all"
  });
});

test("detects an individually mentioned member after bot mention", () => {
  const message = {
    chat: { id: "g1", chat_type: "GROUP" },
    mentions: [
      { user_id: "bot-id", display_name: "Bot Thảo Vy" },
      { user_id: "u-lan", display_name: "Lan" }
    ]
  };
  const target = detectTarget(message, "@Bot Thảo Vy mai 8h nhắc @Lan gửi báo cáo");
  assert.equal(target.mode, "user");
  assert.equal(target.uid, "u-lan");
  assert.equal(target.name, "Lan");
});

test("builds native all mention payload", () => {
  const output = buildNotification({
    target_mode: "all",
    due_local_date: "2026-08-28",
    due_local_time: "18:00",
    title: "Họp team"
  });
  assert.match(output.text, /^@all/);
  assert.deepEqual(output.mentions, [{ pos: 0, len: 4, uid: "-1", type: 0 }]);
});

test("extracts a readable reminder title", () => {
  const title = extractReminderTitle("@Bot 18h hôm nay nhắc @all họp team ở quận 1", { mode: "all", name: "all" });
  assert.match(title.toLowerCase(), /họp team|hop team/);
});

test("parses cancellation prefix", () => {
  assert.equal(getCancelPrefix("@Bot hủy thông báo ab12cd34"), "ab12cd34");
});

test("legacy scheduler remains on quarter-hour ticks", () => {
  assert.equal(shouldRunLegacyScheduled(Date.parse("2026-08-28T12:15:00Z")), true);
  assert.equal(shouldRunLegacyScheduled(Date.parse("2026-08-28T12:16:00Z")), false);
});
