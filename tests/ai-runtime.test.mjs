import assert from "node:assert/strict";
import test from "node:test";

import { getConfiguredModels, isAiRuntimeQuestion } from "../src/worker-v5.js";

test("detects AI/provider/model identity questions", () => {
  assert.equal(isAiRuntimeQuestion("Đang sài model AI của ai"), true);
  assert.equal(isAiRuntimeQuestion("model gì vậy"), true);
  assert.equal(isAiRuntimeQuestion("đang dùng Gemini hay OpenAI"), true);
  assert.equal(isAiRuntimeQuestion("/model"), true);
});

test("does not hijack unrelated AI questions", () => {
  assert.equal(isAiRuntimeQuestion("AI quota hôm nay còn bao nhiêu"), false);
  assert.equal(isAiRuntimeQuestion("giải thích AI là gì"), false);
  assert.equal(isAiRuntimeQuestion("thời tiết hôm nay"), false);
});

test("reports configured Gemini models without exposing secrets", () => {
  const models = getConfiguredModels({
    GEMINI_MODEL: "gemini-custom-chat",
    GEMINI_SEARCH_MODEL: "gemini-custom-search",
    GEMINI_IMAGE_MODEL: "gemini-custom-image",
    GEMINI_FALLBACK_MODELS: "fallback-a,fallback-b"
  });

  assert.equal(models.general, "gemini-custom-chat");
  assert.equal(models.search, "gemini-custom-search");
  assert.equal(models.image, "gemini-custom-image");
  assert.deepEqual(models.fallbacks, [
    "gemini-custom-chat",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite",
    "fallback-a",
    "fallback-b"
  ]);
});
