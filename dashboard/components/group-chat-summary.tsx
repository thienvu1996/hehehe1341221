"use client";

import { AlertTriangle, Bot, Clock3, Loader2, MessageCircleMore, RefreshCw, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type MessageRow = {
  id: number;
  chat_id: string;
  chat_title: string;
  user_name: string;
  text: string;
  created_at: string;
};

type GroupRow = {
  chat_id: string;
  chat_title: string;
  message_count: number;
  participant_count: number;
  participants: string[];
  last_message_at: string;
  recent: MessageRow[];
};

type SummaryRow = {
  summary: string;
  provider: string;
  model: string;
  message_count: number;
  group_count: number;
  created_at: string;
};

type Payload = {
  ok: boolean;
  message?: string;
  note?: string;
  connection_id: string;
  hours: number;
  message_count: number;
  group_count: number;
  groups: GroupRow[];
  latest_summary?: SummaryRow | null;
  summary?: string;
  provider?: string;
  model?: string;
};

const panel: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.18)",
  background: "rgba(8,18,28,.82)",
  borderRadius: 16,
  padding: 18
};

function fmt(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(date);
}

function connectionFromUrl() {
  if (typeof window === "undefined") return "main";
  return new URLSearchParams(window.location.search).get("connection_id") || "main";
}

