import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanExplicitImageQuery,
  isContextualImageRequest,
  isImageReferenceQuestion,
  resolveContextualImageQuery,
  topicFromText
} from "../src/worker-v21.js";

test("image router does not resend an image when user only refers to previous image", () => {
  assert.equal(isImageReferenceQuestion("Em là ai mà gửi ảnh này"), true);
  assert.equal(isContextualImageRequest("Em là ai mà gửi ảnh này"), false);
  assert.equal(isContextualImageRequest("Sao em gửi ảnh này vậy"), false);
  assert.equal(isContextualImageRequest("Ảnh này là ai?"), false);
});

test("image router understands Vietnamese shorthand commands", () => {
  assert.equal(isContextualImageRequest("gửi a xem đi"), true);
  assert.equal(isContextualImageRequest("cho a coi"), true);
  assert.equal(isContextualImageRequest("gửi ảnh cây cối"), true);
  assert.equal(cleanExplicitImageQuery("gửi a xem đi"), "");
});

test("vague image request resolves from recent conversation context", () => {
  const result = resolveContextualImageQuery("gửi a xem đi", {
    profile: { gender: "nữ", persona: "trợ lý nữ" },
    recent: [
      { user_id: "__bot__:main", text: "Em đang nói về bộ đồ thời trang em vừa nhắc tới." },
      { user_id: "u1", text: "cho anh xem thử" }
    ],
    memories: []
  });
  assert.equal(result.query, "adult fashion portrait");
  assert.equal(result.reason, "recent_context");
});

test("persona is used instead of a random unrelated image when context is vague", () => {
  const result = resolveContextualImageQuery("gửi a xem đi", {
    profile: { gender: "nữ", persona: "trợ lý nữ" },
    recent: [],
    memories: []
  });
  assert.equal(result.query, "adult woman portrait fashion");
  assert.equal(result.reason, "persona");
});

test("topic mapper keeps common Vietnamese subjects searchable", () => {
  assert.equal(topicFromText("gửi ảnh cây cối xanh đi"), "trees nature");
  assert.equal(topicFromText("mèo dễ thương"), "cat");
  assert.equal(topicFromText("căn hộ đẹp"), "apartment interior");
});
