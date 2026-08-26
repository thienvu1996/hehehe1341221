const BOT_API_ORIGIN = "https://bot.jean1331.io.vn";
const ALLOWED_API_PATHS = new Set([
  "/admin/dashboard-session",
  "/admin/dashboard-data",
  "/admin/bot-profile",
  "/admin/connections",
  "/admin/ai-permissions"
]);
const ALLOWED_API_PREFIXES = [
  "/admin/zalo-connections",
  "/admin/ai-providers",
  "/admin/ai-api-keys",
  "/admin/ai-permissions"
];

function isAllowedApiPath(path) {
  return ALLOWED_API_PATHS.has(path) || ALLOWED_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function getRefererConnectionId(request) {
  const referer = request.headers.get("referer") || "";
  if (!referer) return "";
  try {
    return new URL(referer).searchParams.get("connection_id") || "";
  } catch {
    return "";
  }
}

async function proxyBotApi(request, url) {
  const botPath = url.pathname.replace(/^\/api/, "") || "/";

  if (!isAllowedApiPath(botPath)) {
    return new Response(JSON.stringify({ message: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const target = new URL(BOT_API_ORIGIN);
  target.pathname = botPath;
  target.search = url.search;

  if (
    (botPath === "/admin/dashboard-data" || botPath === "/admin/bot-profile") &&
    !target.searchParams.has("connection_id")
  ) {
    const connectionId = getRefererConnectionId(request);
    if (connectionId) target.searchParams.set("connection_id", connectionId);
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  return fetch(target.toString(), {
    method: request.method,
    headers,
    body,
    redirect: "manual"
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await proxyBotApi(request, url);
      } catch (error) {
        console.error("Dashboard API proxy failed:", error);
        return new Response(
          JSON.stringify({
            message: "Dashboard API proxy failed",
            error: String(error?.message || error)
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
