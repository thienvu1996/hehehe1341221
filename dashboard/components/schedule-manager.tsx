"use client";

import { CalendarClock, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Connection = {
  id: string;
  display_name: string;
  enabled: number | boolean;
};

type WeatherSchedule = {
  chat_id: string;
  chat_type: string;
  chat_title: string;
  user_name: string;
  weather_enabled: number | boolean;
  weather_time: string;
  weather_location: string;
  timezone: string;
};

type Reminder = {
  id: string;
  chat_id: string;
  chat_type: string;
  chat_title: string;
  user_name: string;
  title: string;
  due_local_date: string;
  due_local_time: string;
  timezone: string;
  status: string;
};

type SchedulePayload = {
  ok: boolean;
  connection_id: string;
  settings: WeatherSchedule[];
  reminders: Reminder[];
  message?: string;
};

const button: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.25)",
  borderRadius: 10,
  padding: "9px 12px",
  background: "rgba(15,23,42,.94)",
  color: "#e2e8f0",
  cursor: "pointer",
  display: "inline-flex",
  gap: 7,
  alignItems: "center"
};

const input: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,.3)",
  background: "rgba(2,6,23,.8)",
  color: "#e2e8f0",
  padding: "10px 12px"
};

function bool(value: unknown) {
  return value === true || Number(value) === 1;
}

function chatLabel(row: { chat_title?: string; chat_id?: string }) {
  return row.chat_title || (row.chat_id ? `Chat ${row.chat_id.slice(0, 10)}...` : "Chưa rõ chat");
}

