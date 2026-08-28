import test from "node:test";
import assert from "node:assert/strict";

import {
  hasHousingSignals,
  isExplicitWebIntent,
  isOperationalBotCommand,
  retryDelayMinutes
} from "../src/worker-v28.js";

test("detects explicit external web search intent", () => {
  assert.equal(isExplicitWebIntent("kiếm ở ngoài trên web đi"), true);
  assert.equal(isExplicitWebIntent("tìm phòng trọ gần Gigamall"), true);
});

test("detects housing context signals", () => {
  assert.equal(hasHousingSignals("đang tìm nhà thuê quận 7"), true);
  assert.equal(hasHousingSignals("hello"), false);
});

test("does not steal reminder commands", () => {
  assert.equal(isOperationalBotCommand("@Bot lịch thông báo hôm nay"), true);
  assert.equal(isOperationalBotCommand("@Bot nhắc @Chị 3 lúc 14:00"), true);
});

test("uses progressive retry backoff capped at one hour", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map(retryDelayMinutes),
    [1, 2, 5, 10, 20, 30, 60, 60]
  );
});
