"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";

const linkStyle = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 11px",
  borderRadius: 10,
  textDecoration: "none",
  color: active ? "#e2e8f0" : "#94a3b8",
  background: active ? "rgba(30,41,59,.95)" : "transparent",
  border: active ? "1px solid rgba(148,163,184,.24)" : "1px solid transparent",
  fontSize: 13,
  fontWeight: 700
});

type Connection = {
  id: string;
  display_name: string;
  enabled: number | boolean;
};

export function AdminNav() {
  const pathname = usePathname();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState("main");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelected(params.get("connection_id") || "main");

    const token = sessionStorage.getItem("dashboardSession") || "";
    if (!token) return;

    fetch("/api/admin/connections", {
      cache: "no-store",
      headers: { "X-Dashboard-Token": token }
    })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.ok && Array.isArray(payload.zalo_connections)) {
          setConnections(payload.zalo_connections.filter((row: Connection) => row.enabled === true || Number(row.enabled) === 1));
        }
      })
      .catch(() => {});
  }, [pathname]);

  const openBot = (connectionId: string) => {
    setSelected(connectionId);
    const target = connectionId === "main" ? "/" : `/?connection_id=${encodeURIComponent(connectionId)}`;
    window.location.href = target;
  };

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", justifyContent: "center", background: "rgba(2,6,23,.88)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(148,163,184,.12)" }}>
      <nav style={{ width: "100%", maxWidth: 1180, padding: "9px 18px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={selected === "main" ? "/" : `/?connection_id=${encodeURIComponent(selected)}`} style={linkStyle(pathname === "/")}><LayoutDashboard size={15} /> Dashboard</Link>
        <Link href="/connections" style={linkStyle(pathname.startsWith("/connections"))}><Bot size={15} /> Kết nối Zalo & AI</Link>
        {connections.length ? (
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>
            Dữ liệu bot
            <select
              value={selected}
              onChange={(event) => openBot(event.target.value)}
              style={{ borderRadius: 9, border: "1px solid rgba(148,163,184,.25)", background: "rgba(15,23,42,.95)", color: "#e2e8f0", padding: "7px 10px", minWidth: 170 }}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.display_name || connection.id}{connection.id === "main" ? " (chính)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </nav>
    </div>
  );
}
