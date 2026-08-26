"use client";

import { useEffect } from "react";

const SESSION_KEY = "dashboardSession";
const LEGACY_TOKEN_KEY = "dashboardToken";
const API_BASE_URL = process.env.NEXT_PUBLIC_BOT_API_URL || "https://bot.jean1331.io.vn";
const KEEPALIVE_INTERVAL_MS = 2 * 60 * 1000;

export function SessionExpiryGuard() {
  useEffect(() => {
    let isReloading = false;
    let keepAliveRunning = false;

    const clearSessionAndReload = () => {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);

      if (!isReloading) {
        isReloading = true;
        window.location.reload();
      }
    };

    const keepSessionAlive = async () => {
      if (keepAliveRunning) {
        return;
      }

      const token = sessionStorage.getItem(SESSION_KEY) || "";

      if (!token) {
        return;
      }

      keepAliveRunning = true;

      try {
        const response = await fetch(`${API_BASE_URL}/admin/dashboard-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ token }),
          cache: "no-store"
        });

        if (response.status === 401 || response.status === 403) {
          clearSessionAndReload();
        }
      } catch {
        // Lỗi mạng tạm thời không tự đăng xuất; lần keepalive sau sẽ thử lại.
      } finally {
        keepAliveRunning = false;
      }
    };

    void keepSessionAlive();

    const intervalId = window.setInterval(() => {
      void keepSessionAlive();
    }, KEEPALIVE_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void keepSessionAlive();
      }
    };

    const handleFocus = () => {
      void keepSessionAlive();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
