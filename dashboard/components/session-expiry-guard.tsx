"use client";

import { useEffect } from "react";

const SESSION_KEY = "dashboardSession";
const LEGACY_TOKEN_KEY = "dashboardToken";

function getSessionExpiryMs(token: string) {
  const parts = String(token || "").split(".");

  if (parts.length < 2 || parts[0] !== "v1") {
    return null;
  }

  const expiresAtSeconds = Number(parts[1]);

  return Number.isFinite(expiresAtSeconds) ? expiresAtSeconds * 1000 : null;
}

export function SessionExpiryGuard() {
  useEffect(() => {
    let isReloading = false;

    const clearExpiredSession = () => {
      const token = sessionStorage.getItem(SESSION_KEY) || "";

      if (!token) {
        return;
      }

      const expiresAt = getSessionExpiryMs(token);

      if (expiresAt && Date.now() < expiresAt) {
        return;
      }

      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);

      if (!isReloading) {
        isReloading = true;
        window.location.reload();
      }
    };

    clearExpiredSession();

    const intervalId = window.setInterval(clearExpiredSession, 1000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        clearExpiredSession();
      }
    };

    window.addEventListener("focus", clearExpiredSession);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", clearExpiredSession);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
