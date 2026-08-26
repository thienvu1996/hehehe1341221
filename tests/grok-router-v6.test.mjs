import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseGrokModel,
  getGrokConfig,
  isAiRuntimeQuestion,
  isSpecialBaseFlow,
  shouldUseGrokForMessage
} from "../src/worker-v6.js";

test("routes normal private chat to Grok", () => {
  const message = { chat: { chat_type: "PRIVATE" } };
  assert.equal(shouldUseGrokForMessage(message, "nay hôm nay sao rồi"), true);
});

test("keeps deterministic/tool flows on existing worker", () => {
  assert.equal(isSpecialBaseFlow("thời tiết HCM hôm nay"), true);
  assert.equal(isSpecialBaseFlow("https://example.com/can-ho"), true);
  assert.equal(isSpecialBaseFlow("nhắc tôi mai 9h họp"), true);
  assert.equal(isSpecialBaseFlow("tìm nhà q7 8tr"), true);
});

test("selects Grok models by task", () => {
  const env = {};
  assert.equal(chooseGrokModel("chào bạn", env), "grok-4.6");
  assert.equal(chooseGrokModel("sửa code SQL này giúp tôi", env), "coding-agent");
  assert.equal(chooseGrokModel("tại sao chuyện này xảy ra, phân tích sâu", env), "grok-4.6-high");
});

test("supports runtime model identity questions", () => {
  assert.equal(isAiRuntimeQuestion("/model"), true);
  assert.equal(isAiRuntimeQuestion("đang xài model AI của ai"), true);
  assert.equal(isAiRuntimeQuestion("ăn gì tối nay"), false);
});

test("allows model overrides without changing secret", () => {
  const config = getGrokConfig({
    NEXUS_API_BASE_URL: "https://gateway.example/v1/",
    GROK_MODEL: "grok-chat-custom",
    GROK_REASONING_MODEL: "grok-reason-custom",
    GROK_CODE_MODEL: "code-custom"
  });

  assert.deepEqual(config, {
    baseUrl: "https://gateway.example/v1",
    chatModel: "grok-chat-custom",
    reasoningModel: "grok-reason-custom",
    codeModel: "code-custom"
  });
});