export function ScheduleManager() {
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState("main");
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const session = typeof window === "undefined" ? "" : sessionStorage.getItem("dashboardSession") || "";

  const request = async (path: string, init: RequestInit = {}) => {
    const token = sessionStorage.getItem("dashboardSession") || "";
    const response = await fetch(`/api${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Token": token,
        ...(init.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.message || `HTTP ${response.status}`);
    return payload;
  };

  const loadConnections = async () => {
    const payload = await request("/admin/connections");
    const rows = (payload.zalo_connections || []).filter((row: Connection) => bool(row.enabled));
    setConnections(rows);
    const urlConnection = new URLSearchParams(window.location.search).get("connection_id") || "";
    const next = rows.some((row: Connection) => row.id === urlConnection)
      ? urlConnection
      : rows.some((row: Connection) => row.id === selected)
        ? selected
        : (rows[0]?.id || "main");
    setSelected(next);
    return next;
  };

  const loadSchedules = async (connectionId = selected) => {
    const payload = await request(`/admin/schedules?connection_id=${encodeURIComponent(connectionId)}`);
    setData(payload);
  };

  const reload = async () => {
    if (!sessionStorage.getItem("dashboardSession")) return;
    setBusy(true);
    setError("");
    try {
      const next = await loadConnections();
      await loadSchedules(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được lịch.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  useEffect(() => {
    if (!open || !selected) return;
    setBusy(true);
    setError("");
    void loadSchedules(selected)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không tải được lịch."))
      .finally(() => setBusy(false));
  }, [selected]);

  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const payload = await request("/admin/schedules", {
        method: "POST",
        body: JSON.stringify({ connection_id: selected, ...body })
      });
      setData(payload);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Không cập nhật được lịch.");
    } finally {
      setBusy(false);
    }
  };

  const activeWeather = useMemo(() => (data?.settings || []).filter((row) => bool(row.weather_enabled)), [data]);
  const pendingReminders = useMemo(() => (data?.reminders || []).filter((row) => row.status === "pending"), [data]);

  if (!session) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ ...button, position: "fixed", right: 18, bottom: 18, zIndex: 900, boxShadow: "0 12px 35px rgba(0,0,0,.35)" }}
      >
        <CalendarClock size={17} /> Quản lý lịch
      </button>

      {open ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2,6,23,.76)", display: "grid", placeItems: "center", padding: 18 }}>
          <section style={{ width: "min(980px,96vw)", maxHeight: "90vh", overflow: "auto", border: "1px solid rgba(148,163,184,.24)", borderRadius: 18, background: "#0b1420", color: "#e2e8f0", boxShadow: "0 24px 80px rgba(0,0,0,.55)" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 16, background: "#0b1420", borderBottom: "1px solid rgba(148,163,184,.16)" }}>
              <div>
                <div style={{ color: "#38bdf8", fontSize: 12, fontWeight: 800 }}>SCHEDULE CONTROL</div>
                <h2 style={{ margin: "3px 0 0" }}>Hủy / tắt lịch bot</h2>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={button} onClick={() => void reload()} disabled={busy}>{busy ? <Loader2 size={16} /> : <RefreshCw size={16} />} Nạp lại</button>
                <button style={{ ...button, padding: 9 }} onClick={() => setOpen(false)}><X size={17} /></button>
              </div>
            </div>

            <div style={{ padding: 16, display: "grid", gap: 18 }}>
              <label style={{ display: "grid", gap: 6, maxWidth: 360 }}>
                <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>Bot</span>
                <select style={input} value={selected} onChange={(event) => setSelected(event.target.value)}>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>{connection.display_name || connection.id}{connection.id === "main" ? " · Bot chính" : ""}</option>
                  ))}
                </select>
              </label>

              {error ? <div style={{ color: "#fca5a5", border: "1px solid rgba(239,68,68,.28)", borderRadius: 10, padding: 10 }}>{error}</div> : null}

              <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                  <div><b>Lịch thời tiết đang bật</b> <span style={{ color: "#64748b" }}>({activeWeather.length})</span></div>
                  {activeWeather.length ? (
                    <button
                      style={{ ...button, color: "#fca5a5" }}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Tắt toàn bộ ${activeWeather.length} lịch thời tiết của bot này?`)) void mutate({ action: "weather_disable_all" });
                      }}
                    ><Trash2 size={15} /> Tắt tất cả</button>
                  ) : null}
                </div>
                {!activeWeather.length ? <div style={{ color: "#64748b" }}>Không có lịch thời tiết đang bật.</div> : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {activeWeather.map((row) => (
                      <div key={row.chat_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 11, borderRadius: 11, background: "rgba(15,23,42,.7)" }}>
                        <div>
                          <b>{chatLabel(row)}</b>
                          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3 }}>{row.weather_time || "06:00"} · {row.weather_location || "TP Hồ Chí Minh"} · {row.chat_type || "CHAT"}</div>
                        </div>
                        <button
                          style={{ ...button, color: "#fca5a5", flexShrink: 0 }}
                          disabled={busy}
                          onClick={() => void mutate({ action: "weather_set", chat_id: row.chat_id, enabled: false })}
                        ><Trash2 size={15} /> Hủy lịch</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                  <div><b>Lịch nhắc việc đang chờ</b> <span style={{ color: "#64748b" }}>({pendingReminders.length})</span></div>
                  {pendingReminders.length ? (
                    <button
                      style={{ ...button, color: "#fca5a5" }}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Hủy toàn bộ ${pendingReminders.length} lịch nhắc việc đang chờ của bot này?`)) void mutate({ action: "reminders_cancel_all" });
                      }}
                    ><Trash2 size={15} /> Hủy tất cả</button>
                  ) : null}
                </div>
                {!pendingReminders.length ? <div style={{ color: "#64748b" }}>Không có lịch nhắc việc đang chờ.</div> : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {pendingReminders.map((row) => (
                      <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 11, borderRadius: 11, background: "rgba(15,23,42,.7)" }}>
                        <div>
                          <b>{row.title || "Việc đã hẹn"}</b>
                          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3 }}>{row.due_local_time || "??:??"} {row.due_local_date || ""} · {chatLabel(row)}</div>
                        </div>
                        <button
                          style={{ ...button, color: "#fca5a5", flexShrink: 0 }}
                          disabled={busy}
                          onClick={() => void mutate({ action: "reminder_cancel", reminder_id: row.id, chat_id: row.chat_id })}
                        ><Trash2 size={15} /> Hủy nhắc</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
