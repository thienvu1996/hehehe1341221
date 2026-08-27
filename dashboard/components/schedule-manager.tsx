"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, RefreshCw, Trash2, X } from "lucide-react";
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

type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

const OPEN_KEY = "scheduleManagerOpen";
const BOT_KEY = "scheduleManagerBot";

const button: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.25)",
  borderRadius: 10,
  padding: "9px 12px",
  background: "rgba(15,23,42,.94)",
  color: "#e2e8f0",
  cursor: "pointer",
  display: "inline-flex",
  gap: 7,
  alignItems: "center",
  justifyContent: "center",
  transition: "transform .15s ease, border-color .15s ease, background .15s ease"
};

const dangerButton: React.CSSProperties = {
  ...button,
  color: "#fecaca",
  border: "1px solid rgba(248,113,113,.34)",
  background: "rgba(127,29,29,.28)"
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
  const [notice, setNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

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

  useEffect(() => {
    const rememberedBot = sessionStorage.getItem(BOT_KEY) || "";
    const urlBot = new URLSearchParams(window.location.search).get("connection_id") || "";
    setSelected(urlBot || rememberedBot || "main");
    if (sessionStorage.getItem(OPEN_KEY) === "1") setOpen(true);
  }, []);

  useEffect(() => {
    sessionStorage.setItem(BOT_KEY, selected);
  }, [selected]);

  useEffect(() => {
    sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
  }, [open]);

  const loadConnections = async () => {
    const payload = await request("/admin/connections");
    const rows = (payload.zalo_connections || []).filter((row: Connection) => bool(row.enabled));
    setConnections(rows);
    const urlConnection = new URLSearchParams(window.location.search).get("connection_id") || "";
    const remembered = sessionStorage.getItem(BOT_KEY) || "";
    const wanted = urlConnection || remembered || selected;
    const next = rows.some((row: Connection) => row.id === wanted)
      ? wanted
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
    setNotice("");
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
    setNotice("");
    void loadSchedules(selected)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không tải được lịch."))
      .finally(() => setBusy(false));
  }, [selected]);

  const mutate = async (
    body: Record<string, unknown>,
    optimistic: (current: SchedulePayload) => SchedulePayload,
    successMessage: string
  ) => {
    const before = data;
    setBusy(true);
    setError("");
    setNotice("");
    if (before) setData(optimistic(before));

    try {
      const payload = await request("/admin/schedules", {
        method: "POST",
        body: JSON.stringify({ connection_id: selected, ...body })
      });
      setData(payload);
      setNotice(successMessage);
      window.dispatchEvent(new CustomEvent("dashboard:schedules-updated", { detail: { connection_id: selected } }));
    } catch (actionError) {
      if (before) setData(before);
      setError(actionError instanceof Error ? actionError.message : "Không cập nhật được lịch.");
    } finally {
      setBusy(false);
    }
  };

  const activeWeather = useMemo(() => (data?.settings || []).filter((row) => bool(row.weather_enabled)), [data]);
  const pendingReminders = useMemo(() => (data?.reminders || []).filter((row) => row.status === "pending"), [data]);

  const ask = (action: ConfirmAction) => {
    setConfirmAction(action);
    setError("");
    setNotice("");
  };

  const runConfirmed = async () => {
    const action = confirmAction;
    if (!action || busy) return;
    setConfirmAction(null);
    await action.run();
  };

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
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2,6,23,.76)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 18 }}>
          <section style={{ width: "min(980px,96vw)", maxHeight: "90vh", overflow: "auto", border: "1px solid rgba(148,163,184,.24)", borderRadius: 18, background: "#0b1420", color: "#e2e8f0", boxShadow: "0 24px 80px rgba(0,0,0,.55)" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 16, background: "rgba(11,20,32,.96)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(148,163,184,.16)" }}>
              <div>
                <div style={{ color: "#38bdf8", fontSize: 12, fontWeight: 800 }}>SCHEDULE CONTROL</div>
                <h2 style={{ margin: "3px 0 0" }}>Quản lý lịch bot</h2>
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>Bấm hủy là cập nhật ngay, không cần F5.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={button} onClick={() => void reload()} disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Nạp lại</button>
                <button style={{ ...button, padding: 9 }} onClick={() => setOpen(false)} aria-label="Đóng"><X size={17} /></button>
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

              {notice ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#86efac", border: "1px solid rgba(34,197,94,.28)", background: "rgba(20,83,45,.18)", borderRadius: 10, padding: 10 }}>
                  <CheckCircle2 size={17} /> {notice}
                </div>
              ) : null}
              {error ? <div style={{ color: "#fca5a5", border: "1px solid rgba(239,68,68,.28)", borderRadius: 10, padding: 10 }}>{error}</div> : null}

              <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                  <div><b>Lịch thời tiết đang bật</b> <span style={{ color: "#64748b" }}>({activeWeather.length})</span></div>
                  {activeWeather.length ? (
                    <button
                      style={dangerButton}
                      disabled={busy}
                      onClick={() => ask({
                        title: `Tắt ${activeWeather.length} lịch thời tiết?`,
                        description: "Tất cả lịch thời tiết đang bật của bot này sẽ dừng ngay. Bạn có thể bật lại sau bằng lệnh chat.",
                        confirmLabel: "Tắt tất cả",
                        run: () => mutate(
                          { action: "weather_disable_all" },
                          (current) => ({ ...current, settings: current.settings.map((row) => ({ ...row, weather_enabled: 0 })) }),
                          `Đã tắt ${activeWeather.length} lịch thời tiết.`
                        )
                      })}
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
                          style={{ ...dangerButton, flexShrink: 0 }}
                          disabled={busy}
                          onClick={() => ask({
                            title: "Hủy lịch thời tiết này?",
                            description: `${chatLabel(row)} · ${row.weather_time || "06:00"} · ${row.weather_location || "TP Hồ Chí Minh"}`,
                            confirmLabel: "Hủy lịch",
                            run: () => mutate(
                              { action: "weather_set", chat_id: row.chat_id, enabled: false },
                              (current) => ({ ...current, settings: current.settings.map((item) => item.chat_id === row.chat_id ? { ...item, weather_enabled: 0 } : item) }),
                              `Đã hủy lịch thời tiết của ${chatLabel(row)}.`
                            )
                          })}
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
                      style={dangerButton}
                      disabled={busy}
                      onClick={() => ask({
                        title: `Hủy ${pendingReminders.length} lịch nhắc việc?`,
                        description: "Các nhắc việc đang chờ của bot này sẽ chuyển sang cancelled và cron sẽ không gửi nữa.",
                        confirmLabel: "Hủy tất cả",
                        run: () => mutate(
                          { action: "reminders_cancel_all" },
                          (current) => ({ ...current, reminders: current.reminders.map((row) => row.status === "pending" ? { ...row, status: "cancelled" } : row) }),
                          `Đã hủy ${pendingReminders.length} lịch nhắc việc.`
                        )
                      })}
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
                          style={{ ...dangerButton, flexShrink: 0 }}
                          disabled={busy}
                          onClick={() => ask({
                            title: "Hủy nhắc việc này?",
                            description: `${row.title || "Việc đã hẹn"} · ${row.due_local_time || "??:??"} ${row.due_local_date || ""}`,
                            confirmLabel: "Hủy nhắc",
                            run: () => mutate(
                              { action: "reminder_cancel", reminder_id: row.id, chat_id: row.chat_id },
                              (current) => ({ ...current, reminders: current.reminders.map((item) => item.id === row.id ? { ...item, status: "cancelled" } : item) }),
                              `Đã hủy nhắc: ${row.title || "Việc đã hẹn"}.`
                            )
                          })}
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

      {confirmAction ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(2,6,23,.72)", backdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: 18 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmAction(null); }}>
          <section role="dialog" aria-modal="true" aria-label={confirmAction.title} style={{ width: "min(460px,94vw)", borderRadius: 18, border: "1px solid rgba(248,113,113,.28)", background: "linear-gradient(180deg,#111c2b 0%,#0b1420 100%)", color: "#e2e8f0", padding: 20, boxShadow: "0 28px 90px rgba(0,0,0,.58)" }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(127,29,29,.3)", color: "#fca5a5", marginBottom: 14 }}><AlertTriangle size={22} /></div>
            <h3 style={{ margin: "0 0 8px", fontSize: 19 }}>{confirmAction.title}</h3>
            <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.6, fontSize: 14 }}>{confirmAction.description}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 20 }}>
              <button style={button} disabled={busy} onClick={() => setConfirmAction(null)}>Giữ lại</button>
              <button style={dangerButton} disabled={busy} onClick={() => void runConfirmed()}>{busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}{confirmAction.confirmLabel}</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
