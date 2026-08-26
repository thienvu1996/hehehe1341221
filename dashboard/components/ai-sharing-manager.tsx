"use client";

import { Bot, BrainCircuit, CheckCircle2, Gauge, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Connection = {
  id: string;
  display_name: string;
  enabled: number | boolean;
};

type Provider = {
  id: string;
  label: string;
  enabled: number | boolean;
  source?: string;
};

type Usage = {
  day_requests: number;
  day_tokens: number;
  month_requests: number;
  month_tokens: number;
};

type Permission = {
  connection_id: string;
  enabled: number | boolean;
  inherit_main: number | boolean;
  provider_ids: string[];
  allow_chat: number | boolean;
  allow_reasoning: number | boolean;
  allow_code: number | boolean;
  daily_request_limit: number;
  daily_token_limit: number;
  monthly_request_limit: number;
  monthly_token_limit: number;
  usage?: Usage;
};

type Draft = {
  enabled: boolean;
  inherit_main: boolean;
  provider_ids: string[];
  allow_chat: boolean;
  allow_reasoning: boolean;
  allow_code: boolean;
  daily_request_limit: number;
  daily_token_limit: number;
  monthly_request_limit: number;
  monthly_token_limit: number;
};

const emptyDraft: Draft = {
  enabled: false,
  inherit_main: true,
  provider_ids: [],
  allow_chat: true,
  allow_reasoning: true,
  allow_code: true,
  daily_request_limit: 0,
  daily_token_limit: 0,
  monthly_request_limit: 0,
  monthly_token_limit: 0
};

const card: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.22)",
  borderRadius: 18,
  background: "rgba(15,23,42,.72)",
  padding: 18,
  boxShadow: "0 18px 50px rgba(2,6,23,.25)"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,.3)",
  background: "rgba(2,6,23,.65)",
  color: "#e2e8f0",
  padding: "10px 12px",
  outline: "none"
};

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: "1px solid rgba(148,163,184,.28)",
  borderRadius: 10,
  background: "rgba(30,41,59,.85)",
  color: "#e2e8f0",
  padding: "9px 12px",
  cursor: "pointer"
};

function asBool(value: unknown) {
  return value === true || Number(value) === 1;
}

function fromPermission(permission?: Permission): Draft {
  if (!permission) return { ...emptyDraft };
  return {
    enabled: asBool(permission.enabled),
    inherit_main: asBool(permission.inherit_main),
    provider_ids: Array.isArray(permission.provider_ids) ? permission.provider_ids : [],
    allow_chat: asBool(permission.allow_chat),
    allow_reasoning: asBool(permission.allow_reasoning),
    allow_code: asBool(permission.allow_code),
    daily_request_limit: Number(permission.daily_request_limit || 0),
    daily_token_limit: Number(permission.daily_token_limit || 0),
    monthly_request_limit: Number(permission.monthly_request_limit || 0),
    monthly_token_limit: Number(permission.monthly_token_limit || 0)
  };
}

