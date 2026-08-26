"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Cpu, KeyRound, Loader2, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";

type ZaloConnection = {
  id: string;
  display_name: string;
  enabled: number | boolean;
  owner_ids: string;
  webhook_path: string;
  source: string;
  token_configured: number | boolean;
  webhook_secret_configured: number | boolean;
  updated_at?: string | null;
};

type ApiKeyRow = {
  id: string;
  provider_id: string;
  label: string;
  enabled: number | boolean;
  priority: number;
  key_configured: number | boolean;
  success_count?: number;
  failure_count?: number;
  last_used_at?: string | null;
  last_error?: string;
  source?: string;
};

type AiProvider = {
  id: string;
  label: string;
  provider_type: string;
  base_url: string;
  chat_model: string;
  reasoning_model: string;
  code_model: string;
  enabled: number | boolean;
  priority: number;
  source?: string;
  keys: ApiKeyRow[];
};

type ConnectionsPayload = {
  ok: boolean;
  encryption_ready: boolean;
  zalo_connections: ZaloConnection[];
  ai_providers: AiProvider[];
  message?: string;
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

function bool(value: unknown) {
  return value === true || Number(value) === 1;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

export function ConfigManager() {
  const [data, setData] = useState<ConnectionsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [botDraft, setBotDraft] = useState({
    id: "",
    display_name: "",
    token: "",
    webhook_secret: "",
    owner_ids: "",
    enabled: true
  });
  const [providerDraft, setProviderDraft] = useState({
    id: "",
    label: "",
    provider_type: "openai_compatible",
    base_url: "https://api.nexusapi.co/v1",
    chat_model: "grok-4.6",
    reasoning_model: "grok-4.6-high",
    code_model: "coding-agent",
    priority: 100,
    enabled: true
  });
  const [keyDraft, setKeyDraft] = useState({
    provider_id: "",
    label: "",
    api_key: "",
    priority: 100,
    model_allowlist: ""
  });

  const sessionToken = typeof window === "undefined" ? "" : sessionStorage.getItem("dashboardSession") || "";

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
    setBusy(true);
    setError("");
    try {
      const payload = await request("/admin/connections");
      setData(payload);
      const firstManaged = (payload.ai_providers || []).find((row: AiProvider) => row.source !== "cloudflare-env");
      if (!keyDraft.provider_id && firstManaged) setKeyDraft((current) => ({ ...current, provider_id: firstManaged.id }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được cấu hình.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (sessionStorage.getItem("dashboardSession")) void load();
  }, []);

  const managedProviders = useMemo(
    () => (data?.ai_providers || []).filter((provider) => provider.source !== "cloudflare-env"),
    [data]
  );

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(success);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  };

  if (!sessionToken) {
    return (
      <main style={{ maxWidth: 780, margin: "48px auto", padding: 20, color: "#e2e8f0" }}>
        <div style={card}>
          <h1 style={{ marginTop: 0 }}>Cần đăng nhập dashboard</h1>
          <p style={{ color: "#94a3b8" }}>Mở dashboard chính bằng KEY_Dashboard trước, sau đó quay lại trang cấu hình.</p>
          <Link href="/" style={{ color: "#38bdf8" }}>Về dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 18px 70px", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <p style={{ margin: 0, color: "#38bdf8", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2 }}>Runtime connections</p>
          <h1 style={{ margin: "5px 0 0" }}>Kết nối Zalo & AI</h1>
          <p style={{ color: "#94a3b8", marginBottom: 0 }}>Quản lý nhiều bot, nhiều provider và xoay nhiều API key khi key lỗi/quota.</p>
        </div>
        <button style={buttonStyle} onClick={() => void load()} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Nạp lại
        </button>
      </div>

      {!data?.encryption_ready ? (
        <div style={{ ...card, borderColor: "rgba(245,158,11,.5)", marginBottom: 16 }}>
          Chưa có secret mã hóa. Worker cần <b>DASHBOARD_TOKEN</b> hoặc <b>CONFIG_ENCRYPTION_KEY</b> để lưu token/API key mã hóa trong D1.
        </div>
      ) : null}
      {notice ? <div style={{ ...card, borderColor: "rgba(34,197,94,.45)", marginBottom: 16, color: "#86efac" }}>{notice}</div> : null}
      {error ? <div style={{ ...card, borderColor: "rgba(239,68,68,.45)", marginBottom: 16, color: "#fca5a5" }}>{error}</div> : null}

      <section style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}><Bot size={20} /><h2 style={{ margin: 0 }}>Zalo Bots</h2></div>
        <div style={{ display: "grid", gap: 10 }}>
          {(data?.zalo_connections || []).map((connection) => (
            <div key={connection.id} style={{ border: "1px solid rgba(148,163,184,.18)", borderRadius: 14, padding: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <b>{connection.display_name || connection.id}</b> <span style={{ color: "#64748b" }}>({connection.id})</span>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>Webhook: https://bot.jean1331.io.vn{connection.webhook_path || (connection.id === "main" ? "/webhook" : `/webhook/${connection.id}`)}</div>
                </div>
                <div style={{ color: bool(connection.enabled) ? "#86efac" : "#fca5a5", fontSize: 13 }}>
                  {bool(connection.enabled) ? "● Bật" : "● Tắt"} · {connection.source}
                </div>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>
                Token {bool(connection.token_configured) ? "✅" : "❌"} · Webhook secret {bool(connection.webhook_secret_configured) ? "✅" : "❌"} · Owner: {connection.owner_ids || "chưa đặt"}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={buttonStyle} disabled={busy || !bool(connection.token_configured)} onClick={() => void run(
                  () => request("/admin/zalo-connections/register-webhook", { method: "POST", body: JSON.stringify({ id: connection.id }) }),
                  `Đã đăng ký webhook cho ${connection.id}.`
                )}><Webhook size={15} /> Đăng ký webhook</button>
                {connection.source !== "cloudflare-env" ? (
                  <button style={{ ...buttonStyle, color: "#fca5a5" }} disabled={busy} onClick={() => {
                    if (window.confirm(`Xóa bot ${connection.id}?`)) void run(
                      () => request(`/admin/zalo-connections?id=${encodeURIComponent(connection.id)}`, { method: "DELETE" }),
                      `Đã xóa ${connection.id}.`
                    );
                  }}><Trash2 size={15} /> Xóa</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid rgba(148,163,184,.16)", paddingTop: 16 }}>
          <h3 style={{ marginTop: 0 }}><Plus size={16} style={{ verticalAlign: "-3px" }} /> Thêm / cập nhật Zalo Bot</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <Field label="Connection ID"><input style={inputStyle} value={botDraft.id} onChange={(e) => setBotDraft({ ...botDraft, id: e.target.value })} placeholder="sale / rent / bot2" /></Field>
            <Field label="Tên hiển thị"><input style={inputStyle} value={botDraft.display_name} onChange={(e) => setBotDraft({ ...botDraft, display_name: e.target.value })} placeholder="Bot Sale" /></Field>
            <Field label="Zalo Bot Token"><input style={inputStyle} type="password" value={botDraft.token} onChange={(e) => setBotDraft({ ...botDraft, token: e.target.value })} placeholder="Không hiển thị lại sau khi lưu" /></Field>
            <Field label="Webhook Secret"><input style={inputStyle} type="password" value={botDraft.webhook_secret} onChange={(e) => setBotDraft({ ...botDraft, webhook_secret: e.target.value })} placeholder="Secret riêng của bot" /></Field>
            <Field label="Owner Zalo IDs"><input style={inputStyle} value={botDraft.owner_ids} onChange={(e) => setBotDraft({ ...botDraft, owner_ids: e.target.value })} placeholder="id1,id2" /></Field>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
            <label style={{ color: "#94a3b8" }}><input type="checkbox" checked={botDraft.enabled} onChange={(e) => setBotDraft({ ...botDraft, enabled: e.target.checked })} /> Bật connection</label>
            <button style={buttonStyle} disabled={busy || !botDraft.id} onClick={() => void run(async () => {
              await request("/admin/zalo-connections", { method: "POST", body: JSON.stringify(botDraft) });
              setBotDraft({ id: "", display_name: "", token: "", webhook_secret: "", owner_ids: "", enabled: true });
            }, "Đã lưu Zalo Bot.")}><CheckCircle2 size={15} /> Lưu bot</button>
          </div>
        </div>
      </section>

      <section style={card}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}><Cpu size={20} /><h2 style={{ margin: 0 }}>AI Providers & API Keys</h2></div>
        <p style={{ color: "#94a3b8" }}>Provider dashboard được ưu tiên theo số Priority nhỏ hơn. Trong mỗi provider, bot thử key theo priority; key lỗi sẽ tăng failure count và bot tự thử key tiếp theo, sau cùng mới rơi về cấu hình Cloudflare Env.</p>
        <div style={{ display: "grid", gap: 12 }}>
          {(data?.ai_providers || []).map((provider) => (
            <div key={provider.id} style={{ border: "1px solid rgba(148,163,184,.18)", borderRadius: 14, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><b>{provider.label || provider.id}</b> <span style={{ color: "#64748b" }}>({provider.id})</span></div>
                <span style={{ color: bool(provider.enabled) ? "#86efac" : "#fca5a5", fontSize: 13 }}>{bool(provider.enabled) ? "● Bật" : "● Tắt"} · P{provider.priority} {provider.source ? `· ${provider.source}` : ""}</span>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>{provider.provider_type} · {provider.base_url}</div>
              <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 4 }}>Chat: {provider.chat_model || "-"} · Reasoning: {provider.reasoning_model || "-"} · Code: {provider.code_model || "-"}</div>
              <div style={{ marginTop: 10, display: "grid", gap: 7 }}>
                {(provider.keys || []).map((key) => (
                  <div key={key.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 10px", background: "rgba(2,6,23,.42)", borderRadius: 10 }}>
                    <div><KeyRound size={14} style={{ verticalAlign: "-2px" }} /> {key.label || key.id} <span style={{ color: "#64748b", fontSize: 11 }}>P{key.priority ?? "-"} · ok {key.success_count ?? 0} / lỗi {key.failure_count ?? 0}</span>{key.last_error ? <div style={{ color: "#fca5a5", fontSize: 11, marginTop: 3 }}>{key.last_error}</div> : null}</div>
                    {provider.source !== "cloudflare-env" ? <button style={{ ...buttonStyle, padding: "6px 8px", color: "#fca5a5" }} onClick={() => {
                      if (window.confirm(`Xóa API key ${key.label || key.id}?`)) void run(
                        () => request(`/admin/ai-api-keys?id=${encodeURIComponent(key.id)}`, { method: "DELETE" }),
                        "Đã xóa API key."
                      );
                    }}><Trash2 size={14} /></button> : null}
                  </div>
                ))}
              </div>
              {provider.source !== "cloudflare-env" ? <div style={{ marginTop: 10 }}><button style={{ ...buttonStyle, color: "#fca5a5" }} onClick={() => {
                if (window.confirm(`Xóa provider ${provider.id} và toàn bộ key?`)) void run(
                  () => request(`/admin/ai-providers?id=${encodeURIComponent(provider.id)}`, { method: "DELETE" }),
                  `Đã xóa provider ${provider.id}.`
                );
              }}><Trash2 size={14} /> Xóa provider</button></div> : null}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid rgba(148,163,184,.16)", paddingTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Thêm / cập nhật AI Provider</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
            <Field label="Provider ID"><input style={inputStyle} value={providerDraft.id} onChange={(e) => setProviderDraft({ ...providerDraft, id: e.target.value })} placeholder="nexus-grok / openai / gemini2" /></Field>
            <Field label="Tên"><input style={inputStyle} value={providerDraft.label} onChange={(e) => setProviderDraft({ ...providerDraft, label: e.target.value })} placeholder="Nexus Grok" /></Field>
            <Field label="Loại"><select style={inputStyle} value={providerDraft.provider_type} onChange={(e) => setProviderDraft({ ...providerDraft, provider_type: e.target.value })}><option value="openai_compatible">OpenAI-compatible</option><option value="gemini">Gemini API</option></select></Field>
            <Field label="Base URL"><input style={inputStyle} value={providerDraft.base_url} onChange={(e) => setProviderDraft({ ...providerDraft, base_url: e.target.value })} /></Field>
            <Field label="Chat model"><input style={inputStyle} value={providerDraft.chat_model} onChange={(e) => setProviderDraft({ ...providerDraft, chat_model: e.target.value })} /></Field>
            <Field label="Reasoning model"><input style={inputStyle} value={providerDraft.reasoning_model} onChange={(e) => setProviderDraft({ ...providerDraft, reasoning_model: e.target.value })} /></Field>
            <Field label="Code model"><input style={inputStyle} value={providerDraft.code_model} onChange={(e) => setProviderDraft({ ...providerDraft, code_model: e.target.value })} /></Field>
            <Field label="Priority"><input style={inputStyle} type="number" value={providerDraft.priority} onChange={(e) => setProviderDraft({ ...providerDraft, priority: Number(e.target.value) })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
            <label style={{ color: "#94a3b8" }}><input type="checkbox" checked={providerDraft.enabled} onChange={(e) => setProviderDraft({ ...providerDraft, enabled: e.target.checked })} /> Bật provider</label>
            <button style={buttonStyle} disabled={busy || !providerDraft.id || !providerDraft.chat_model} onClick={() => void run(async () => {
              await request("/admin/ai-providers", { method: "POST", body: JSON.stringify(providerDraft) });
              setKeyDraft((current) => ({ ...current, provider_id: providerDraft.id }));
            }, "Đã lưu AI provider.")}><CheckCircle2 size={15} /> Lưu provider</button>
          </div>
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid rgba(148,163,184,.16)", paddingTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Thêm API Key</h3>
          {managedProviders.length === 0 ? <p style={{ color: "#94a3b8" }}>Tạo provider dashboard trước rồi mới thêm key.</p> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
                <Field label="Provider"><select style={inputStyle} value={keyDraft.provider_id} onChange={(e) => setKeyDraft({ ...keyDraft, provider_id: e.target.value })}><option value="">Chọn provider</option>{managedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}</select></Field>
                <Field label="Tên key"><input style={inputStyle} value={keyDraft.label} onChange={(e) => setKeyDraft({ ...keyDraft, label: e.target.value })} placeholder="Key 1 / Key dự phòng" /></Field>
                <Field label="API Key"><input style={inputStyle} type="password" value={keyDraft.api_key} onChange={(e) => setKeyDraft({ ...keyDraft, api_key: e.target.value })} placeholder="Không hiển thị lại sau khi lưu" /></Field>
                <Field label="Priority"><input style={inputStyle} type="number" value={keyDraft.priority} onChange={(e) => setKeyDraft({ ...keyDraft, priority: Number(e.target.value) })} /></Field>
                <Field label="Chỉ cho model (tuỳ chọn)"><input style={inputStyle} value={keyDraft.model_allowlist} onChange={(e) => setKeyDraft({ ...keyDraft, model_allowlist: e.target.value })} placeholder="grok-4.6,grok-4.6-high" /></Field>
              </div>
              <button style={{ ...buttonStyle, marginTop: 12 }} disabled={busy || !keyDraft.provider_id || !keyDraft.api_key} onClick={() => void run(async () => {
                await request("/admin/ai-api-keys", {
                  method: "POST",
                  body: JSON.stringify({
                    provider_id: keyDraft.provider_id,
                    label: keyDraft.label,
                    api_key: keyDraft.api_key,
                    priority: keyDraft.priority,
                    enabled: true,
                    model_allowlist: keyDraft.model_allowlist.split(",").map((v) => v.trim()).filter(Boolean)
                  })
                });
                setKeyDraft((current) => ({ ...current, label: "", api_key: "", model_allowlist: "" }));
              }, "Đã thêm API key.")}><Plus size={15} /> Thêm key</button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