export function GroupChatSummary() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");
  const connectionId = useMemo(() => connectionFromUrl(), []);

  const request = async (generate = false) => {
    const token = sessionStorage.getItem("dashboardSession") || "";
    if (!token) {
      setError("Chưa có dashboard session. Về Dashboard và nhập key trước.");
      setLoading(false);
      return;
    }

    if (generate) setSummarizing(true);
    else setLoading(true);
    setError("");

    try {
      const path = `/api/admin/chat-summary?connection_id=${encodeURIComponent(connectionId)}&hours=${hours}`;
      const response = await fetch(path, {
        method: generate ? "POST" : "GET",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Token": token
        },
        body: generate ? JSON.stringify({ connection_id: connectionId, hours }) : undefined
      });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok || !payload.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      if (generate) {
        setData((current) => ({
          ...(current || payload),
          ...payload,
          latest_summary: payload.summary
            ? {
                summary: payload.summary,
                provider: payload.provider || "",
                model: payload.model || "",
                message_count: payload.message_count || 0,
                group_count: payload.group_count || 0,
                created_at: new Date().toISOString()
              }
            : current?.latest_summary
        }));
      } else {
        setData(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu chat.");
    } finally {
      setLoading(false);
      setSummarizing(false);
    }
  };

  useEffect(() => {
    void request(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, connectionId]);

  const summary = data?.latest_summary;

  return (
    <main style={{ minHeight: "100vh", padding: "28px 20px 70px", color: "#e5eef7" }}>
      <div style={{ width: "100%", maxWidth: 1180, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", gap: 14, alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, color: "#5eead4", fontSize: 12, fontWeight: 800, letterSpacing: 1.2 }}>GROUP WORK INTEL</p>
            <h1 style={{ margin: "4px 0 4px", fontSize: 34 }}>Chat tổng hợp</h1>
            <p style={{ margin: 0, color: "#94a3b8" }}>Gom các tin group mà Zalo đã chuyển tới bot, rồi tổng hợp công việc bằng AI.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              style={{ borderRadius: 10, padding: "9px 12px", background: "#0f172a", color: "#e2e8f0", border: "1px solid rgba(148,163,184,.24)" }}
            >
              <option value={24}>24 giờ</option>
              <option value={72}>3 ngày</option>
              <option value={168}>7 ngày</option>
              <option value={720}>30 ngày</option>
            </select>
            <button type="button" onClick={() => void request(false)} disabled={loading} style={{ borderRadius: 10, padding: "9px 13px", background: "#111827", color: "#e2e8f0", border: "1px solid rgba(148,163,184,.24)", cursor: "pointer" }}>
              <RefreshCw size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Nạp lại
            </button>
            <button type="button" onClick={() => void request(true)} disabled={summarizing || !data?.message_count} style={{ borderRadius: 10, padding: "9px 13px", background: "linear-gradient(135deg,#7c3aed,#2563eb)", color: "white", border: 0, fontWeight: 800, cursor: "pointer" }}>
              {summarizing ? <Loader2 size={15} className="spin" style={{ verticalAlign: "-2px", marginRight: 6 }} /> : <Sparkles size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />}
              {summarizing ? "Đang tổng hợp..." : "Tổng hợp bằng AI"}
            </button>
          </div>
        </header>

        <section style={{ ...panel, borderColor: "rgba(245,158,11,.45)", background: "rgba(120,53,15,.12)", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={19} color="#fbbf24" style={{ flex: "0 0 auto", marginTop: 2 }} />
          <div>
            <strong>Giới hạn của Zalo Bot trong group</strong>
            <p style={{ margin: "5px 0 0", color: "#cbd5e1", lineHeight: 1.55 }}>
              Bot chỉ lưu được tin mà Zalo thực tế gửi tới webhook. Nếu Zalo không chuyển một tin group tới Bot API thì Worker không thể tự quét lại tin đó. Trang này không giả định dữ liệu đã đủ 100% hội thoại.
            </p>
          </div>
        </section>

        {error ? <section style={{ ...panel, borderColor: "rgba(248,113,113,.45)", color: "#fecaca" }}>{error}</section> : null}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <div style={panel}><MessageCircleMore size={18} color="#38bdf8" /><div style={{ fontSize: 30, fontWeight: 900, marginTop: 8 }}>{data?.message_count ?? 0}</div><div style={{ color: "#94a3b8" }}>Tin group đã thu thập</div></div>
          <div style={panel}><Users size={18} color="#34d399" /><div style={{ fontSize: 30, fontWeight: 900, marginTop: 8 }}>{data?.group_count ?? 0}</div><div style={{ color: "#94a3b8" }}>Nhóm có dữ liệu</div></div>
          <div style={panel}><Clock3 size={18} color="#fbbf24" /><div style={{ fontSize: 30, fontWeight: 900, marginTop: 8 }}>{hours}h</div><div style={{ color: "#94a3b8" }}>Khoảng tổng hợp</div></div>
          <div style={panel}><Bot size={18} color="#c084fc" /><div style={{ fontSize: 16, fontWeight: 900, marginTop: 14 }}>{connectionId}</div><div style={{ color: "#94a3b8" }}>Bot đang xem</div></div>
        </section>

        <section style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div><p style={{ margin: 0, color: "#c084fc", fontSize: 12, fontWeight: 800 }}>AI SUMMARY</p><h2 style={{ margin: "4px 0 0" }}>Tổng hợp công việc</h2></div>
            {summary ? <span style={{ color: "#94a3b8", fontSize: 12 }}>{summary.provider} / {summary.model} · {fmt(summary.created_at)}</span> : null}
          </div>
          <div style={{ marginTop: 14, whiteSpace: "pre-wrap", lineHeight: 1.65, color: summary ? "#e2e8f0" : "#94a3b8" }}>
            {summary?.summary || (loading ? "Đang tải..." : "Chưa có bản tổng hợp. Bấm “Tổng hợp bằng AI”.")}
          </div>
        </section>

        <section style={{ display: "grid", gap: 12 }}>
          {(data?.groups || []).map((group) => (
            <article key={group.chat_id} style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><h3 style={{ margin: 0 }}>{group.chat_title || group.chat_id}</h3><div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>{group.message_count} tin · {group.participant_count} người · cập nhật {fmt(group.last_message_at)}</div></div>
                {group.participants?.length ? <div style={{ color: "#94a3b8", fontSize: 12 }}>{group.participants.slice(0, 6).join(", ")}</div> : null}
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {(group.recent || []).slice(0, 8).map((row) => (
                  <div key={row.id} style={{ padding: "9px 11px", borderRadius: 10, background: "rgba(15,23,42,.72)", border: "1px solid rgba(148,163,184,.1)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: "#94a3b8", fontSize: 11 }}><strong style={{ color: "#a7f3d0" }}>{row.user_name || "Người dùng"}</strong><span>{fmt(row.created_at)}</span></div>
                    <div style={{ marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{row.text || "(không có text)"}</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {!loading && !(data?.groups || []).length ? <section style={panel}>Chưa có tin group nào được Zalo chuyển tới bot trong khoảng này.</section> : null}
        </section>
      </div>
    </main>
  );
}