export function AiSharingManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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

  const load = async () => {
    if (!sessionStorage.getItem("dashboardSession")) return;
    setBusy(true);
    setError("");
    try {
      const [connectionPayload, permissionPayload] = await Promise.all([
        request("/admin/connections"),
        request("/admin/ai-permissions")
      ]);
      const botRows = (connectionPayload.zalo_connections || []).filter((row: Connection) => row.id !== "main" && asBool(row.enabled));
      setConnections(botRows);
      setProviders((connectionPayload.ai_providers || []).filter((row: Provider) => asBool(row.enabled)));
      setPermissions(permissionPayload.permissions || []);
      const nextSelected = selected || botRows[0]?.id || "";
      setSelected(nextSelected);
      const permission = (permissionPayload.permissions || []).find((row: Permission) => row.connection_id === nextSelected);
      setDraft(fromPermission(permission));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được quyền AI.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const permission = permissions.find((row) => row.connection_id === selected);
    setDraft(fromPermission(permission));
  }, [selected, permissions]);

  const currentPermission = useMemo(
    () => permissions.find((row) => row.connection_id === selected),
    [permissions, selected]
  );

  const currentBot = useMemo(
    () => connections.find((row) => row.id === selected),
    [connections, selected]
  );

  const toggleProvider = (providerId: string) => {
    setDraft((current) => ({
      ...current,
      provider_ids: current.provider_ids.includes(providerId)
        ? current.provider_ids.filter((id) => id !== providerId)
        : [...current.provider_ids, providerId]
    }));
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/admin/ai-permissions", {
        method: "POST",
        body: JSON.stringify({ connection_id: selected, ...draft })
      });
      setNotice(`Đã lưu quyền AI cho ${currentBot?.display_name || selected}.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được quyền AI.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ ...card, maxWidth: 1180, margin: "0 auto 70px", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#a78bfa", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.1 }}>AI sharing permissions</p>
          <h2 style={{ margin: "6px 0" }}>Chia sẻ quyền AI từ Bot chính</h2>
          <p style={{ margin: 0, color: "#94a3b8" }}>Bot chính giữ API key. Bot phụ chỉ được mượn quyền gọi AI theo quyền và hạn mức ở đây, không nhìn thấy API key.</p>
        </div>
        <button style={buttonStyle} onClick={() => void load()} disabled={busy}>
          {busy ? <Loader2 size={16} /> : <RefreshCw size={16} />} Nạp lại
        </button>
      </div>

      {notice ? <div style={{ marginTop: 14, color: "#86efac" }}>{notice}</div> : null}
      {error ? <div style={{ marginTop: 14, color: "#fca5a5" }}>{error}</div> : null}

      {!connections.length ? (
        <div style={{ marginTop: 18, color: "#94a3b8" }}>Chưa có bot phụ. Tạo bot ở phần Zalo Bots trước.</div>
      ) : (
        <>
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(220px,320px) 1fr", gap: 16, alignItems: "start" }}>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>Bot được chia sẻ</span>
                <select style={inputStyle} value={selected} onChange={(event) => setSelected(event.target.value)}>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>{connection.display_name || connection.id}</option>
                  ))}
                </select>
              </label>

              <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 13, padding: 13 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}><Gauge size={17} /><b>Usage hiện tại</b></div>
                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.7 }}>
                  Hôm nay: <b style={{ color: "#e2e8f0" }}>{currentPermission?.usage?.day_requests || 0}</b> lượt · <b style={{ color: "#e2e8f0" }}>{currentPermission?.usage?.day_tokens || 0}</b> token<br />
                  Tháng này: <b style={{ color: "#e2e8f0" }}>{currentPermission?.usage?.month_requests || 0}</b> lượt · <b style={{ color: "#e2e8f0" }}>{currentPermission?.usage?.month_tokens || 0}</b> token
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Chia sẻ AI cho bot này</label>
                <label><input type="checkbox" checked={draft.inherit_main} onChange={(event) => setDraft({ ...draft, inherit_main: event.target.checked })} /> Dùng AI giống Bot chính</label>
              </div>

              <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 13, padding: 13 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}><BrainCircuit size={17} /><b>Loại tác vụ được phép</b></div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <label><input type="checkbox" checked={draft.allow_chat} onChange={(event) => setDraft({ ...draft, allow_chat: event.target.checked })} /> Chat thường</label>
                  <label><input type="checkbox" checked={draft.allow_reasoning} onChange={(event) => setDraft({ ...draft, allow_reasoning: event.target.checked })} /> Reasoning</label>
                  <label><input type="checkbox" checked={draft.allow_code} onChange={(event) => setDraft({ ...draft, allow_code: event.target.checked })} /> Code / SQL</label>
                </div>
              </div>

              {!draft.inherit_main ? (
                <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 13, padding: 13 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}><ShieldCheck size={17} /><b>Provider được mượn</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 9 }}>
                    {providers.map((provider) => (
                      <label key={provider.id} style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, padding: 10 }}>
                        <input type="checkbox" checked={draft.provider_ids.includes(provider.id)} onChange={() => toggleProvider(provider.id)} /> {provider.label || provider.id}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 13, padding: 13 }}>
                <div style={{ marginBottom: 10 }}><b>Giới hạn sử dụng</b> <span style={{ color: "#64748b" }}>0 = không giới hạn</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 12, color: "#94a3b8" }}>Lượt / ngày</span><input style={inputStyle} type="number" min={0} value={draft.daily_request_limit} onChange={(e) => setDraft({ ...draft, daily_request_limit: Number(e.target.value || 0) })} /></label>
                  <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 12, color: "#94a3b8" }}>Token / ngày</span><input style={inputStyle} type="number" min={0} value={draft.daily_token_limit} onChange={(e) => setDraft({ ...draft, daily_token_limit: Number(e.target.value || 0) })} /></label>
                  <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 12, color: "#94a3b8" }}>Lượt / tháng</span><input style={inputStyle} type="number" min={0} value={draft.monthly_request_limit} onChange={(e) => setDraft({ ...draft, monthly_request_limit: Number(e.target.value || 0) })} /></label>
                  <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 12, color: "#94a3b8" }}>Token / tháng</span><input style={inputStyle} type="number" min={0} value={draft.monthly_token_limit} onChange={(e) => setDraft({ ...draft, monthly_token_limit: Number(e.target.value || 0) })} /></label>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button style={{ ...buttonStyle, background: "rgba(30,64,175,.65)" }} onClick={() => void save()} disabled={busy || !selected}>
                  {busy ? <Loader2 size={16} /> : <CheckCircle2 size={16} />} Lưu quyền AI
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "rgba(15,23,42,.55)", color: "#94a3b8", fontSize: 13 }}>
            <Bot size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            Bot chính luôn có toàn quyền AI. Bot phụ chỉ dùng được quyền đã cấp; khi chạm hạn mức, Worker chặn trước khi gọi model nên không tiếp tục tiêu quota.
          </div>
        </>
      )}
    </section>
  );
}
