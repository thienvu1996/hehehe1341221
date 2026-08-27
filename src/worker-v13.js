import workerV12 from "./worker-v12.js";
import { parseZaloWebhookPath } from "./zalo-connections.js";
import { processPendingMemoryPipelines, queueMemoryEvent } from "./memory-v3.js";

function getMemoryPayload(body) {
  const event = body?.result || body;
  const message = event?.message;
  if (!event || !message?.chat?.id) return null;
  return {
    eventName: String(event.event_name || ""),
    message
  };
}

function isMemoryEvent(eventName) {
  return ["message.text.received", "message.image.received"].includes(String(eventName || ""));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const webhook = parseZaloWebhookPath(url.pathname);
    let memoryPayloadPromise = null;

    if (request.method === "POST" && webhook) {
      memoryPayloadPromise = request.clone().json().catch(() => null);
    }

    const response = await workerV12.fetch(request, env, ctx);

    if (memoryPayloadPromise && response.ok) {
      const body = await memoryPayloadPromise;
      const payload = getMemoryPayload(body);
      if (payload && isMemoryEvent(payload.eventName)) {
        const job = queueMemoryEvent(env, webhook.connectionId, payload.eventName, payload.message).catch((error) => {
          console.error("Memory V3 event pipeline failed:", error);
        });
        if (ctx?.waitUntil) ctx.waitUntil(job);
        else await job;
      }
    }

    return response;
  },

  async scheduled(event, env, ctx) {
    const memoryJob = processPendingMemoryPipelines(env).catch((error) => {
      console.error("Memory V3 scheduled pipeline failed:", error);
    });
    if (ctx?.waitUntil) ctx.waitUntil(memoryJob);

    if (typeof workerV12.scheduled === "function") {
      return workerV12.scheduled(event, env, ctx);
    }

    return memoryJob;
  }
};

export { getMemoryPayload, isMemoryEvent };
