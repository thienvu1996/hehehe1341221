const BOT_API_ORIGIN = "https://bot.jean1331.io.vn";
const ALLOWED_API_PATHS = new Set([
  "/admin/dashboard-session",
  "/admin/dashboard-data",
  "/admin/bot-profile"
]);

async function proxyBotApi(request, url) {
  const botPath = url.pathname.replace(/^\/api/, "") || "/";

  if (!ALLOWED_API_PATHS.has(botPath)) {
    return new Response(JSON.stringify({ message: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const target = new URL(BOT_API_ORIGIN);
  target.pathname = botPath;
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");

  return fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return proxyBotApi(request, url);
    }

    return env.ASSETS.fetch(request);
  }
};
