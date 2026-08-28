import test from "node:test";
import assert from "node:assert/strict";

import {
  detectTarget,
  extractReminderTitle,
  getListDateFilter,
  isMentionReminderListIntent,
  normalizeReminderText
} from "../src/worker-v26.js";

test("normalizes common Vietnamese notification typo", () => {
  assert.equal(normalizeReminderText("lịch thông tbaos hôm nay"), "lich thong bao hom nay");
});

test("recognizes typoed today reminder list command", () => {
  const message = { chat: { id: "g1", chat_type: "GROUP" } };
  assert.equal(
    isMentionReminderListIntent(message, "@Bot Thu Thập atess lịch thông tbaos hôm nay"),
    true
  );
});

test("filters today reminder list in Vietnam timezone", () => {
  const now = new Date("2026-08-28T05:06:00.000Z"); // 12:06 VN
  assert.equal(getListDateFilter("@Bot lịch thông báo hôm nay", now), "2026-08-28");
});

test("uses the visible mentioned person instead of an unrelated stale mention", () => {
  const text = "@Bot Thu Thập atess nhắc @Chị 3 nay đi lúc 12:10";
  const botStart = text.indexOf("@Bot Thu Thập atess");
  const userStart = text.indexOf("@Chị 3");
  const message = {
    chat: { id: "g1", chat_type: "GROUP" },
    mentions: [
      { user_id: "stale", display_name: "Nhật Hạ" },
      { user_id: "bot-id", pos: botStart, len: "@Bot Thu Thập atess".length },
      { user_id: "chi3", pos: userStart, len: "@Chị 3".length }
    ]
  };

  const target = detectTarget(message, text);
  assert.equal(target.mode, "user");
  assert.equal(target.uid, "chi3");
  assert.equal(target.name, "Chị 3");
});

test("cleans bot mention, target and time from reminder title", () => {
  const text = "@Bot Thu Thập atess nhắc @Chị 3 nay đi lúc 12:10";
  const message = {
    chat: { id: "g1", chat_type: "GROUP" },
    mentions: [
      { user_id: "bot-id", pos: 0, len: "@Bot Thu Thập atess".length },
      { user_id: "chi3", pos: text.indexOf("@Chị 3"), len: "@Chị 3".length }
    ]
  };
  const target = { mode: "user", uid: "chi3", name: "Chị 3" };
  const title = extractReminderTitle(text, target, message);
  assert.equal(title.toLowerCase(), "đi");
});
