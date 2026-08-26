import test from "node:test";
import assert from "node:assert/strict";
import { buildLinkAliases, detectEntityReference, normalizeMemoryText } from "../src/worker-v2.js";

test("normalizes Vietnamese chat abbreviations", () => {
  assert.equal(normalizeMemoryText("cái này k dc r"), "cai nay khong duoc roi");
  assert.equal(normalizeMemoryText("hqua ktra link"), "hom qua kiem tra link");
});

test("detects common entity references", () => {
  assert.equal(detectEntityReference("cái đầu bao nhiêu"), true);
  assert.equal(detectEntityReference("căn thứ 2 sao"), true);
  assert.equal(detectEntityReference("cái q7 có ban công k"), true);
  assert.equal(detectEntityReference("nó bao nhiêu"), true);
  assert.equal(detectEntityReference("thời tiết hôm nay"), false);
});

test("builds positional and district aliases", () => {
  const first = buildLinkAliases({ area_text: "Quận 7" }, 0);
  const second = buildLinkAliases({ area_text: "Bình Thạnh" }, 1);

  assert.ok(first.includes("cai dau"));
  assert.ok(first.includes("can q7"));
  assert.ok(second.includes("can 2"));
  assert.ok(second.includes("cai binh thanh"));
});
