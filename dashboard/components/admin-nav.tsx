"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LayoutDashboard } from "lucide-react";

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

export function AdminNav() {
  const pathname = usePathname();
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", justifyContent: "center", background: "rgba(2,6,23,.88)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(148,163,184,.12)" }}>
      <nav style={{ width: "100%", maxWidth: 1180, padding: "9px 18px", display: "flex", gap: 8 }}>
        <Link href="/" style={linkStyle(pathname === "/")}><LayoutDashboard size={15} /> Dashboard</Link>
        <Link href="/connections" style={linkStyle(pathname.startsWith("/connections"))}><Bot size={15} /> Kết nối Zalo & AI</Link>
      </nav>
    </div>
  );
}
