import test from "node:test";
import assert from "node:assert/strict";

import { orderProviderIds } from "../src/web-routing.js";
import { orderGroupsByRoute, providerSupportsNativeSearch } from "../src/worker-v15.js";

test("per-bot web route respects explicit provider priority", () => {
  assert.deepEqual(
    orderProviderIds(["env-gemini", "nexus-grok"], ["nexus-grok", "env-gemini", "other"], false),
    ["env-gemini", "nexus-grok"]
  );
});

test("native web search detection distinguishes Gemini/xAI from Nexus chat gateway", () => {
  assert.equal(providerSupportsNativeSearch({ provider_type: "gemini", base_url: "https://generativelanguage.googleapis.com/v1beta" }), true);
  assert.equal(providerSupportsNativeSearch({ provider_type: "openai_compatible", base_url: "https://api.x.ai/v1" }), true);
  assert.equal(providerSupportsNativeSearch({ provider_type: "openai_compatible", base_url: "https://api.nexusapi.co/v1", capabilities: ["chat"] }), false);
});

test("search routing only keeps search-capable providers in chosen order", () => {
  const groups = [
    { id: "nexus-grok", provider_type: "openai_compatible", type: "openai_compatible", baseUrl: "https://api.nexusapi.co/v1", capabilities: ["chat"] },
    { id: "env-gemini", provider_type: "gemini", type: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", capabilities: ["chat", "search"] },
    { id: "xai-direct", provider_type: "openai_compatible", type: "openai_compatible", baseUrl: "https://api.x.ai/v1", capabilities: ["chat", "search"] }
  ];
  const routed = orderGroupsByRoute(groups, ["xai-direct", "env-gemini"], true);
  assert.deepEqual(routed.map((row) => row.id), ["xai-direct", "env-gemini"]);
});
