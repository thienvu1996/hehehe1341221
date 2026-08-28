import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMentionForText,
  isVisibleTarget,
  parseVietnamDueAtStrict
} from "../src/worker-v27.js";

test("parses Vietnam local time to exact UTC", () => {
  const now = new Date("2026-08-28T05:05:00.000Z"); // 12:05 VN
  const due = parseVietnamDueAtStrict("@Bot nhắc @Chị 3 nay đi lúc 12:10", now);
  assert.equal(due.ok, true);
  assert.equal(due.localDate, "2026-08-28");
  assert.equal(due.localTime, "12:10");
  assert.equal(due.dueAt.toISOString(), "2026-08-28T05:10:00.000Z");
});

test("rejects an explicit today time that already passed", () => {
  const now = new Date("2026-08-28T06:40:00.000Z"); // 13:40 VN
  const due = parseVietnamDueAtStrict("@Bot nhắc @Chị 3 hôm nay lúc 12:10 đi", now);
  assert.equal(due.ok, false);
  assert.equal(due.reason, "past_time");
  assert.equal(due.nowLocalTime, "13:40");
});

test("rolls an unspecified past time to tomorrow", () => {
  const now = new Date("2026-08-28T06:40:00.000Z"); // 13:40 VN
  const due = parseVietnamDueAtStrict("@Bot nhắc @Chị 3 lúc 12:10 đi", now);
  assert.equal(due.ok, true);
  assert.equal(due.localDate, "2026-08-29");
  assert.equal(due.localTime, "12:10");
});

test("requires the selected user to be visibly mentioned in the current text", () => {
  assert.equal(
    isVisibleTarget("@Bot nhắc @Chị 3 lúc 14:00", { mode: "user", uid: "chi3", name: "Chị 3" }),
    true
  );
  assert.equal(
    isVisibleTarget("@Bot nhắc @Chị 3 lúc 14:00", { mode: "user", uid: "nhatha", name: "Nhật Hạ" }),
    false
  );
});

test("builds native mention for the same user id and display name", () => {
  const text = "Đã đặt lịch ✅\n14:00 28/08/2026 → @Chị 3\nđi";
  const mentions = buildMentionForText(text, { mode: "user", uid: "chi3", name: "Chị 3" });
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].uid, "chi3");
  assert.equal(text.slice(mentions[0].pos, mentions[0].pos + mentions[0].len), "@Chị 3");
});
