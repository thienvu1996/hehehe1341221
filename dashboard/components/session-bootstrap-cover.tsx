"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const SESSION_KEY = "dashboardSession";

export function SessionBootstrapCover() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_KEY) || "";

    // Không có session thì cho hiện form đăng nhập ngay.
    if (!token) {
      setVisible(false);
      return;
    }

    let stopped = false;
    let timerId = 0;
    const startedAt = Date.now();

    const checkReady = () => {
      if (stopped) return;

      const currentToken = sessionStorage.getItem(SESSION_KEY) || "";
      const dashboard = document.querySelector(".dashboard-shell");
      const apiChip = document.querySelector(".api-chip");
      const loadingText = apiChip?.textContent || "";

      // Session bị backend từ chối: DashboardApp/guard sẽ xóa token,
      // lúc đó mới cho hiện form nhập key.
      if (!currentToken) {
        setVisible(false);
        return;
      }

      // Chỉ bỏ lớp che khi dashboard đã phục hồi session và có dữ liệu.
      if (dashboard && apiChip && !/Dang tai/i.test(loadingText)) {
        setVisible(false);
        return;
      }

      // Không khóa màn hình vô hạn nếu mạng/API có vấn đề.
      if (Date.now() - startedAt > 8000) {
        setVisible(false);
        return;
      }

      timerId = window.setTimeout(checkReady, 50);
    };

    timerId = window.setTimeout(checkReady, 0);

    return () => {
      stopped = true;
      window.clearTimeout(timerId);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Đang khôi phục phiên dashboard"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        display: "grid",
        placeItems: "center",
        background: "#07111b",
        color: "#cbd5e1"
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 12 }}>
        <Loader2 size={26} className="spin" />
        <div style={{ fontSize: 13, fontWeight: 700 }}>Đang khôi phục phiên dashboard...</div>
      </div>
    </div>
  );
}
